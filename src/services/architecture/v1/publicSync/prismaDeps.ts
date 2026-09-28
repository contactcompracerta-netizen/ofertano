/**
 * CATALOG_ARCHITECTURE_V1 — DEPENDENCIAS PRISMA DO PUBLIC SYNC (FASE 9.5).
 *
 * Implementacoes reais (banco) das portas que o runner consome. Todas sao
 * fail-closed por construcao: qualquer erro de banco propaga para o runner,
 * que o converte em "nao publica este item" em vez de tentar adivinhar.
 *
 * O LOOKUP e por INDICE em `CandidateBlockingKey`, com teto. Nunca ha full
 * scan de `Product`, `LIKE '%title%'` nem produto cartesiano — a garantia e
 * estrutural: a unica consulta possivel aqui e equality por
 * (keyType, normalizedValue), que o indice declarado cobre.
 */

import type { PrismaClient } from "@prisma/client";
import { NORMALIZED_LISTING_V1, UNKNOWN, type NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import { resolveLegacyEnumValue, resolveMarketplaceIdFromLegacyEnum } from "../marketplaceRegistry";
import { computeRawHash } from "../hashing";
import { evaluateIdentityConfidence } from "../identity/identityConfidence";
import { toCanonicalMarketplaceId } from "../publication/shadowWeight";
import type {
  BlockingKeyLookup,
  KnownBinding,
  KnownBindingLookup,
  ProductListingLoader,
} from "./types";

/** Teto de candidatos por chave, coerente com o canario certificado. */
export const PUBLIC_SYNC_MAX_CANDIDATES_PER_KEY = 20;

/** Prisma: Product com as ofertas EXACT utilizaveis, para a IdentityPolicy. */
type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  modelNumber: string | null;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  offers: Array<{
    marketplace: string;
    externalId: string | null;
    title: string | null;
    price: number;
    oldPrice: number | null;
    stock: number | null;
    available: boolean | null;
    seller: string | null;
    image: string | null;
    matchStatus: string;
  }>;
};

type OfferRow = ProductRow["offers"][number];

/**
 * Normaliza uma oferta legada para o contrato V1, para que a IdentityPolicy
 * possa compara-la com a listing da fonte. Nao inventa identidade: os campos
 * estruturados vem do Product e so sao usados como estao.
 */
function toNormalized(row: ProductRow, offer: OfferRow): NormalizedMarketplaceListingV1 {
  return {
    contractVersion: NORMALIZED_LISTING_V1,
    source: "catalog-offer",
    marketplaceId:
      resolveMarketplaceIdFromLegacyEnum(offer.marketplace) ??
      toCanonicalMarketplaceId(offer.marketplace),
    externalListingId: String(offer.externalId ?? ""),
    seller: { externalSellerId: null, name: offer.seller ?? null },
    identity: {
      gtin: [row.ean, row.gtin].filter(
        (v): v is string => typeof v === "string" && v.trim() !== "",
      ),
      mpn: row.mpn,
      manufacturerModel: row.modelNumber,
      brand: row.brand,
      model: row.modelNumber,
    },
    catalog: {
      title: offer.title ?? row.name,
      description: null,
      category: row.category,
      images: offer.image ? [offer.image] : [],
      attributes: {},
      primaryImageUrl: offer.image ?? null,
    },
    variant: {
      color: UNKNOWN, storage: UNKNOWN, memory: UNKNOWN,
      voltage: UNKNOWN, size: UNKNOWN, otherAttributes: {},
    },
    commerce: {
      price: offer.price > 0 ? offer.price : 1,
      oldPrice: offer.oldPrice ?? null,
      pixPrice: UNKNOWN, installments: UNKNOWN,
      stock: typeof offer.stock === "number" ? offer.stock : UNKNOWN,
      availability: offer.available === false ? "OUT_OF_STOCK" : "IN_STOCK",
      shippingHint: UNKNOWN, promotion: null,
    },
    metadata: {
      sourceUpdatedAt: null,
      collectedAt: new Date().toISOString(),
      rawHash: computeRawHash({ p: row.id, e: offer.externalId }),
      payloadVersion: "catalog-offer/v1",
    },
  };
}

/** SELECT das ofertas que o Product usa como identidade cross-market. */
const PRODUCT_OFFER_SELECT = {
  marketplace: true,
  externalId: true,
  title: true,
  price: true,
  oldPrice: true,
  stock: true,
  available: true,
  seller: true,
  image: true,
  matchStatus: true,
} as const;

/**
 * Loader de Product. Uma consulta por candidate, ja filtrada para as ofertas
 * EXACT de marketplaces DIFERENTES da fonte em avaliacao.
 *
 * O filtro acontece no BANCO (nao depois, em JS) para que a comparacao
 * cross-market seja garantida por construcao: nenhuma oferta da propria fonte
 * pode chegar a policy e produzir SAME_MARKETPLACE.
 */
export function createProductListingLoader(prisma: PrismaClient): ProductListingLoader {
  return {
    async loadAll(
      productId: string,
      probeMarketplaceId: string,
    ): Promise<NormalizedMarketplaceListingV1[]> {
      const row = await prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          name: true,
          brand: true,
          category: true,
          modelNumber: true,
          ean: true,
          gtin: true,
          mpn: true,
          offers: {
            where: { matchStatus: "EXACT", price: { gt: 0 } },
            select: PRODUCT_OFFER_SELECT,
            orderBy: [{ price: "asc" }],
          },
        },
      });
      if (row === null) return [];

      const typed = row as ProductRow;
      return typed.offers
        .filter((offer) => {
          const offerMarketplaceId =
            resolveMarketplaceIdFromLegacyEnum(offer.marketplace) ??
            toCanonicalMarketplaceId(offer.marketplace);
          return offerMarketplaceId !== probeMarketplaceId;
        })
        .map((offer) => toNormalized(typed, offer));
    },
  };
}

/**
 * Lookup INDEXADO em CandidateBlockingKey.
 *
 * Uma consulta por chave, equality nos dois campos do indice
 * (`CandidateBlockingKey_keyType_normalizedValue_idx`), com teto de linhas.
 * E a MESMA forma do canario certificado — nenhuma varredura de Product.
 */
export function createBlockingKeyLookup(
  prisma: PrismaClient,
  maxCandidatesPerKey: number = PUBLIC_SYNC_MAX_CANDIDATES_PER_KEY,
): BlockingKeyLookup {
  return {
    async lookup(keyType: string, normalizedValue: string): Promise<string[]> {
      const rows = await prisma.$queryRaw<Array<{ productId: string }>>`
        SELECT "productId" FROM "CandidateBlockingKey"
         WHERE "keyType" = ${keyType}::"CandidateBlockingKeyType"
           AND "normalizedValue" = ${normalizedValue}
         LIMIT ${maxCandidatesPerKey}`;
      return rows.map((r) => r.productId);
    },
  };
}

/** Avaliador certificado, exposto para injecao explicita no runner. */
export { evaluateIdentityConfidence };

/* ------------------------------------------------------------------ */
/* ASSOCIACOES JA CERTIFICADAS (modelo B)                              */
/* ------------------------------------------------------------------ */

/**
 * Associações JÁ CERTIFICADAS, lidas por (marketplace, externalId).
 *
 * Esta porta e o que separa "refresh de uma associação existente" de
 * "descoberta de um match novo". Ela devolve o `productId` que o gate
 * central JÁ validou e persistiu; o runner nunca o deriva de título e nunca o
 * inventa.
 *
 * Consulta por indice (`@@unique([marketplace, externalId])`), sem scan.
 */
export function createKnownBindingLookup(prisma: PrismaClient): KnownBindingLookup {
  const toBinding = (row: {
    productId: string;
    externalId: string | null;
    matchStatus: string;
    price: number | null;
    affiliateLink: string | null;
    lastCheckedAt: Date | null;
  }): KnownBinding => ({
    productId: row.productId,
    externalId: String(row.externalId ?? ""),
    matchStatus: row.matchStatus,
    currentPrice: row.price ?? null,
    affiliateLink: row.affiliateLink,
    lastSeenAt: row.lastCheckedAt,
  });

  const select = {
    productId: true,
    externalId: true,
    matchStatus: true,
    price: true,
    affiliateLink: true,
    lastCheckedAt: true,
  } as const;

  const canonical = (marketplaceId: string) => {
    const legacy = resolveLegacyEnumValue(marketplaceId);
    return legacy;
  };

  return {
    async find(marketplaceId, externalListingId) {
      const legacy = canonical(marketplaceId);
      if (legacy === null) return null;
      const row = await prisma.marketplaceOffer.findFirst({
        where: { marketplace: legacy as never, externalId: externalListingId },
        select,
      });
      return row === null ? null : toBinding(row);
    },

    async listCertified(marketplaceId) {
      const legacy = canonical(marketplaceId);
      if (legacy === null) return [];
      const rows = await prisma.marketplaceOffer.findMany({
        where: { marketplace: legacy as never },
        select,
        orderBy: { externalId: "asc" },
      });
      return rows.map(toBinding);
    },
  };
}
