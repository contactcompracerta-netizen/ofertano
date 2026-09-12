import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { buildQueryIntent, normalizeCandidate, scoreQueryRelevance } from "@/services/multistore-v2";
import { isWeakModifier, normalizeConceptText } from "@/services/multistore-v2/productConcepts";
import { countDistinctNonEmptyMarketplaces } from "@/services/publicVisibility/multiStoreVisibility";

export const CATALOG_CANDIDATE_LIMIT = 120;
export const CATALOG_RESULT_LIMIT = 40;

export type CatalogSearchSource = "LOCAL_CATALOG";

export type CatalogSearchOffer = {
  marketplace: string;
  active?: boolean;
  available?: boolean;
  status?: string;
  matchStatus?: string;
  price?: number | null;
};

export type CatalogSearchProduct = {
  id: string;
  name: string;
  canonicalName?: string | null;
  brand?: string | null;
  specifications?: unknown;
  modelNumber?: string | null;
  ean?: string | null;
  gtin?: string | null;
  mpn?: string | null;
  color?: string | null;
  voltage?: string | null;
  size?: string | null;
  image: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  store: string;
  installments: string | null;
  rating: number | null;
  reviews: number | null;
  sales: number | null;
  stock: number | null;
  active: boolean;
  publicationStatus?: string | null;
  updatedAt?: Date | string | null;
  offers: CatalogSearchOffer[];
};

export type CatalogSearchHit = {
  product: CatalogSearchProduct;
  kind: "COMPARABLE" | "SINGLE_MARKETPLACE";
  marketplaceCount: number;
  lowestPrice: number;
  relevanceScore?: number;
};

export type CatalogSearchResult = {
  query: string;
  normalizedQuery: string;
  source: CatalogSearchSource;
  hits: CatalogSearchHit[];
  total: number;
  elapsedMs: number;
};

export type CatalogSearchRepositoryInput = {
  query: string;
  normalizedQuery: string;
  limit: number;
};

export type CatalogSearchRepository = (
  input: CatalogSearchRepositoryInput,
) => Promise<CatalogSearchProduct[]>;

export type CatalogSearchOptions = {
  repository?: CatalogSearchRepository;
  queryLimit?: number;
  resultLimit?: number;
};

export function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 160);
}

function termVariants(term: string): string[] {
  const cleaned = term.trim();

  if (!cleaned) {
    return [];
  }

  const capacity = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)$/i);

  if (capacity) {
    const amount = capacity[1];
    const unit = capacity[2].toUpperCase();
    return Array.from(new Set([`${amount}${unit}`, `${amount} ${unit}`]));
  }

  return [cleaned];
}

function textFilters(value: string): Prisma.ProductWhereInput[] {
  return [
    { name: { contains: value, mode: "insensitive" } },
    { canonicalName: { contains: value, mode: "insensitive" } },
    { brand: { contains: value, mode: "insensitive" } },
    { modelNumber: { contains: value, mode: "insensitive" } },
    { category: { contains: value, mode: "insensitive" } },
  ];
}

export function catalogFilter(query: string): Prisma.ProductWhereInput {
  const terms = query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => {
      if (!term) {
        return false;
      }

      return !isWeakModifier(normalizeConceptText(term));
    });

  return {
    active: true,
    price: { gt: 0 },
    image: { not: "" },
    publicationStatus: { notIn: ["DRAFT", "ARCHIVED"] },
    OR: [
      ...textFilters(query),
      ...(terms.length > 0
        ? [
            {
              AND: terms.map((term) => ({
                OR: termVariants(term).flatMap((variant) => textFilters(variant)),
              })),
            },
          ]
        : []),
    ],
  };
}

function catalogIdentityAttributes(
  product: Pick<
    CatalogSearchProduct,
    | "specifications"
    | "modelNumber"
    | "ean"
    | "gtin"
    | "mpn"
    | "color"
    | "voltage"
    | "size"
  >,
): Record<string, string> {
  const base =
    product.specifications &&
    typeof product.specifications === "object" &&
    !Array.isArray(product.specifications)
      ? Object.fromEntries(
          Object.entries(product.specifications as Record<string, unknown>)
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => [key, String(value)]),
        )
      : {};

  return {
    ...base,
    ...(product.modelNumber ? { MODEL: product.modelNumber } : {}),
    ...(product.ean ? { EAN: product.ean } : {}),
    ...(product.gtin ? { GTIN: product.gtin } : {}),
    ...(product.mpn ? { MPN: product.mpn } : {}),
    ...(product.color ? { COLOR: product.color } : {}),
    ...(product.voltage ? { VOLTAGE: product.voltage } : {}),
    ...(product.size ? { SIZE: product.size } : {}),
  };
}

function matchesQuery(product: CatalogSearchProduct, query: string): boolean {
  const title = product.canonicalName?.trim() || product.name;
  const scored = scoreQueryRelevance(
    buildQueryIntent(query),
    normalizeCandidate({
      marketplace: "AMAZON",
      marketplaceName: "Amazon",
      externalId: `catalog:${title.slice(0, 24)}`,
      title,
      price: 1,
      url: "https://ofertano.local/catalog",
      image: "https://ofertano.local/img.jpg",
      brand: product.brand ?? null,
      category: null,
      seller: null,
      affiliateLink: null,
      attributes: catalogIdentityAttributes(product),
    }),
  );

  return scored.status === "RELEVANT";
}

function isUsableCatalogOffer(offer: CatalogSearchOffer): boolean {
  if (offer.active === false) {
    return false;
  }

  if (offer.matchStatus !== undefined && offer.matchStatus !== "EXACT") {
    return false;
  }

  return Boolean(
    offer.available !== false &&
      offer.status !== "UNAVAILABLE" &&
      offer.status !== "ERROR" &&
      Number.isFinite(offer.price as number) &&
      (offer.price as number) > 0,
  );
}

function marketCount(product: CatalogSearchProduct): number {
  return countDistinctNonEmptyMarketplaces(
    product.offers
      .filter(isUsableCatalogOffer)
      .map((offer) => ({ marketplace: String(offer.marketplace ?? "").trim() })),
  );
}

function lowestPrice(product: CatalogSearchProduct): number {
  const prices = product.offers
    .filter(isUsableCatalogOffer)
    .map((offer) => Number(offer.price ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  return prices.length > 0 ? Math.min(...prices) : Number(product.price ?? 0);
}

const defaultCatalogRepository: CatalogSearchRepository = async ({ query, limit }) => {
  const rows = await prisma.product.findMany({
    where: catalogFilter(query),
    include: {
      offers: {
        where: {
          active: true,
          matchStatus: "EXACT",
        },
        select: {
          marketplace: true,
          active: true,
          available: true,
          status: true,
          matchStatus: true,
          price: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { price: "asc" }],
    take: limit,
  });

  return rows.map((product) => ({
    id: product.id,
    name: product.name,
    canonicalName: product.canonicalName,
    brand: product.brand,
    specifications: product.specifications,
    modelNumber: product.modelNumber,
    ean: product.ean,
    gtin: product.gtin,
    mpn: product.mpn,
    color: product.color,
    voltage: product.voltage,
    size: product.size,
    image: product.image ?? "",
    price: product.price,
    oldPrice: product.oldPrice ?? null,
    discount: product.discount ?? null,
    store: product.store ?? "",
    installments: product.installments ?? null,
    rating: product.rating ?? null,
    reviews: product.reviews ?? null,
    sales: product.sales ?? null,
    stock: product.stock ?? null,
    active: product.active,
    publicationStatus: product.publicationStatus,
    updatedAt: product.updatedAt,
    offers: product.offers.map((offer) => ({
      marketplace: String(offer.marketplace ?? ""),
      active: offer.active,
      available: offer.available,
      status: String(offer.status ?? "ACTIVE"),
      matchStatus: String(offer.matchStatus ?? "EXACT"),
      price: offer.price,
    })),
  }));
};

export async function searchCatalogLocal(
  query: string,
  options: CatalogSearchOptions = {},
): Promise<CatalogSearchResult> {
  const normalizedQuery = normalizeQuery(query);
  const limit = Math.max(options.queryLimit ?? CATALOG_CANDIDATE_LIMIT, 1);
  const resultLimit = Math.max(options.resultLimit ?? CATALOG_RESULT_LIMIT, 1);

  if (normalizedQuery.length < 2) {
    return {
      query: normalizedQuery,
      normalizedQuery,
      source: "LOCAL_CATALOG",
      hits: [],
      total: 0,
      elapsedMs: 0,
    };
  }

  const startedAt = Date.now();
  const repository = options.repository ?? defaultCatalogRepository;
  const productRows = await repository({
    query: normalizedQuery,
    normalizedQuery,
    limit,
  });

  const matches = productRows.filter((product) => {
    if (!product.active || product.price <= 0) {
      return false;
    }

    if (!product.image || !product.image.trim()) {
      return false;
    }

    if (product.publicationStatus === "DRAFT" || product.publicationStatus === "ARCHIVED") {
      return false;
    }

    return matchesQuery(product, normalizedQuery);
  });

  const hits = matches
    .map((product) => {
      const count = marketCount(product);
      const score = scoreQueryRelevance(
        buildQueryIntent(normalizedQuery),
        normalizeCandidate({
          marketplace: "AMAZON",
          marketplaceName: "Amazon",
          externalId: `catalog:${(product.canonicalName ?? product.name).slice(0, 24)}`,
          title: product.canonicalName ?? product.name,
          price: product.price,
          url: "https://ofertano.local/catalog",
          image: product.image ?? "",
          brand: product.brand ?? null,
          category: null,
          seller: null,
          affiliateLink: null,
          attributes: catalogIdentityAttributes(product),
        }),
      );

      return {
        product,
        kind: count >= 2 ? "COMPARABLE" : "SINGLE_MARKETPLACE",
        marketplaceCount: count,
        lowestPrice: lowestPrice(product),
        relevanceScore: score.status === "RELEVANT" ? score.queryRelevance : 0,
      } satisfies CatalogSearchHit;
    })
    .sort((first, second) => {
      if (second.marketplaceCount !== first.marketplaceCount) {
        return second.marketplaceCount - first.marketplaceCount;
      }

      if ((second.relevanceScore ?? 0) !== (first.relevanceScore ?? 0)) {
        return (second.relevanceScore ?? 0) - (first.relevanceScore ?? 0);
      }

      if (first.lowestPrice !== second.lowestPrice) {
        return first.lowestPrice - second.lowestPrice;
      }

      const firstUpdated = new Date(first.product.updatedAt ?? Date.now()).getTime();
      const secondUpdated = new Date(second.product.updatedAt ?? Date.now()).getTime();
      return secondUpdated - firstUpdated;
    })
    .slice(0, resultLimit);

  return {
    query: normalizedQuery,
    normalizedQuery,
    source: "LOCAL_CATALOG",
    hits,
    total: hits.length,
    elapsedMs: Date.now() - startedAt,
  };
}
