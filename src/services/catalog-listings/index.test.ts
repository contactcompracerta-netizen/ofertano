import assert from "node:assert/strict";
import test from "node:test";

import {
  buildListingIdentity,
  buildProductSearchDocument,
  evaluateRawListingBoundedBatchExecutionPrecheck,
  evaluateRawListingCanaryReadiness,
  evaluateRawListingControlledMultiListingCanaryPrecheck,
  evaluateRawListingRealCanaryProbePrecheck,
  evaluateRawListingRealIdempotencyCanaryPrecheck,
  getRawListingCanaryMetrics,
  isRawListingDualWriteEnabled,
  linkListingToCanonicalProduct,
  listingFingerprint,
  normalizeMarketplaceListing,
  persistRawListingIfEnabled,
  resetRawListingCanaryMetrics,
  sanitizeRawListingPayload,
} from "./index";

test("same marketplace and external id share listing identity", () => {
  const left = buildListingIdentity({ marketplace: "AMAZON", externalId: "B07L2XYZ1P" });
  const right = buildListingIdentity({ marketplace: "AMAZON", externalId: "B07L2XYZ1P" });

  assert.deepEqual(left, right);
});

test("different marketplaces produce different listing identity", () => {
  const left = buildListingIdentity({ marketplace: "AMAZON", externalId: "B07L2XYZ1P" });
  const right = buildListingIdentity({ marketplace: "MERCADO_LIVRE", externalId: "B07L2XYZ1P" });

  assert.notDeepEqual(left, right);
});

test("different sellers same marketplace are allowed when externalId differs", () => {
  const first = buildListingIdentity({ marketplace: "MERCADO_LIVRE", externalId: "ML-001", sellerId: "seller-a" });
  const second = buildListingIdentity({ marketplace: "MERCADO_LIVRE", externalId: "ML-002", sellerId: "seller-b" });

  assert.notDeepEqual(first, second);
});

test("normalization preserves brand and model details", () => {
  const normalized = normalizeMarketplaceListing({
    marketplace: "AMAZON",
    externalId: "A-001",
    title: "Samsung Galaxy S21 5G 128GB Preto",
    brand: "Samsung",
    modelNumber: "S21",
  });

  assert.equal(normalized.brand, "Samsung");
  assert.equal(normalized.modelNumber, "S21");
  assert.match(normalized.normalizedTitle ?? "", /samsung|galaxy|s21/);
});

test("search document de-dupes marketplace offers by marketplace", () => {
  const document = buildProductSearchDocument({
    productId: "product-1",
    title: "Notebook Dell Inspiron 15",
    brand: "Dell",
    category: "Eletrônicos",
    marketplaceOffers: [
      { marketplace: "AMAZON", price: 2500 },
      { marketplace: "AMAZON", price: 2700 },
      { marketplace: "MAGAZINE_LUIZA", price: 2900 },
    ],
  });

  assert.equal(document.marketplaceCount, 2);
  assert.equal(document.offerCount, 3);
  assert.equal(document.lowestPrice, 2500);
});

test("canonical linking can keep raw listing unmatched", () => {
  const decision = linkListingToCanonicalProduct({
    listing: normalizeMarketplaceListing({ marketplace: "SHOPEE", externalId: "SH-999" }),
    decision: "UNMATCHED",
  });

  assert.equal(decision.status, "UNMATCHED");
  assert.equal(decision.canonicalProductId, null);
});

test("listing fingerprint remains stable for repeated normalization", () => {
  const input = normalizeMarketplaceListing({
    marketplace: "MERCADO_LIVRE",
    externalId: "ML-777",
    title: "Fone JBL Tune 520BT Preto",
    brand: "JBL",
    modelNumber: "Tune 520BT",
    price: 499,
  });

  const first = listingFingerprint(input);
  const second = listingFingerprint(normalizeMarketplaceListing({
    marketplace: "MERCADO_LIVRE",
    externalId: "ML-777",
    title: "Fone JBL Tune 520BT Preto",
    brand: "JBL",
    modelNumber: "Tune 520BT",
    price: 499,
  }));

  assert.equal(first, second);
});

test("cross-brand canonical match is rejected at the linking layer", () => {
  const decision = linkListingToCanonicalProduct({
    listing: normalizeMarketplaceListing({
      marketplace: "AMAZON",
      externalId: "A-ERR",
      title: "Monitor Acer Predator",
      brand: "Acer",
      modelNumber: "Predator",
    }),
    canonicalProductId: "product-samsung",
    decision: "REJECTED",
  });

  assert.equal(decision.status, "ERROR");
});

test("raw listing dual-write flag is fail-closed and accepts explicit truthy values", () => {
  assert.equal(isRawListingDualWriteEnabled({}), false);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "false" }), false);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "0" }), false);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "no" }), false);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "true" }), true);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "1" }), true);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "yes" }), true);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "maybe" }), false);
});

test("readiness gate returns READY for a safe config without changing system state", () => {
  const safeConfig = {
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON,MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "5",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "A-ALLOWED,ML-ALLOWED",
  };

  const readiness = evaluateRawListingCanaryReadiness(safeConfig);
  assert.equal(readiness.status, "READY");
  assert.deepEqual(readiness.reasons, []);
  assert.equal(readiness.checks.dualWriteEnabled, false);
  assert.equal(readiness.checks.marketplaceAllowlistValid, true);
  assert.equal(readiness.checks.maxWritesValid, true);
  assert.equal(readiness.checks.metricsHealthy, true);
  assert.equal(readiness.checks.readOnly, true);
});

test("readiness gate blocks dual-write if already enabled", () => {
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "true",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "5",
  });

  assert.equal(readiness.status, "NOT_READY");
  assert.ok(readiness.reasons.includes("DUAL_WRITE_ALREADY_ENABLED"));
});

test("readiness gate blocks missing marketplace allowlist", () => {
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MAX_WRITES: "5",
  });

  assert.equal(readiness.status, "NOT_READY");
  assert.ok(readiness.reasons.includes("MARKETPLACE_ALLOWLIST_MISSING"));
});

test("readiness gate blocks invalid marketplace allowlist", () => {
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "ALL_MARKETS",
    RAW_LISTING_CANARY_MAX_WRITES: "5",
  });

  assert.equal(readiness.status, "NOT_READY");
  assert.ok(readiness.reasons.includes("MARKETPLACE_ALLOWLIST_INVALID"));
});

test("readiness gate blocks missing max writes", () => {
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
  });

  assert.equal(readiness.status, "NOT_READY");
  assert.ok(readiness.reasons.includes("MAX_WRITES_MISSING"));
});

test("readiness gate blocks zero max writes", () => {
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "0",
  });

  assert.equal(readiness.status, "NOT_READY");
  assert.ok(readiness.reasons.includes("MAX_WRITES_INVALID"));
});

test("readiness gate blocks negative max writes", () => {
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "-2",
  });

  assert.equal(readiness.status, "NOT_READY");
  assert.ok(readiness.reasons.includes("MAX_WRITES_INVALID"));
});

test("readiness gate blocks non-numeric max writes", () => {
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "abc",
  });

  assert.equal(readiness.status, "NOT_READY");
  assert.ok(readiness.reasons.includes("MAX_WRITES_INVALID"));
});

test("readiness gate accepts valid external allowlist and remains READY", () => {
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "5",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "A-ALLOWED, A-SECOND",
  });

  assert.equal(readiness.status, "READY");
  assert.equal(readiness.checks.externalIdsValid, true);
});

test("readiness gate blocks invalid external ids", () => {
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "5",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "A-VALID, invalid id",
  });

  assert.equal(readiness.status, "NOT_READY");
  assert.ok(readiness.reasons.includes("EXTERNAL_ID_ALLOWLIST_INVALID"));
});

test("readiness gate is read-only and does not touch metrics or repository state", () => {
  const before = getRawListingCanaryMetrics();
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "5",
  });
  const after = getRawListingCanaryMetrics();

  assert.equal(readiness.status, "READY");
  assert.deepEqual(after, before);
  assert.equal(readiness.checks.readOnly, true);
});

test("readiness gate is deterministic for the same config", () => {
  const first = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "5",
  });
  const second = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "5",
  });

  assert.deepEqual(first, second);
});

test("readiness gate snapshot is isolated from caller mutation", () => {
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "5",
  });

  readiness.checks.marketplaceAllowlistValid = false;
  const next = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "5",
  });

  assert.equal(next.checks.marketplaceAllowlistValid, true);
});

test("readiness gate is fail-closed for malformed config", () => {
  const readiness = evaluateRawListingCanaryReadiness({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "",
    RAW_LISTING_CANARY_MAX_WRITES: "Infinity",
  });

  assert.equal(readiness.status, "NOT_READY");
  assert.ok(readiness.reasons.length > 0);
});

test("real canary precheck returns READY for a single safe probe plan", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(precheck.status, "READY");
  assert.equal(precheck.plan.maxWrites, 1);
  assert.equal(precheck.checks.readinessGateReady, true);
  assert.equal(precheck.checks.dualWriteCurrentlyDisabled, true);
  assert.equal(precheck.checks.canaryLimitIsOne, true);
  assert.equal(precheck.checks.readOnly, true);
});

const idempotencyCanaryConfig = {
  RAW_LISTING_DUAL_WRITE_ENABLED: "false",
  RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
  RAW_LISTING_CANARY_MAX_WRITES: "2",
  RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-IDEMPOTENCY-001",
};

const idempotencyCanaryOptions = {
  baselineKnown: true,
  rollbackDefined: true,
  abortCriteriaDefined: true,
};

test("idempotency canary precheck accepts exactly two writes for one target", () => {
  const precheck = evaluateRawListingRealIdempotencyCanaryPrecheck(
    idempotencyCanaryConfig,
    idempotencyCanaryOptions,
  );

  assert.equal(precheck.status, "READY");
  assert.deepEqual(precheck.reasons, []);
  assert.equal(precheck.plan.maxWrites, 2);
  assert.equal(precheck.checks.readOnly, true);
});

test("idempotency canary precheck rejects max writes other than two", () => {
  for (const maxWrites of ["1", "3"]) {
    const precheck = evaluateRawListingRealIdempotencyCanaryPrecheck(
      { ...idempotencyCanaryConfig, RAW_LISTING_CANARY_MAX_WRITES: maxWrites },
      idempotencyCanaryOptions,
    );

    assert.equal(precheck.status, "NOT_READY");
    assert.ok(precheck.reasons.includes("CANARY_MAX_WRITES_NOT_TWO"));
  }
});

test("idempotency canary precheck requires exactly one valid marketplace", () => {
  for (const marketplaces of ["", "MERCADO_LIVRE,AMAZON"]) {
    const precheck = evaluateRawListingRealIdempotencyCanaryPrecheck(
      { ...idempotencyCanaryConfig, RAW_LISTING_CANARY_MARKETPLACES: marketplaces },
      idempotencyCanaryOptions,
    );

    assert.equal(precheck.status, "NOT_READY");
    assert.ok(precheck.reasons.includes("CANARY_MARKETPLACE_COUNT_NOT_ONE"));
  }
});

test("idempotency canary precheck requires exactly one valid external id", () => {
  for (const externalIds of ["", "ML-FIRST,ML-SECOND", "invalid id"]) {
    const precheck = evaluateRawListingRealIdempotencyCanaryPrecheck(
      { ...idempotencyCanaryConfig, RAW_LISTING_CANARY_EXTERNAL_IDS: externalIds },
      idempotencyCanaryOptions,
    );

    assert.equal(precheck.status, "NOT_READY");
  }

  const invalid = evaluateRawListingRealIdempotencyCanaryPrecheck(
    { ...idempotencyCanaryConfig, RAW_LISTING_CANARY_EXTERNAL_IDS: "invalid id" },
    idempotencyCanaryOptions,
  );
  assert.ok(invalid.reasons.includes("CANARY_EXTERNAL_ID_INVALID"));
});

test("idempotency canary precheck requires dual-write off and all safety acknowledgements", () => {
  const cases = [
    [{ RAW_LISTING_DUAL_WRITE_ENABLED: "true" }, "DUAL_WRITE_ENABLED"],
    [{}, "BASELINE_NOT_KNOWN"],
    [{}, "ROLLBACK_NOT_DEFINED"],
    [{}, "ABORT_CRITERIA_NOT_DEFINED"],
  ] as const;

  for (const [overrides, reason] of cases) {
    const options = {
      ...idempotencyCanaryOptions,
      baselineKnown: reason === "BASELINE_NOT_KNOWN" ? false : idempotencyCanaryOptions.baselineKnown,
      rollbackDefined: reason === "ROLLBACK_NOT_DEFINED" ? false : idempotencyCanaryOptions.rollbackDefined,
      abortCriteriaDefined: reason === "ABORT_CRITERIA_NOT_DEFINED"
        ? false
        : idempotencyCanaryOptions.abortCriteriaDefined,
    };
    const precheck = evaluateRawListingRealIdempotencyCanaryPrecheck(
      { ...idempotencyCanaryConfig, ...overrides },
      options,
    );

    assert.equal(precheck.status, "NOT_READY");
    assert.ok(precheck.reasons.includes(reason));
  }
});

const multiListingCanaryOptions = {
  baselineKnown: true,
  rollbackDefined: true,
  abortCriteriaDefined: true,
};

function multiListingConfig(externalIds: string, maxWrites: string, overrides: Record<string, string> = {}) {
  return {
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_EXTERNAL_IDS: externalIds,
    RAW_LISTING_CANARY_MAX_WRITES: maxWrites,
    ...overrides,
  };
}

test("controlled multi-listing precheck accepts two and three targets", () => {
  for (const [externalIds, maxWrites, expectedCount] of [
    ["ML-001,ML-002", "2", 2],
    ["ML-001,ML-002,ML-003", "3", 3],
  ] as const) {
    const precheck = evaluateRawListingControlledMultiListingCanaryPrecheck(
      multiListingConfig(externalIds, maxWrites),
      multiListingCanaryOptions,
    );

    assert.equal(precheck.status, "READY");
    assert.deepEqual(precheck.reasons, []);
    assert.equal(precheck.plan.targetCount, expectedCount);
    assert.equal(precheck.plan.maxWrites, expectedCount);
    assert.equal(precheck.checks.readOnly, true);
  }
});

test("controlled multi-listing precheck rejects invalid target counts", () => {
  for (const externalIds of ["", "ML-001", "ML-001,ML-002,ML-003,ML-004"]) {
    const precheck = evaluateRawListingControlledMultiListingCanaryPrecheck(
      multiListingConfig(externalIds, externalIds ? externalIds.split(",").length.toString() : "0"),
      multiListingCanaryOptions,
    );

    assert.equal(precheck.status, "NOT_READY");
  }

  assert.ok(evaluateRawListingControlledMultiListingCanaryPrecheck(
    multiListingConfig("", "0"),
    multiListingCanaryOptions,
  ).reasons.includes("CANARY_EXTERNAL_ID_COUNT_BELOW_MIN"));
  assert.ok(evaluateRawListingControlledMultiListingCanaryPrecheck(
    multiListingConfig("ML-001,ML-002,ML-003,ML-004", "4"),
    multiListingCanaryOptions,
  ).reasons.includes("CANARY_EXTERNAL_ID_COUNT_ABOVE_MAX"));
});

test("controlled multi-listing precheck rejects invalid, duplicate, or mismatched targets", () => {
  const invalid = evaluateRawListingControlledMultiListingCanaryPrecheck(
    multiListingConfig("ML-001,invalid id", "2"),
    multiListingCanaryOptions,
  );
  assert.equal(invalid.status, "NOT_READY");
  assert.ok(invalid.reasons.includes("CANARY_EXTERNAL_ID_INVALID"));

  const duplicates = evaluateRawListingControlledMultiListingCanaryPrecheck(
    multiListingConfig("ML-001,ML-001", "2"),
    multiListingCanaryOptions,
  );
  assert.equal(duplicates.status, "NOT_READY");
  assert.ok(duplicates.reasons.includes("CANARY_EXTERNAL_IDS_NOT_UNIQUE"));

  for (const [externalIds, maxWrites] of [["ML-001,ML-002", "1"], ["ML-001,ML-002", "3"], ["ML-001,ML-002,ML-003", "2"]]) {
    const precheck = evaluateRawListingControlledMultiListingCanaryPrecheck(
      multiListingConfig(externalIds, maxWrites),
      multiListingCanaryOptions,
    );
    assert.equal(precheck.status, "NOT_READY");
    assert.ok(precheck.reasons.includes("CANARY_MAX_WRITES_TARGET_COUNT_MISMATCH"));
  }
});

test("controlled multi-listing precheck requires one marketplace and all safety gates", () => {
  const cases = [
    [multiListingConfig("ML-001,ML-002", "2", { RAW_LISTING_CANARY_MARKETPLACES: "" }), multiListingCanaryOptions, "CANARY_MARKETPLACE_COUNT_NOT_ONE"],
    [multiListingConfig("ML-001,ML-002", "2", { RAW_LISTING_CANARY_MARKETPLACES: "AMAZON,MERCADO_LIVRE" }), multiListingCanaryOptions, "CANARY_MARKETPLACE_COUNT_NOT_ONE"],
    [multiListingConfig("ML-001,ML-002", "2", { RAW_LISTING_DUAL_WRITE_ENABLED: "true" }), multiListingCanaryOptions, "DUAL_WRITE_ENABLED"],
    [multiListingConfig("ML-001,ML-002", "2"), { ...multiListingCanaryOptions, baselineKnown: false }, "BASELINE_NOT_KNOWN"],
    [multiListingConfig("ML-001,ML-002", "2"), { ...multiListingCanaryOptions, rollbackDefined: false }, "ROLLBACK_NOT_DEFINED"],
    [multiListingConfig("ML-001,ML-002", "2"), { ...multiListingCanaryOptions, abortCriteriaDefined: false }, "ABORT_CRITERIA_NOT_DEFINED"],
  ] as const;

  for (const [config, options, reason] of cases) {
    const precheck = evaluateRawListingControlledMultiListingCanaryPrecheck(config, options);
    assert.equal(precheck.status, "NOT_READY");
    assert.ok(precheck.reasons.includes(reason));
  }
});

test("existing single and idempotency prechecks retain their write limits", () => {
  const base = {
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-001",
  };
  assert.equal(evaluateRawListingRealCanaryProbePrecheck(
    { ...base, RAW_LISTING_CANARY_MAX_WRITES: "1" },
    multiListingCanaryOptions,
  ).status, "READY");
  assert.equal(evaluateRawListingRealCanaryProbePrecheck(
    { ...base, RAW_LISTING_CANARY_MAX_WRITES: "2" },
    multiListingCanaryOptions,
  ).status, "NOT_READY");
  assert.equal(evaluateRawListingRealIdempotencyCanaryPrecheck(
    { ...base, RAW_LISTING_CANARY_MAX_WRITES: "2" },
    multiListingCanaryOptions,
  ).status, "READY");
  assert.equal(evaluateRawListingRealIdempotencyCanaryPrecheck(
    { ...base, RAW_LISTING_CANARY_MAX_WRITES: "1" },
    multiListingCanaryOptions,
  ).status, "NOT_READY");
  assert.equal(evaluateRawListingRealIdempotencyCanaryPrecheck(
    { ...base, RAW_LISTING_CANARY_MAX_WRITES: "3" },
    multiListingCanaryOptions,
  ).status, "NOT_READY");
});

const boundedBatchOptions = {
  baselineKnown: true,
  rollbackDefined: true,
  abortCriteriaDefined: true,
  cleanupRequired: true,
  cleanupScopeExplicit: true,
  stopAfterFirstFailure: true,
  executionMode: "sequential",
  concurrency: 1,
  parallelWrites: 0,
  expectedInitialRawCount: 0,
};

function boundedBatchConfig(externalIds: string, maxWrites: string, overrides: Record<string, string> = {}) {
  return {
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_EXTERNAL_IDS: externalIds,
    RAW_LISTING_CANARY_MAX_WRITES: maxWrites,
    ...overrides,
  };
}

test("bounded batch precheck returns READY for two sequential targets", () => {
  const metricsBefore = getRawListingCanaryMetrics();
  const dualWriteBefore = process.env.RAW_LISTING_DUAL_WRITE_ENABLED;
  const precheck = evaluateRawListingBoundedBatchExecutionPrecheck(
    boundedBatchConfig("ML-001,ML-002", "2"),
    boundedBatchOptions,
  );

  assert.equal(precheck.status, "READY");
  assert.deepEqual(precheck.reasons, []);
  assert.equal(precheck.plan.targetCount, 2);
  assert.equal(precheck.plan.maxWrites, 2);
  assert.equal(precheck.plan.executionMode, "sequential");
  assert.equal(precheck.plan.concurrency, 1);
  assert.equal(precheck.plan.stopAfterFirstFailure, true);
  assert.equal(precheck.plan.cleanupRequired, true);
  assert.equal(precheck.plan.cleanupScopeExplicit, true);
  assert.equal(precheck.plan.rollbackRequired, true);
  assert.equal(precheck.plan.abortCriteriaDefined, true);
  assert.equal(precheck.plan.baselineKnown, true);
  assert.equal(precheck.plan.readOnly, true);
  assert.deepEqual(getRawListingCanaryMetrics(), metricsBefore);
  assert.equal(process.env.RAW_LISTING_DUAL_WRITE_ENABLED, dualWriteBefore);
});

test("bounded batch precheck returns READY for three sequential targets", () => {
  const metricsBefore = getRawListingCanaryMetrics();
  const precheck = evaluateRawListingBoundedBatchExecutionPrecheck(
    boundedBatchConfig("ML-001,ML-002,ML-003", "3"),
    boundedBatchOptions,
  );

  assert.equal(precheck.status, "READY");
  assert.deepEqual(precheck.reasons, []);
  assert.equal(precheck.plan.targetCount, 3);
  assert.equal(precheck.plan.maxWrites, 3);
  assert.equal(precheck.plan.executionMode, "sequential");
  assert.deepEqual(getRawListingCanaryMetrics(), metricsBefore);
});

test("bounded batch precheck fail-closed matrix rejects unsafe plans", () => {
  const cases: Array<{
    config?: Record<string, string>;
    options?: Partial<typeof boundedBatchOptions> & { parallel?: boolean };
    reason?: string;
  }> = [
    { config: boundedBatchConfig("", "0"), reason: "BATCH_TARGET_COUNT_BELOW_MIN" },
    { config: boundedBatchConfig("ML-001", "1"), reason: "BATCH_TARGET_COUNT_BELOW_MIN" },
    { config: boundedBatchConfig("ML-001,ML-002,ML-003,ML-004", "4"), reason: "BATCH_TARGET_LIMIT_EXCEEDED" },
    { config: boundedBatchConfig("ML-001,ML-002", "2", { RAW_LISTING_CANARY_MARKETPLACES: "" }), reason: "BATCH_MARKETPLACE_COUNT_NOT_ONE" },
    { config: boundedBatchConfig("ML-001,ML-002", "2", { RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE,AMAZON" }), reason: "BATCH_MARKETPLACE_COUNT_NOT_ONE" },
    { config: boundedBatchConfig("ML-001,ML-002", "2", { RAW_LISTING_CANARY_MARKETPLACES: "NOT_A_MARKET" }), reason: "BATCH_MARKETPLACE_INVALID" },
    { config: boundedBatchConfig("ML-001,invalid id", "2"), reason: "BATCH_EXTERNAL_ID_INVALID" },
    { config: boundedBatchConfig("ML-001,ML-001", "2"), reason: "BATCH_EXTERNAL_IDS_NOT_UNIQUE" },
    { config: boundedBatchConfig("ML-001,ML-002", "1"), reason: "BATCH_MAX_WRITES_TARGET_COUNT_MISMATCH" },
    { config: boundedBatchConfig("ML-001,ML-002", "3"), reason: "BATCH_MAX_WRITES_TARGET_COUNT_MISMATCH" },
    { config: boundedBatchConfig("ML-001,ML-002,ML-003", "2"), reason: "BATCH_MAX_WRITES_TARGET_COUNT_MISMATCH" },
    { config: boundedBatchConfig("ML-001,ML-002", "4"), reason: "BATCH_MAX_WRITES_LIMIT_EXCEEDED" },
    { config: boundedBatchConfig("ML-001,ML-002", "2", { RAW_LISTING_DUAL_WRITE_ENABLED: "true" }), reason: "DUAL_WRITE_ENABLED" },
    { options: { baselineKnown: false }, reason: "BASELINE_NOT_KNOWN" },
    { options: { rollbackDefined: false }, reason: "ROLLBACK_NOT_DEFINED" },
    { options: { abortCriteriaDefined: false }, reason: "ABORT_CRITERIA_NOT_DEFINED" },
    { options: { cleanupRequired: false }, reason: "CLEANUP_NOT_REQUIRED" },
    { options: { cleanupScopeExplicit: false }, reason: "CLEANUP_SCOPE_NOT_EXPLICIT" },
    { options: { stopAfterFirstFailure: false }, reason: "STOP_AFTER_FIRST_FAILURE_REQUIRED" },
    { options: { concurrency: 2 }, reason: "BATCH_CONCURRENCY_NOT_ALLOWED" },
    { options: { parallelWrites: 1 }, reason: "BATCH_CONCURRENCY_NOT_ALLOWED" },
    { options: { executionMode: "parallel" }, reason: "BATCH_EXECUTION_MODE_NOT_SEQUENTIAL" },
    { options: { parallel: true }, reason: "BATCH_CONCURRENCY_NOT_ALLOWED" },
  ];

  for (const testCase of cases) {
    const precheck = evaluateRawListingBoundedBatchExecutionPrecheck(
      testCase.config ?? boundedBatchConfig("ML-001,ML-002", "2"),
      { ...boundedBatchOptions, ...testCase.options },
    );
    assert.equal(precheck.status, "NOT_READY", testCase.reason);
    if (testCase.reason) {
      assert.ok(precheck.reasons.includes(testCase.reason), `${testCase.reason} in ${precheck.reasons.join(",")}`);
    }
  }
});

test("legacy prechecks and bounded batch keep their independent limits", () => {
  const singleBase = {
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-001",
  };

  assert.equal(evaluateRawListingRealCanaryProbePrecheck(
    { ...singleBase, RAW_LISTING_CANARY_MAX_WRITES: "1" },
    multiListingCanaryOptions,
  ).status, "READY");
  assert.equal(evaluateRawListingRealCanaryProbePrecheck(
    { ...singleBase, RAW_LISTING_CANARY_MAX_WRITES: "2" },
    multiListingCanaryOptions,
  ).status, "NOT_READY");

  assert.equal(evaluateRawListingRealIdempotencyCanaryPrecheck(
    { ...singleBase, RAW_LISTING_CANARY_MAX_WRITES: "2" },
    multiListingCanaryOptions,
  ).status, "READY");
  assert.equal(evaluateRawListingRealIdempotencyCanaryPrecheck(
    { ...singleBase, RAW_LISTING_CANARY_MAX_WRITES: "1" },
    multiListingCanaryOptions,
  ).status, "NOT_READY");
  assert.equal(evaluateRawListingRealIdempotencyCanaryPrecheck(
    { ...singleBase, RAW_LISTING_CANARY_MAX_WRITES: "3" },
    multiListingCanaryOptions,
  ).status, "NOT_READY");

  assert.equal(evaluateRawListingControlledMultiListingCanaryPrecheck(
    multiListingConfig("ML-001,ML-002", "2"),
    multiListingCanaryOptions,
  ).status, "READY");
  assert.equal(evaluateRawListingControlledMultiListingCanaryPrecheck(
    multiListingConfig("ML-001,ML-002,ML-003", "3"),
    multiListingCanaryOptions,
  ).status, "READY");
  assert.equal(evaluateRawListingControlledMultiListingCanaryPrecheck(
    multiListingConfig("ML-001", "1"),
    multiListingCanaryOptions,
  ).status, "NOT_READY");
  assert.equal(evaluateRawListingControlledMultiListingCanaryPrecheck(
    multiListingConfig("ML-001,ML-002,ML-003,ML-004", "4"),
    multiListingCanaryOptions,
  ).status, "NOT_READY");

  assert.equal(evaluateRawListingBoundedBatchExecutionPrecheck(
    boundedBatchConfig("ML-001,ML-002", "2"),
    boundedBatchOptions,
  ).status, "READY");
  assert.equal(evaluateRawListingBoundedBatchExecutionPrecheck(
    boundedBatchConfig("ML-001,ML-002,ML-003", "3"),
    boundedBatchOptions,
  ).status, "READY");
});

test("real canary precheck is not ready when readiness gate is not ready", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(precheck.status, "NOT_READY");
  assert.ok(precheck.reasons.includes("READINESS_GATE_NOT_READY"));
});

test("real canary precheck requires dual-write to remain off", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "true",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(precheck.status, "NOT_READY");
  assert.ok(precheck.reasons.includes("DUAL_WRITE_ALREADY_ENABLED"));
});

test("real canary precheck requires exactly one marketplace", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE,AMAZON",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(precheck.status, "NOT_READY");
  assert.ok(precheck.reasons.includes("PROBE_MARKETPLACE_COUNT_INVALID"));
});

test("real canary precheck rejects missing max writes", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(precheck.status, "NOT_READY");
  assert.ok(precheck.reasons.includes("CANARY_MAX_WRITES_NOT_ONE"));
});

test("real canary precheck rejects max writes not equal to one", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "2",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(precheck.status, "NOT_READY");
  assert.ok(precheck.reasons.includes("CANARY_MAX_WRITES_NOT_ONE"));
});

test("real canary precheck requires a single valid external id", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001,ML-REAL-PROBE-002",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(precheck.status, "NOT_READY");
  assert.ok(precheck.reasons.includes("PROBE_EXTERNAL_ID_COUNT_INVALID"));
});

test("real canary precheck rejects missing external id", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(precheck.status, "NOT_READY");
  assert.ok(precheck.reasons.includes("PROBE_EXTERNAL_ID_MISSING"));
});

test("real canary precheck rejects invalid external id", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "invalid id",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(precheck.status, "NOT_READY");
  assert.ok(precheck.reasons.includes("PROBE_EXTERNAL_ID_INVALID"));
});

test("real canary precheck is read-only and does not mutate metrics or write state", () => {
  const before = getRawListingCanaryMetrics();
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });
  const after = getRawListingCanaryMetrics();

  assert.equal(precheck.status, "READY");
  assert.deepEqual(after, before);
  assert.equal(precheck.checks.readOnly, true);
});

test("real canary precheck is deterministic for the same config", () => {
  const first = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });
  const second = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.deepEqual(first, second);
});

test("real canary precheck snapshot is isolated from caller mutation", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  precheck.checks.canaryLimitIsOne = false;
  const next = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(next.checks.canaryLimitIsOne, true);
});

test("real canary precheck is fail-closed for malformed config", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(precheck.status, "NOT_READY");
  assert.ok(precheck.reasons.length > 0);
});

test("real canary precheck never auto-activates the dual-write flag", () => {
  const precheck = evaluateRawListingRealCanaryProbePrecheck({
    RAW_LISTING_DUAL_WRITE_ENABLED: "false",
    RAW_LISTING_CANARY_MARKETPLACES: "MERCADO_LIVRE",
    RAW_LISTING_CANARY_MAX_WRITES: "1",
    RAW_LISTING_CANARY_EXTERNAL_IDS: "ML-REAL-PROBE-001",
  }, {
    baselineKnown: true,
    rollbackDefined: true,
    abortCriteriaDefined: true,
  });

  assert.equal(precheck.status, "READY");
  assert.equal(precheck.checks.noAutoActivation, true);
});

test("dry-run overrides the dual-write flag and never persists", async () => {
  const calls: string[] = [];
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async (listing: ReturnType<typeof normalizeMarketplaceListing>) => {
      calls.push(`${listing.marketplace}:${listing.externalId}`);
      return listing;
    },
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({
      marketplace: "AMAZON",
      externalId: "A-DRY",
      title: "Monitor Samsung Odyssey",
      brand: "Samsung",
      category: "Eletrônicos",
    }),
    repository,
    enabled: true,
    dryRun: true,
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(calls.length, 0);
});

test("enabled dual-write persists sanitized payload fields without leaking secrets", async () => {
  const seen: Record<string, unknown> = {};
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async (listing: ReturnType<typeof normalizeMarketplaceListing>) => {
      seen.marketplace = listing.marketplace;
      seen.externalId = listing.externalId;
      seen.sourceUrl = listing.sourceUrl;
      seen.affiliateLink = listing.affiliateLink;
      seen.price = listing.price;
      seen.title = listing.title;
      return listing;
    },
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({
      marketplace: "MERCADO_LIVRE",
      externalId: "ML-ALLOWED",
      title: "Fone JBL Tune 520BT",
      brand: "JBL",
      category: "Áudio",
      sourceUrl: "https://example.com/listing?token=secret&source=ml",
      affiliateLink: "https://example.com/afiliado?auth=abc&campaign=promo",
      price: 499,
      canonicalProductId: "product-123",
    }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["MERCADO_LIVRE"],
      allowedExternalIds: ["ML-ALLOWED"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "CREATED");
  assert.equal(seen.marketplace, "MERCADO_LIVRE");
  assert.equal(seen.externalId, "ML-ALLOWED");
  assert.equal(seen.title, "Fone JBL Tune 520BT");
  assert.equal(seen.price, 499);
  assert.equal(String(seen.sourceUrl ?? "").includes("token"), false);
  assert.equal(String(seen.affiliateLink ?? "").includes("auth"), false);
});

test("repository failure is isolated and returns an error result instead of breaking legacy flow", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => {
      throw new Error("repository-down");
    },
    upsertRawMarketplaceListing: async () => {
      throw new Error("repository-down");
    },
    linkListingToProduct: async () => undefined,
  };

  await assert.doesNotReject(async () => {
    const result = await persistRawListingIfEnabled({
      listing: normalizeMarketplaceListing({
        marketplace: "AMAZON",
        externalId: "A-FAIL",
        title: "Kindle",
      }),
      repository,
      enabled: true,
      dryRun: false,
      canary: {
        allowedMarketplaces: ["AMAZON"],
        allowedExternalIds: ["A-FAIL"],
        maxWrites: 10,
        counter: { current: 0 },
      },
    });

    assert.equal(result.status, "ERROR");
  });
});

test("global off blocks writes even when the shadow path is otherwise configured", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-GLOBAL-OFF" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-GLOBAL-OFF", title: "Widget" }),
    repository,
    enabled: false,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-GLOBAL-OFF"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "DISABLED");
});

test("flag on without valid canary config blocks writes", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-NO-CANARY" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-NO-CANARY", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: { counter: { current: 0 } },
  });

  assert.equal(result.status, "DISABLED");
});

test("flag on without any canary configuration blocks writes and preserves legacy flow", async () => {
  resetRawListingCanaryMetrics();

  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-FLAG-ONLY" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-FLAG-ONLY", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(result.reason, "canary-config-invalid");

  const metrics = getRawListingCanaryMetrics();
  assert.equal(metrics.attempted, 1);
  assert.equal(metrics.skippedDisabled, 1);
});

test("resetRawListingCanaryMetrics clears all counters", () => {
  resetRawListingCanaryMetrics();

  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-RESET" }),
    linkListingToProduct: async () => undefined,
  };

  return persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-RESET", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-RESET"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  }).then(() => {
    const metrics = getRawListingCanaryMetrics();
    assert.equal(metrics.attempted, 1);
    assert.equal(metrics.writeSuccess, 1);

    const reset = resetRawListingCanaryMetrics();
    assert.equal(reset.attempted, 1);
    assert.equal(reset.writeSuccess, 1);

    const cleared = getRawListingCanaryMetrics();
    assert.equal(cleared.attempted, 0);
    assert.equal(cleared.writeSuccess, 0);
    assert.deepEqual(cleared.byMarketplace, {});
  });
});

test("dry-run metrics are captured without a repository write", async () => {
  resetRawListingCanaryMetrics();

  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DRY-METRIC" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DRY-METRIC", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: true,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-DRY-METRIC"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "DISABLED");
  const metrics = getRawListingCanaryMetrics();
  assert.equal(metrics.attempted, 1);
  assert.equal(metrics.skippedDryRun, 1);
  assert.equal(metrics.writeSuccess, 0);
});

test("marketplace deny metrics are counted without write", async () => {
  resetRawListingCanaryMetrics();

  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "MERCADO_LIVRE", externalId: "ML-DENY-METRIC" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "MERCADO_LIVRE", externalId: "ML-DENY-METRIC", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["ML-DENY-METRIC"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "DISABLED");
  const metrics = getRawListingCanaryMetrics();
  assert.equal(metrics.attempted, 1);
  assert.equal(metrics.skippedMarketplace, 1);
});

test("external id deny metrics are counted without write", async () => {
  resetRawListingCanaryMetrics();

  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DENY-METRIC" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DENY-METRIC", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-ALLOW-METRIC"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "DISABLED");
  const metrics = getRawListingCanaryMetrics();
  assert.equal(metrics.attempted, 1);
  assert.equal(metrics.skippedExternalId, 1);
});

test("max writes metric is counted and write does not continue", async () => {
  resetRawListingCanaryMetrics();

  const counter = { current: 0 };
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-LIMIT-METRIC" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-LIMIT-METRIC", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-LIMIT-METRIC"],
      maxWrites: 0,
      counter,
    },
  });

  assert.equal(result.status, "DISABLED");
  const metrics = getRawListingCanaryMetrics();
  assert.equal(metrics.attempted, 1);
  assert.equal(metrics.skippedLimit, 1);
});

test("invalid external id metrics are counted before a write attempt", async () => {
  resetRawListingCanaryMetrics();

  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "   " }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "   ", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-INVALID-METRIC"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "REJECTED");
  const metrics = getRawListingCanaryMetrics();
  assert.equal(metrics.attempted, 1);
  assert.equal(metrics.skippedInvalidExternalId, 1);
  assert.equal(metrics.writeSuccess, 0);
});

test("success metric counts a valid write and failure metric counts repository error", async () => {
  resetRawListingCanaryMetrics();

  const successRepository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-SUCCESS-METRIC" }),
    linkListingToProduct: async () => undefined,
  };

  const success = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-SUCCESS-METRIC", title: "Widget" }),
    repository: successRepository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-SUCCESS-METRIC"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(success.status, "CREATED");

  const failingRepository = {
    findListingByMarketplaceExternalId: async () => {
      throw new Error("metrics-repository-down");
    },
    upsertRawMarketplaceListing: async () => {
      throw new Error("metrics-repository-down");
    },
    linkListingToProduct: async () => undefined,
  };

  const failure = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-FAIL-METRIC", title: "Widget" }),
    repository: failingRepository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-FAIL-METRIC"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(failure.status, "ERROR");

  const metrics = getRawListingCanaryMetrics();
  assert.equal(metrics.attempted, 2);
  assert.equal(metrics.writeSuccess, 1);
  assert.equal(metrics.writeFailed, 1);
});

test("metrics accumulate and snapshot is isolated from internal state", async () => {
  resetRawListingCanaryMetrics();

  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-ACCUM-1" }),
    linkListingToProduct: async () => undefined,
  };

  await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-ACCUM-1", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-ACCUM-1"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  const first = getRawListingCanaryMetrics();
  first.attempted = 999;
  first.byMarketplace.amazon.attempted = 999;

  const second = getRawListingCanaryMetrics();
  assert.equal(second.attempted, 1);
  assert.equal(second.byMarketplace.amazon.attempted, 1);

  const reset = resetRawListingCanaryMetrics();
  assert.equal(reset.attempted, 1);
  assert.equal(reset.writeSuccess, 1);
});

test("marketplace allowlist enforces explicit permission", async () => {
  const calls: string[] = [];
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async (listing: ReturnType<typeof normalizeMarketplaceListing>) => {
      calls.push(`${listing.marketplace}:${listing.externalId}`);
      return listing;
    },
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-ALLOW", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-ALLOW"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "CREATED");
  assert.equal(calls.length, 1);
});

test("marketplace deny blocks writes outside the allowlist", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "MERCADO_LIVRE", externalId: "ML-DENY" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "MERCADO_LIVRE", externalId: "ML-DENY", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["ML-DENY"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(result.reason, "canary-marketplace-denied");
});

test("external id allowlist enforces exact match", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-EXACT" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-EXACT", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-EXACT"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "CREATED");
});

test("external id deny blocks unlisted IDs", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DENY" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DENY", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-ALLOW"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(result.reason, "canary-external-id-denied");
});

test("max writes limit caps canary writes within a process", async () => {
  const calls: string[] = [];
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async (listing: ReturnType<typeof normalizeMarketplaceListing>) => {
      calls.push(listing.externalId);
      return listing;
    },
    linkListingToProduct: async () => undefined,
  };

  const counter = { current: 0 };

  const first = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-LIMIT-1", title: "Widget A" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-LIMIT-1", "A-LIMIT-2"],
      maxWrites: 1,
      counter,
    },
  });

  const second = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-LIMIT-2", title: "Widget B" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-LIMIT-1", "A-LIMIT-2"],
      maxWrites: 1,
      counter,
    },
  });

  assert.equal(first.status, "CREATED");
  assert.equal(second.status, "DISABLED");
  assert.equal(second.reason, "canary-max-writes-reached");
  assert.equal(calls.length, 1);
});

test("dry run keeps precedence over every canary permit", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DRY" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DRY", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: true,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-DRY"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(result.reason, "dry-run");
});

test("repository failure stays isolated and the legacy flow continues", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => {
      throw new Error("canary-repository-down");
    },
    upsertRawMarketplaceListing: async () => {
      throw new Error("canary-repository-down");
    },
    linkListingToProduct: async () => undefined,
  };

  await assert.doesNotReject(async () => {
    const result = await persistRawListingIfEnabled({
      listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-FAIL", title: "Widget" }),
      repository,
      enabled: true,
      dryRun: false,
      canary: {
        allowedMarketplaces: ["AMAZON"],
        allowedExternalIds: ["A-FAIL"],
        maxWrites: 10,
        counter: { current: 0 },
      },
    });

    assert.equal(result.status, "ERROR");
  });
});

test("invalid external ids are rejected before persisting", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "   " }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "   ", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-INVALID"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "REJECTED");
});

test("same marketplace and external id remains idempotent under canary controls", async () => {
  const calls: Array<{ marketplace: string; externalId: string }> = [];
  const repository = {
    findListingByMarketplaceExternalId: async (marketplace: string, externalId: string) => {
      const match = calls.find((entry) => entry.marketplace === marketplace && entry.externalId === externalId);
      return match ? normalizeMarketplaceListing({ marketplace: marketplace as any, externalId, title: "Existing", brand: "BrandX" }) : null;
    },
    upsertRawMarketplaceListing: async (listing: ReturnType<typeof normalizeMarketplaceListing>) => {
      calls.push({ marketplace: listing.marketplace, externalId: listing.externalId });
      return listing;
    },
    linkListingToProduct: async () => undefined,
  };

  const listing = normalizeMarketplaceListing({
    marketplace: "MERCADO_LIVRE",
    externalId: "ML-CANARY-1",
    title: "Fone JBL Tune 520BT",
    brand: "JBL",
    category: "Áudio",
    sourceUrl: "https://example.com/listing?token=secret",
    affiliateLink: "https://example.com/afiliado?auth=abc",
    canonicalProductId: "product-1",
  });

  const first = await persistRawListingIfEnabled({
    listing,
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["MERCADO_LIVRE"],
      allowedExternalIds: ["ML-CANARY-1"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  const second = await persistRawListingIfEnabled({
    listing,
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["MERCADO_LIVRE"],
      allowedExternalIds: ["ML-CANARY-1"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(first.status, "CREATED");
  assert.equal(second.status, "UPDATED");
  assert.equal(calls.length, 2);
});

test("enabled dual-write persists idempotently for the same marketplace and external id", async () => {
  const calls: Array<{ marketplace: string; externalId: string }> = [];
  const repository = {
    findListingByMarketplaceExternalId: async (marketplace: string, externalId: string) => {
      const match = calls.find((entry) => entry.marketplace === marketplace && entry.externalId === externalId);
      return match ? normalizeMarketplaceListing({ marketplace: marketplace as any, externalId, title: "Existing", brand: "BrandX" }) : null;
    },
    upsertRawMarketplaceListing: async (listing: ReturnType<typeof normalizeMarketplaceListing>) => {
      calls.push({ marketplace: listing.marketplace, externalId: listing.externalId });
      return listing;
    },
    linkListingToProduct: async () => undefined,
  };

  const listing = normalizeMarketplaceListing({
    marketplace: "MERCADO_LIVRE",
    externalId: "ML-123",
    title: "Fone JBL Tune 520BT",
    brand: "JBL",
    category: "Áudio",
    sourceUrl: "https://example.com/listing?token=secret",
    affiliateLink: "https://example.com/afiliado?auth=abc",
    canonicalProductId: "product-1",
  });

  const first = await persistRawListingIfEnabled({
    listing,
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["MERCADO_LIVRE"],
      allowedExternalIds: ["ML-123"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });
  const second = await persistRawListingIfEnabled({
    listing,
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["MERCADO_LIVRE"],
      allowedExternalIds: ["ML-123"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(first.status, "CREATED");
  assert.equal(second.status, "UPDATED");
  assert.equal(calls.length >= 2, true);
  assert.equal(sanitizeRawListingPayload(listing).sourceUrl?.includes("token"), false);
  assert.equal(sanitizeRawListingPayload(listing).affiliateLink?.includes("auth"), false);
});

test("invalid listing is rejected before write attempt", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "x" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "   ", title: "Offer" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-INVALID"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "REJECTED");
});
