import assert from "node:assert/strict";
import { test } from "node:test";

import { GET as catalogPopulate } from "./catalog-populate/route";
import { GET as importQueueRoute } from "./import-queue/route";

import prisma from "@/lib/prisma";
import { searchCatalogOrDiscover } from "@/services/search/searchCatalogOrDiscover";
import { saveProduct } from "@/services/database/saveProduct";
import { processPriceMonitor } from "@/services/priceMonitor/processPriceMonitor";
import type { DiscoveryAdapter } from "@/services/discovery/core/types";
import type { PersistProductFn } from "@/services/multistore-v2/persist";

const DB_URL = process.env.DATABASE_URL ?? "";
const DB_IS_LOCAL_CANARY =
  DB_URL.includes("127.0.0.1:55433") && DB_URL.includes("ofertano_canary");

function cronRequest(): Request {
  return new Request("http://localhost/api/cron/test", {
    headers: {
      authorization: "Bearer test-secret",
    },
  });
}

function foundCandidate(
  extras: {
    marketplace: string;
    marketplaceName: string;
    externalId: string;
    price?: number;
    title?: string;
  },
) {
  const title = extras.title ?? "Headphone MarcaX ZX100";
  return {
    marketplace: extras.marketplace,
    marketplaceName: extras.marketplaceName,
    externalId: extras.externalId,
    sourceUrl: `https://loja.example/${extras.externalId}`,
    affiliateLink: `https://aff.example/${extras.externalId}`,
    image: "https://loja.example/img.jpg",
    price: extras.price ?? 199,
    oldPrice: null,
    brand: "MarcaX",
    category: "Eletronicos",
    seller: null,
    attributes: {},
    title,
    status: "FOUND" as const,
    error: null,
  };
}

function fakeAdapter(
  marketplace: DiscoveryAdapter["marketplace"],
  marketplaceName: string,
  searcher: NonNullable<DiscoveryAdapter["searcher"]>,
): DiscoveryAdapter {
  return {
    marketplace,
    marketplaceName,
    enabled: true,
    searcher,
  };
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function counts() {
  const [product, offer, history, opportunity, queue] =
    await prisma.$transaction([
      prisma.product.count(),
      prisma.marketplaceOffer.count(),
      prisma.priceHistory.count(),
      prisma.productOpportunity.count(),
      prisma.importQueue.count(),
    ]);
  return { product, offer, history, opportunity, queue };
}

function assertAllFlagsAbsent() {
  delete process.env.CATALOG_POPULATE_ENABLED;
  delete process.env.IMPORT_QUEUE_PROCESS_ENABLED;
  delete process.env.PUBLIC_SEARCH_PERSISTENCE_ENABLED;
}

const multiStoreAdapters: DiscoveryAdapter[] = [
  fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
    marketplace: "MERCADO_LIVRE" as const,
    query: "Headphone MarcaX ZX100",
    success: true,
    scanned: 1,
    candidates: [foundCandidate({ marketplace: "MERCADO_LIVRE", marketplaceName: "Mercado Livre", externalId: "ml-ax-1" })],
    error: null,
  })),
  fakeAdapter("AMAZON", "Amazon", async () => ({
    marketplace: "AMAZON" as const,
    query: "Headphone MarcaX ZX100",
    success: true,
    scanned: 1,
    candidates: [foundCandidate({ marketplace: "AMAZON", marketplaceName: "Amazon", externalId: "amz-ax-1" })],
    error: null,
  })),
  fakeAdapter("SHOPEE", "Shopee", async () => ({
    marketplace: "SHOPEE" as const,
    query: "Headphone MarcaX ZX100",
    success: true,
    scanned: 2,
    candidates: [],
    error: null,
  })),
  fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => ({
    marketplace: "MAGAZINE_LUIZA" as const,
    query: "Headphone MarcaX ZX100",
    success: true,
    scanned: 2,
    candidates: [],
    error: null,
  })),
  fakeAdapter("ALIEXPRESS", "AliExpress", async () => ({
    marketplace: "ALIEXPRESS" as const,
    query: "Headphone MarcaX ZX100",
    success: true,
    scanned: 2,
    candidates: [],
    error: null,
  })),
];

const previousSecret = process.env.CRON_SECRET;
process.env.CRON_SECRET = "test-secret";

test.after(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

// ─────────────────────────────────────────────────────────────────────────────
// FASE 15 — catalog-populate OFF: no DB writes
// ─────────────────────────────────────────────────────────────────────────────
test(
  "FASE 15: catalog-populate OFF → skipped, zero DB deltas",
  { skip: DB_IS_LOCAL_CANARY ? undefined : "Requires local canary DB (127.0.0.1:55433)" },
  async () => {
    assertAllFlagsAbsent();
    const before = await counts();
    const response = await catalogPopulate(cronRequest());
    assert.equal(response.status, 200);
    const body = await json(response);
    assert.equal(body.success, true);
    assert.equal(body.skipped, true);
    assert.equal(body.automated, true);
    assert.equal(body.reason, "CATALOG_POPULATE_ENABLED is not explicitly true.");
    assertAllFlagsAbsent();
    const after = await counts();
    assert.equal(after.opportunity - before.opportunity, 0, "ProductOpportunity Δ = 0");
    assert.equal(after.queue - before.queue, 0, "ImportQueue Δ = 0");
    assert.equal(after.product - before.product, 0, "Product Δ = 0");
    assert.equal(after.offer - before.offer, 0, "MarketplaceOffer Δ = 0");
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// FASE 16 — import-queue OFF: queue preserved, zero DB writes
// ─────────────────────────────────────────────────────────────────────────────
test(
  "FASE 16: import-queue OFF → skipped, queue preserved, zero DB deltas",
  { skip: DB_IS_LOCAL_CANARY ? undefined : "Requires local canary DB (127.0.0.1:55433)" },
  async () => {
    assertAllFlagsAbsent();

    const fixture = await prisma.importQueue.create({
      data: {
        url: `https://produto.mercadolivre.com.br/MLB-INTEGRATION-TEST-${Date.now()}`,
        marketplace: "MERCADO_LIVRE",
        status: "PENDING",
        attempts: 0,
      },
    });

    const before = await counts();

    try {
      const response = await importQueueRoute(cronRequest());
      assert.equal(response.status, 200);
      const body = await json(response);
      assert.equal(body.success, true);
      assert.equal(body.skipped, true);
      assert.equal(body.automated, true);
      assert.equal(body.reason, "IMPORT_QUEUE_PROCESS_ENABLED is not explicitly true.");

      assertAllFlagsAbsent();

      const fixtureAfter = await prisma.importQueue.findUniqueOrThrow({ where: { id: fixture.id } });
      assert.equal(fixtureAfter.status, "PENDING", "queue row stays PENDING");
      assert.equal(fixtureAfter.attempts, 0, "attempts stays 0");

      const after = await counts();
      assert.equal(after.product - before.product, 0, "Product Δ = 0");
      assert.equal(after.offer - before.offer, 0, "MarketplaceOffer Δ = 0");
      assert.equal(after.history - before.history, 0, "PriceHistory Δ = 0");
    } finally {
      await prisma.importQueue.delete({ where: { id: fixture.id } });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// FASE 17 — public search OFF: results returned, persistence NOT triggered
// ─────────────────────────────────────────────────────────────────────────────
test(
  "FASE 17: public search OFF → results unaffected, persistence skipped",
  { skip: DB_IS_LOCAL_CANARY ? undefined : "Requires local canary DB (127.0.0.1:55433)" },
  async () => {
    assertAllFlagsAbsent();

    const before = await counts();

    let persistCallCount = 0;
    const spy: PersistProductFn = async () => {
      persistCallCount += 1;
      return { id: "local-fake-id" };
    };

    const result = await searchCatalogOrDiscover("Headphone MarcaX ZX100", 5, {
      adapters: multiStoreAdapters,
      persistProduct: spy,
    });

    assert.equal(result.source, "DISCOVERY", "returns DISCOVERY results");
    assert.ok(result.products.length >= 1, "search results unaffected");

    assert.equal(persistCallCount, 0, "persistProduct NOT called when flag OFF");

    const after = await counts();
    assert.equal(after.product - before.product, 0, "Product Δ = 0");
    assert.equal(after.offer - before.offer, 0, "MarketplaceOffer Δ = 0");
    assert.equal(after.history - before.history, 0, "PriceHistory Δ = 0");
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// FASE 18 — flags ON: persistence path executes (LOCAL only)
// ─────────────────────────────────────────────────────────────────────────────
test(
  "FASE 18: public search ON → persistence path executed via spy",
  { skip: DB_IS_LOCAL_CANARY ? undefined : "Requires local canary DB (127.0.0.1:55433)" },
  async () => {
    process.env.PUBLIC_SEARCH_PERSISTENCE_ENABLED = "true";
    assertAllFlagsAbsent();
    process.env.PUBLIC_SEARCH_PERSISTENCE_ENABLED = "true";

    const before = await counts();

    let persistCallCount = 0;
    const spy: PersistProductFn = async () => {
      persistCallCount += 1;
      return { id: `local-${persistCallCount}` };
    };

    const result = await searchCatalogOrDiscover("Headphone MarcaX ZX100", 5, {
      adapters: multiStoreAdapters,
      persistProduct: spy,
    });

    assert.equal(result.source, "DISCOVERY", "returns DISCOVERY results");
    assert.ok(result.products.length >= 1, "search results present when ON");
    assert.ok(persistCallCount >= 1, "persistProduct IS called when flag ON");

    const after = await counts();
    assert.equal(after.product - before.product, 0, "no real DB writes (spy is in-memory)");
    assert.equal(after.offer - before.offer, 0, "MarketplaceOffer Δ = 0");

    delete process.env.PUBLIC_SEARCH_PERSISTENCE_ENABLED;
  },
);

test(
  "FASE 18: import-queue ON → consumer executes, hermetic fast-fail",
  { skip: DB_IS_LOCAL_CANARY ? undefined : "Requires local canary DB (127.0.0.1:55433)" },
  async () => {
    assertAllFlagsAbsent();
    process.env.IMPORT_QUEUE_PROCESS_ENABLED = "true";

    const fixtureUrl = `https://produto.mercadolivre.com.br/MLB-INTEGRATION-ON-${Date.now()}`;
    const fixture = await prisma.importQueue.create({
      data: {
        url: fixtureUrl,
        marketplace: "MERCADO_LIVRE",
        status: "PENDING",
        attempts: 0,
      },
    });

    const before = await counts();

    try {
      const response = await importQueueRoute(cronRequest());
      assert.equal(response.status, 200);
      const body = await json(response);
      assert.equal(body.success, true);
      assert.equal(body.processed, 1, "consumer processed 1 item");

      const fixtureAfter = await prisma.importQueue.findUniqueOrThrow({ where: { id: fixture.id } });
      assert.ok(fixtureAfter.status !== "PENDING", "queue item transitioned away from PENDING");
      assert.ok(fixtureAfter.attempts >= 1, "attempts incremented");

      const after = await counts();
      assert.equal(after.product - before.product, 0, "no new Product (hermetic fast-fail)");
    } finally {
      await prisma.importQueue.delete({ where: { id: fixture.id } });
      delete process.env.IMPORT_QUEUE_PROCESS_ENABLED;
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// FASE 19 — manual import unaffected by flags
// ─────────────────────────────────────────────────────────────────────────────
test(
  "FASE 19: manual import saveProduct creates Product when flags OFF",
  { skip: DB_IS_LOCAL_CANARY ? undefined : "Requires local canary DB (127.0.0.1:55433)" },
  async () => {
    assertAllFlagsAbsent();
    const before = await counts();
    const externalId = `MLB-INT-MANUAL-${Date.now()}`;
    const result = await saveProduct(
      {
        marketplace: "Mercado Livre",
        externalId,
        url: `https://produto.mercadolivre.com.br/${externalId}`,
        title: "Produto Manual Int Test",
        description: null,
        brand: "MarcaManual",
        category: "Teste",
        image: "https://loja.example/manual.jpg",
        images: [],
        price: 299.99,
        oldPrice: null,
        discount: null,
        installments: null,
        rating: null,
        reviews: null,
        sales: null,
        stock: null,
        seller: null,
        attributes: {},
      },
      null,
      { discoverySource: "MANUAL" },
    );

    assert.ok(result.id, "Product created with valid id");
    assert.equal(result.name, "Produto Manual Int Test");

    const after = await counts();
    assert.equal(after.product - before.product, 1, "MANUAL_IMPORT_STILL_WORKS: Product +1");
    assert.equal(after.offer - before.offer, 1, "MarketplaceOffer +1");

    await prisma.product.delete({ where: { id: result.id } });

    const restored = await counts();
    assert.equal(restored.product, before.product, "Product restored after cleanup");
    assert.equal(restored.offer, before.offer, "MarketplaceOffer restored after cleanup");
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// FASE 20 — price monitor: cannot create Product from zero
// ─────────────────────────────────────────────────────────────────────────────
test(
  "FASE 20: processPriceMonitor zero-product → Product unchanged",
  { skip: DB_IS_LOCAL_CANARY ? undefined : "Requires local canary DB (127.0.0.1:55433)" },
  async () => {
    assertAllFlagsAbsent();
    const before = await counts();

    const result = await processPriceMonitor(1);

    assert.equal(result.success, true);
    assert.equal(result.selected, 0, "no eligible offers → selected 0");

    const after = await counts();
    assert.equal(after.product - before.product, 0, "Product unchanged");
    assert.equal(after.offer - before.offer, 0, "MarketplaceOffer unchanged");
  },
);

test(
  "FASE 20: processPriceMonitor operates on existing offer without creating new Product",
  { skip: DB_IS_LOCAL_CANARY ? undefined : "Requires local canary DB (127.0.0.1:55433)" },
  async () => {
    assertAllFlagsAbsent();

    const manualProduct = await saveProduct(
      {
        marketplace: "Mercado Livre",
        externalId: `MLB-INT-MON-${Date.now()}`,
        url: "https://produto.mercadolivre.com.br/MLB-INT-MON",
        title: "Produto Monitor Int Test",
        description: null,
        brand: "MarcaMonitor",
        category: "Teste",
        image: "https://loja.example/monitor.jpg",
        images: [],
        price: 100,
        oldPrice: null,
        discount: null,
        installments: null,
        rating: null,
        reviews: null,
        sales: null,
        stock: null,
        seller: null,
        attributes: {},
      },
      null,
      { discoverySource: "MANUAL" },
    );

    const before = await counts();

    try {
      const result = await processPriceMonitor(1);
      assert.equal(result.success, true);
      assert.ok(result.selected >= 0, "selected computed");

      const after = await counts();
      assert.equal(after.product - before.product, 0, "no new Product (operates over existing only)");
    } finally {
      await prisma.product.delete({ where: { id: manualProduct.id } });
    }
  },
);
