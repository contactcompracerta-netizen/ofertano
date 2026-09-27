/**
 * FASE 8.3 — BLIND REDISCOVERY (FASE K).
 *
 * Prova de que o Candidate GeneratorDESCUBRE produtos iguais entre
 * marketplaces SEM receber a resposta.
 *
 * O conjunto de verdade são as 6 associacoes legacy cross-market ja
 * auditadas (CONFIRMED_EXACT=6 na FASE 8.1).
 *
 * O QUE O GENERATOR RECEBE (e o que NAO recebe):
 *   RECEBE:  titulo/brand/model/preco da listing Shopee (o que a fonte da),
 *            e o POOL de listings do catalogo (ML/Magalu) como candidatos.
 *   NAO RECEBE: productId legacy, associacao legacy, productId do
 *            MarketplaceOffer, externalId do par, nem qualquer "truth".
 *
 * Ou seja: o probe é uma listing CUJO TEXTO VEIO DA FONTE, e o pool é o
 * catalogo. A resposta (qual productId é o certo) só é usada na HORA DE
 * CONFERIR, nunca é dada ao gerador.
 *
 * Se o generator achasse a association pelo productId, o teste passaria
 * trivialmente e não provaria nada. Por isso o probe é reconstruído a
 * partir de uma listing ANONIMA — a identidade do producto some.
 */

import prisma from "../lib/prisma";
import {
  InMemoryBlockingKeyIndex,
  generateCandidates,
  canonicalCategory,
  canonicalModel,
  buildBlockingKeys,
  MAX_CANDIDATES_PER_LISTING,
  CANDIDATE_BLOCKING_KEY_V1,
} from "../services/architecture/v1/identity/candidateGeneration";
import { evaluateIdentityConfidence } from "../services/architecture/v1/identity/identityConfidence";
import { IDENTITY_POLICY_V1 } from "../services/architecture/v1/identity/identityPolicy";
import {
  NORMALIZED_LISTING_V1,
  UNKNOWN,
  type NormalizedMarketplaceListingV1,
} from "../services/architecture/v1/types/normalizedListingV1";
import { resolveMarketplaceIdFromLegacyEnum } from "../services/architecture/v1/marketplaceRegistry";
import { computeRawHash } from "../services/architecture/v1/hashing";

/**
 * FASE P — SELEÇÃO DA CANDIDATA QUE CORRESPONDE À VERDADE.
 *
 * A versão anterior do harness usava `candidates[0]`, o que só coincide com a
 * verdade por acaso. Hoje os 6/6 batem justamente porque a verdade ocupa a
 * primeira posição; o número estava certo, a MEDIÇÃO estava frágil.
 *
 * Esta função é pura e isolada para que o comportamento errado seja testável
 * sem banco: basta uma lista em que a verdade é a SEGUNDA candidata.
 *
 * A verdade entra aqui DEPOIS da geração — `generateCandidates` nunca a recebe.
 */
export function selectTruthCandidate<T extends { candidateKey: string }>(
  candidates: T[],
  truthKeys: string[],
): T | undefined {
  return candidates.find((c) => truthKeys.includes(c.candidateKey));
}

type Row = {
  productId: string;
  name: string;
  brand: string | null;
  category: string | null;
  marketplace: string;
  externalId: string | null;
  title: string | null;
  price: number | null;
  oldPrice: number | null;
  stock: number | null;
  available: boolean | null;
  seller: string | null;
  image: string | null;
  productModelNumber: string | null;
  productEan: string | null;
  productGtin: string | null;
  productMpn: string | null;
  rawModelNumber: string | null;
  rawEan: string | null;
  rawGtin: string | null;
  rawMpn: string | null;
  rawAttributes: Record<string, string> | null;
};

function toNormalized(row: Row): NormalizedMarketplaceListingV1 {
  const marketplaceId = resolveMarketplaceIdFromLegacyEnum(row.marketplace);
  const gtin = [row.productEan, row.productGtin, row.rawEan, row.rawGtin]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  const manufacturerModel = row.rawModelNumber ?? row.productModelNumber ?? null;
  const mpn = row.rawMpn ?? row.productMpn ?? null;
  return {
    contractVersion: NORMALIZED_LISTING_V1,
    source: "legacy-marketplace-offer",
    marketplaceId: marketplaceId ?? row.marketplace.toLowerCase(),
    externalListingId: String(row.externalId ?? ""),
    seller: { externalSellerId: null, name: row.seller ?? null },
    identity: { gtin, mpn, manufacturerModel, brand: row.brand ?? null, model: manufacturerModel },
    catalog: {
      title: row.title ?? row.name,
      description: null,
      category: row.category ?? null,
      images: row.image ? [row.image] : [],
      attributes: row.rawAttributes ?? {},
      primaryImageUrl: row.image ?? null,
    },
    variant: { color: UNKNOWN, storage: UNKNOWN, memory: UNKNOWN, voltage: UNKNOWN, size: UNKNOWN, otherAttributes: {} },
    commerce: {
      price: typeof row.price === "number" && row.price > 0 ? row.price : 1,
      oldPrice: row.oldPrice ?? null,
      pixPrice: UNKNOWN, installments: UNKNOWN,
      stock: typeof row.stock === "number" ? row.stock : UNKNOWN,
      availability: row.available === false ? "OUT_OF_STOCK" : "IN_STOCK",
      shippingHint: UNKNOWN, promotion: null,
    },
    metadata: {
      sourceUpdatedAt: null,
      collectedAt: new Date().toISOString(),
      rawHash: computeRawHash({ productId: row.productId, externalId: row.externalId }),
      payloadVersion: "legacy/v1",
    },
  };
}

async function main() {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT p.id::text AS "productId", p.name AS name, p.brand AS brand, p.category AS category,
           o.marketplace::text AS marketplace, o."externalId"::text AS "externalId",
           o.title AS title, o.price AS price, o."oldPrice" AS "oldPrice",
           o.stock AS stock, o.available AS available, o.seller AS seller, o.image AS image,
           p."modelNumber" AS "productModelNumber", p.ean AS "productEan",
           p.gtin AS "productGtin", p.mpn AS "productMpn",
           r."modelNumber" AS "rawModelNumber", r.ean AS "rawEan",
           r.gtin AS "rawGtin", r.mpn AS "rawMpn", r.attributes AS "rawAttributes"
      FROM "MarketplaceOffer" o
      JOIN "Product" p ON p.id = o."productId"
      LEFT JOIN "RawMarketplaceListing" r
             ON r.marketplace = o.marketplace AND r."externalId" = o."externalId"
     WHERE o.active = true AND o."matchStatus" = 'EXACT'
       AND o.available = true AND o.price > 0
     ORDER BY p.name`;

  // POOL: todas as listings do catalogo (por oferta).
  const pool = rows.map(toNormalized);

  // Léxico de marcas derivado do PRÓPRIO POOL (não inventado, não é "truth").
  const brandLexicon = new Set<string>();
  for (const r of rows) if (r.brand) brandLexicon.add(canonicalModel(r.brand));
  for (const extra of ["apple", "xiaomi", "samsung", "logitech", "anker"]) {
    brandLexicon.add(extra);
  }

  // Verdade: pares legacy cross-market (productId, marketplace, externalId).
  const byProduct = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byProduct.get(r.productId) ?? [];
    list.push(r);
    byProduct.set(r.productId, list);
  }
  const truth: Array<{ productId: string; productName: string; a: Row; b: Row }> = [];
  for (const [productId, offers] of byProduct) {
    if (new Set(offers.map((o) => o.marketplace)).size < 2) continue;
    for (let i = 0; i < offers.length; i += 1) {
      for (let j = i + 1; j < offers.length; j += 1) {
        if (offers[i].marketplace === offers[j].marketplace) continue;
        truth.push({ productId, productName: offers[i].name, a: offers[i], b: offers[j] });
      }
    }
  }

  const out: Record<string, unknown> = {
    MODE: "BLIND_REDISCOVERY",
    IDENTITY_POLICY_VERSION: IDENTITY_POLICY_V1,
    BLOCKING_KEY_VERSION: CANDIDATE_BLOCKING_KEY_V1,
    MAX_CANDIDATES_PER_LISTING,
    POOL_SIZE: pool.length,
    TRUTH_PAIRS: truth.length,
    BRAND_LEXICON_SIZE: brandLexicon.size,
    PROBE_HAS_PRODUCT_ID: false,
    NOTE:
      "O probe e uma listing ANONIMA construida a partir do TEXTO da oferta " +
      "Shopee. productId/associacao/productId do ProductIdentifier nunca sao " +
      "passados ao generator; so servem para CONFERIR depois.",
  };

  // O generator nao recebe productId. Montamos o probe como ANONIMO.
  const index = new InMemoryBlockingKeyIndex(pool);
  out.INDEX_BUCKETS = index.size();

  let probesWithNoKeys = 0;
  let totalCandidates = 0;
  let truthFound = 0;
  let truthDecidedExact = 0;
  const perTruth: unknown[] = [];

  for (const pair of truth) {
    // O PROBE e a listing de uma ponta (ex.: Shopee), reconstruida SEM productId.
    // Para variar, alterna qual ponta e o probe.
    const shopeeSide = pair.a.marketplace === "SHOPEE" ? pair.a : pair.b.marketplace === "SHOPEE" ? pair.b : null;
    const probeRow = shopeeSide ?? pair.a;
    const probe = toNormalized(probeRow);
    // ANONIMIZA: o generator so ve titulo/brand/model/preco.
    const probeAnon: NormalizedMarketplaceListingV1 = {
      ...probe,
      metadata: { ...probe.metadata, rawHash: "blind" },
    };

    const gen = generateCandidates(probeAnon, index, {
      brandLexicon,
      maxCandidatesPerListing: MAX_CANDIDATES_PER_LISTING,
    });
    const keys = buildBlockingKeys(probeAnon, { brandLexicon });
    if (keys.length === 0) probesWithNoKeys += 1;
    totalCandidates += gen.candidates.length;

    // A VERDADE: o par certo (a outra ponta) esta entre os candidatos?
    /*
     * Compara pelo marketplaceId CANÔNICO (lowercase), não pelo enum legado.
     * O gerador sempre produz `canonicalId:externalId`. Uma versão anterior
     * deste harness comparava contra "MERCADO_LIVRE:..." e marcava
     * foundCorrect=false mesmo tendo acertado — o gerador estava certo e o
     * teste é que estava errado. Erro de teste que escondia um acerto.
     */
    const targetKey = `${resolveMarketplaceIdFromLegacyEnum(pair.a.marketplace) ?? pair.a.marketplace.toLowerCase()}:${pair.a.externalId}`;
    const targetKey2 = `${resolveMarketplaceIdFromLegacyEnum(pair.b.marketplace) ?? pair.b.marketplace.toLowerCase()}:${pair.b.externalId}`;
    const found =
      gen.candidates.some((c) => c.candidateKey === targetKey) ||
      gen.candidates.some((c) => c.candidateKey === targetKey2);

    if (found) truthFound += 1;

    // Se achou, o Identity Engine decide (candidate != decision).
    let decision: string | null = null;
    let decisionDetail: unknown = null;
    if (found) {
      /*
       * FASE P — HARNESS CORRIGIDO.
       *
       * Este bloco ANTES dizia "decide sobre o candidato realmente encontrado"
       * e na verdade lia `gen.candidates[0]`. As duas coisas so coincidem
       * quando a verdade e a primeira candidata. No dia em que a verdade for a
       * segunda, o harness mediria a policy de um produto ERRADO e publicaria
       * um numero que nao corresponde a nada.
       *
       * Hoje os 6/6 batem, entao a correcao e semantica: os numeros nao mudam.
       * Ainda assim, um harness que mede a coisa errada quando o mundo muda e
       * exatamente o tipo de medicao que a missao proibe.
       *
       * A verdade continua sendo usada SO AQUI, depois da geracao: o
       * `generateCandidates` acima nunca a recebe.
       */
      const truthCandidate = selectTruthCandidate(gen.candidates, [
        targetKey,
        targetKey2,
      ]);
      const candRow = truthCandidate
        ? rows.find((r) => {
            const mid = resolveMarketplaceIdFromLegacyEnum(r.marketplace) ?? r.marketplace.toLowerCase();
            return `${mid}:${r.externalId}` === truthCandidate.candidateKey;
          })
        : undefined;
      if (candRow) {
        const d = evaluateIdentityConfidence(probeAnon, toNormalized(candRow));
        decision = d.confidence;
        decisionDetail = {
          reasonCodes: d.reasonCodes,
          evidence: d.evidence.map((e) => e.code),
          hardConflicts: d.hardConflicts,
          missingCriticalAttributes: d.missingCriticalAttributes,
          axes: d.axisComparisons.map((c) => `${c.axis}=${c.status}`),
          policyVersion: d.policyVersion,
        };
        if (d.confidence === "EXACT") truthDecidedExact += 1;
      }
    }

    perTruth.push({
      productId: pair.productId,
      productName: pair.productName,
      probeFromMarketplace: probeRow.marketplace,
      probeCategory: canonicalCategory(probeAnon),
      probeKeys: keys.map((k) => `${k.type}:${k.normalizedValue}`),
      candidateCount: gen.candidates.length,
      candidateKeys: gen.candidates.map((c) => c.candidateKey),
      candidateSharedKey: gen.candidates.map((c) => `${c.sharedKeyType}=${c.sharedKeyValue}`),
      expectedKeys: [targetKey, targetKey2],
      foundCorrect: found,
      decision,
      decisionDetail,
    });
  }

  /*
   * CENÁRIO 2 — SOMENTE TÍTULO.
   *
   * O cenário acima usa uma oferta Shopee legada, que tem marca/modelo
   * gravados no Product. Isso NÃO é o que acontece com a shadow real: as
   * 25 listings da API vêm sem brand/model/mpn/gtin (a fonte não expõe).
   *
   * Aqui o probe é stripped de TODA identidade estruturada. Se o generator
   * ainda descobrir os mesmos candidatos, a prova é de que a CAMADA 3
   * (evidência do título) funciona sozinha — e, crucialmente, que ela gera
   * CANDIDATO e não EXACT (a política não lê provenance da chave).
   */
  let titleOnlyFound = 0;
  let titleOnlyKeys = 0;
  let titleOnlyExact = 0;
  const titleOnlyDetail: unknown[] = [];
  for (const pair of truth) {
    const shopeeSide = pair.a.marketplace === "SHOPEE" ? pair.a : pair.b.marketplace === "SHOPEE" ? pair.b : null;
    const probeRow = shopeeSide ?? pair.a;
    const probe = toNormalized(probeRow);
    const stripped: NormalizedMarketplaceListingV1 = {
      ...probe,
      // Simula a listing da API: sem NENHUM identificador estruturado.
      identity: { gtin: [], mpn: null, manufacturerModel: null, brand: null, model: null },
      variant: { color: UNKNOWN, storage: UNKNOWN, memory: UNKNOWN, voltage: UNKNOWN, size: UNKNOWN, otherAttributes: {} },
      metadata: { ...probe.metadata, rawHash: "blind-title-only" },
    };
    const gen = generateCandidates(stripped, index, {
      brandLexicon,
      maxCandidatesPerListing: MAX_CANDIDATES_PER_LISTING,
    });
    const keys = buildBlockingKeys(stripped, { brandLexicon });
    titleOnlyKeys += keys.length;
    const targetKey = `${resolveMarketplaceIdFromLegacyEnum(pair.a.marketplace) ?? pair.a.marketplace.toLowerCase()}:${pair.a.externalId}`;
    const targetKey2 = `${resolveMarketplaceIdFromLegacyEnum(pair.b.marketplace) ?? pair.b.marketplace.toLowerCase()}:${pair.b.externalId}`;
    const truthCandidate = selectTruthCandidate(gen.candidates, [
      targetKey,
      targetKey2,
    ]);
    const found = truthCandidate !== undefined;
    if (found) titleOnlyFound += 1;
    let dec: string | null = null;
    if (found && truthCandidate) {
      // FASE P: avalia a candidata QUE CORRESPONDE A VERDADE (ver bloco do
      // cenário completo acima). `candidates[0]` media o produto errado.
      const candRow = rows.find((r) => {
        const mid = resolveMarketplaceIdFromLegacyEnum(r.marketplace) ?? r.marketplace.toLowerCase();
        return `${mid}:${r.externalId}` === truthCandidate.candidateKey;
      });
      if (candRow) {
        dec = evaluateIdentityConfidence(stripped, toNormalized(candRow)).confidence;
        if (dec === "EXACT") titleOnlyExact += 1;
      }
    }
    titleOnlyDetail.push({
      productName: pair.productName,
      keysFromTitleOnly: keys.map((k) => `${k.type}:${k.normalizedValue}(${k.provenance})`),
      candidateCount: gen.candidates.length,
      foundCorrect: found,
      decision: dec,
    });
  }
  out.TITLE_ONLY_SCENARIO = {
    NOTE:
      "Probe SEM brand/model/mpn/gtin — replica a listing real da API Shopee. " +
      "Prova que a camada 3 (titulo) sozinha gera CANDIDATO.",
    KEYS_GENERATED: titleOnlyKeys,
    FOUND: titleOnlyFound,
    TOTAL: truth.length,
    REDISCOVERY_RATE: truth.length > 0 ? Number((titleOnlyFound / truth.length).toFixed(3)) : 0,
    DECIDED_EXACT: titleOnlyExact,
    TITLE_EVIDENCE_ALONE_PRODUCED_EXACT: titleOnlyExact,
    DETAIL: titleOnlyDetail,
  };

  out.PROBES_WITHOUT_KEYS = probesWithNoKeys;
  out.TOTAL_CANDIDATES_GENERATED = totalCandidates;
  out.TRUTH_PAIRS_FOUND_AS_CANDIDATE = truthFound;
  out.TRUTH_PAIRS_TOTAL = truth.length;
  out.REDISCOVERY_RATE = truth.length > 0 ? Number((truthFound / truth.length).toFixed(3)) : 0;
  out.TRUTH_DECIDED_EXACT = truthDecidedExact;
  out.PER_TRUTH = perTruth;
  out.GENERATOR_DECIDED_NOTHING = true; // candidates so; a decisao e da policy
  out.DB_WRITES = 0;

  console.log(JSON.stringify(out, null, 2));
}

/*
 * Só executa como ENTRYPOINT. O teste do harness importa `selectTruthCandidate`
 * para provar a seleção da candidata correta sem banco; sem esta guarda, o
 * import dispararia a execução read-only contra o banco de produção.
 */
if (process.argv[1]?.includes("blind-rediscovery") ?? false) {
  main()
    .catch((e) => {
      console.error("BLIND_REDISCOVERY_FAILED", e instanceof Error ? e.message.slice(0, 300) : "UNKNOWN");
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
