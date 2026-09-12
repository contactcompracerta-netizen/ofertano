import assert from "node:assert/strict";

import { searchCatalogLocal, type CatalogSearchProduct } from "./index";

function makeProduct(overrides: Partial<CatalogSearchProduct> = {}): CatalogSearchProduct {
  return {
    id: "prod-1",
    name: "Notebook Dell XPS 13 9310",
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
  const comparable = await searchCatalogLocal("Dell XPS 13 9310", {
    repository: async ({ query }) => {
      if (query === "dell xps 13 9310") {
        return [
          makeProduct({
            id: "prod-1",
            canonicalName: "Dell XPS 13 9310",
            name: "Notebook Dell XPS 13 9310",
          }),
          makeProduct({
            id: "prod-2",
            canonicalName: "Dell Inspiron 15 5510",
            name: "Dell Inspiron 15 5510",
            modelNumber: "5510",
            brand: "Dell",
            offers: [
              { marketplace: "MERCADO_LIVRE", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 3200 },
            ],
          }),
        ];
      }

      return [];
    },
  });

  assert.equal(comparable.source, "LOCAL_CATALOG");
  assert.equal(comparable.hits.length, 1, "should return only the relevant product");
  assert.equal(comparable.hits[0]?.kind, "COMPARABLE");
  assert.equal(comparable.hits[0]?.marketplaceCount, 2);
  assert.equal(comparable.total, 1);
  assert.ok(comparable.elapsedMs >= 0);

  const singleResult = await searchCatalogLocal("Dell Inspiron 15 5510", {
    repository: async () => [
      makeProduct({
        id: "prod-2",
        canonicalName: "Dell Inspiron 15 5510",
        name: "Dell Inspiron 15 5510",
        modelNumber: "5510",
        offers: [
          { marketplace: "MERCADO_LIVRE", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 3200 },
        ],
      }),
    ],
  });

  assert.equal(singleResult.hits[0]?.kind, "SINGLE_MARKETPLACE");
  assert.equal(singleResult.hits[0]?.marketplaceCount, 1);

  const brandMismatch = await searchCatalogLocal("Dell XPS 13 9310", {
    repository: async () => [
      makeProduct({
        id: "prod-3",
        canonicalName: "Lenovo ThinkPad X1",
        name: "Lenovo ThinkPad X1",
        brand: "Lenovo",
        modelNumber: "X1",
        offers: [
          { marketplace: "MERCADO_LIVRE", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 5200 },
          { marketplace: "AMAZON", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 5000 },
        ],
      }),
    ],
  });

  assert.equal(brandMismatch.hits.length, 0, "brand mismatch should be rejected");

  const voltageConflict = await searchCatalogLocal("Aspirador 220V", {
    repository: async () => [
      makeProduct({
        id: "prod-4",
        canonicalName: "Aspirador Turbo 110V",
        name: "Aspirador Turbo 110V",
        brand: "Turbo",
        voltage: "110V",
        offers: [
          { marketplace: "MERCADO_LIVRE", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 456 },
          { marketplace: "AMAZON", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 421 },
        ],
      }),
    ],
  });

  assert.equal(voltageConflict.hits.length, 0, "voltage conflict should be rejected");

  const inactiveProduct = await searchCatalogLocal("Dell XPS 13 9310", {
    repository: async () => [
      makeProduct({
        id: "prod-5",
        active: false,
      }),
    ],
  });

  assert.equal(inactiveProduct.hits.length, 0, "inactive products should never appear");

  const limited = await searchCatalogLocal("Notebook Dell", {
    repository: async () => Array.from({ length: 8 }, (_, index) =>
      makeProduct({
        id: `prod-${index}`,
        canonicalName: `Notebook Dell ${index}`,
        name: `Notebook Dell ${index}`,
        offers: [
          { marketplace: "MERCADO_LIVRE", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 1000 + index },
          { marketplace: "AMAZON", active: true, matchStatus: "EXACT", available: true, status: "ACTIVE", price: 900 + index },
        ],
      }),
    ),
    resultLimit: 3,
  });

  assert.equal(limited.hits.length, 3, "result limit should be enforced");

  const shortQuery = await searchCatalogLocal("a", {
    repository: async () => {
      throw new Error("should not query database for short queries");
    },
  });

  assert.deepEqual(shortQuery.hits, []);
  assert.equal(shortQuery.total, 0);

  console.log("CATALOG_SEARCH_LOCAL=PASS");
}

void main();
