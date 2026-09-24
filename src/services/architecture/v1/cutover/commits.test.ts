/**
 * CATALOG_ARCHITECTURE_V1 — REAL AUTHORITATIVE COMMITS TESTS (FASE D/R).
 *
 * - buildProductImportFromV1Context: conversão marketplace-agnostic
 *   (nunca hardcode nomes; url/preço obrigatórios preservados).
 * - commitV1FastOffer: fast path sem heavy matching; PriceHistory (FASE R):
 *     preço igual => nenhuma entrada; mudança real => 1 entrada;
 *     sem oferta existente => falha fail-closed (INVALID_DATA).
 * - commitV1Structural/legacyWrite delegam ao saveProduct canônico
 *   (aqui validamos o contrato do commit com um prisma fake).
 */
import assert from "node:assert/strict";
import {
  buildProductImportFromV1Context,
  createRealAuthoritativeCommits,
  type RealAuthoritativeCommits,
} from "./commits";
import type { V1WriteContext } from "./writer";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";

function listing(
  marketplaceId: string,
  overrides: Partial<NormalizedMarketplaceListingV1> = {},
): NormalizedMarketplaceListingV1 {
  return {
    contractVersion: "normalized-listing/v1",
    source: "test",
    marketplaceId,
    externalListingId: "EXT-1",
    seller: { externalSellerId: null, name: "Loja Teste" },
    identity: { gtin: [], mpn: null, manufacturerModel: null, brand: "Marca", model: null },
    catalog: {
      title: "Produto Teste",
      description: null,
      category: "Eletrônicos",
      images: ["https://img.test/1.jpg"],
      attributes: {},
      primaryImageUrl: "https://img.test/1.jpg",
    },
    variant: {
      color: null,
      storage: null,
      memory: null,
      voltage: null,
      size: null,
      otherAttributes: {},
    },
    commerce: {
      price: 100,
      oldPrice: null,
      pixPrice: null,
      installments: null,
      stock: 5,
      availability: "IN_STOCK",
      shippingHint: null,
      promotion: null,
    },
    metadata: {
      sourceUpdatedAt: null,
      collectedAt: "2026-09-24T00:00:00.000Z",
      rawHash: "",
      payloadVersion: "v1",
    },
    ...overrides,
  };
}

function ctxFor(
  listingV1: NormalizedMarketplaceListingV1,
  sourceUrl: string,
): V1WriteContext {
  return {
    marketplaceId: listingV1.marketplaceId,
    externalListingId: listingV1.externalListingId,
    listing: listingV1,
    hashes: {
      catalogHash: "c",
      offerHash: "o",
      rawHash: "r",
    },
    row: {
      marketplace: "MERCADO_LIVRE",
      externalId: listingV1.externalListingId,
      sourceUrl,
      title: listingV1.catalog.title ?? null,
    },
  };
}

/** Prisma fake mínimo para o fast offer path. */
function fakePrisma(seed: {
  existingOffer: {
    id: string;
    productId: string;
    price: number;
    oldPrice: number | null;
    priceHistory: { price: number }[];
  } | null;
}) {
  const state = {
    offer: seed.existingOffer,
    priceHistoryCreated: 0,
    lastUpdated: null as null | { price: number; oldPrice: number | null },
  };
  return {
    marketplaceOffer: {
      async findUnique() {
        return state.offer;
      },
      async update({ data }: { data: Record<string, unknown> }) {
        state.lastUpdated = {
          price: data.price as number,
          oldPrice: data.oldPrice as number | null,
        };
        return { ...state.offer!, ...data };
      },
    },
    priceHistory: {
      async create() {
        state.priceHistoryCreated += 1;
        return { id: "ph-1" };
      },
    },
    state,
  };
}

async function main(): Promise<void> {
  // --- buildProductImportFromV1Context: marketplace-agnostic --------------------------------
  {
    const l = listing("mercado_livre");
    const ctx = ctxFor(l, "https://produto.mercadolivre.com.br/EXT-1");
    const product = buildProductImportFromV1Context(ctx);
    assert.equal(product.marketplace, "Mercado Livre", "display name sem identidade");
    assert.equal(product.externalId, "EXT-1");
    assert.equal(product.url, "https://produto.mercadolivre.com.br/EXT-1");
    assert.equal(product.price, 100);
    assert.equal(product.title, "Produto Teste");
    assert.equal(product.image, "https://img.test/1.jpg");
    assert.deepEqual(product.images, ["https://img.test/1.jpg"]);
  }

  // --- Fast offer: preço igual => SEM PriceHistory (FASE R) ------------------------------------
  {
    const prisma = fakePrisma({
      existingOffer: {
        id: "offer-1",
        productId: "prod-1",
        price: 100,
        oldPrice: null,
        priceHistory: [{ price: 100 }],
      },
    });
    const commits = createRealAuthoritativeCommits(prisma as never);
    const l = listing("mercado_livre");
    const result = await commits.commitV1FastOffer(ctxFor(l, "https://x/EXT-1"));
    assert.equal(result.productId, "prod-1");
    assert.equal(prisma.state.priceHistoryCreated, 0, "preço igual => sem entrada nova");
    assert.ok(prisma.state.lastUpdated, "offer atualizado (stock/availability)");
  }

  // --- Fast offer: mudança real => 1 PriceHistory (FASE R) ---------------------------------------
  {
    const prisma = fakePrisma({
      existingOffer: {
        id: "offer-1",
        productId: "prod-1",
        price: 100,
        oldPrice: null,
        priceHistory: [{ price: 100 }],
      },
    });
    const commits = createRealAuthoritativeCommits(prisma as never);
    const l = listing("mercado_livre", {
      commerce: {
        price: 90,
        oldPrice: 100,
        pixPrice: null,
        installments: null,
        stock: 5,
        availability: "IN_STOCK",
        shippingHint: null,
        promotion: null,
      },
    });
    const result = await commits.commitV1FastOffer(ctxFor(l, "https://x/EXT-1"));
    assert.equal(result.productId, "prod-1");
    assert.equal(prisma.state.priceHistoryCreated, 1, "mudança real => 1 entrada");
  }

  // --- Fast offer: fast path exige oferta existente (fail-closed) --------------------------------
  {
    const prisma = fakePrisma({ existingOffer: null });
    const commits = createRealAuthoritativeCommits(prisma as never);
    const l = listing("mercado_livre");
    await assert.rejects(
      commits.commitV1FastOffer(ctxFor(l, "https://x/EXT-1")),
      /INVALID_DATA:fast-offer-sem-oferta-existente/,
      "sem oferta => estrutura mudou => fail-closed",
    );
  }

  // --- Marketplace via legada inválida => fail-closed MULTISTORE_NOT_READY ---------------------------
  {
    const prisma = fakePrisma({
      existingOffer: {
        id: "offer-1",
        productId: "prod-1",
        price: 100,
        oldPrice: null,
        priceHistory: [],
      },
    });
    const commits = createRealAuthoritativeCommits(prisma as never);
    const l = listing("market_unknown");
    await assert.rejects(
      commits.commitV1FastOffer(ctxFor(l, "https://x/EXT-1")),
      /MULTISTORE_NOT_READY|fast-offer|INVALID_DATA/,
    );
  }

  // --- Contrato dos commits reais (structural/legacy delegam ao saveProduct canônico) ----------------
  {
    const prisma = fakePrisma({ existingOffer: null });
    const commits: RealAuthoritativeCommits =
      createRealAuthoritativeCommits(prisma as never);
    assert.equal(typeof commits.commitV1Structural, "function");
    assert.equal(typeof commits.commitV1FastOffer, "function");
    assert.equal(typeof commits.legacyWrite, "function");
  }

  console.log("cutover/commits.test.ts PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});