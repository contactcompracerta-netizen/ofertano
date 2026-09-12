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

export type RawListingCanaryReadinessChecks = {
  dualWriteEnabled: boolean;
  marketplaceAllowlistValid: boolean;
  maxWritesValid: boolean;
  externalIdsValid: boolean;
  metricsHealthy: boolean;
  readOnly: boolean;
};

export type RawListingCanaryReadinessResult = {
  status: "READY" | "NOT_READY";
  reasons: string[];
  checks: RawListingCanaryReadinessChecks;
};

export type RawListingRealCanaryProbePlan = {
  maxWrites: number;
  marketplace: string;
  externalId: string;
  rollbackRequired: boolean;
  abortCriteriaDefined: boolean;
};

export type RawListingRealCanaryProbeChecks = RawListingCanaryReadinessChecks & {
  readinessGateReady: boolean;
  dualWriteCurrentlyDisabled: boolean;
  rawListingTableBaselineKnown: boolean;
  canaryLimitIsOne: boolean;
  singleMarketplaceConfigured: boolean;
  singleExternalIdConfigured: boolean;
  noAutoActivation: boolean;
};

export type RawListingRealCanaryProbePrecheckResult = {
  status: "READY" | "NOT_READY";
  reasons: string[];
  plan: RawListingRealCanaryProbePlan;
  checks: RawListingRealCanaryProbeChecks;
};

export type RawListingRealIdempotencyCanaryPrecheckResult = {
  status: "READY" | "NOT_READY";
  reasons: string[];
  plan: RawListingRealCanaryProbePlan;
  checks: {
    dualWriteDisabled: boolean;
    marketplaceAllowlistValid: boolean;
    exactlyOneMarketplace: boolean;
    externalIdsValid: boolean;
    exactlyOneExternalId: boolean;
    maxWritesIsTwo: boolean;
    metricsHealthy: boolean;
    baselineKnown: boolean;
    rollbackDefined: boolean;
    abortCriteriaDefined: boolean;
    readOnly: boolean;
  };
};

const rawListingCanaryProcessCounter = { current: 0 };
const MAX_SAFE_RAW_LISTING_CANARY_MAX_WRITES = 100;
const VALID_RAW_LISTING_MARKETPLACES = new Set([
  "MERCADO_LIVRE",
  "AMAZON",
  "SHOPEE",
  "MAGAZINE_LUIZA",
  "ALIEXPRESS",
]);

function isValidRawListingMarketplace(value?: string | null): boolean {
  return !!value && VALID_RAW_LISTING_MARKETPLACES.has(normalizeCanaryValue(value));
}

function isValidRawListingExternalId(value?: string | null): boolean {
  const token = (value ?? "").trim();
  if (!token) {
    return false;
  }

  return /^[A-Za-z0-9._:-]+$/.test(token);
}

export function evaluateRawListingCanaryReadiness(
  env: Record<string, string | undefined> = process.env,
): RawListingCanaryReadinessResult {
  const reasons: string[] = [];

  const dualWriteEnabled = isRawListingDualWriteEnabled(env);
  const checks: RawListingCanaryReadinessChecks = {
    dualWriteEnabled: dualWriteEnabled,
    marketplaceAllowlistValid: false,
    maxWritesValid: false,
    externalIdsValid: true,
    metricsHealthy: false,
    readOnly: true,
  };

  if (dualWriteEnabled) {
    reasons.push("DUAL_WRITE_ALREADY_ENABLED");
  }

  const marketplaceSetting = env.RAW_LISTING_CANARY_MARKETPLACES ?? "";
  const marketplaceAllowlist = normalizeCanaryList(
    (marketplaceSetting || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  if (marketplaceAllowlist.length === 0) {
    reasons.push("MARKETPLACE_ALLOWLIST_MISSING");
  } else {
    const invalidMarketplace = marketplaceAllowlist.find((marketplace) => !isValidRawListingMarketplace(marketplace));
    if (invalidMarketplace) {
      reasons.push("MARKETPLACE_ALLOWLIST_INVALID");
    } else {
      checks.marketplaceAllowlistValid = true;
    }
  }

  const rawMaxWrites = env.RAW_LISTING_CANARY_MAX_WRITES ?? "";
  if (rawMaxWrites.trim() === "") {
    reasons.push("MAX_WRITES_MISSING");
  } else {
    const parsed = Number(rawMaxWrites);
    const isValid =
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed > 0 &&
      parsed <= MAX_SAFE_RAW_LISTING_CANARY_MAX_WRITES;

    if (!isValid) {
      reasons.push("MAX_WRITES_INVALID");
    } else {
      checks.maxWritesValid = true;
    }
  }

  const externalIdSetting = env.RAW_LISTING_CANARY_EXTERNAL_IDS ?? "";
  if (externalIdSetting.trim() !== "") {
    const externalIds = externalIdSetting
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (externalIds.length === 0 || externalIds.some((value) => !isValidRawListingExternalId(value))) {
      reasons.push("EXTERNAL_ID_ALLOWLIST_INVALID");
      checks.externalIdsValid = false;
    }
  }

  try {
    const metrics = getRawListingCanaryMetrics();
    checks.metricsHealthy =
      !!metrics &&
      typeof metrics.attempted === "number" &&
      typeof metrics.skippedDisabled === "number" &&
      typeof metrics.skippedDryRun === "number" &&
      typeof metrics.skippedMarketplace === "number" &&
      typeof metrics.skippedExternalId === "number" &&
      typeof metrics.skippedLimit === "number" &&
      typeof metrics.skippedInvalidExternalId === "number" &&
      typeof metrics.writeSuccess === "number" &&
      typeof metrics.writeFailed === "number" &&
      typeof metrics.byMarketplace === "object";
  } catch {
    checks.metricsHealthy = false;
  }

  if (!checks.metricsHealthy) {
    reasons.push("METRICS_UNAVAILABLE");
  }

  const uniqueReasons = Array.from(new Set(reasons));
  const status: "READY" | "NOT_READY" = uniqueReasons.length === 0 ? "READY" : "NOT_READY";

  return {
    status,
    reasons: uniqueReasons,
    checks: {
      ...checks,
      dualWriteEnabled: false,
      marketplaceAllowlistValid: checks.marketplaceAllowlistValid,
      maxWritesValid: checks.maxWritesValid,
      externalIdsValid: checks.externalIdsValid,
      metricsHealthy: checks.metricsHealthy,
      readOnly: true,
    },
  };
}

export function evaluateRawListingRealCanaryProbePrecheck(
  env: Record<string, string | undefined> = process.env,
  options?: {
    baselineKnown?: boolean;
    rollbackDefined?: boolean;
    abortCriteriaDefined?: boolean;
  },
): RawListingRealCanaryProbePrecheckResult {
  const reasons: string[] = [];
  const readiness = evaluateRawListingCanaryReadiness(env);
  const resultChecks: RawListingRealCanaryProbeChecks = {
    dualWriteEnabled: false,
    marketplaceAllowlistValid: false,
    maxWritesValid: false,
    externalIdsValid: true,
    metricsHealthy: true,
    readOnly: true,
    readinessGateReady: readiness.status === "READY",
    dualWriteCurrentlyDisabled: !isRawListingDualWriteEnabled(env),
    rawListingTableBaselineKnown: !!options?.baselineKnown,
    canaryLimitIsOne: false,
    singleMarketplaceConfigured: false,
    singleExternalIdConfigured: false,
    noAutoActivation: true,
  };

  if (readiness.status !== "READY") {
    reasons.push("READINESS_GATE_NOT_READY");
  }
  resultChecks.readinessGateReady = readiness.status === "READY";

  if (isRawListingDualWriteEnabled(env)) {
    reasons.push("DUAL_WRITE_ALREADY_ENABLED");
  }
  resultChecks.dualWriteCurrentlyDisabled = !isRawListingDualWriteEnabled(env);

  const marketplaces = normalizeCanaryList(
    (env.RAW_LISTING_CANARY_MARKETPLACES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  if (marketplaces.length === 0) {
    reasons.push("PROBE_MARKETPLACE_MISSING");
  } else if (marketplaces.length !== 1) {
    reasons.push("PROBE_MARKETPLACE_COUNT_INVALID");
  } else if (!isValidRawListingMarketplace(marketplaces[0])) {
    reasons.push("PROBE_MARKETPLACE_INVALID");
  } else {
    resultChecks.singleMarketplaceConfigured = true;
    resultChecks.marketplaceAllowlistValid = true;
  }

  const rawMaxWrites = env.RAW_LISTING_CANARY_MAX_WRITES ?? "";
  const parsedMaxWrites = rawMaxWrites.trim() === "" ? NaN : Number(rawMaxWrites);
  if (!Number.isInteger(parsedMaxWrites) || parsedMaxWrites !== 1) {
    reasons.push("CANARY_MAX_WRITES_NOT_ONE");
  } else {
    resultChecks.maxWritesValid = true;
    resultChecks.canaryLimitIsOne = true;
  }

  const externalIdSetting = env.RAW_LISTING_CANARY_EXTERNAL_IDS ?? "";
  const externalIds = externalIdSetting
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (externalIds.length === 0) {
    reasons.push("PROBE_EXTERNAL_ID_MISSING");
  } else if (externalIds.length !== 1) {
    reasons.push("PROBE_EXTERNAL_ID_COUNT_INVALID");
  } else if (!isValidRawListingExternalId(externalIds[0])) {
    reasons.push("PROBE_EXTERNAL_ID_INVALID");
  } else {
    resultChecks.singleExternalIdConfigured = true;
    resultChecks.externalIdsValid = true;
  }

  if (!options?.baselineKnown) {
    reasons.push("BASELINE_UNKNOWN");
  }
  resultChecks.rawListingTableBaselineKnown = !!options?.baselineKnown;

  if (!options?.rollbackDefined) {
    reasons.push("ROLLBACK_NOT_DEFINED");
  }

  if (!options?.abortCriteriaDefined) {
    reasons.push("ABORT_CRITERIA_NOT_DEFINED");
  }

  const uniqueReasons = Array.from(new Set(reasons));
  const status: "READY" | "NOT_READY" = uniqueReasons.length === 0 ? "READY" : "NOT_READY";

  const plan: RawListingRealCanaryProbePlan = {
    maxWrites: 1,
    marketplace: marketplaces[0] ?? "UNDECIDED",
    externalId: externalIds[0] ?? "",
    rollbackRequired: !!options?.rollbackDefined,
    abortCriteriaDefined: !!options?.abortCriteriaDefined,
  };

  return {
    status,
    reasons: uniqueReasons,
    plan,
    checks: {
      ...resultChecks,
      dualWriteEnabled: false,
      marketplaceAllowlistValid: resultChecks.marketplaceAllowlistValid,
      maxWritesValid: resultChecks.maxWritesValid,
      externalIdsValid: resultChecks.externalIdsValid,
      metricsHealthy: true,
      readOnly: true,
      readinessGateReady: resultChecks.readinessGateReady,
      dualWriteCurrentlyDisabled: resultChecks.dualWriteCurrentlyDisabled,
      rawListingTableBaselineKnown: resultChecks.rawListingTableBaselineKnown,
      canaryLimitIsOne: resultChecks.canaryLimitIsOne,
      singleMarketplaceConfigured: resultChecks.singleMarketplaceConfigured,
      singleExternalIdConfigured: resultChecks.singleExternalIdConfigured,
      noAutoActivation: true,
    },
  } as RawListingRealCanaryProbePrecheckResult;
}

export function evaluateRawListingRealIdempotencyCanaryPrecheck(
  env: Record<string, string | undefined> = process.env,
  options?: {
    baselineKnown?: boolean;
    rollbackDefined?: boolean;
    abortCriteriaDefined?: boolean;
  },
): RawListingRealIdempotencyCanaryPrecheckResult {
  const readiness = evaluateRawListingCanaryReadiness(env);
  const reasons: string[] = [];
  const marketplaces = normalizeCanaryList(
    (env.RAW_LISTING_CANARY_MARKETPLACES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const externalIds = (env.RAW_LISTING_CANARY_EXTERNAL_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const dualWriteDisabled = !isRawListingDualWriteEnabled(env);
  const marketplaceAllowlistValid = marketplaces.length > 0 && marketplaces.every(isValidRawListingMarketplace);
  const exactlyOneMarketplace = marketplaces.length === 1;
  const externalIdsValid = externalIds.length > 0 && externalIds.every(isValidRawListingExternalId);
  const exactlyOneExternalId = externalIds.length === 1;
  const parsedMaxWrites = Number(env.RAW_LISTING_CANARY_MAX_WRITES ?? "");
  const maxWritesIsTwo = Number.isInteger(parsedMaxWrites) && parsedMaxWrites === 2;
  const metricsHealthy = readiness.checks.metricsHealthy;
  const baselineKnown = options?.baselineKnown === true;
  const rollbackDefined = options?.rollbackDefined === true;
  const abortCriteriaDefined = options?.abortCriteriaDefined === true;

  if (!dualWriteDisabled) {
    reasons.push("DUAL_WRITE_ENABLED");
  }
  if (!marketplaceAllowlistValid) {
    reasons.push("CANARY_MARKETPLACE_INVALID");
  }
  if (!exactlyOneMarketplace) {
    reasons.push("CANARY_MARKETPLACE_COUNT_NOT_ONE");
  }
  if (!externalIdsValid) {
    reasons.push("CANARY_EXTERNAL_ID_INVALID");
  }
  if (!exactlyOneExternalId) {
    reasons.push("CANARY_EXTERNAL_ID_COUNT_NOT_ONE");
  }
  if (!maxWritesIsTwo) {
    reasons.push("CANARY_MAX_WRITES_NOT_TWO");
  }
  if (!metricsHealthy) {
    reasons.push("METRICS_NOT_READY");
  }
  if (!baselineKnown) {
    reasons.push("BASELINE_NOT_KNOWN");
  }
  if (!rollbackDefined) {
    reasons.push("ROLLBACK_NOT_DEFINED");
  }
  if (!abortCriteriaDefined) {
    reasons.push("ABORT_CRITERIA_NOT_DEFINED");
  }

  const uniqueReasons = Array.from(new Set(reasons));
  return {
    status: uniqueReasons.length === 0 ? "READY" : "NOT_READY",
    reasons: uniqueReasons,
    plan: {
      maxWrites: 2,
      marketplace: marketplaces[0] ?? "UNDECIDED",
      externalId: externalIds[0] ?? "",
      rollbackRequired: rollbackDefined,
      abortCriteriaDefined,
    },
    checks: {
      dualWriteDisabled,
      marketplaceAllowlistValid,
      exactlyOneMarketplace,
      externalIdsValid,
      exactlyOneExternalId,
      maxWritesIsTwo,
      metricsHealthy,
      baselineKnown,
      rollbackDefined,
      abortCriteriaDefined,
      readOnly: true,
    },
  };
}


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
