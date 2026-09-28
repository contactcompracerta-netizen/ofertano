/**
 * CATALOG_ARCHITECTURE_V1 — MARKETPLACE PUBLIC SYNC V1 (FASE 9.9).
 *
 * Runner GENERICO de coleta -> publicacao publica. Nao existe
 * `if (marketplaceId === "shopee")` neste arquivo: o marketplace entra
 * inteiro pela `PublicSyncConfig`.
 *
 * PIPELINE (FASE 9.4):
 *   connector.collect()
 *     -> validate
 *     -> blocking-key lookup INDEXADO
 *     -> IdentityPolicy (EXACT unico, sem hard conflict)
 *     -> selecao determinista da oferta vencedora
 *     -> commit canonico + publication gate central
 *     -> metricas
 *
 * FAIL-CLOSED (FASE 9.24): credencial ausente, API offline, identidade fraca,
 * link invalido, ambiguidade ou erro de DB nao publicam item novo. A execucao
 * continua com os demais itens quando e seguro, e a falha fica registrada.
 *
 * DRY-RUN DEFAULT (FASE 9.14): sem `--apply`, ZERO escrita no banco.
 */

import type { MarketplaceConnector } from "../types/connector";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import { resolveProbeIdentity, type IdentityResolverDeps, type ProbeIdentityResultV1 } from "./identityResolver";
import { resolvePurchaseLinks, noPurchaseLinks } from "./purchaseLinks";
import { selectWinningOffer } from "./offerWriter";
import { authorizePublicSync, type PublicSyncAllowlist } from "./flags";
import type {
  PublicOfferDraftV1,
  PublicSyncConfig,
  PublicSyncDeps,
  PublicSyncReportV1,
} from "./types";

/**
 * Capacidade OPCIONAL de conector: preservar o payload bruto por
 * externalListingId, para releitura dos links de compra.
 *
 * Deliberadamente um tipo ESTRUTURAL local, e nao um metodo novo em
 * `MarketplaceConnector`: a FASE 9.8 proibe alterar o contrato global por causa
 * de uma peculiaridade de um conector. Um conector que preserva o bruto expoe o
 * metodo; um que nao preserva simplesmente nao expoe, e o runner trata como
 * "sem link disponivel" em vez de inventar um.
 */
type RawPayloadPreserving = {
  rawPayloadFor(externalListingId: string): unknown | null;
};

function rawPayloadReader(
  connector: MarketplaceConnector,
): ((externalListingId: string) => unknown | null) | null {
  const candidate = connector as Partial<RawPayloadPreserving>;
  return typeof candidate.rawPayloadFor === "function"
    ? (id: string) => candidate.rawPayloadFor!(id)
    : null;
}

export interface RunPublicSyncOptions {
  dryRun: boolean;
  /** teto de listings coletados nesta execucao. */
  maxListings?: number;
  /** cursor de coleta (retomada). */
  fromCursor?: string | null;
  /** substitui a allowlist autoritativa (apenas teste). */
  allowlistOverride?: PublicSyncAllowlist;
}

function emptyReport(config: PublicSyncConfig, dryRun: boolean): PublicSyncReportV1 {
  return {
    MODE: dryRun ? "DRY_RUN" : "APPLY",
    MARKETPLACE_ID: config.marketplaceId,
    WRITER_MODE: "OFF",
    ATTACH_ONLY: true,
    MAX_LISTINGS: config.maxListings,
    LISTINGS_COLLECTED: 0,
    COLLECT_CALLS: 0,
    COLLECT_PARTIAL: false,
    LISTINGS_VALID: 0,
    LISTINGS_WITH_KEYS: 0,
    LISTINGS_WITHOUT_KEYS: 0,
    CANDIDATES: 0,
    EXACT_UNIQUE: 0,
    REVIEW: 0,
    REJECT: 0,
    HARD_CONFLICT: 0,
    AMBIGUOUS_EXACT: 0,
    NO_CANDIDATES: 0,
    NO_EXACT: 0,
    MISSING_AFFILIATE_LINK: 0,
    INVALID_LINK: 0,
    WOULD_WRITE: 0,
    WRITES: 0,
    WRITES_CREATED: 0,
    WRITES_UPDATED: 0,
    WRITES_NOOP: 0,
    PRODUCTS_CREATED: 0,
    REVIEW_PUBLISHED: 0,
    REJECT_PUBLISHED: 0,
    HARD_CONFLICT_PUBLISHED: 0,
    AMBIGUOUS_PUBLISHED: 0,
    PROBES: [],
    ERROR: null,
  };
}

/**
 * Deriva o draft de oferta a partir de uma listing aceita e dos links
 * resolvidos. Nao inventa nenhum campo: cada um vem da listing normalizada ou
 * do payload bruto da fonte (FASE 9.11).
 */
function toOfferDraft(
  listing: NormalizedMarketplaceListingV1,
  productId: string,
  links: ReturnType<typeof resolvePurchaseLinks>,
): PublicOfferDraftV1 {
  return {
    marketplaceId: listing.marketplaceId,
    productId,
    externalId: listing.externalListingId,
    title: listing.catalog.title,
    seller: typeof listing.seller.name === "string" ? listing.seller.name : null,
    image: listing.catalog.primaryImageUrl ?? listing.catalog.images[0] ?? null,
    price: listing.commerce.price,
    sourceUrl: links.sourceUrl,
    affiliateLink: links.affiliateLink,
    // A fonte nao expoe estoque (capacidade stock=false). O conector traduz
    // preco>0 para IN_STOCK; qualquer outro estado nao infere disponibilidade.
    available: listing.commerce.availability === "IN_STOCK",
    matchStatus: "EXACT",
    discoverySource: "API",
  };
}

/**
 * Executa UM ciclo de sync publico.
 *
 * Nao lanca por falha de fonte nem por falha de identidade: registra e segue.
 * A unica excecao que escapa e a falta de autorizacao de escrita, que e erro
 * de OPERACAO (chamar o runner errado nao e um bug de dados) e precisa
 * aparecer em vez de virar um relatorio vazio e silencioso.
 */
export async function runMarketplacePublicSync(
  config: PublicSyncConfig,
  deps: PublicSyncDeps,
  options: RunPublicSyncOptions,
): Promise<PublicSyncReportV1> {
  const dryRun = options.dryRun;
  const report = emptyReport(config, dryRun);

  // 0. autorizacao de escrita (FASE 9.30). Fail-closed: nada e coletado se o
  // marketplace nao esta explicitamente autorizado a escrever oferta publica.
  const authorization = authorizePublicSync(
    config.marketplaceId,
    options.allowlistOverride,
  );
  if (!authorization.authorized) {
    report.WRITER_MODE = authorization.reason;
    report.ERROR = `WRITER_NOT_AUTHORIZED: ${authorization.reason}`;
    return report;
  }
  report.WRITER_MODE = authorization.mode;

  // 1. coleta (FASE 9.9).
  //
  // O conector avanca UMA consulta por cursor (uma keyword por chamada), entao
  // o runner itera ate exhausting o cursor, o teto de listings, ou uma falha.
  // Falha de coleta no MEIO do recorrido nao descarta o que ja foi coletado:
  // as listings anteriores continuam fail-closed na identidade e podem ser
  // aceitas. Falha na PRIMEIRA chamada nao tem nada a processar e aborta.
  const maxListings = options.maxListings ?? config.maxListings;
  const collected: NormalizedMarketplaceListingV1[] = [];
  let cursor: string | null = options.fromCursor ?? null;
  let collectFailed = false;
  let collectCalls = 0;

  // Teto de chamadas: protege contra cursor que nunca avanca.
  const MAX_COLLECT_CALLS = 64;

  do {
    let batch;
    try {
      batch = await config.connector.collect(cursor);
    } catch (error) {
      report.ERROR = `COLLECT_FAILED: ${error instanceof Error ? error.name : "UNKNOWN"}`;
      collectFailed = true;
      break;
    }
    for (const item of batch.items ?? []) {
      if (collected.length >= maxListings) break;
      collected.push(item);
    }
    cursor = batch.nextCursor ?? null;
    collectCalls += 1;
  } while (cursor !== null && collected.length < maxListings && collectCalls < MAX_COLLECT_CALLS);

  report.COLLECT_CALLS = collectCalls;
  report.COLLECT_PARTIAL = collectFailed && collected.length > 0;

  if (collectFailed && collected.length === 0) {
    return report;
  }

  const listings = collected.slice(0, maxListings);
  report.LISTINGS_COLLECTED = listings.length;

  const readRaw = rawPayloadReader(config.connector);
  const resolverDeps: IdentityResolverDeps = {
    keys: deps.keys,
    products: deps.products,
    evaluate: deps.evaluate,
    brandLexicon: config.brandLexicon,
  };

  // 2. validacao + identity, listing a listing. Os drafts aceitos sao
  // acumulados por (productId) para que a selecao determinista (FASE 9.10)
  // happenca sobre TODAS as listings aceitas do mesmo Product.
  const draftsByProduct = new Map<string, PublicOfferDraftV1[]>();

  for (const listing of listings) {
    // validate(): rejeicao de payload e rejeicao de DADOS, nao erro de sistema.
    if (config.connector.validate(listing).length > 0) continue;
    report.LISTINGS_VALID += 1;

    let probe: ProbeIdentityResultV1;
    try {
      probe = await resolveProbeIdentity(listing, resolverDeps);
    } catch {
      // Erro inesperado na resolucao: nao publica esta listing, segue a proxima.
      report.ERROR = report.ERROR ?? "IDENTITY_RESOLVE_FAILED";
      continue;
    }
    report.PROBES.push(probe);

    if (probe.blockingKeys.length > 0) report.LISTINGS_WITH_KEYS += 1;
    else report.LISTINGS_WITHOUT_KEYS += 1;

    report.CANDIDATES += probe.candidateCount;
    report.REJECT += probe.rejectCount;
    report.HARD_CONFLICT += probe.hardConflictCount;

    switch (probe.outcome) {
      case "AMBIGUOUS_EXACT":
        report.AMBIGUOUS_EXACT += 1;
        continue;
      case "NO_EXACT":
        report.NO_EXACT += 1;
        continue;
      case "NO_CANDIDATES":
        report.NO_CANDIDATES += 1;
        continue;
      case "EXACT_UNIQUE":
        report.EXACT_UNIQUE += 1;
        break;
      case "REVIEW":
        report.REVIEW += 1;
        continue;
      case "REJECT":
        report.REJECT += 1;
        continue;
    }

    // EXACT_UNIQUE sempre tem winner; se nao tem, e violacao de contrato do
    // resolver, e falamos fechado em vez de gravar sem Product resolvido.
    if (probe.winnerProductId === null) {
      report.ERROR = report.ERROR ?? "EXACT_UNIQUE_WITHOUT_WINNER";
      continue;
    }

    // Links de compra lidos do payload BRUTO preservado (FASE 9.7 / 9.8).
    const rawPayload = readRaw ? readRaw(listing.externalListingId) : null;
    const links =
      rawPayload === null || rawPayload === undefined
        ? noPurchaseLinks()
        : resolvePurchaseLinks(config.purchaseLinks.extract(rawPayload));

    if (links.affiliateState === "MISSING") report.MISSING_AFFILIATE_LINK += 1;
    if (links.affiliateState === "INVALID" || links.sourceState === "INVALID") {
      report.INVALID_LINK += 1;
    }

    const draft = toOfferDraft(listing, probe.winnerProductId, links);
    const bucket = draftsByProduct.get(draft.productId);
    if (bucket) bucket.push(draft);
    else draftsByProduct.set(draft.productId, [draft]);
  }

  // 3. selecao determinista + commit (FASE 9.10 / 9.12)
  for (const drafts of draftsByProduct.values()) {
    const winner = selectWinningOffer(drafts);
    if (winner === null) continue;
    report.WOULD_WRITE += 1;

    try {
      const result = await deps.writer.commit(winner, { dryRun });
      if (result.action === "CREATE") report.WRITES_CREATED += 1;
      else if (result.action === "UPDATE") report.WRITES_UPDATED += 1;
      else report.WRITES_NOOP += 1;
      if (!dryRun && result.changed) report.WRITES += 1;
    } catch {
      // Falha de DB e por ITEM: nao publica, segue, e registra.
      report.ERROR = report.ERROR ?? "COMMIT_FAILED";
    }
  }

  return report;
}
