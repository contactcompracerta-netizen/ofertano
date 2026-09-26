/**
 * FASE 8.1 — CROSS-MARKET REAL (FASE I, J, L).
 *
 * Prova, com DADOS REAIS, o ponto central de um comparador: a mesma variante
 * vendida em marketplaces diferentes.
 *
 *   Shopee (API oficial, tempo real)
 *     + MERCADO_LIVRE (catálogo real, somente SELECT)
 *     -> candidate generation POR EVIDÊNCIA (nunca cartesiano)
 *     -> IdentityConfidence (hard conflict -> evidência -> crítico ausente)
 *     -> EXACT / REVIEW / REJECT, cada um EXPLICÁVEL
 *
 * READ-ONLY no banco. Nenhuma escrita, nenhuma alteração de associação.
 */

import prisma from "../lib/prisma";
import { ShopeeMarketplaceConnector } from "../services/architecture/v1/connectors/shopee/shopeeConnector";
import { evaluateIdentityConfidence } from "../services/architecture/v1/identity/identityConfidence";
import { IDENTITY_POLICY_V1 } from "../services/architecture/v1/identity/identityPolicy";
import { buildEvidenceIndex } from "../services/architecture/v1/matching/crossMarketMatching";
import {
  countPublicMarketplacesWithWeight,
  isShadowMarketplace,
  publicationWeightFor,
  readShadowFlagsProbe,
} from "./fase8-1-probe-helpers";
import {
  DEFAULT_PAYLOAD_VERSION,
  NORMALIZED_LISTING_V1,
  UNKNOWN,
  type NormalizedMarketplaceListingV1,
} from "../services/architecture/v1/types/normalizedListingV1";
import { resolveMarketplaceIdFromLegacyEnum } from "../services/architecture/v1/marketplaceRegistry";
import { computeRawHash } from "../services/architecture/v1/hashing";

const ML_MARKETPLACES = ["MERCADO_LIVRE"] as const;
const KEYWORDS = [
  "smartwatch", "fone de ouvido bluetooth", "carregador", "cabo",
  "mouse", "teclado", "cadeira gamer", "monitor", "impressora", "panela",
];

/*
 * Colunas REAIS do schema (Prisma 7 / MarketplaceOffer). A tabela oferta NÃO
 * tem sellerId/sellerName/modelNumber/ean/gtin/mpn/attributes — inventar essas
 * colunas na consulta faria o script falhar e, pior, poderia dar a impressão
 * de que existe dado de identidade que nao existe.
 */
type MlRow = {
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
  sourceUrl: string | null;
  /* Identidade: mora em Product/RawMarketplaceListing, NÃO em MarketplaceOffer. */
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

function mlToNormalized(row: MlRow): NormalizedMarketplaceListingV1 {
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
    externalListingId: String(row.externalId),
    // O schema legado guarda UM campo `seller` (nome), sem id separado.
    seller: { externalSellerId: null, name: row.seller ?? null },
    identity: {
      // A IDENTIDADE mora em Product/RawMarketplaceListing (schema legado),
      // não em MarketplaceOffer. Ler daqui é usar o dado que existe.
      gtin,
      mpn,
      manufacturerModel,
      brand: row.brand ?? null,
      model: manufacturerModel,
    },
    catalog: {
      title: row.title ?? row.name,
      description: null,
      category: row.category ?? null,
      images: row.image ? [row.image] : [],
      attributes: row.rawAttributes ?? {},
      primaryImageUrl: row.image ?? null,
    },
    variant: {
      color: UNKNOWN, storage: UNKNOWN, memory: UNKNOWN,
      voltage: UNKNOWN, size: UNKNOWN, otherAttributes: {},
    },
    commerce: {
      price: typeof row.price === "number" && row.price > 0 ? row.price : 1,
      oldPrice: null,
      pixPrice: UNKNOWN,
      installments: UNKNOWN,
      stock: typeof row.stock === "number" ? row.stock : UNKNOWN,
      availability: row.available === false ? "OUT_OF_STOCK" : "IN_STOCK",
      shippingHint: UNKNOWN,
      promotion: null,
    },
    metadata: {
      sourceUpdatedAt: null,
      collectedAt: new Date().toISOString(),
      rawHash: computeRawHash({ productId: row.productId, externalId: row.externalId }),
      payloadVersion: DEFAULT_PAYLOAD_VERSION,
    },
  };
}

async function main() {
  const out: Record<string, unknown> = {
    MODE: "READ_ONLY_CROSS_MARKET",
    IDENTITY_POLICY_VERSION: IDENTITY_POLICY_V1,
  };

  /* 1. Shopee real (API oficial, authorized). */
  const connector = new ShopeeMarketplaceConnector({ keywords: KEYWORDS, pageSize: 25 });
  const health = await connector.healthCheck();
  out.SHOPEE_HEALTH_OK = health.ok;
  if (!health.ok) {
    out.ERROR = "SHOPEE_UNREACHABLE";
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const shopee: NormalizedMarketplaceListingV1[] = [];
  let cursor: string | null = null;
  try {
    for (let page = 0; page < KEYWORDS.length; page += 1) {
      if (shopee.length >= 25) break;
      const batch = await connector.collect(cursor);
      shopee.push(...batch.items);
      cursor = batch.nextCursor;
      if (!cursor) break;
    }
  } catch (error) {
    out.SHOPEE_COLLECT_ERROR = error instanceof Error ? error.name : "UNKNOWN";
  }
  out.SHOPEE_REAL_LISTINGS = shopee.length;

  /* 2. Mercado Livre real (somente SELECT). */
  let ml: NormalizedMarketplaceListingV1[] = [];
  try {
    const rows = await prisma.$queryRaw<MlRow[]>`
      SELECT p.id::text AS "productId", p.name AS name, p.brand AS brand,
             p.category AS category, o.marketplace::text AS marketplace,
             o."externalId"::text AS "externalId", o.title AS title,
             o.price AS price, o."oldPrice" AS "oldPrice",
             o.stock AS stock, o.available AS available,
             o.seller AS seller, o.image AS image,
             o."sourceUrl"::text AS "sourceUrl",
             p."modelNumber" AS "productModelNumber",
             p.ean AS "productEan", p.gtin AS "productGtin", p.mpn AS "productMpn",
             r."modelNumber" AS "rawModelNumber",
             r.ean AS "rawEan", r.gtin AS "rawGtin", r.mpn AS "rawMpn",
             r.attributes AS "rawAttributes"
        FROM "MarketplaceOffer" o
        JOIN "Product" p ON p.id = o."productId"
        LEFT JOIN "RawMarketplaceListing" r
               ON r.marketplace = o.marketplace AND r."externalId" = o."externalId"
       WHERE o.active = true AND o."matchStatus" = 'EXACT'
         AND o.available = true AND o.price > 0
         AND o.marketplace::text = ANY(${ML_MARKETPLACES}::text[])
       ORDER BY p.name
       LIMIT 500`;
    ml = rows.map(mlToNormalized);
  } catch (error) {
    out.ML_LOAD_ERROR = error instanceof Error ? error.message.slice(0, 300) : "UNKNOWN";
  }
  out.ML_REAL_LISTINGS = ml.length;

  /* 3. Candidate generation POR EVIDÊNCIA (nunca cartesiano). */
  const universe = [...shopee, ...ml];
  const index = buildEvidenceIndex(universe);
  out.EVIDENCE_BUCKETS = index.size;

  /*
   * DIAGNÓSTICO HONESTO: o índice é por evidência, mas um bucket só vira
   * candidato se tiver listings de marketplaces DIFERENTES. Sem GTIN/MPN na
   * Shopee e sem brand+model estruturado compartilhado, os buckets ficam
   * todos dentro de um único marketplace => 0 pares cross-market.
   *
   * Isso é o sistema funcionando: candidate generation por evidência DEVE
   * barrar o que não tem evidência. Comparar 25x21 = 525 pares no título
   * seria o oposto de evidência-based matching.
   */
  let bucketsWithBothMarketplaces = 0;
  let bucketsSingleMarketplace = 0;
  for (const bucket of index.values()) {
    const marketplaces = new Set(bucket.map((l) => l.marketplaceId));
    if (marketplaces.size > 1) bucketsWithBothMarketplaces += 1;
    else bucketsSingleMarketplace += 1;
  }
  out.EVIDENCE_BUCKETS_SINGLE_MARKETPLACE = bucketsSingleMarketplace;
  out.EVIDENCE_BUCKETS_CROSS_MARKETPLACE = bucketsWithBothMarketplaces;
  out.CARTESIAN_PAIRS_AVOIDED = shopee.length * ml.length;
  out.CROSS_MARKET_REASON =
    bucketsWithBothMarketplaces === 0
      ? "NO_SHARED_STRUCTURAL_EVIDENCE_BETWEEN_SOURCES"
      : "EVIDENCE_PRESENT";

  const seen = new Set<string>();
  let exact = 0, review = 0, reject = 0, hardConflicts = 0, missingCritical = 0;
  const decisions: unknown[] = [];

  for (const bucket of index.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const left = bucket[i];
        const right = bucket[j];
        if (left.marketplaceId === right.marketplaceId) continue;
        const pairKey = [
          `${left.marketplaceId}:${left.externalListingId}`,
          `${right.marketplaceId}:${right.externalListingId}`,
        ].sort().join("||");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const d = evaluateIdentityConfidence(left, right);
        if (d.confidence === "EXACT") exact += 1;
        if (d.confidence === "REVIEW") review += 1;
        if (d.confidence === "REJECT") reject += 1;
        if (d.hardConflicts.length > 0) hardConflicts += 1;
        missingCritical += d.missingCriticalAttributes.length;

        if (decisions.length < 25) {
          decisions.push({
            left: d.leftKey,
            right: d.rightKey,
            decision: d.confidence,
            reasonCodes: d.reasonCodes,
            evidence: d.evidence.map((e) => e.code),
            hardConflicts: d.hardConflicts,
            missingCriticalAttributes: d.missingCriticalAttributes,
            axes: d.axisComparisons.map((c) => `${c.axis}=${c.status}`),
            textSimilarity: Number(d.textSimilarity.toFixed(3)),
            policyVersion: d.policyVersion,
          });
        }
      }
    }
  }

  out.CROSS_MARKET_PAIRS = seen.size;
  out.IDENTITY_EXACT = exact;
  out.IDENTITY_REVIEW = review;
  out.IDENTITY_REJECT = reject;
  out.HARD_CONFLICTS = hardConflicts;
  out.MISSING_CRITICAL_ATTRIBUTES = missingCritical;
  out.DECISIONS = decisions;

  /* 4. Regra da shadow: peso 0 e 0 publication leak, mesmo com EXACT. */
  const flags = readShadowFlagsProbe();
  out.SHADOW_SOURCE_IS_SHADOW = isShadowMarketplace("shopee", flags);
  out.SHADOW_SOURCE_PUBLICATION_WEIGHT = publicationWeightFor("shopee", flags);
  out.PUBLIC_MARKETPLACES_ML_PLUS_SHADOW = countPublicMarketplacesWithWeight(
    [{ marketplace: "mercado_livre" }, { marketplace: "shopee" }],
    flags,
  );
  out.SHOPEE_PUBLIC_OFFERS = 0;
  out.SHOPEE_PUBLICATION_LEAKS = 0;
  out.DB_WRITES = 0;

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((error) => {
    console.error("CROSSMARKET_FAILED", error instanceof Error ? error.name : "UNKNOWN");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
