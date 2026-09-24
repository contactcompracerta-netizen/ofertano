/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW LEGACY ADAPTER (FASE 5).
 *
 * Converte dados observáveis do fluxo REAL legado (saveProduct / tabela
 * RawMarketplaceListing) para o contrato NormalizedMarketplaceListingV1,
 * sem nunca alterar o caminho legado.
 *
 * Duas fontes suportadas:
 *  1. Contexto do saveProduct (RawListingPersistenceContext + dados salvos).
 *  2. Linha real de RawMarketplaceListing (replay/canário contra prod).
 *
 * Fail-closed: marketplace sem registro canônico (marketplaceId) => null
 * (nada entra por nomes/URLs; identidade é sempre o registry V1).
 */

import {
  resolveMarketplaceIdFromLegacyEnum,
} from "../marketplaceRegistry";
import {
  DEFAULT_PAYLOAD_VERSION,
  type AvailabilityValue,
  type NormalizedMarketplaceListingV1,
} from "../types/normalizedListingV1";

/**
 * Contexto mínimo observável no fim do saveProduct legado.
 * Equivale ao RawListingPersistenceContext já persistido, ampliado com os
 * dados estruturais do Product salvo (somente leitura).
 */
export type LegacyShadowSaveContext = {
  /** Enum Prisma legado (ex.: "MERCADO_LIVRE"). */
  marketplace: string;
  externalId: string;
  sourceUrl: string;
  title?: string | null;
  price?: number | null;
  oldPrice?: number | null;
  stock?: number | null;
  available?: boolean | null;
  brand?: string | null;
  category?: string | null;
  image?: string | null;
  attributes?: Record<string, string> | null;
  canonicalProductId?: string | null;
  collectedAt?: string;
};

/** Linha real de RawMarketplaceListing (fonte do replay/canário). */
export type LegacyShadowRawRow = {
  marketplace: string;
  externalId: string;
  sellerId?: string | null;
  sellerName?: string | null;
  sourceUrl?: string | null;
  affiliateLink?: string | null;
  title?: string | null;
  brand?: string | null;
  modelNumber?: string | null;
  ean?: string | null;
  gtin?: string | null;
  mpn?: string | null;
  category?: string | null;
  attributes?: Record<string, string> | null;
  image?: string | null;
  price?: number | null;
  oldPrice?: number | null;
  stock?: number | null;
  available?: boolean | null;
  canonicalProductId?: string | null;
};

function availabilityFromLegacy(
  available: boolean | null | undefined,
  price: number | null | undefined,
): AvailabilityValue {
  if (available === false) {
    return "OUT_OF_STOCK";
  }
  if (typeof price === "number" && price > 0) {
    return "IN_STOCK";
  }
  if (available === true) {
    return "IN_STOCK";
  }
  return "UNAVAILABLE";
}

function stringAttributes(
  attributes: Record<string, string> | null | undefined,
): Record<string, string | number | boolean | string[] | null> {
  if (!attributes) {
    return {};
  }
  return { ...attributes };
}

function collectGtin(
  ean: string | null | undefined,
  gtin: string | null | undefined,
): string[] {
  const values = [ean, gtin].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return [...new Set(values.map((value) => value.trim()))];
}

/**
 * Constrói a listing V1 a partir do contexto observável do saveProduct.
 * Retorna null quando o marketplace não é resolvível (fail-closed).
 */
export function buildShadowListingFromSaveContext(
  input: LegacyShadowSaveContext,
): NormalizedMarketplaceListingV1 | null {
  const marketplaceId = resolveMarketplaceIdFromLegacyEnum(input.marketplace);
  if (!marketplaceId) {
    return null;
  }

  const price =
    typeof input.price === "number" && Number.isFinite(input.price)
      ? input.price
      : 0;

  const images =
    typeof input.image === "string" && input.image.trim()
      ? [input.image.trim()]
      : [];

  return {
    contractVersion: "normalized-listing/v1",
    source: "legacy-save-product",
    marketplaceId,
    externalListingId: input.externalId,
    seller: {
      externalSellerId: null,
      name: null,
    },
    identity: {
      gtin: [],
      mpn: null,
      manufacturerModel: null,
      brand: input.brand ?? null,
      model: null,
    },
    catalog: {
      title: input.title ?? null,
      description: null,
      category: input.category ?? null,
      images,
      attributes: stringAttributes(input.attributes),
      primaryImageUrl: images[0] ?? null,
    },
    variant: {
      color: null,
      storage: null,
      memory: null,
      voltage: null,
      size: null,
      otherAttributes: {},
    },
    commerce: {
      price,
      oldPrice:
        typeof input.oldPrice === "number" ? input.oldPrice : null,
      pixPrice: null,
      installments: null,
      stock:
        typeof input.stock === "number" && Number.isFinite(input.stock)
          ? input.stock
          : null,
      availability: availabilityFromLegacy(input.available, price),
      shippingHint: null,
      promotion: null,
    },
    metadata: {
      sourceUpdatedAt: null,
      collectedAt: input.collectedAt ?? new Date().toISOString(),
      rawHash: "",
      payloadVersion: DEFAULT_PAYLOAD_VERSION,
    },
  };
}

/**
 * Constrói a listing V1 a partir de uma linha REAL de RawMarketplaceListing
 * (replay/canário). Retorna null quando o marketplace não é resolvível.
 */
export function buildShadowListingFromRawRow(
  row: LegacyShadowRawRow,
): NormalizedMarketplaceListingV1 | null {
  const marketplaceId = resolveMarketplaceIdFromLegacyEnum(row.marketplace);
  if (!marketplaceId) {
    return null;
  }

  const price =
    typeof row.price === "number" && Number.isFinite(row.price) ? row.price : 0;
  const images =
    typeof row.image === "string" && row.image.trim() ? [row.image.trim()] : [];
  const gtin = collectGtin(row.ean, row.gtin);

  return {
    contractVersion: "normalized-listing/v1",
    source: "legacy-shadow-replay",
    marketplaceId,
    externalListingId: row.externalId,
    seller: {
      externalSellerId: row.sellerId ?? null,
      name: row.sellerName ?? null,
    },
    identity: {
      gtin,
      mpn: row.mpn ?? null,
      manufacturerModel: null,
      brand: row.brand ?? null,
      model: row.modelNumber ?? null,
    },
    catalog: {
      title: row.title ?? null,
      description: null,
      category: row.category ?? null,
      images,
      attributes: stringAttributes(row.attributes),
      primaryImageUrl: images[0] ?? null,
    },
    variant: {
      color: null,
      storage: null,
      memory: null,
      voltage: null,
      size: null,
      otherAttributes: {},
    },
    commerce: {
      price,
      oldPrice:
        typeof row.oldPrice === "number" ? row.oldPrice : null,
      pixPrice: null,
      installments: null,
      stock:
        typeof row.stock === "number" && Number.isFinite(row.stock)
          ? row.stock
          : null,
      availability: availabilityFromLegacy(row.available, price),
      shippingHint: null,
      promotion: null,
    },
    metadata: {
      sourceUpdatedAt: null,
      collectedAt: new Date().toISOString(),
      rawHash: "",
      payloadVersion: DEFAULT_PAYLOAD_VERSION,
    },
  };
}

/** Função injetável de `agora` para testes determinísticos. */
export type NowProvider = () => string;

export function withCollectedAt(
  listing: NormalizedMarketplaceListingV1,
  now: NowProvider = () => new Date().toISOString(),
): NormalizedMarketplaceListingV1 {
  return {
    ...listing,
    metadata: {
      ...listing.metadata,
      collectedAt: now(),
    },
  };
}