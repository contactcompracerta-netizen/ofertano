import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSeedPlan,
  isCandidateEligible,
  runCatalogIngestionBatch,
  type CatalogIngestionCandidate,
  type CatalogIngestionSeed,
} from "./index";
import type { NormalizedMarketplaceListing } from "../catalog-listings";

test("buildSeedPlan collects miss and single-marketplace sources", () => {
  const seeds: CatalogIngestionSeed[] = [
    { source: "searchRequest", query: "lavadora", normalizedQuery: "lavadora" },
    { source: "singleMarketplace", productId: "p-1", query: "notebook dell" },
    { source: "singleMarketplace", productId: "p-2", query: "monitor samsung" },
  ];

  const plan = buildSeedPlan(seeds, { seedLimit: 2 });

  assert.equal(plan.length, 2);
  assert.equal(plan[0].query, "lavadora");
  assert.equal(plan[1].productId, "p-1");
});

test("eligible candidate keeps brand and attributes coherent", () => {
  const candidate: CatalogIngestionCandidate = {
    marketplace: "AMAZON",
    marketplaceName: "Amazon",
    externalId: "B07L2XYZ1P",
    sourceUrl: "https://www.amazon.com/dp/B07L2XYZ1P",
    title: "Samsung Galaxy S21 5G 128GB",
    image: "https://example.com/s21.jpg",
    price: 2999,
    oldPrice: 3299,
    affiliateLink: "https://affiliate.example/s21",
    brand: "Samsung",
    category: "Celulares",
    attributes: { MODEL: "S21", COLOR: "Phantom Gray" },
    status: "FOUND",
  };

  assert.equal(isCandidateEligible(candidate, "samsung galaxy s21"), true);
});

test("cross-brand candidate is rejected by guard", () => {
  const candidate: CatalogIngestionCandidate = {
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "ML-123",
    sourceUrl: "https://lista.mercadolivre.com.br/monitor",
    title: "Monitor Gamer Acer",
    image: "https://example.com/acer.jpg",
    price: 999,
    oldPrice: null,
    affiliateLink: null,
    brand: "Acer",
    category: "Eletrônicos",
    attributes: { MODEL: "Predator" },
    status: "FOUND",
  };

  assert.equal(isCandidateEligible(candidate, "samsung galaxy s21"), false);
});

test("dry run produces metrics without writes", async () => {
  const adapter = async (query: string): Promise<CatalogIngestionCandidate[]> => [{
    marketplace: "AMAZON",
    marketplaceName: "Amazon",
    externalId: `amazon-${query}`,
    sourceUrl: `https://example.com/${query}`,
    title: `${query} premium`,
    image: "https://example.com/image.jpg",
    price: 123,
    oldPrice: null,
    affiliateLink: null,
    brand: "BrandX",
    category: "Eletrônicos",
    attributes: { MODEL: "X1" },
    status: "FOUND",
  }];

  const result = await runCatalogIngestionBatch({
    seeds: [{ source: "searchRequest", query: "brandx x1", normalizedQuery: "brandx x1" }],
    adapters: [{ key: "amazon", searcher: adapter }],
    dryRun: true,
    batchLimit: 8,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.candidatesFound, 1);
  assert.equal(result.offersCreated, 0);
  assert.equal(result.productsUpdated, 0);
});

test("dual-write disabled does not call the injected repository", async () => {
  const adapter = async () => [{
    marketplace: "AMAZON" as const,
    marketplaceName: "Amazon",
    externalId: "CANARY-OFF-1",
    sourceUrl: "https://example.com/off",
    title: "BrandX X1 premium",
    image: null,
    price: 123,
    oldPrice: null,
    affiliateLink: null,
    brand: "BrandX",
    category: "Eletrônicos",
    attributes: null,
    status: "FOUND" as const,
  }];
  const repository = {
    findListingByMarketplaceExternalId: async () => {
      throw new Error("repository must not be called");
    },
    upsertRawMarketplaceListing: async () => {
      throw new Error("repository must not be called");
    },
    linkListingToProduct: async () => {
      throw new Error("repository must not be called");
    },
  };

  const result = await runCatalogIngestionBatch({
    seeds: [{ source: "searchRequest", query: "brandx x1" }],
    adapters: [{ key: "amazon", searcher: adapter }],
    dryRun: false,
    rawListingEnabled: false,
    rawListingRepository: repository,
  });

  assert.equal(result.candidatesFound, 1);
  assert.equal(result.rawListingCreated, 0);
  assert.equal(result.rawListingDisabled, 1);
});

test("enabled gated ingestion reaches the injected official repository", async () => {
  const calls: string[] = [];
  const adapter = async () => [{
    marketplace: "AMAZON" as const,
    marketplaceName: "Amazon",
    externalId: "CANARY-ON-1",
    sourceUrl: "https://example.com/on",
    title: "BrandX X1 premium",
    image: null,
    price: 123,
    oldPrice: null,
    affiliateLink: null,
    brand: "BrandX",
    category: "Eletrônicos",
    attributes: null,
    status: "FOUND" as const,
  }];
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async (listing: NormalizedMarketplaceListing) => {
      calls.push(`${listing.marketplace}:${listing.externalId}`);
      return listing;
    },
    linkListingToProduct: async () => undefined,
  };

  const previousEnv = {
    marketplaces: process.env.RAW_LISTING_CANARY_MARKETPLACES,
    externalIds: process.env.RAW_LISTING_CANARY_EXTERNAL_IDS,
    maxWrites: process.env.RAW_LISTING_CANARY_MAX_WRITES,
  };
  process.env.RAW_LISTING_CANARY_MARKETPLACES = "AMAZON";
  process.env.RAW_LISTING_CANARY_EXTERNAL_IDS = "CANARY-ON-1";
  process.env.RAW_LISTING_CANARY_MAX_WRITES = "1";

  try {
    const result = await runCatalogIngestionBatch({
      seeds: [{ source: "searchRequest", query: "brandx x1" }],
      adapters: [{ key: "amazon", searcher: adapter }],
      dryRun: false,
      rawListingEnabled: true,
      rawListingRepository: repository,
    });

    assert.deepEqual(calls, ["AMAZON:CANARY-ON-1"]);
    assert.equal(result.rawListingCreated, 1);
  } finally {
    if (previousEnv.marketplaces === undefined) delete process.env.RAW_LISTING_CANARY_MARKETPLACES;
    else process.env.RAW_LISTING_CANARY_MARKETPLACES = previousEnv.marketplaces;
    if (previousEnv.externalIds === undefined) delete process.env.RAW_LISTING_CANARY_EXTERNAL_IDS;
    else process.env.RAW_LISTING_CANARY_EXTERNAL_IDS = previousEnv.externalIds;
    if (previousEnv.maxWrites === undefined) delete process.env.RAW_LISTING_CANARY_MAX_WRITES;
    else process.env.RAW_LISTING_CANARY_MAX_WRITES = previousEnv.maxWrites;
  }
});

test("adapter timeout is counted without aborting other seeds", async () => {
  const result = await runCatalogIngestionBatch({
    seeds: [
      { source: "searchRequest", query: "aspirador", normalizedQuery: "aspirador" },
      { source: "searchRequest", query: "notebook", normalizedQuery: "notebook" },
    ],
    adapters: [
      {
        key: "amazon",
        searcher: async () => {
          throw new Error("timeout");
        },
      },
      {
        key: "mercadolivre",
        searcher: async () => [{
          marketplace: "MERCADO_LIVRE",
          marketplaceName: "Mercado Livre",
          externalId: "ML-01",
          sourceUrl: "https://example.com/ml",
          title: "Notebook gamer",
          image: "https://example.com/ml.jpg",
          price: 2499,
          oldPrice: null,
          affiliateLink: null,
          brand: "Dell",
          category: "Computadores",
          attributes: { MODEL: "G5" },
          status: "FOUND",
        }],
      },
    ],
    dryRun: true,
    batchLimit: 10,
  });

  assert.equal(result.marketplaceErrors.length >= 1, true);
  assert.equal(result.candidatesFound >= 1, true);
});

test("batch limit caps the amount of seeds processed", async () => {
  const result = await runCatalogIngestionBatch({
    seeds: Array.from({ length: 20 }, (_, index) => ({
      source: "searchRequest",
      query: `seed-${index}`,
      normalizedQuery: `seed-${index}`,
    })),
    adapters: [{
      key: "amazon",
      searcher: async () => [],
    }],
    dryRun: true,
    batchLimit: 5,
  });

  assert.equal(result.seedsProcessed, 5);
});
