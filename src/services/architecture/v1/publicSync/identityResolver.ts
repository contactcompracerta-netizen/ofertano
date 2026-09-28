/**
 * CATALOG_ARCHITECTURE_V1 — RESOLVEDOR DE IDENTIDADE DO WRITER PUBLICO (FASE 9.5).
 *
 * Dada UMA listing normalizada de marketplace, resolve qual Product ela e — ou
 * decide que NAO e. O caminho e fail-closed em cada degrau:
 *
 *   1. deriva blocking keys da listing
 *   2. consulta CandidateBlockingKey POR INDICE (nunca full scan, nunca
 *      LIKE '%title%', nunca cartesiano)
 *   3. para cada Product candidato, avalia `evaluateIdentityConfidence` contra
 *      as ofertas COUNTERPART (marketplace diferente) desse Product, e fica com
 *      a MELHOR decisao do par
 *   4. aceita SOMENTE `confidence === EXACT` com `hardConflicts.length === 0`
 *      no par vencedor
 *   5. exige EXATAMENTE 1 Product EXACT:
 *        0   -> NO_EXACT (nao publica)
 *        1   -> EXACT_UNIQUE (publicavel)
 *        >=2 -> AMBIGUOUS_EXACT (nao publica NENHUM)
 *
 * SEMANTICA DO HARD CONFLICT: o veto vale PARA O PAR VENCEDOR, nao para a
 * Probe inteira. Um Product pode ter uma oferta conflitante e outra
 * corroborante; a corretude da identidade depende do par que realmente
 * compara as duas fontes. Exigir zero conflito em todo o Product descartaria
 * matches legitimos. O que NUNCA e permitido e um par vencedor com conflito.
 *
 * O `productId` da verdade nunca e fornecido aqui: ele sai do INDICE, e o
 * indice e materializado a partir dos campos estruturados de cada Product.
 * Esse e o mesmo principio da blind rediscovery ja certificada.
 */

import { buildBlockingKeys, type BlockingKeyType } from "../identity/candidateGeneration";
import { evaluateIdentityConfidence } from "../identity/identityConfidence";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import type { ProbeIdentityResultV1 } from "./types";
import type {
  BlockingKeyLookup,
  IdentityEvaluator,
  ProductListingLoader,
} from "./types";

export type { ProbeIdentityResultV1 };

export interface IdentityResolverDeps {
  keys: BlockingKeyLookup;
  products: ProductListingLoader;
  evaluate: IdentityEvaluator;
  /** lexico de marcas usado na derivacao de chaves. */
  brandLexicon: ReadonlySet<string>;
  /** teto de candidatos por listing (o indice ja limita; aqui e defense-in-depth). */
  maxCandidatesPerListing?: number;
}

function emptyResult(
  marketplaceId: string,
  externalListingId: string,
  blockingKeys: Array<{ type: BlockingKeyType; normalizedValue: string }>,
  outcome: ProbeIdentityResultV1["outcome"],
): ProbeIdentityResultV1 {
  return {
    marketplaceId,
    externalListingId,
    blockingKeys,
    candidateCount: 0,
    evaluatedPairs: 0,
    exactProductIds: [],
    reviewCount: 0,
    rejectCount: 0,
    hardConflictCount: 0,
    outcome,
    winnerProductId: null,
    decision: null,
  };
}

/**
 * Ordem de forca de uma decisao.
 *
 * Um EXACT que carrega hard conflict e internamente inconsistente — a policy
 * certificada nunca produz um, mas o writer nao pode depender dessa promessa
 * para ordenar: se dois pares do mesmo Product voltarem EXACT, o par SEM
 * conflito tem de ser preferido, senao um conflito alheio derruba uma
 * identidade legitima. Entao a ordem e (confianca, ausencia de conflito):
 *   EXACT sem conflito > EXACT com conflito > REVIEW > REJECT
 */
function decisionRank(decision: { confidence: string; hardConflicts: unknown[] }): number {
  const base = decision.confidence === "EXACT" ? 3 : decision.confidence === "REVIEW" ? 2 : 1;
  return decision.hardConflicts.length === 0 ? base * 2 : base * 2 - 1;
}

/** true quando `next` e uma decisao mais forte que `current`. */
function isStronger(
  next: { confidence: string; hardConflicts: unknown[] },
  current: { confidence: string; hardConflicts: unknown[] },
): boolean {
  return decisionRank(next) > decisionRank(current);
}

/**
 * Resolve a identidade de UMA listing.
 * Nunca lanca por dados de fonte: uma decisao negativa e um resultado.
 */
export async function resolveProbeIdentity(
  listing: NormalizedMarketplaceListingV1,
  deps: IdentityResolverDeps,
): Promise<ProbeIdentityResultV1> {
  const { marketplaceId, externalListingId } = listing;
  const maxCandidates = deps.maxCandidatesPerListing ?? 20;

  // 1. blocking keys da listing
  const derived = buildBlockingKeys(listing, { brandLexicon: deps.brandLexicon });
  const blockingKeys = derived.map((k: { type: BlockingKeyType; normalizedValue: string }) => ({
    type: k.type,
    normalizedValue: k.normalizedValue,
  }));

  if (blockingKeys.length === 0) {
    return emptyResult(marketplaceId, externalListingId, blockingKeys, "NO_CANDIDATES");
  }

  // 2. lookup INDEXADO, acumulando ProductIds distintos
  const found = new Set<string>();
  for (const key of blockingKeys) {
    if (found.size >= maxCandidates) break;
    const hits = await deps.keys.lookup(key.type, key.normalizedValue);
    for (const productId of hits) {
      if (found.size >= maxCandidates) break;
      found.add(productId);
    }
  }

  const candidateIds = [...found];
  if (candidateIds.length === 0) {
    return emptyResult(marketplaceId, externalListingId, blockingKeys, "NO_CANDIDATES");
  }

  // 3. IdentityPolicy sobre cada candidato, escolhendo a MELHOR decisao entre
  // as ofertas counterpart do Product.
  const exactProductIds: string[] = [];
  let reviewCount = 0;
  let rejectCount = 0;
  let hardConflictCount = 0;
  let evaluatedPairs = 0;
  let winningDecision: ProbeIdentityResultV1["decision"] = null;

  for (const productId of candidateIds) {
    const counterparts = await deps.products.loadAll(productId, marketplaceId);
    let best: ProbeIdentityResultV1["decision"] = null;

    for (const candidate of counterparts) {
      const decision = deps.evaluate(listing, candidate);
      evaluatedPairs += 1;
      hardConflictCount += decision.hardConflicts.length;
      if (best === null || isStronger(decision, best)) {
        best = decision;
      }
    }

    if (best === null) continue;

    if (best.confidence === "EXACT" && best.hardConflicts.length === 0) {
      exactProductIds.push(productId);
      if (winningDecision === null) winningDecision = best;
    } else if (best.confidence === "REVIEW") {
      reviewCount += 1;
    } else {
      rejectCount += 1;
    }
  }

  const base = {
    marketplaceId,
    externalListingId,
    blockingKeys,
    candidateCount: candidateIds.length,
    evaluatedPairs,
    exactProductIds,
    reviewCount,
    rejectCount,
    hardConflictCount,
  };

  // 4. fail-closed na ambiguidade: 2 Products EXACT = nao publica nenhum.
  if (exactProductIds.length > 1) {
    return { ...base, outcome: "AMBIGUOUS_EXACT", winnerProductId: null, decision: winningDecision };
  }

  if (exactProductIds.length === 0) {
    return {
      ...base,
      outcome: evaluatedPairs === 0 ? "NO_CANDIDATES" : "NO_EXACT",
      winnerProductId: null,
      decision: null,
    };
  }

  // 5. EXATAMENTE 1 EXACT cujo par vencedor nao tem hard conflict.
  return { ...base, outcome: "EXACT_UNIQUE", winnerProductId: exactProductIds[0], decision: winningDecision };
}

/** Atalho de producao: a policy certificada, injetada por padrao. */
export const CERTIFIED_IDENTITY_EVALUATOR: IdentityEvaluator = evaluateIdentityConfidence;
