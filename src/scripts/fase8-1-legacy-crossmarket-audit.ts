/**
 * FASE 8.1 — AUDITORIA READ-ONLY DAS ASSOCIAÇÕES LEGACY (FASE K).
 *
 * A FASE 8 achou 4 produtos com ofertas em >=2 marketplaces, 2 deles com
 * MERCADO_LIVRE + SHOPEE. O legado associou esses pares como EXACT.
 *
 * ESTA MISSÃO NAO CONFIA NESSAS ASSOCIAÇÕES. Este script:
 *   1. lê as ofertas (somente SELECT);
 *   2. converte para NormalizedMarketplaceListingV1;
 *   3. roda o NOVO IdentityConfidence sobre cada par;
 *   4. classifica CONFIRMED_EXACT / REVIEW / REJECT.
 *
 * NADA É ALTERADO. Divergência vira DÍVIDA REGISTRADA, não correção
 * automática — mudar associação legacy é decisão de produto, não efeito
 * colateral de uma missão de promote.
 */

import prisma from "../lib/prisma";
import { evaluateIdentityConfidence } from "../services/architecture/v1/identity/identityConfidence";
import { IDENTITY_POLICY_V1 } from "../services/architecture/v1/identity/identityPolicy";
import {
  DEFAULT_PAYLOAD_VERSION,
  NORMALIZED_LISTING_V1,
  UNKNOWN,
  type NormalizedMarketplaceListingV1,
} from "../services/architecture/v1/types/normalizedListingV1";
import {
  resolveMarketplaceIdFromLegacyEnum,
} from "../services/architecture/v1/marketplaceRegistry";
import { computeRawHash } from "../services/architecture/v1/hashing";

/*
 * Colunas REAIS do schema. A oferta legada NAO tem sellerId/sellerName/
 * modelNumber/ean/gtin/mpn/attributes: o que não existe é lido como ausente
 * (UNKNOWN), nunca inventado.
 */
type OfferRow = {
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
  matchStatus: string;
  /*
   * Identidade mora em Product/RawMarketplaceListing, NÃO em MarketplaceOffer.
   * Sem estas colunas (LEFT JOIN em RawMarketplaceListing) a auditoria não
   * teria evidência alguma e tudo cairia em NO_SHARED_EVIDENCE.
   */
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

/** Converte uma oferta legada no contrato V1 (sem inventar dado). */
function toNormalized(row: OfferRow): NormalizedMarketplaceListingV1 {
  const marketplaceId = resolveMarketplaceIdFromLegacyEnum(row.marketplace);
  const price = typeof row.price === "number" && row.price > 0 ? row.price : 1;

  /*
   * A IDENTIDADE mora em Product/RawMarketplaceListing (schema legado), não
   * em MarketplaceOffer. Sem este LEFT JOIN, todo par legacy cairia em
   * NO_SHARED_EVIDENCE e a auditoria não diria nada de útil.
   */
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
    seller: {
      externalSellerId: null,
      name: row.seller ?? null,
    },
    identity: {
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
      color: UNKNOWN,
      storage: UNKNOWN,
      memory: UNKNOWN,
      voltage: UNKNOWN,
      size: UNKNOWN,
      otherAttributes: {},
    },
    commerce: {
      price,
      oldPrice: row.oldPrice ?? null,
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
    MODE: "READ_ONLY_AUDIT",
    IDENTITY_POLICY_VERSION: IDENTITY_POLICY_V1,
    NOTE:
      "Nenhuma associacao legacy foi alterada. Divergencias sao DIVIDA, nao correcao.",
  };

  try {
    const rows = await prisma.$queryRaw<OfferRow[]>`
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
             r.attributes AS "rawAttributes",
             o."matchStatus"::text AS "matchStatus"
        FROM "MarketplaceOffer" o
        JOIN "Product" p ON p.id = o."productId"
        LEFT JOIN "RawMarketplaceListing" r
               ON r.marketplace = o.marketplace AND r."externalId" = o."externalId"
       WHERE o.active = true AND o."matchStatus" = 'EXACT'
         AND o.available = true AND o.price > 0
       ORDER BY p.name`;

    /* Agrupa por produto e só audita os que têm >=2 marketplaces. */
    const byProduct = new Map<string, OfferRow[]>();
    for (const row of rows) {
      const list = byProduct.get(row.productId) ?? [];
      list.push(row);
      byProduct.set(row.productId, list);
    }

    let audited = 0;
    let confirmedExact = 0;
    let review = 0;
    let reject = 0;
    const details: unknown[] = [];
    const debt: unknown[] = [];

    for (const [productId, offers] of byProduct) {
      const marketplaces = new Set(offers.map((o) => o.marketplace));
      if (marketplaces.size < 2) continue;
      audited += 1;

      for (let i = 0; i < offers.length; i += 1) {
        for (let j = i + 1; j < offers.length; j += 1) {
          const left = toNormalized(offers[i]);
          const right = toNormalized(offers[j]);
          if (left.marketplaceId === right.marketplaceId) continue;

          const decision = evaluateIdentityConfidence(left, right);
          if (decision.confidence === "EXACT") confirmedExact += 1;
          if (decision.confidence === "REVIEW") review += 1;
          if (decision.confidence === "REJECT") reject += 1;

          const detail = {
            productId,
            productName: offers[i].name,
            pair: [`${decision.leftKey}`, `${decision.rightKey}`],
            legacyMatchStatus: "EXACT",
            newDecision: decision.confidence,
            reasonCodes: decision.reasonCodes,
            evidence: decision.evidence.map((e) => e.code),
            hardConflicts: decision.hardConflicts,
            missingCriticalAttributes: decision.missingCriticalAttributes,
            axes: decision.axisComparisons.map((c) => `${c.axis}=${c.status}`),
            policyVersion: decision.policyVersion,
          };
          details.push(detail);
          if (decision.confidence !== "EXACT") {
            debt.push({
              productId,
              productName: offers[i].name,
              legacySays: "EXACT",
              newPolicySays: decision.confidence,
              reasonCodes: decision.reasonCodes,
              ACTION_TAKEN: "NONE (dívida registrada; associação legacy preservada)",
            });
          }
        }
      }
    }

    out.LEGACY_CROSS_MARK_MATCHES_AUDITED = audited;
    out.LEGACY_PAIRS_EVALUATED = details.length;
    out.LEGACY_CONFIRMED_EXACT = confirmedExact;
    out.LEGACY_REVIEW = review;
    out.LEGACY_REJECT = reject;
    out.LEGACY_DETAILS = details;
    out.LEGACY_DEBT = debt;
    out.LEGACY_WRITES_PERFORMED = 0;
  } catch (error) {
    out.ERROR = error instanceof Error ? error.message.slice(0, 400) : "UNKNOWN";
  }

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((error) => {
    console.error("LEGACY_AUDIT_FAILED", error instanceof Error ? error.name : "UNKNOWN");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
