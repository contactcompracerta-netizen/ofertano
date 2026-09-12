import assert from "node:assert/strict";

import { type CatalogSearchProduct } from "./index";
import { compareCatalogShadowToPublic, runCatalogShadowSearch } from "./shadow";

function makeProduct(overrides: Partial<CatalogSearchProduct> = {}): CatalogSearchProduct {
  return {
    id: "prod-1",
    name: "Dell XPS 13 9310",
    canonicalName: "Dell XPS 13 9310",
    brand: "Dell",
    specifications: {},
    modelNumber: "9310",
    ean: null,
    gtin: null,
    mpn: null,
    color: "Prata",
    voltage: null,
    size: null,
    image: "https://img.example/dell.jpg",
    store: "Ofertano",
    price: 4999,
    oldPrice: null,
    discount: null,
    installments: null,
    rating: null,
    reviews: null,
    sales: null,
    stock: null,
    active: true,
    publicationStatus: "LIVE_COMPLETE",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    offers: [
      { marketplace: "MERCADO_LIVRE", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 4999 },
      { marketplace: "AMAZON", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 4799 },
    ],
    ...overrides,
  };
}

async function main(): Promise<void> {
  const previousFlag = process.env.CATALOG_SHADOW_SEARCH_ENABLED;
  const previousTimeout = process.env.CATALOG_SHADOW_TIMEOUT_MS;

  delete process.env.CATALOG_SHADOW_SEARCH_ENABLED;
  delete process.env.CATALOG_SHADOW_TIMEOUT_MS;

  const flagOff = await runCatalogShadowSearch("Dell XPS 13", {
    repository: async () => {
      throw new Error("shadow should not run when flag is off");
    },
  });

  assert.equal(flagOff.executed, false);
  assert.equal(flagOff.enabled, false);

  process.env.CATALOG_SHADOW_SEARCH_ENABLED = "true";
  process.env.CATALOG_SHADOW_TIMEOUT_MS = "50";

  const hit = await runCatalogShadowSearch("Dell XPS 13", {
    repository: async () => [makeProduct()],
  });

  assert.equal(hit.executed, true);
  assert.equal(hit.status, "HIT");
  assert.equal(hit.hitCount, 1);
  assert.equal(hit.comparableCount, 1);

  const miss = await runCatalogShadowSearch("No product should match", {
    repository: async () => [],
  });

  assert.equal(miss.status, "MISS");
  assert.equal(miss.hitCount, 0);

  const error = await runCatalogShadowSearch("query causing failure", {
    repository: async () => {
      throw new Error("database timeout");
    },
  });

  assert.equal(error.status, "ERROR");
  assert.match(String(error.error ?? ""), /database timeout|unknown catalog shadow error/i);

  const timeout = await runCatalogShadowSearch("slow query", {
    repository: async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return [makeProduct()];
    },
  });

  assert.equal(timeout.status, "ERROR");
  assert.match(String(timeout.error ?? ""), /TIMEOUT/i);

  const comparable = await runCatalogShadowSearch("Dell XPS 13 9310", {
    repository: async () => [
      makeProduct({
        id: "prod-comparable",
        offers: [
          { marketplace: "MERCADO_LIVRE", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 5200 },
          { marketplace: "AMAZON", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 5100 },
        ],
      }),
    ],
  });

  assert.equal(comparable.comparableCount, 1);
  assert.equal(comparable.singleCount, 0);

  const single = await runCatalogShadowSearch("Dell Inspiron 15", {
    repository: async () => [
      makeProduct({
        id: "prod-single",
        name: "Dell Inspiron 15",
        canonicalName: "Dell Inspiron 15",
        offers: [
          { marketplace: "MERCADO_LIVRE", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 3200 },
        ],
      }),
    ],
  });

  assert.equal(single.singleCount, 1);
  assert.equal(single.comparableCount, 0);

  const comparisonMatch = compareCatalogShadowToPublic(hit, {
    source: "DISCOVERY",
    products: [{ id: "prod-1", offers: [{ marketplace: "AMAZON" }] }],
  });

  assert.equal(comparisonMatch.status, "MATCH");

  const comparisonUnknown = compareCatalogShadowToPublic(miss, {
    source: "DISCOVERY",
    products: [{ id: "prod-2", offers: [{ marketplace: "MERCADO_LIVRE" }] }],
  });

  assert.equal(comparisonUnknown.status, "DIFFERENT");
  assert.equal(comparisonUnknown.topProductAgreement, "DIFFERENT");

  if (previousFlag === undefined) {
    delete process.env.CATALOG_SHADOW_SEARCH_ENABLED;
  } else {
    process.env.CATALOG_SHADOW_SEARCH_ENABLED = previousFlag;
  }

  if (previousTimeout === undefined) {
    delete process.env.CATALOG_SHADOW_TIMEOUT_MS;
  } else {
    process.env.CATALOG_SHADOW_TIMEOUT_MS = previousTimeout;
  }

  console.log("CATALOG_SHADOW_SEARCH=PASS");
}

void main();
