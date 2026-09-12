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

export type RawListingWriteStatus =
  | "DISABLED"
  | "CREATED"
  | "UPDATED"
  | "REJECTED"
  | "ERROR";

export type RawListingCanaryConfig = {
  allowedMarketplaces?: string[] | null;
  allowedExternalIds?: string[] | null;
  maxWrites?: number | null;
  counter?: { current: number };
};

export type RawListingWriteResult = {
  status: RawListingWriteStatus;
  marketplace: MarketplaceListingMarket;
  externalId?: string;
  listingId?: string;
  reason?: string;
};

export type RawListingCanaryMetricCounters = {
  attempted: number;
  skippedDisabled: number;
  skippedDryRun: number;
  skippedMarketplace: number;
  skippedExternalId: number;
  skippedLimit: number;
  skippedInvalidExternalId: number;
  writeSuccess: number;
  writeFailed: number;
};

export type RawListingCanaryMetrics = RawListingCanaryMetricCounters & {
  byMarketplace: Record<string, RawListingCanaryMetricCounters>;
};

const rawListingCanaryProcessCounter = { current: 0 };

const emptyRawListingCanaryMetricCounters = (): RawListingCanaryMetricCounters => ({
  attempted: 0,
  skippedDisabled: 0,
  skippedDryRun: 0,
  skippedMarketplace: 0,
  skippedExternalId: 0,
  skippedLimit: 0,
  skippedInvalidExternalId: 0,
  writeSuccess: 0,
  writeFailed: 0,
});

const rawListingCanaryMetrics: RawListingCanaryMetrics = {
  ...emptyRawListingCanaryMetricCounters(),
  byMarketplace: {},
};

function normalizeMetricMarketplaceKey(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function ensureRawListingCanaryMarketplaceBucket(marketplace?: string | null): RawListingCanaryMetricCounters {
  const key = normalizeMetricMarketplaceKey(marketplace);
  if (!key) {
    return rawListingCanaryMetrics;
  }

  if (!rawListingCanaryMetrics.byMarketplace[key]) {
    rawListingCanaryMetrics.byMarketplace[key] = emptyRawListingCanaryMetricCounters();
  }

  return rawListingCanaryMetrics.byMarketplace[key];
}

function incrementRawListingCanaryMetric(kind: keyof RawListingCanaryMetricCounters, marketplace?: string | null): void {
  rawListingCanaryMetrics[kind] += 1;
  const bucket = ensureRawListingCanaryMarketplaceBucket(marketplace);
  if (bucket !== rawListingCanaryMetrics) {
    bucket[kind] += 1;
  }

  emitRawListingCanaryEvent(kind, marketplace);
}

const RAW_LISTING_CANARY_EVENT_MAP: Partial<Record<keyof RawListingCanaryMetricCounters, string>> = {
  attempted: "RAW_LISTING_CANARY_ATTEMPTED",
  skippedDisabled: "RAW_LISTING_CANARY_SKIPPED_DISABLED",
  skippedDryRun: "RAW_LISTING_CANARY_SKIPPED_DRY_RUN",
  skippedMarketplace: "RAW_LISTING_CANARY_SKIPPED_MARKETPLACE",
  skippedExternalId: "RAW_LISTING_CANARY_SKIPPED_EXTERNAL_ID",
  skippedLimit: "RAW_LISTING_CANARY_SKIPPED_LIMIT",
  skippedInvalidExternalId: "RAW_LISTING_CANARY_SKIPPED_INVALID_EXTERNAL_ID",
  writeSuccess: "RAW_LISTING_CANARY_WRITE_SUCCESS",
  writeFailed: "RAW_LISTING_CANARY_WRITE_FAILED",
};

function emitRawListingCanaryEvent(kind: keyof RawListingCanaryMetricCounters, marketplace?: string | null): void {
  const eventName = RAW_LISTING_CANARY_EVENT_MAP[kind];
  if (!eventName) {
    return;
  }

  if (typeof console !== "undefined" && console.info) {
    console.info(eventName, {
      marketplace: normalizeMetricMarketplaceKey(marketplace),
    });
  }
}

export function getRawListingCanaryMetrics(): RawListingCanaryMetrics {
  return {
    attempted: rawListingCanaryMetrics.attempted,
    skippedDisabled: rawListingCanaryMetrics.skippedDisabled,
    skippedDryRun: rawListingCanaryMetrics.skippedDryRun,
    skippedMarketplace: rawListingCanaryMetrics.skippedMarketplace,
    skippedExternalId: rawListingCanaryMetrics.skippedExternalId,
    skippedLimit: rawListingCanaryMetrics.skippedLimit,
    skippedInvalidExternalId: rawListingCanaryMetrics.skippedInvalidExternalId,
    writeSuccess: rawListingCanaryMetrics.writeSuccess,
    writeFailed: rawListingCanaryMetrics.writeFailed,
    byMarketplace: Object.fromEntries(
      Object.entries(rawListingCanaryMetrics.byMarketplace).map(([marketplace, metrics]) => [
        marketplace,
        { ...metrics },
      ]),
    ),
  };
}

export function resetRawListingCanaryMetrics(): RawListingCanaryMetrics {
  const snapshot = getRawListingCanaryMetrics();

  const cleared = { ...emptyRawListingCanaryMetricCounters(), byMarketplace: {} };
  Object.assign(rawListingCanaryMetrics, cleared);

  return snapshot;
}

function normalizeCanaryValue(value?: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeCanaryList(values?: string[] | null): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => normalizeCanaryValue(value)).filter(Boolean))];
}

function readRawListingCanaryFromEnv(
  env: Record<string, string | undefined> = process.env,
): RawListingCanaryConfig {
  const rawMaxWrites = env.RAW_LISTING_CANARY_MAX_WRITES ?? "";
  const parsedMaxWrites = rawMaxWrites.trim() === "" ? null : Number(rawMaxWrites);

  return {
    allowedMarketplaces: normalizeCanaryList((env.RAW_LISTING_CANARY_MARKETPLACES ?? "")
      .split(",")
      .map((item) => item.trim())),
    allowedExternalIds: normalizeCanaryList((env.RAW_LISTING_CANARY_EXTERNAL_IDS ?? "")
      .split(",")
      .map((item) => item.trim())),
    maxWrites: Number.isFinite(parsedMaxWrites) ? parsedMaxWrites : null,
  };
}

function isCanaryConfigValid(canary?: RawListingCanaryConfig | null): boolean {
  if (!canary) {
    return false;
  }

  const hasAllowlists = (canary.allowedMarketplaces?.length ?? 0) > 0 || (canary.allowedExternalIds?.length ?? 0) > 0;
  const hasMaxWrites = typeof canary.maxWrites === "number" && Number.isFinite(canary.maxWrites) && canary.maxWrites >= 0;

  return hasAllowlists || hasMaxWrites;
}

export function isRawListingCanaryAllowed(params: {
  listing: NormalizedMarketplaceListing;
  enabled?: boolean;
  dryRun?: boolean;
  canary?: RawListingCanaryConfig | null;
}): { allowed: boolean; reason?: string; } {
  const listing = normalizeMarketplaceListing(params.listing);
  const isEnabled = params.enabled ?? isRawListingDualWriteEnabled();

  if (!isEnabled) {
    return { allowed: false, reason: "dual-write-disabled" };
  }

  if (params.dryRun) {
    return { allowed: false, reason: "dry-run" };
  }

  const hasExplicitCanary = params.canary !== undefined;
  const envCanary = readRawListingCanaryFromEnv();
  const canary = hasExplicitCanary ? (params.canary ?? {}) : envCanary;
  const configuredFromEnv =
    (envCanary.allowedMarketplaces?.length ?? 0) > 0 ||
    (envCanary.allowedExternalIds?.length ?? 0) > 0 ||
    envCanary.maxWrites !== null;

  if (!hasExplicitCanary && !configuredFromEnv) {
    return { allowed: false, reason: "canary-config-invalid" };
  }

  const allowedMarketplaces = normalizeCanaryList(canary.allowedMarketplaces);
  const allowedExternalIds = normalizeCanaryList(canary.allowedExternalIds);
  const maxWrites = typeof canary.maxWrites === "number" ? canary.maxWrites : null;

  if (!isCanaryConfigValid(canary)) {
    return { allowed: false, reason: "canary-config-invalid" };
  }

  if (allowedMarketplaces.length > 0 && !allowedMarketplaces.includes(normalizeCanaryValue(listing.marketplace))) {
    return { allowed: false, reason: "canary-marketplace-denied" };
  }

  if (allowedExternalIds.length > 0 && !allowedExternalIds.includes(normalizeCanaryValue(listing.externalId))) {
    return { allowed: false, reason: "canary-external-id-denied" };
  }

  if (typeof maxWrites === "number" && (!Number.isFinite(maxWrites) || maxWrites < 0)) {
    return { allowed: false, reason: "canary-max-writes-invalid" };
  }

  if (typeof maxWrites === "number") {
    const counter = canary.counter ?? rawListingCanaryProcessCounter;
    if (counter.current >= maxWrites) {
      return { allowed: false, reason: "canary-max-writes-reached" };
    }
    counter.current += 1;
  }

  return { allowed: true };
}

export function isRawListingDualWriteEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env.RAW_LISTING_DUAL_WRITE_ENABLED?.trim().toLowerCase();

  if (!value) {
    return false;
  }

  return value === "1" || value === "true" || value === "yes";
}

export function sanitizeRawListingPayload(
  listing: NormalizedMarketplaceListing,
): Partial<NormalizedMarketplaceListing> {
  const sanitized: Partial<NormalizedMarketplaceListing> = {
    marketplace: listing.marketplace,
    externalId: listing.externalId,
    sellerId: listing.sellerId ?? null,
    sellerName: listing.sellerName ?? null,
    sourceUrl: listing.sourceUrl ?? null,
    affiliateLink: listing.affiliateLink ?? null,
    title: listing.title ?? null,
    normalizedTitle: listing.normalizedTitle ?? null,
    brand: listing.brand ?? null,
    modelNumber: listing.modelNumber ?? null,
    ean: listing.ean ?? null,
    gtin: listing.gtin ?? null,
    mpn: listing.mpn ?? null,
    category: listing.category ?? null,
    attributes: listing.attributes ?? null,
    image: listing.image ?? null,
    price: listing.price ?? null,
    oldPrice: listing.oldPrice ?? null,
    stock: listing.stock ?? null,
    available: listing.available ?? true,
    status: listing.status ?? "DISCOVERED",
    fingerprint: listing.fingerprint ?? listingFingerprint(listing),
    canonicalProductId: listing.canonicalProductId ?? null,
  };

  if (sanitized.sourceUrl) {
    sanitized.sourceUrl = sanitized.sourceUrl.replace(/([?&])(token|key|auth|secret|password)=[^&\s]+/gi, "$1redacted");
  }

  if (sanitized.affiliateLink) {
    sanitized.affiliateLink = sanitized.affiliateLink.replace(/([?&])(token|key|auth|secret|password)=[^&\s]+/gi, "$1redacted");
  }

  return sanitized;
}

export async function persistRawListingIfEnabled(params: {
  listing: NormalizedMarketplaceListing;
  repository?: Pick<RawListingRepository, "findListingByMarketplaceExternalId" | "upsertRawMarketplaceListing" | "linkListingToProduct">;
  enabled?: boolean;
  dryRun?: boolean;
  canary?: RawListingCanaryConfig | null;
}): Promise<RawListingWriteResult> {
  const listing = normalizeMarketplaceListing(params.listing);
  const isEnabled = params.enabled ?? isRawListingDualWriteEnabled();

  incrementRawListingCanaryMetric("attempted", listing.marketplace);

  if (params.dryRun) {
    incrementRawListingCanaryMetric("skippedDryRun", listing.marketplace);
    return {
      status: "DISABLED",
      marketplace: listing.marketplace,
      externalId: listing.externalId,
      reason: "dry-run",
    };
  }

  if (!isEnabled) {
    incrementRawListingCanaryMetric("skippedDisabled", listing.marketplace);
    return {
      status: "DISABLED",
      marketplace: listing.marketplace,
      externalId: listing.externalId,
      reason: "dual-write-disabled",
    };
  }

  if (!listing.marketplace || !listing.externalId || !listing.externalId.trim()) {
    incrementRawListingCanaryMetric("skippedInvalidExternalId", listing.marketplace);
    return {
      status: "REJECTED",
      marketplace: listing.marketplace,
      externalId: listing.externalId,
      reason: "missing-marketplace-or-external-id",
    };
  }

  const canaryResult = isRawListingCanaryAllowed({
    listing,
    enabled: isEnabled,
    dryRun: params.dryRun,
    canary: params.canary,
  });

  if (!canaryResult.allowed) {
    if (canaryResult.reason === "canary-marketplace-denied") {
      incrementRawListingCanaryMetric("skippedMarketplace", listing.marketplace);
    } else if (canaryResult.reason === "canary-external-id-denied") {
      incrementRawListingCanaryMetric("skippedExternalId", listing.marketplace);
    } else if (canaryResult.reason === "canary-max-writes-reached") {
      incrementRawListingCanaryMetric("skippedLimit", listing.marketplace);
    } else {
      incrementRawListingCanaryMetric("skippedDisabled", listing.marketplace);
    }

    return {
      status: "DISABLED",
      marketplace: listing.marketplace,
      externalId: listing.externalId,
      reason: canaryResult.reason,
    };
  }

  if (!params.repository) {
    incrementRawListingCanaryMetric("writeFailed", listing.marketplace);
    return {
      status: "ERROR",
      marketplace: listing.marketplace,
      externalId: listing.externalId,
      reason: "repository-not-configured",
    };
  }

  try {
    const sanitized = sanitizeRawListingPayload(listing);
    const existing = await params.repository.findListingByMarketplaceExternalId(
      listing.marketplace,
      listing.externalId,
    );

    const saved = await params.repository.upsertRawMarketplaceListing({
      ...normalizeMarketplaceListing(existing ?? sanitized),
      ...normalizeMarketplaceListing({ ...existing, ...sanitized }),
    });

    if (listing.canonicalProductId && saved?.externalId) {
      await params.repository.linkListingToProduct(saved.externalId, listing.canonicalProductId);
    }

    incrementRawListingCanaryMetric("writeSuccess", listing.marketplace);

    return {
      status: existing ? "UPDATED" : "CREATED",
      marketplace: saved.marketplace,
      externalId: saved.externalId,
      listingId: saved?.externalId,
    };
  } catch (error) {
    incrementRawListingCanaryMetric("writeFailed", listing.marketplace);
    return {
      status: "ERROR",
      marketplace: listing.marketplace,
      externalId: listing.externalId,
      reason: error instanceof Error ? error.message : "raw-listing-write-failed",
    };
  }
}
