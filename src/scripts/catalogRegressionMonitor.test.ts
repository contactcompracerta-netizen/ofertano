import assert from "node:assert/strict";

import {
  PROTECTED_REJECTED_OFFER_IDS,
  computePresentationCounters,
  evaluateCatalogRegression,
  sanitizeDbErrorMessage,
  type ProtectedOfferStatus,
} from "./catalogRegressionMonitor";

function healthyCounters(scanned = 90) {
  return {
    publicProductsScanned: scanned,
    productsOk: scanned,
    productsWithIssues: 0,
    titleIssues: 0,
    descriptionIssues: 0,
    brandConflicts: 0,
    invalidCanonicalBrands: 0,
    structuredBrandCleanupNeeded: 0,
  };
}

function allRejectedOffers(): ProtectedOfferStatus[] {
  return PROTECTED_REJECTED_OFFER_IDS.map((id) => ({
    id,
    found: true,
    matchStatus: "REJECTED",
  }));
}

// ---- HEALTHY_CATALOG_PASS -----------------------------------------------
{
  const evaluation = evaluateCatalogRegression(
    healthyCounters(90),
    allRejectedOffers(),
  );
  assert.equal(evaluation.regression, false, "healthy catalog must not regress");
  assert.equal(evaluation.productCountInvariant, true);
  assert.equal(evaluation.protectedInvariant, true);
  assert.equal(evaluation.regressedOfferIds.length, 0);
}
console.log("HEALTHY_CATALOG_PASS=PASS");

// ---- TITLE_REGRESSION_FAIL ----------------------------------------------
{
  const evaluation = evaluateCatalogRegression(
    { ...healthyCounters(90), productsOk: 89, productsWithIssues: 1, titleIssues: 1 },
    allRejectedOffers(),
  );
  assert.equal(evaluation.regression, true, "title issue must regress");
}
console.log("TITLE_REGRESSION_FAIL=PASS");

// ---- DESCRIPTION_REGRESSION_FAIL ----------------------------------------
{
  const evaluation = evaluateCatalogRegression(
    { ...healthyCounters(90), productsOk: 89, productsWithIssues: 1, descriptionIssues: 1 },
    allRejectedOffers(),
  );
  assert.equal(evaluation.regression, true, "description issue must regress");
}
console.log("DESCRIPTION_REGRESSION_FAIL=PASS");

// ---- BRAND_CONFLICT_REGRESSION_FAIL -------------------------------------
{
  const evaluation = evaluateCatalogRegression(
    { ...healthyCounters(90), productsOk: 89, productsWithIssues: 1, brandConflicts: 1 },
    allRejectedOffers(),
  );
  assert.equal(evaluation.regression, true, "brand conflict must regress");
}
console.log("BRAND_CONFLICT_REGRESSION_FAIL=PASS");

// ---- STRUCTURED_BRAND_CLEANUP_FAIL --------------------------------------
{
  const evaluation = evaluateCatalogRegression(
    {
      ...healthyCounters(90),
      productsOk: 89,
      productsWithIssues: 1,
      structuredBrandCleanupNeeded: 1,
    },
    allRejectedOffers(),
  );
  assert.equal(evaluation.regression, true, "structured cleanup must regress");
}
console.log("STRUCTURED_BRAND_CLEANUP_FAIL=PASS");

// ---- INVALID_CANONICAL_BRAND_FAIL ---------------------------------------
{
  const evaluation = evaluateCatalogRegression(
    {
      ...healthyCounters(90),
      productsOk: 89,
      productsWithIssues: 1,
      invalidCanonicalBrands: 1,
    },
    allRejectedOffers(),
  );
  assert.equal(evaluation.regression, true, "invalid brand must regress");
}
console.log("INVALID_CANONICAL_BRAND_FAIL=PASS");

// ---- REJECTED_OFFER_REACTIVATED_FAIL ------------------------------------
{
  const offers = allRejectedOffers();
  offers[4] = { ...offers[4], matchStatus: "EXACT" };
  const evaluation = evaluateCatalogRegression(healthyCounters(90), offers);
  assert.equal(evaluation.regression, true, "reactivated offer must regress");
  assert.deepEqual(evaluation.regressedOfferIds, [offers[4].id]);
}
console.log("REJECTED_OFFER_REACTIVATED_FAIL=PASS");

// ---- REJECTED_OFFER_NOT_FOUND_FAIL --------------------------------------
{
  const offers = allRejectedOffers().slice(0, 4);
  const evaluation = evaluateCatalogRegression(healthyCounters(90), offers);
  assert.equal(evaluation.regression, true, "missing offer must regress");
  assert.equal(evaluation.protectedInvariant, false);
}
console.log("REJECTED_OFFER_NOT_FOUND_FAIL=PASS");

// ---- REJECTED_OFFER_DELETED_ROW_FAIL ------------------------------------
{
  const offers = allRejectedOffers();
  offers[0] = { id: offers[0].id, found: false, matchStatus: null };
  const evaluation = evaluateCatalogRegression(healthyCounters(90), offers);
  assert.equal(evaluation.regression, true, "deleted offer must regress");
  assert.deepEqual(evaluation.regressedOfferIds, [offers[0].id]);
}
console.log("REJECTED_OFFER_DELETED_ROW_FAIL=PASS");

// ---- CATALOG_GROWTH_ALLOWED ---------------------------------------------
{
  const evaluation = evaluateCatalogRegression(
    healthyCounters(120),
    allRejectedOffers(),
  );
  assert.equal(
    evaluation.regression,
    false,
    "healthy growth 90 -> 120 must PASS",
  );
}
console.log("CATALOG_GROWTH_ALLOWED=PASS");

// ---- PRODUCT_COUNT_INVARIANT_FAIL ---------------------------------------
{
  const evaluation = evaluateCatalogRegression(
    {
      ...healthyCounters(100),
      publicProductsScanned: 100,
      productsOk: 98,
      productsWithIssues: 1,
    },
    allRejectedOffers(),
  );
  assert.equal(evaluation.regression, true, "broken invariant must regress");
  assert.equal(evaluation.productCountInvariant, false);
}
console.log("PRODUCT_COUNT_INVARIANT_FAIL=PASS");

// ---- DATABASE_ERROR_SANITIZED -------------------------------------------
{
  const sanitized = sanitizeDbErrorMessage(
    'connect failed: postgresql://user:secret@host:5432/db and key "sb_publishable_abc123" url https://x.supabase.co',
  );
  assert.equal(sanitized.includes("secret"), false, "must not leak password");
  assert.equal(
    sanitized.includes("sb_publishable_abc123"),
    false,
    "must not leak key",
  );
  assert.equal(
    sanitized.includes("DATABASE_URL"),
    false,
    "must not mention env names",
  );
}
console.log("DATABASE_ERROR_SANITIZED=PASS");

// ---- COMPUTE_COUNTERS_HEALTHY -------------------------------------------
{
  const counters = computePresentationCounters(
    [
      {
        id: "p1",
        name: "Produto Limpo",
        description: null,
        brand: "Marca",
        specifications: { Marca: "Marca" },
      },
    ],
    2,
  );
  assert.equal(counters.publicProductsScanned, 1);
  assert.equal(counters.productsWithIssues, 0);
  assert.equal(counters.productsOk, 1);
  assert.equal(counters.nonPublicProductsSkipped, 2);
}
console.log("COMPUTE_COUNTERS_HEALTHY=PASS");

// ---- COMPUTE_COUNTERS_TITLE_ISSUE ---------------------------------------
{
  const counters = computePresentationCounters(
    [
      {
        id: "p1",
        name: "Produto  Com  Espaco",
        description: null,
        brand: "Marca",
        specifications: { Marca: "Marca" },
      },
    ],
    0,
  );
  assert.equal(counters.titleIssues, 1);
  assert.equal(counters.productsWithIssues, 1);
}
console.log("COMPUTE_COUNTERS_TITLE_ISSUE=PASS");

console.log("ALL_CATALOG_REGRESSION_MONITOR_TESTS=PASS");
