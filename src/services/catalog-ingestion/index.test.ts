import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSeedPlan,
  isCandidateEligible,
  runCatalogIngestionBatch,
  type CatalogIngestionCandidate,
  type CatalogIngestionSeed,
} from "./index";

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
  const adapter = async (query: string) => [{
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
