export type MarketplaceListingMarket =
  | "MERCADO_LIVRE"
  | "AMAZON"
  | "SHOPEE"
  | "MAGAZINE_LUIZA"
  | "ALIEXPRESS";

export type RawListingStatus =
  | "DISCOVERED"
  | "NORMALIZED"
  | "MATCHED"
  | "UNMATCHED"
  | "STALE"
  | "ARCHIVED"
  | "ERROR";

export type NormalizedMarketplaceListing = {
  marketplace: MarketplaceListingMarket;
  externalId: string;
  sellerId?: string | null;
  sellerName?: string | null;
  sourceUrl?: string | null;
  affiliateLink?: string | null;
  title?: string | null;
  normalizedTitle?: string | null;
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
  available?: boolean;
  status?: RawListingStatus;
  fingerprint?: string | null;
  canonicalProductId?: string | null;
};

export type ListingIdentity = {
  marketplace: MarketplaceListingMarket;
  externalId: string;
  sellerId?: string | null;
};

export function buildListingIdentity(input: Partial<ListingIdentity>): ListingIdentity {
  return {
    marketplace: input.marketplace ?? "AMAZON",
    externalId: (input.externalId ?? "").trim(),
    sellerId: input.sellerId ?? null,
  };
}

export function normalizeMarketplaceListingTitle(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function listingFingerprint(input: NormalizedMarketplaceListing): string {
  const title = normalizeMarketplaceListingTitle(input.normalizedTitle ?? input.title ?? "");
  const brand = normalizeMarketplaceListingTitle(input.brand ?? "");
  const model = normalizeMarketplaceListingTitle(input.modelNumber ?? "");
  const category = normalizeMarketplaceListingTitle(input.category ?? "");
  const price = Number.isFinite(input.price ?? NaN) ? Number(input.price) : 0;

  return [input.marketplace, input.externalId.trim(), brand, model, category, title, String(price)].join(":");
}

export function normalizeMarketplaceListing(
  input: Partial<NormalizedMarketplaceListing>,
): NormalizedMarketplaceListing {
  const title = input.title ?? "";
  const normalizedTitle = normalizeMarketplaceListingTitle(title);

  return {
    marketplace: input.marketplace ?? "AMAZON",
    externalId: (input.externalId ?? "").trim(),
    sellerId: input.sellerId ?? null,
    sellerName: input.sellerName ?? null,
    sourceUrl: input.sourceUrl ?? null,
    affiliateLink: input.affiliateLink ?? null,
    title: title || null,
    normalizedTitle: normalizedTitle || null,
    brand: input.brand ?? null,
    modelNumber: input.modelNumber ?? null,
    ean: input.ean ?? null,
    gtin: input.gtin ?? null,
    mpn: input.mpn ?? null,
    category: input.category ?? null,
    attributes: input.attributes ?? null,
    image: input.image ?? null,
    price: input.price ?? null,
    oldPrice: input.oldPrice ?? null,
    stock: input.stock ?? null,
    available: input.available ?? true,
    status: input.status ?? "DISCOVERED",
    fingerprint: input.fingerprint ?? listingFingerprint({
      marketplace: input.marketplace ?? "AMAZON",
      externalId: input.externalId ?? "",
      sellerId: input.sellerId ?? null,
      title: title || null,
      normalizedTitle: normalizedTitle || null,
      brand: input.brand ?? null,
      modelNumber: input.modelNumber ?? null,
      category: input.category ?? null,
      price: input.price ?? null,
    }),
    canonicalProductId: input.canonicalProductId ?? null,
  };
}

export function buildProductSearchDocument(input: {
  productId: string;
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  gtin?: string | null;
  ean?: string | null;
  mpn?: string | null;
  category?: string | null;
  aliases?: string[];
  marketplaceOffers?: Array<{ marketplace: string; price?: number | null; }>;
  updatedAt?: Date | string | null;
}): {
  productId: string;
  title: string;
  normalizedTitle: string;
  brand: string | null;
  model: string | null;
  gtin: string | null;
  ean: string | null;
  mpn: string | null;
  category: string | null;
  aliases: string[];
  lowestPrice: number | null;
  offerCount: number;
  marketplaceCount: number;
  updatedAt: Date | string | null;
} {
  const offers = input.marketplaceOffers ?? [];
  const prices = offers
    .map((offer) => (Number.isFinite(Number(offer.price)) ? Number(offer.price) : null))
    .filter((value): value is number => value !== null);

  return {
    productId: input.productId,
    title: input.title ?? "",
    normalizedTitle: normalizeMarketplaceListingTitle(input.title ?? ""),
    brand: input.brand ?? null,
    model: input.model ?? null,
    gtin: input.gtin ?? null,
    ean: input.ean ?? null,
    mpn: input.mpn ?? null,
    category: input.category ?? null,
    aliases: input.aliases ?? [],
    lowestPrice: prices.length > 0 ? Math.min(...prices) : null,
    offerCount: offers.length,
    marketplaceCount: new Set(offers.map((offer) => offer.marketplace)).size,
    updatedAt: input.updatedAt ?? new Date(),
  };
}

export type ListingLinkDecision =
  | "MATCHED"
  | "UNMATCHED"
  | "REJECTED";

export function linkListingToCanonicalProduct(input: {
  listing: NormalizedMarketplaceListing;
  canonicalProductId?: string | null;
  decision: ListingLinkDecision;
}): Pick<NormalizedMarketplaceListing, "canonicalProductId" | "status"> {
  return {
    canonicalProductId: input.canonicalProductId ?? null,
    status: input.decision === "MATCHED" ? "MATCHED" : input.decision === "UNMATCHED" ? "UNMATCHED" : "ERROR",
  };
}

export type RawListingRepository = {
  upsertRawMarketplaceListing: (listing: NormalizedMarketplaceListing) => Promise<NormalizedMarketplaceListing>;
  findListingByMarketplaceExternalId: (marketplace: MarketplaceListingMarket, externalId: string) => Promise<NormalizedMarketplaceListing | null>;
  linkListingToProduct: (listingId: string, canonicalProductId: string) => Promise<void>;
  markListingStale: (listingId: string) => Promise<void>;
};
