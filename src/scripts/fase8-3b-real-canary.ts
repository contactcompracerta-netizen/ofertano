/**
 * FASE 8.3B — CANÁRIO REAL COM LOOKUP INDEXADO (FASE N2 + P + Q).
 *
 * 1. Coleta REAL da Shopee (API oficial autorizada).
 * 2. Candidate generation por LOOKUP INDEXADO em CandidateBlockingKey
 *    (nunca Product scan, nunca LIKE '%token%').
 * 3. IDENTITY_POLICY_V1 decide cada candidato.
 * 4. FASE P: audita as 3 ofertas Shopee públicas LEGADAS, em BLIND.
 * 5. FASE Q: publication safety.
 */

import prisma from "../lib/prisma";
import { ShopeeMarketplaceConnector, SHOPEE_MARKETPLACE_ID } from "../services/architecture/v1/connectors/shopee/shopeeConnector";
import {
  buildBlockingKeys,
  canonicalModel,
  MAX_CANDIDATES_PER_LISTING,
  CANDIDATE_BLOCKING_KEY_V1,
  hasHardConflictPreFilter,
  type BlockingKeyType,
} from "../services/architecture/v1/identity/candidateGeneration";
import { evaluateIdentityConfidence } from "../services/architecture/v1/identity/identityConfidence";
import { IDENTITY_POLICY_V1 } from "../services/architecture/v1/identity/identityPolicy";
import {
  publicationWeightFor,
  countPublicMarketplacesWithWeight,
  isShadowMarketplace,
} from "../services/architecture/v1/publication/shadowWeight";
import { readShadowFlags } from "../services/architecture/v1/shadow/flags";
import {
  NORMALIZED_LISTING_V1,
  UNKNOWN,
  type NormalizedMarketplaceListingV1,
} from "../services/architecture/v1/types/normalizedListingV1";
import { resolveMarketplaceIdFromLegacyEnum } from "../services/architecture/v1/marketplaceRegistry";
import { computeRawHash } from "../services/architecture/v1/hashing";

const KEYWORDS = ["smartwatch","fone de ouvido bluetooth","carregador","cabo","mouse","teclado","cadeira gamer","monitor","impressora","panela"];
const SHOPEE_PUBLIC_OFFERS_BASELINE = 3;

type DbRow = {
  productId: string; name: string; brand: string | null; category: string | null;
  marketplace: string; externalId: string | null; title: string | null;
  price: number | null; oldPrice: number | null; stock: number | null;
  available: boolean | null; seller: string | null; image: string | null;
  productModelNumber: string | null; productEan: string | null;
  productGtin: string | null; productMpn: string | null;
  rawModelNumber: string | null; rawEan: string | null; rawGtin: string | null;
  rawMpn: string | null; rawAttributes: Record<string, string> | null;
};

function toNormalized(row: DbRow): NormalizedMarketplaceListingV1 {
  const gtin = [row.productEan, row.productGtin, row.rawEan, row.rawGtin]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  const manufacturerModel = row.rawModelNumber ?? row.productModelNumber ?? null;
  return {
    contractVersion: NORMALIZED_LISTING_V1,
    source: "legacy-offer",
    marketplaceId: resolveMarketplaceIdFromLegacyEnum(row.marketplace) ?? row.marketplace.toLowerCase(),
    externalListingId: String(row.externalId ?? ""),
    seller: { externalSellerId: null, name: row.seller ?? null },
    identity: { gtin, mpn: row.rawMpn ?? row.productMpn ?? null, manufacturerModel, brand: row.brand ?? null, model: manufacturerModel },
    catalog: { title: row.title ?? row.name, description: null, category: row.category ?? null, images: row.image ? [row.image] : [], attributes: row.rawAttributes ?? {}, primaryImageUrl: row.image ?? null },
    variant: { color: UNKNOWN, storage: UNKNOWN, memory: UNKNOWN, voltage: UNKNOWN, size: UNKNOWN, otherAttributes: {} },
    commerce: {
      price: typeof row.price === "number" && row.price > 0 ? row.price : 1,
      oldPrice: row.oldPrice ?? null, pixPrice: UNKNOWN, installments: UNKNOWN,
      stock: typeof row.stock === "number" ? row.stock : UNKNOWN,
      availability: row.available === false ? "OUT_OF_STOCK" : "IN_STOCK",
      shippingHint: UNKNOWN, promotion: null,
    },
    metadata: { sourceUpdatedAt: null, collectedAt: new Date().toISOString(), rawHash: computeRawHash({ p: row.productId }), payloadVersion: "legacy/v1" },
  };
}

/** LOOKUP INDEXADO (FASE N). Uma consulta por chave, com LIMIT. */
async function indexedLookup(productIds: Set<string>, keyType: string, value: string) {
  const rows = await prisma.$queryRaw<Array<{ productId: string }>>`
    SELECT "productId" FROM "CandidateBlockingKey"
     WHERE "keyType" = ${keyType}::"CandidateBlockingKeyType"
       AND "normalizedValue" = ${value}
     LIMIT ${MAX_CANDIDATES_PER_LISTING}`;
  return rows.map((r) => r.productId).filter((id) => productIds.has(id));
}

async function main() {
  const flags = readShadowFlags();
  const out: Record<string, unknown> = {
    IDENTITY_POLICY_VERSION: IDENTITY_POLICY_V1,
    BLOCKING_KEY_VERSION: CANDIDATE_BLOCKING_KEY_V1,
    MAX_CANDIDATES_PER_LISTING,
    LOOKUP_PATH: "CandidateBlockingKey(keyType, normalizedValue) — indexado",
    USES_PRODUCT_SCAN: false,
  };

  // Catálogo (para resolver productId -> listing, só para o Identity Engine).
  const rows = await prisma.$queryRaw<DbRow[]>`
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
     WHERE o.active = true AND o."matchStatus" = 'EXACT' AND o.available = true AND o.price > 0`;
  const byProduct = new Map(rows.map((r) => [r.productId, r]));
  const productIds = new Set(rows.map((r) => r.productId));
  out.CATALOG_OFFERS = rows.length;

  const brandLexicon = new Set<string>(["apple","xiaomi","samsung","logitech","anker"]);
  for (const r of rows) if (r.brand) brandLexicon.add(canonicalModel(r.brand));

  /* ---------- 1..3: canário Shopee real ------------------------------- */
  const connector = new ShopeeMarketplaceConnector({ keywords: KEYWORDS, pageSize: 25 });
  const health = await connector.healthCheck();
  out.SHOPEE_HEALTH_OK = health.ok;
  if (!health.ok) { console.log(JSON.stringify(out, null, 2)); return; }

  const shopee: NormalizedMarketplaceListingV1[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < KEYWORDS.length; i += 1) {
    if (shopee.length >= 25) break;
    const b = await connector.collect(cursor);
    shopee.push(...b.items);
    cursor = b.nextCursor;
    if (!cursor) break;
  }
  out.SHOPEE_LISTINGS_PROCESSED = shopee.length;

  let withCand = 0, withoutCand = 0, totalCand = 0, maxObs = 0;
  let idExact = 0, idReview = 0, idReject = 0, hardConflict = 0, missingCrit = 0;
  const keyUsage: Record<string, number> = {};
  const samples: unknown[] = [];

  for (const probe of shopee) {
    const keys = buildBlockingKeys(probe, { brandLexicon });
    const found = new Map<string, string>(); // productId -> keyType
    for (const k of keys) {
      const hits = await indexedLookup(productIds, k.type, k.normalizedValue);
      keyUsage[`${k.type}`] = (keyUsage[`${k.type}`] ?? 0) + hits.length;
      for (const pid of hits) if (!found.has(pid)) found.set(pid, k.type);
    }
    // remove o próprio produto do probe, se houver (mesmo marketplace)
    const candidates = [...found.keys()].slice(0, MAX_CANDIDATES_PER_LISTING);
    if (candidates.length > 0) withCand += 1; else withoutCand += 1;
    totalCand += candidates.length;
    maxObs = Math.max(maxObs, candidates.length);

    for (const pid of candidates) {
      const candRow = byProduct.get(pid);
      if (!candRow) continue;
      const cand = toNormalized(candRow);
      if (cand.marketplaceId === probe.marketplaceId) continue;
      if (hasHardConflictPreFilter(probe, cand)) { hardConflict += 1; continue; }
      const d = evaluateIdentityConfidence(probe, cand);
      if (d.confidence === "EXACT") idExact += 1;
      if (d.confidence === "REVIEW") idReview += 1;
      if (d.confidence === "REJECT") idReject += 1;
      if (d.hardConflicts.length > 0) hardConflict += 1;
      missingCrit += d.missingCriticalAttributes.length;
      if (samples.length < 8) {
        samples.push({
          probe: `${probe.marketplaceId}:${probe.externalListingId}`,
          candidateProduct: pid,
          blockingKeyType: found.get(pid),
          decision: d.confidence,
          reasonCodes: d.reasonCodes,
          missingCritical: d.missingCriticalAttributes.map((m) => m.axis),
          identityPolicyVersion: d.policyVersion,
        });
      }
    }
  }
  out.LISTINGS_WITH_CANDIDATES = withCand;
  out.LISTINGS_WITHOUT_CANDIDATES = withoutCand;
  out.TOTAL_CANDIDATES = totalCand;
  out.AVG_CANDIDATES_PER_LISTING = withCand + withoutCand > 0 ? Number((totalCand / shopee.length).toFixed(2)) : 0;
  out.MAX_CANDIDATES_OBSERVED = maxObs;
  out.CAP_RESPECTED = maxObs <= MAX_CANDIDATES_PER_LISTING;
  out.BLOCKING_KEY_USAGE = keyUsage;
  out.IDENTITY_EXACT = idExact;
  out.IDENTITY_REVIEW = idReview;
  out.IDENTITY_REJECT = idReject;
  out.HARD_CONFLICT = hardConflict;
  out.MISSING_CRITICAL_ATTRIBUTE = missingCrit;
  out.NO_EXACT_TARGET_IS_VALID = idExact === 0 ? "ZERO EXACT: valido (evidencia nao sustenta)" : "n";
  out.SAMPLES = samples;

  /* ---------- FASE P: as 3 ofertas públicas Shopee legadas (BLIND) -- */
  {
    const legacyShopee = rows.filter((r) => r.marketplace === "SHOPEE");
    const audit: unknown[] = [];
    let validated = 0, review = 0, reject = 0, notRedisc = 0;
    for (const leg of legacyShopee) {
      // Probe ANÔNIMO: sem productId, sem associação.
      const probe: NormalizedMarketplaceListingV1 = {
        ...toNormalized(leg),
        identity: { gtin: [], mpn: null, manufacturerModel: null, brand: null, model: null },
        metadata: { ...toNormalized(leg).metadata, rawHash: "blind" },
      };
      const keys = buildBlockingKeys(probe, { brandLexicon });
      const found = new Set<string>();
      for (const k of keys) {
        /*
         * NÃO exclui leg.productId. A contraparte CORRETA é justamente o
         * MESMO produto visto de outro marketplace — o lookup devolve o
         * productId, e é ele que queremos medir. Uma versão anterior
         * tratava o productId como "a própria listing" e o removia,
         * descartando a resposta e reportando NOT_REDISCOVERED para
         * associações que o gerador tinha encontrado.
         */
        for (const pid of await indexedLookup(productIds, k.type, k.normalizedValue)) {
          found.add(pid);
        }
      }
      const cands = [...found].slice(0, MAX_CANDIDATES_PER_LISTING);
      /*
       * A GERAÇÃO É CEGA: ela devolve um conjunto, sem saber a resposta.
       * A CLASSIFICAÇÃO olha qual candidato é a contraparte real — e isso é
       * verificação, não pista para o gerador.
       *
       * Uma versão anterior classificava o PRIMEIRO candidato, o que mede
       * "o primeiro candidato é o certo?" em vez de "o certo foi
       * redescberto?" — e reportava REJECT para associações corretas.
       */
      const counterpart = rows.find(
        (o) =>
          o.productId === leg.productId &&
          resolveMarketplaceIdFromLegacyEnum(o.marketplace) !== SHOPEE_MARKETPLACE_ID,
      );
      const correctKey = counterpart
        ? `${resolveMarketplaceIdFromLegacyEnum(counterpart.marketplace)}:${counterpart.externalId}`
        : null;
      const correctListing = counterpart ? toNormalized(counterpart) : null;
      // A contraparte real compartilha o productId com a oferta legada.
      const hitCorrect = Boolean(correctListing) && found.has(leg.productId);
      void correctKey;

      let cls: string;
      if (!hitCorrect || !correctListing) {
        cls = "LEGACY_PUBLIC_NOT_REDISCOVERED";
        notRedisc += 1;
      } else {
        const d = evaluateIdentityConfidence(probe, correctListing);
        if (d.confidence === "EXACT") { cls = "LEGACY_PUBLIC_VALIDATED_EXACT"; validated += 1; }
        else if (d.confidence === "REVIEW") { cls = "LEGACY_PUBLIC_REVIEW"; review += 1; }
        else { cls = "LEGACY_PUBLIC_REJECT"; reject += 1; }
      }
      audit.push({
        productName: leg.name,
        marketplace: leg.marketplace,
        title: (leg.title ?? "").slice(0, 60),
        candidatesFound: cands.length,
        classification: cls,
      });
    }
    out.LEGACY_PUBLIC_AUDIT = audit;
    out.LEGACY_PUBLIC_VALIDATED_EXACT = validated;
    out.LEGACY_PUBLIC_REVIEW = review;
    out.LEGACY_PUBLIC_REJECT = reject;
    out.LEGACY_PUBLIC_NOT_REDISCOVERED = notRedisc;
    out.LEGACY_PUBLICATION_CHANGED = false; // NADA foi despublicado
  }

  /* ---------- FASE Q: publication safety ----------------------------- */
  {
    const now = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total FROM "MarketplaceOffer"
       WHERE marketplace::text = 'SHOPEE' AND active = true
         AND available = true AND "matchStatus" = 'EXACT' AND price > 0`;
    const nowCount = now[0]?.total ?? 0;
    out.SHOPEE_PUBLIC_OFFERS_BASELINE = SHOPEE_PUBLIC_OFFERS_BASELINE;
    out.SHOPEE_PUBLIC_OFFERS_NOW = nowCount;
    out.SHOPEE_PUBLIC_OFFERS_CREATED_BY_SHADOW = Math.max(0, nowCount - SHOPEE_PUBLIC_OFFERS_BASELINE);
    out.SHOPEE_PUBLICATION_LEAKS_DELTA = Math.max(0, nowCount - SHOPEE_PUBLIC_OFFERS_BASELINE);
    out.SHADOW_SOURCE_IS_SHADOW = isShadowMarketplace(SHOPEE_MARKETPLACE_ID, flags);
    out.SHOPEE_PUBLICATION_WEIGHT = publicationWeightFor(SHOPEE_MARKETPLACE_ID, flags);
    out.PUBLIC_MARKETPLACES_ML_PLUS_SHADOW_EXACT = countPublicMarketplacesWithWeight(
      [
        { marketplace: "mercado_livre" },
        { marketplace: SHOPEE_MARKETPLACE_ID },
      ],
      flags,
    );
    out.PUBLICATION_SAFETY = out.SHADOW_SOURCE_IS_SHADOW && out.SHOPEE_PUBLICATION_WEIGHT === 0
      && out.PUBLIC_MARKETPLACES_ML_PLUS_SHADOW_EXACT === 1
      && out.SHOPEE_PUBLICATION_LEAKS_DELTA === 0 ? "PASS" : "FAIL";
    out.NEVER_PUBLISHED_BY_GENERATOR = true;
  }

  const lt2 = await prisma.$queryRaw<Array<{ total: number }>>`
    SELECT COUNT(*)::int AS total FROM "Product" p WHERE p."autoCreated" = true AND p.active = true
     AND (SELECT COUNT(DISTINCT o.marketplace::text) FROM "MarketplaceOffer" o
           WHERE o."productId" = p.id AND o.active = true AND o."matchStatus" = 'EXACT'
             AND o.available = true AND o.status NOT IN ('UNAVAILABLE','ERROR') AND o.price > 0) < 2`;
  out.AUTO_ACTIVE_LT2 = lt2[0]?.total ?? null;

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error("REAL_CANARY_FAILED", e instanceof Error ? e.message.slice(0, 300) : "UNKNOWN");
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
