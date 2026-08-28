import assert from "node:assert/strict";

import type { DiscoveryAdapter, DiscoveryCandidate } from "../discovery/core/types";
import { persistCanonicalProducts, persistSelectedSearchClusters, scheduleSelectedClusterPersist, isClusterPublishable } from "./persist";
import { coverageStatusOf, searchMultistoreV2 } from "./search";
import { searchCatalogOrDiscover } from "../search/searchCatalogOrDiscover";
import type { CanonicalProduct, MarketplaceAcquisition, MarketplaceCode } from "./types";

function canonicalProduct(
  title: string,
  extras: Partial<CanonicalProduct> = {},
): CanonicalProduct {
  const clusterId = extras.clusterId ?? title.replace(/\s+/g, "-").slice(0, 24);
  return {
    clusterId,
    title,
    image: extras.image ?? "https://loja.example/img.jpg",
    description: extras.description ?? null,
    brand: extras.brand ?? "MarcaX",
    price: extras.price ?? 100,
    oldPrice: extras.oldPrice ?? null,
    primaryMarketplace: extras.primaryMarketplace ?? "Amazon",
    marketplaces: extras.marketplaces ?? ["AMAZON"],
    confidence: extras.confidence ?? 1,
    rankTier: extras.rankTier ?? 0,
    coverageStatus: extras.coverageStatus ?? "COMPLETE",
    publishable: extras.publishable,
    offers: extras.offers ?? [
      {
        marketplace: "AMAZON",
        marketplaceName: "Amazon",
        externalId: clusterId,
        title,
        url: `https://loja.example/${clusterId}`,
        image: "https://loja.example/img.jpg",
        price: extras.price ?? 100,
        oldPrice: null,
        brand: extras.brand ?? "MarcaX",
        affiliateLink: `https://aff.example/${clusterId}`,
        attributes: {},
        seller: null,
      },
    ],
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

function foundCandidate(
  extras: Partial<DiscoveryCandidate> &
    Pick<DiscoveryCandidate, "marketplace" | "externalId" | "title">,
): DiscoveryCandidate {
  return {
    marketplace: extras.marketplace ?? "AMAZON",
    marketplaceName: extras.marketplaceName ?? extras.marketplace,
    sourceUrl: extras.sourceUrl ?? `https://loja.example/${extras.externalId}`,
    affiliateLink: extras.affiliateLink ?? `https://aff.example/${extras.externalId}`,
    image: extras.image ?? "https://loja.example/img.jpg",
    price: extras.price ?? 199,
    oldPrice: extras.oldPrice ?? null,
    brand: extras.brand ?? "MarcaX",
    category: extras.category ?? null,
    seller: extras.seller ?? null,
    attributes: extras.attributes ?? {},
    status: "FOUND",
    error: null,
    ...extras,
  };
}

function emptySearch(
  marketplace: DiscoveryAdapter["marketplace"],
  query: string,
) {
  return {
    marketplace,
    query,
    success: true,
    scanned: 2,
    candidates: [],
    error: null,
  };
}

function blockedSearch(
  marketplace: DiscoveryAdapter["marketplace"],
  query: string,
) {
  return {
    marketplace,
    query,
    success: false,
    scanned: 0,
    candidates: [],
    error: `${marketplace} bloqueou a busca HTML.`,
  };
}

function notRunSearch(
  marketplace: DiscoveryAdapter["marketplace"],
  query: string,
) {
  return {
    marketplace,
    query,
    success: false,
    scanned: 0,
    candidates: [],
    error: null,
    searchOutcome: "NOT_RUN" as const,
  };
}

function acquisition(
  marketplace: MarketplaceCode,
  status: MarketplaceAcquisition["status"],
): MarketplaceAcquisition {
  return {
    marketplace,
    marketplaceName: marketplace,
    status,
    raw: 0,
    usable: status === "SUCCESS" ? 1 : 0,
    error: null,
    elapsedMs: 1,
    candidates: [],
  };
}

async function runCoveragePublicationCases() {
  const completeOne = canonicalProduct("Headphone MarcaX ZX100", {
    coverageStatus: "COMPLETE",
    rankTier: 1,
  });
  const incompleteOne = canonicalProduct("Headphone MarcaX ZX100", {
    clusterId: "inc-1",
    coverageStatus: "INCOMPLETE",
    rankTier: 1,
  });
  const blockedOne = canonicalProduct("Headphone MarcaX ZX100", {
    clusterId: "blk-1",
    coverageStatus: "INCOMPLETE",
    rankTier: 1,
  });
  const errorOne = canonicalProduct("Headphone MarcaX ZX100", {
    clusterId: "err-1",
    coverageStatus: "INCOMPLETE",
    rankTier: 1,
  });
  const twoIncomplete = canonicalProduct("Headphone MarcaX ZX100", {
    clusterId: "two-inc",
    coverageStatus: "INCOMPLETE",
    rankTier: 1,
    marketplaces: ["AMAZON", "MERCADO_LIVRE"],
    offers: [
      completeOne.offers[0]!,
      {
        marketplace: "MERCADO_LIVRE",
        marketplaceName: "Mercado Livre",
        externalId: "ml-zx100",
        title: "Headphone MarcaX ZX100",
        url: "https://loja.example/ml-zx100",
        image: "https://loja.example/img.jpg",
        price: 99,
        oldPrice: null,
        brand: "MarcaX",
        affiliateLink: "https://aff.example/ml-zx100",
        attributes: {},
        seller: null,
      },
    ],
  });
  const twoComplete = canonicalProduct("Headphone MarcaX ZX100", {
    clusterId: "two-ok",
    coverageStatus: "COMPLETE",
    rankTier: 1,
    marketplaces: ["AMAZON", "MERCADO_LIVRE"],
    offers: [
      completeOne.offers[0]!,
      {
        marketplace: "MERCADO_LIVRE",
        marketplaceName: "Mercado Livre",
        externalId: "ml-zx100-ok",
        title: "Headphone MarcaX ZX100",
        url: "https://loja.example/ml-zx100-ok",
        image: "https://loja.example/img.jpg",
        price: 99,
        oldPrice: null,
        brand: "MarcaX",
        affiliateLink: "https://aff.example/ml-zx100-ok",
        attributes: {},
        seller: null,
      },
    ],
  });
  const zeroComplete = canonicalProduct("Headphone MarcaX ZX100", {
    clusterId: "zero-empty",
    coverageStatus: "COMPLETE",
    rankTier: 1,
    offers: [],
  });
  const tier3Complete = canonicalProduct("Terno De Reis", {
    clusterId: "terno-reis",
    coverageStatus: "COMPLETE",
    rankTier: 3,
  });

  assert.equal(
    coverageStatusOf([
      acquisition("MERCADO_LIVRE", "SUCCESS"),
      acquisition("AMAZON", "EMPTY"),
      acquisition("SHOPEE", "EMPTY"),
      acquisition("MAGAZINE_LUIZA", "EMPTY"),
      acquisition("ALIEXPRESS", "EMPTY"),
    ]),
    "COMPLETE",
    "1 FOUND + 4 EMPTY => COMPLETE",
  );
  assert.equal(
    coverageStatusOf([
      acquisition("MERCADO_LIVRE", "SUCCESS"),
      acquisition("AMAZON", "SUCCESS"),
      acquisition("SHOPEE", "EMPTY"),
      acquisition("MAGAZINE_LUIZA", "EMPTY"),
      acquisition("ALIEXPRESS", "EMPTY"),
    ]),
    "COMPLETE",
    "2 FOUND + 3 EMPTY => COMPLETE",
  );
  assert.equal(
    coverageStatusOf([
      acquisition("MERCADO_LIVRE", "SUCCESS"),
      acquisition("AMAZON", "SUCCESS"),
      acquisition("SHOPEE", "TIMEOUT"),
    ]),
    "INCOMPLETE",
    "2 FOUND + TIMEOUT => INCOMPLETE",
  );
  assert.equal(
    coverageStatusOf([
      acquisition("MERCADO_LIVRE", "SUCCESS"),
      acquisition("AMAZON", "SUCCESS"),
      acquisition("SHOPEE", "SUCCESS"),
      acquisition("MAGAZINE_LUIZA", "BLOCKED"),
    ]),
    "INCOMPLETE",
    "3 FOUND + BLOCKED => INCOMPLETE",
  );
  assert.equal(
    coverageStatusOf([
      acquisition("MERCADO_LIVRE", "SUCCESS"),
      acquisition("AMAZON", "SUCCESS"),
      acquisition("SHOPEE", "SUCCESS"),
      acquisition("MAGAZINE_LUIZA", "SUCCESS"),
      acquisition("ALIEXPRESS", "ERROR"),
    ]),
    "INCOMPLETE",
    "4 FOUND + ERROR => INCOMPLETE",
  );
  assert.equal(
    coverageStatusOf([
      acquisition("MERCADO_LIVRE", "SUCCESS"),
      acquisition("AMAZON", "TIMEOUT"),
    ]),
    "INCOMPLETE",
    "1 FOUND + TIMEOUT => INCOMPLETE",
  );
  assert.equal(
    coverageStatusOf([
      acquisition("MERCADO_LIVRE", "SUCCESS"),
      acquisition("AMAZON", "NOT_RUN"),
    ]),
    "INCOMPLETE",
    "1 FOUND + NOT_RUN => INCOMPLETE",
  );
  assert.equal(
    coverageStatusOf([
      acquisition("MERCADO_LIVRE", "EMPTY"),
      acquisition("AMAZON", "EMPTY"),
      acquisition("SHOPEE", "EMPTY"),
      acquisition("MAGAZINE_LUIZA", "EMPTY"),
      acquisition("ALIEXPRESS", "EMPTY"),
    ]),
    "COMPLETE",
    "0 FOUND + all EMPTY => COMPLETE",
  );
  assert.equal(
    coverageStatusOf([acquisition("AMAZON", "UNUSABLE")]),
    "INCOMPLETE",
    "UNUSABLE impede COMPLETE",
  );

  assert.equal(isClusterPublishable(completeOne), true, "1 valid + COMPLETE => publishable");
  assert.equal(isClusterPublishable(incompleteOne), false, "1 valid + TIMEOUT/INCOMPLETE => false");
  assert.equal(isClusterPublishable(blockedOne), false, "1 valid + BLOCKED => false");
  assert.equal(isClusterPublishable(errorOne), false, "1 valid + ERROR => false");
  assert.equal(
    isClusterPublishable(twoIncomplete),
    false,
    "2 valid + TIMEOUT/INCOMPLETE => nao publicavel",
  );
  assert.equal(
    isClusterPublishable(twoComplete),
    true,
    "2 valid + COMPLETE => publicavel MULTI",
  );
  assert.equal(
    isClusterPublishable(zeroComplete),
    false,
    "0 ofertas + COMPLETE => nao publicavel",
  );
  assert.ok(twoIncomplete.offers.length >= 2, "2 valid equivalentes => compareCount >= 2");
  assert.equal(
    isClusterPublishable(tier3Complete),
    false,
    "TIER 3 ambiguo nao publica mesmo com cobertura COMPLETE",
  );

  let incompleteHeadWrites = 0;
  const incompleteIds = await persistCanonicalProducts(
    "Headphone MarcaX ZX100",
    [incompleteOne],
    {
      headsOnly: true,
      persistProduct: async () => {
        incompleteHeadWrites += 1;
        return { id: "should-not-save" };
      },
    },
  );
  assert.equal(incompleteHeadWrites, 0, "cluster INCOMPLETE nao persiste head publico");
  assert.equal(incompleteIds[0], "");

  let twoIncompleteWrites = 0;
  const twoIncompleteIds = await persistCanonicalProducts(
    "Headphone MarcaX ZX100",
    [twoIncomplete],
    {
      headsOnly: true,
      persistProduct: async () => {
        twoIncompleteWrites += 1;
        return { id: "should-not-save-multi" };
      },
    },
  );
  assert.equal(twoIncompleteWrites, 0, "2 ofertas + INCOMPLETE nao persiste head");
  assert.equal(twoIncompleteIds[0], "");

  const hangUntilAbort = (signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 30_000);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  const tightBudget = {
    globalMs: 2_500,
    marketplaceMs: 400,
    fetchMs: 250,
    persistReserveMs: 1_200,
    hangGraceMs: 40,
  };
  const query = "Headphone MarcaX ZX100";
  const found = (marketplace: DiscoveryAdapter["marketplace"], marketplaceName: string, externalId: string, price: number) =>
    foundCandidate({
      marketplace,
      marketplaceName,
      externalId,
      title: "Headphone MarcaX ZX100 Bluetooth",
      price,
    });

  const completeSingle = await searchMultistoreV2(query, {
    persist: false,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-ok", 199)],
        error: null,
      })),
      fakeAdapter("AMAZON", "Amazon", async () => emptySearch("AMAZON", query)),
      fakeAdapter("SHOPEE", "Shopee", async () => emptySearch("SHOPEE", query)),
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => emptySearch("MAGAZINE_LUIZA", query)),
      fakeAdapter("ALIEXPRESS", "AliExpress", async () => emptySearch("ALIEXPRESS", query)),
    ],
  });
  assert.equal(coverageStatusOf(completeSingle.acquisitions), "COMPLETE");
  assert.ok(completeSingle.products.length >= 1, "A) 1 loja + EMPTY nas demais e PUBLICAVEL");
  assert.equal(completeSingle.products[0]?.publishable, true);
  assert.equal(completeSingle.products[0]?.coverageStatus, "COMPLETE");
  assert.equal(completeSingle.products[0]?.offers.length, 1);
  assert.ok(completeSingle.views.length >= 1);

  const completeMulti = await searchMultistoreV2(query, {
    persist: false,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-multi-ok", 199)],
        error: null,
      })),
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query,
        success: true,
        scanned: 1,
        candidates: [found("AMAZON", "Amazon", "amz-multi-ok", 189)],
        error: null,
      })),
      fakeAdapter("SHOPEE", "Shopee", async () => emptySearch("SHOPEE", query)),
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => emptySearch("MAGAZINE_LUIZA", query)),
      fakeAdapter("ALIEXPRESS", "AliExpress", async () => emptySearch("ALIEXPRESS", query)),
    ],
  });
  assert.equal(coverageStatusOf(completeMulti.acquisitions), "COMPLETE");
  assert.ok(completeMulti.products.length >= 1, "B) 2 lojas + EMPTY nas demais e PUBLICAVEL Multi Loja");
  assert.equal(completeMulti.products[0]?.publishable, true);
  assert.equal(completeMulti.products[0]?.coverageStatus, "COMPLETE");
  assert.ok((completeMulti.products[0]?.offers.length ?? 0) >= 2);
  assert.equal(completeMulti.multiStoreClusters, 1);

  const timeoutSingle = await searchMultistoreV2(query, {
    persist: false,
    budget: tightBudget,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-timeout", 199)],
        error: null,
      })),
      fakeAdapter("AMAZON", "Amazon", async (request) => {
        await hangUntilAbort(request.signal);
        return {
          marketplace: "AMAZON",
          query: request.query,
          success: false,
          scanned: 0,
          candidates: [],
          error: "ainda rodando",
        };
      }),
      fakeAdapter("SHOPEE", "Shopee", async () => emptySearch("SHOPEE", query)),
    ],
  });
  assert.equal(coverageStatusOf(timeoutSingle.acquisitions), "INCOMPLETE");
  assert.equal(timeoutSingle.acquisitions.find((item) => item.marketplace === "AMAZON")?.status, "TIMEOUT");
  assert.ok(timeoutSingle.relevantCandidates.length >= 1);
  assert.equal(timeoutSingle.products.length, 0, "B) 1 loja + TIMEOUT = INCOMPLETE / NAO PUBLICAVEL");
  assert.equal(timeoutSingle.views.length, 0);

  const blockedSingle = await searchMultistoreV2(query, {
    persist: false,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-blocked", 199)],
        error: null,
      })),
      fakeAdapter("AMAZON", "Amazon", async () => blockedSearch("AMAZON", query)),
    ],
  });
  assert.equal(blockedSingle.products.length, 0, "1 valid + BLOCKED => nao publicavel");

  const errorSingle = await searchMultistoreV2(query, {
    persist: false,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-error", 199)],
        error: null,
      })),
      fakeAdapter("AMAZON", "Amazon", async () => {
        throw new Error("Amazon indisponivel.");
      }),
    ],
  });
  assert.equal(errorSingle.products.length, 0, "1 valid + ERROR => nao publicavel");

  let multiTimeoutWrites = 0;
  const twoValidTimeout = await searchMultistoreV2(query, {
    persist: true,
    budget: tightBudget,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-multi", 199)],
        error: null,
      })),
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query,
        success: true,
        scanned: 1,
        candidates: [found("AMAZON", "Amazon", "amz-multi", 189)],
        error: null,
      })),
      fakeAdapter("SHOPEE", "Shopee", async (request) => {
        await hangUntilAbort(request.signal);
        return {
          marketplace: "SHOPEE",
          query: request.query,
          success: false,
          scanned: 0,
          candidates: [],
          error: "ainda rodando",
        };
      }),
    ],
    persistProduct: async (product) => {
      multiTimeoutWrites += 1;
      return { id: `saved-${product.externalId}` };
    },
  });
  assert.equal(coverageStatusOf(twoValidTimeout.acquisitions), "INCOMPLETE");
  assert.equal(twoValidTimeout.acquisitions.find((item) => item.marketplace === "SHOPEE")?.status, "TIMEOUT");
  assert.ok(twoValidTimeout.relevantCandidates.length >= 2, "2 equivalentes permanecem internos para retry");
  assert.equal(twoValidTimeout.products.length, 0, "C) 2 lojas + TIMEOUT = INCOMPLETE / NAO PUBLICAVEL");
  assert.equal(twoValidTimeout.views.length, 0);
  assert.equal(twoValidTimeout.multiStoreClusters, 0);
  assert.equal(multiTimeoutWrites, 0, "2 equivalentes + TIMEOUT nao persiste head");

  const threeBlocked = await searchMultistoreV2(query, {
    persist: true,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-3b", 150)],
        error: null,
      })),
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query,
        success: true,
        scanned: 1,
        candidates: [found("AMAZON", "Amazon", "amz-3b", 99)],
        error: null,
      })),
      fakeAdapter("SHOPEE", "Shopee", async () => ({
        marketplace: "SHOPEE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("SHOPEE", "Shopee", "shp-3b", 120)],
        error: null,
      })),
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => blockedSearch("MAGAZINE_LUIZA", query)),
    ],
    persistProduct: async () => {
      throw new Error("3 FOUND + BLOCKED nao deveria persistir");
    },
  });
  assert.equal(coverageStatusOf(threeBlocked.acquisitions), "INCOMPLETE");
  assert.equal(threeBlocked.acquisitions.find((item) => item.marketplace === "MAGAZINE_LUIZA")?.status, "BLOCKED");
  assert.equal(threeBlocked.products.length, 0, "3 FOUND + BLOCKED = INCOMPLETE / nao publicavel");
  assert.equal(threeBlocked.views.length, 0);

  const fourError = await searchMultistoreV2(query, {
    persist: true,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-4e", 150)],
        error: null,
      })),
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query,
        success: true,
        scanned: 1,
        candidates: [found("AMAZON", "Amazon", "amz-4e", 99)],
        error: null,
      })),
      fakeAdapter("SHOPEE", "Shopee", async () => ({
        marketplace: "SHOPEE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("SHOPEE", "Shopee", "shp-4e", 120)],
        error: null,
      })),
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => ({
        marketplace: "MAGAZINE_LUIZA",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MAGAZINE_LUIZA", "Magazine Luiza", "mag-4e", 110)],
        error: null,
      })),
      fakeAdapter("ALIEXPRESS", "AliExpress", async () => {
        throw new Error("AliExpress indisponivel.");
      }),
    ],
    persistProduct: async () => {
      throw new Error("4 FOUND + ERROR nao deveria persistir");
    },
  });
  assert.equal(coverageStatusOf(fourError.acquisitions), "INCOMPLETE");
  assert.equal(fourError.acquisitions.find((item) => item.marketplace === "ALIEXPRESS")?.status, "ERROR");
  assert.equal(fourError.products.length, 0, "4 FOUND + ERROR = INCOMPLETE / nao publicavel");
  assert.equal(fourError.views.length, 0);

  const notRunSingle = await searchMultistoreV2(query, {
    persist: true,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-notrun", 199)],
        error: null,
      })),
      fakeAdapter("AMAZON", "Amazon", async () => notRunSearch("AMAZON", query)),
    ],
    persistProduct: async () => {
      throw new Error("1 FOUND + NOT_RUN nao deveria persistir");
    },
  });
  assert.equal(coverageStatusOf(notRunSingle.acquisitions), "INCOMPLETE");
  assert.equal(notRunSingle.acquisitions.find((item) => item.marketplace === "AMAZON")?.status, "NOT_RUN");
  assert.equal(notRunSingle.products.length, 0, "1 FOUND + NOT_RUN = INCOMPLETE / nao publicavel");
  assert.equal(notRunSingle.views.length, 0);

  const allEmpty = await searchMultistoreV2(query, {
    persist: false,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => emptySearch("MERCADO_LIVRE", query)),
      fakeAdapter("AMAZON", "Amazon", async () => emptySearch("AMAZON", query)),
      fakeAdapter("SHOPEE", "Shopee", async () => emptySearch("SHOPEE", query)),
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => emptySearch("MAGAZINE_LUIZA", query)),
      fakeAdapter("ALIEXPRESS", "AliExpress", async () => emptySearch("ALIEXPRESS", query)),
    ],
  });
  assert.equal(coverageStatusOf(allEmpty.acquisitions), "COMPLETE", "0 FOUND + all EMPTY => COMPLETE");
  assert.equal(allEmpty.products.length, 0, "0 ofertas => nao publicavel");
  assert.equal(allEmpty.views.length, 0);

  let cheapestWrites = 0;
  let cheapestPersistedPrice: number | null = null;
  const cheapestComplete = await searchMultistoreV2(query, {
    persist: true,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query,
        success: true,
        scanned: 1,
        candidates: [found("AMAZON", "Amazon", "amz-cheap", 150)],
        error: null,
      })),
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-cheap", 99)],
        error: null,
      })),
      fakeAdapter("SHOPEE", "Shopee", async () => ({
        marketplace: "SHOPEE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("SHOPEE", "Shopee", "shp-cheap", 120)],
        error: null,
      })),
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => emptySearch("MAGAZINE_LUIZA", query)),
      fakeAdapter("ALIEXPRESS", "AliExpress", async () => emptySearch("ALIEXPRESS", query)),
    ],
    persistProduct: async (product) => {
      cheapestWrites += 1;
      if (cheapestPersistedPrice === null) {
        cheapestPersistedPrice = product.price;
      }
      return { id: `saved-${product.externalId}` };
    },
  });
  assert.equal(coverageStatusOf(cheapestComplete.acquisitions), "COMPLETE");
  assert.equal(cheapestComplete.products[0]?.publishable, true);
  assert.equal(cheapestComplete.products[0]?.price, 99, "canonical = menor preco apos COMPLETE");
  assert.equal(cheapestComplete.products[0]?.offers.length, 3);
  assert.equal(cheapestComplete.multiStoreClusters, 1);
  assert.ok(cheapestWrites >= 1, "COMPLETE + equivalentes persiste o head canonico");
  assert.equal(cheapestPersistedPrice, 99, "head persistido e a menor oferta");
  assert.ok(cheapestComplete.views.some((view) => view.id.startsWith("saved-")));

  let cheapestTimeoutWrites = 0;
  const cheapestTimeout = await searchMultistoreV2(query, {
    persist: true,
    budget: tightBudget,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query,
        success: true,
        scanned: 1,
        candidates: [found("AMAZON", "Amazon", "amz-cheap-to", 150)],
        error: null,
      })),
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-cheap-to", 99)],
        error: null,
      })),
      fakeAdapter("SHOPEE", "Shopee", async () => ({
        marketplace: "SHOPEE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("SHOPEE", "Shopee", "shp-cheap-to", 120)],
        error: null,
      })),
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async (request) => {
        await hangUntilAbort(request.signal);
        return {
          marketplace: "MAGAZINE_LUIZA",
          query: request.query,
          success: false,
          scanned: 0,
          candidates: [],
          error: "ainda rodando",
        };
      }),
    ],
    persistProduct: async () => {
      cheapestTimeoutWrites += 1;
      return { id: "should-not-save-cheap" };
    },
  });
  assert.equal(coverageStatusOf(cheapestTimeout.acquisitions), "INCOMPLETE");
  assert.equal(cheapestTimeout.acquisitions.find((item) => item.marketplace === "MAGAZINE_LUIZA")?.status, "TIMEOUT");
  assert.ok(cheapestTimeout.relevantCandidates.length >= 3, "equivalentes 150/99/120 ficam internos");
  assert.equal(cheapestTimeout.products.length, 0, "menor preco 99 nao publica enquanto houver TIMEOUT");
  assert.equal(cheapestTimeout.views.length, 0);
  assert.equal(cheapestTimeoutWrites, 0);

  let publicIncompleteWrites = 0;
  const publicIncomplete = await searchCatalogOrDiscover(query, 5, {
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-public", 199)],
        error: null,
      })),
      fakeAdapter("AMAZON", "Amazon", async () => blockedSearch("AMAZON", query)),
      fakeAdapter("SHOPEE", "Shopee", async () => emptySearch("SHOPEE", query)),
    ],
    persistProduct: async () => {
      publicIncompleteWrites += 1;
      return { id: "should-not-save-head" };
    },
    schedulePersist: () => undefined,
  });
  assert.equal(publicIncomplete.products.length, 0);
  assert.equal(publicIncomplete.source, "NOT_FOUND");
  assert.equal(publicIncompleteWrites, 0, "cluster nao publicavel por INCOMPLETE => nenhuma persistencia head publica");
  assert.equal(
    publicIncomplete.products.filter((product) => product.id).length,
    0,
    "INCOMPLETE nao cria rota /produto",
  );

  let publicMultiIncompleteWrites = 0;
  const publicMultiIncomplete = await searchCatalogOrDiscover(query, 5, {
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 1,
        candidates: [found("MERCADO_LIVRE", "Mercado Livre", "ml-public-multi", 199)],
        error: null,
      })),
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query,
        success: true,
        scanned: 1,
        candidates: [found("AMAZON", "Amazon", "amz-public-multi", 189)],
        error: null,
      })),
      fakeAdapter("SHOPEE", "Shopee", async () => blockedSearch("SHOPEE", query)),
    ],
    persistProduct: async () => {
      publicMultiIncompleteWrites += 1;
      return { id: "should-not-save-multi-head" };
    },
    schedulePersist: () => undefined,
  });
  assert.equal(publicMultiIncomplete.products.length, 0, "2 FOUND + BLOCKED nao entra em Ofertas recentes");
  assert.equal(publicMultiIncomplete.source, "NOT_FOUND");
  assert.equal(publicMultiIncompleteWrites, 0, "INCOMPLETE multi nao persiste head");
  assert.equal(
    publicMultiIncomplete.products.filter((product) => product.id).length,
    0,
    "INCOMPLETE multi nao cria rota /produto",
  );
}

async function runPersistContract() {
  await runCoveragePublicationCases();

  const thirty = Array.from({ length: 30 }, (_, index) =>
    canonicalProduct(`Headphone MarcaX ZX${100 + index}`, {
      clusterId: `cluster-${index}`,
      price: 100 + index,
    }),
  );

  let clusterAttempts = 0;
  const limited = await persistCanonicalProducts("Headphone MarcaX", thirty, {
    limit: 12,
    persistProduct: async (product) => {
      clusterAttempts += 1;
      return { id: `saved-${product.externalId}` };
    },
  });
  assert.equal(
    clusterAttempts,
    12,
    "30 clusters RELEVANT + limit 12 nao podem iniciar mais de 12 persistencias",
  );
  assert.equal(limited.filter(Boolean).length, 12);
  assert.equal(limited.length, 12);

  let expiredAttempts = 0;
  const expired = await persistCanonicalProducts("Headphone MarcaX", thirty, {
    limit: 12,
    deadline: {
      expired: () => true,
      remainingMs: () => 0,
      budget: { hangGraceMs: 40 },
    },
    persistProduct: async () => {
      expiredAttempts += 1;
      return { id: "should-not-save" };
    },
  });
  assert.equal(expiredAttempts, 0, "deadline esgotado nao inicia persistencia");
  assert.equal(expired.filter(Boolean).length, 0);

  let remaining = 1_000;
  let midAttempts = 0;
  await persistCanonicalProducts("Headphone MarcaX", thirty.slice(0, 5), {
    deadline: {
      expired: () => remaining <= 0,
      remainingMs: () => remaining,
      budget: { hangGraceMs: 0 },
    },
    persistProduct: async () => {
      midAttempts += 1;
      remaining = 0;
      return { id: `mid-${midAttempts}` };
    },
  });
  assert.equal(
    midAttempts,
    1,
    "depois que o budget acaba, nenhuma nova gravacao inicia",
  );

  const rejectedTitle = "Caixa de som MarcaX ZX100";
  const persistedTitles: string[] = [];
  const mixed = await searchMultistoreV2("Headphone MarcaX ZX100", {
    persist: true,
    limit: 12,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX ZX100",
        success: true,
        scanned: 4,
        candidates: [
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-ok",
            title: "Headphone MarcaX ZX100 Bluetooth",
            price: 199,
          }),
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-rejected",
            title: rejectedTitle,
            price: 89,
          }),
        ],
        error: null,
      })),
    ],
    persistProduct: async (product) => {
      persistedTitles.push(product.title);
      return { id: `saved-${product.externalId}` };
    },
  });
  assert.ok(mixed.products.length >= 1);
  assert.equal(
    persistedTitles.some((title) => title === rejectedTitle),
    false,
    "REJECTED nunca e persistido",
  );
  assert.ok(
    persistedTitles.every((title) => title.toLowerCase().includes("headphone")),
  );

  const hangUntilAbort = (signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 30_000);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

  const timeoutBudget = {
    globalMs: 2_500,
    marketplaceMs: 400,
    fetchMs: 250,
    persistReserveMs: 1_200,
    hangGraceMs: 40,
  };
  const timeoutTitles: string[] = [];
  const partialTimeout = await searchMultistoreV2("Headphone MarcaX ZX100", {
    persist: true,
    limit: 12,
    budget: timeoutBudget,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX ZX100",
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-fast",
            title: "Headphone MarcaX ZX100",
            price: 199,
          }),
        ],
        error: null,
      })),
      fakeAdapter("SHOPEE", "Shopee", async (request) => {
        await hangUntilAbort(request.signal);
        return {
          marketplace: "SHOPEE",
          query: request.query,
          success: false,
          scanned: 0,
          candidates: [],
          error: "ainda rodando",
        };
      }),
    ],
    persistProduct: async (product) => {
      timeoutTitles.push(product.title);
      return { id: `saved-${product.externalId}` };
    },
  });
  assert.equal(
    partialTimeout.acquisitions.find((item) => item.marketplace === "SHOPEE")?.status,
    "TIMEOUT",
  );
  assert.ok(
    partialTimeout.relevantCandidates.length >= 1,
    "timeout parcial preserva o candidato relevante internamente",
  );
  assert.equal(
    partialTimeout.views.length,
    0,
    "1 oferta + TIMEOUT nao publica single-store",
  );
  assert.equal(
    timeoutTitles.length,
    0,
    "1 oferta + TIMEOUT nao persiste head publico",
  );

  const thirtyLive = await searchMultistoreV2("Headphone MarcaX", {
    persist: true,
    limit: 12,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX",
        success: true,
        scanned: 30,
        candidates: Array.from({ length: 30 }, (_, index) =>
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            brand: "MarcaX",
            externalId: `amz-${index}`,
            title: `Headphone MarcaX ZX${100 + index}`,
            price: 80 + index,
          }),
        ),
        error: null,
      })),
    ],
    persistProduct: async (product) => {
      return { id: `saved-${product.externalId}` };
    },
  });
  assert.ok(thirtyLive.products.length <= 12);
  assert.ok(thirtyLive.persistedProductIds.filter(Boolean).length <= 12);

  await runAdversarialLatencyCases(thirty);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function runAdversarialLatencyCases(thirty: CanonicalProduct[]) {
  const writeDelayMs = 100;
  let caseAWrites = 0;
  const caseAStarted = Date.now();
  await persistCanonicalProducts("Headphone MarcaX", thirty, {
    limit: 12,
    persistProduct: async (product) => {
      caseAWrites += 1;
      await wait(writeDelayMs);
      return { id: `slow-${product.externalId}` };
    },
  });
  const caseAElapsed = Date.now() - caseAStarted;
  assert.equal(
    caseAWrites,
    12,
    "CASO A: 30 clusters + limit 12 inicia no maximo 12 writes mesmo com latencia de DB",
  );
  assert.ok(
    caseAElapsed >= 12 * writeDelayMs - 50,
    `CASO A: persistencia sequencial espera cada write; elapsed=${caseAElapsed}ms`,
  );
  assert.ok(
    caseAElapsed < 30 * writeDelayMs,
    `CASO A: nao percorre os 30 clusters; elapsed=${caseAElapsed}ms`,
  );
  console.log(
    `CASO A writes=${caseAWrites} elapsedMs=${caseAElapsed} sequentialFloorMs=${12 * writeDelayMs}`,
  );

  const persistBudgetMs = 80;
  const slowWriteMs = 450;
  const persistClockStarted = Date.now();
  let caseBWrites = 0;
  const caseBStarted = Date.now();
  await persistCanonicalProducts("Headphone MarcaX", thirty.slice(0, 5), {
    deadline: {
      expired: () => Date.now() - persistClockStarted >= persistBudgetMs,
      remainingMs: () =>
        Math.max(0, persistBudgetMs - (Date.now() - persistClockStarted)),
      budget: { hangGraceMs: 0 },
    },
    persistProduct: async (product) => {
      caseBWrites += 1;
      await wait(slowWriteMs);
      return { id: `over-budget-${product.externalId}` };
    },
  });
  const caseBElapsed = Date.now() - caseBStarted;
  assert.equal(
    caseBWrites,
    1,
    "CASO B: so o write ja iniciado corre; novos nao comecam",
  );
  assert.ok(
    caseBElapsed >= slowWriteMs - 40,
    `CASO B: persistCanonicalProducts espera o write alem do budget; elapsed=${caseBElapsed}ms remainingWas=${persistBudgetMs}ms`,
  );
  console.log(
    `CASO B writes=${caseBWrites} elapsedMs=${caseBElapsed} remainingAtStartMs=${persistBudgetMs} writeMs=${slowWriteMs}`,
  );

  const hang = deferred<{ id: string }>();
  let persistWriteStarted = false;
  let persistReturned = false;
  const persistHang = persistCanonicalProducts(
    "Headphone MarcaX",
    thirty.slice(0, 3),
    {
      limit: 12,
      persistProduct: async () => {
        persistWriteStarted = true;
        return hang.promise;
      },
    },
  );
  void persistHang.then(() => {
    persistReturned = true;
  });
  while (!persistWriteStarted) {
    await wait(5);
  }
  await wait(20);
  assert.equal(
    persistReturned,
    false,
    "CASO C: persistCanonicalProducts fica bloqueado enquanto saveProduct nao resolve",
  );

  let searchWriteStarted = false;
  let searchReturned = false;
  const searchHang = searchMultistoreV2("Headphone MarcaX ZX100", {
    persist: true,
    limit: 12,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX ZX100",
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-hang",
            title: "Headphone MarcaX ZX100",
            price: 199,
          }),
        ],
        error: null,
      })),
    ],
    persistProduct: async () => {
      searchWriteStarted = true;
      return hang.promise;
    },
  });
  void searchHang.then(() => {
    searchReturned = true;
  });
  while (!searchWriteStarted) {
    await wait(5);
  }
  await wait(20);
  assert.equal(
    searchReturned,
    false,
    "CASO C: searchMultistoreV2 (caminho publico) nao retorna enquanto o write iniciado nao termina",
  );

  hang.resolve({ id: "released-after-simulated-30s" });
  const [persistResult, searchResult] = await Promise.all([
    persistHang,
    searchHang,
  ]);
  assert.equal(persistReturned, true);
  assert.equal(searchReturned, true);
  assert.equal(persistResult[0], "released-after-simulated-30s");
  assert.ok(searchResult.views.length >= 1);
  console.log(
    "CASO C: write pendente bloqueia persistCanonicalProducts e searchMultistoreV2; resposta publica so sai depois do await de saveProduct",
  );

  await runAfterResponseCases();
}

async function runAfterResponseCases() {
  const hang = deferred<{ id: string }>();
  let persistCalls = 0;
  let scheduled: (() => Promise<void>) | null = null;
  const searchStarted = Date.now();
  const publicResult = await searchCatalogOrDiscover("Headphone MarcaX ZX100", 5, {
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX ZX100",
        success: true,
        scanned: 2,
        candidates: [
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-ok",
            title: "Headphone MarcaX ZX100 Bluetooth",
            price: 199,
          }),
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-rejected",
            title: "Caixa de som MarcaX ZX100",
            price: 89,
          }),
        ],
        error: null,
      })),
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => ({
        marketplace: "MAGAZINE_LUIZA",
        query: "Headphone MarcaX ZX100",
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "MAGAZINE_LUIZA",
            marketplaceName: "Magazine Luiza",
            externalId: "mag-ok",
            title: "Headphone MarcaX ZX100",
            price: 189,
          }),
        ],
        error: null,
      })),
    ],
    persistProduct: async (product, _affiliateLink, options) => {
      persistCalls += 1;
      assert.equal(
        product.title.includes("Caixa de som"),
        false,
        "after() nao recebe cluster REJECTED",
      );
      if (options?.targetProductId) {
        return hang.promise;
      }
      return { id: "head-navigable-id" };
    },
    schedulePersist: (task) => {
      scheduled = task;
    },
  });
  const availableMs = Date.now() - searchStarted;
  assert.ok(publicResult.products.length >= 1, "busca publica devolve resultados");
  assert.equal(
    publicResult.products[0]?.id,
    "head-navigable-id",
    "card publico usa o id persistido da oferta canonica, navegavel imediatamente",
  );
  assert.equal(persistCalls, 1, "somente a oferta canonica persiste no caminho sincrono");
  assert.ok(availableMs < 500, `resultados disponiveis em ${availableMs}ms sem esperar o write das demais ofertas`);
  assert.ok(scheduled, "after() recebeu o trabalho de persistencia das demais ofertas");

  let afterSettled = false;
  const afterWork = scheduled!();
  void afterWork.then(() => {
    afterSettled = true;
  });
  while (persistCalls < 2) {
    await wait(5);
  }
  await wait(20);
  assert.equal(
    afterSettled,
    false,
    "demais ofertas podem continuar depois sem bloquear o card ja navegavel",
  );
  hang.resolve({ id: "after-saved" });
  await afterWork;
  assert.equal(afterSettled, true);
  assert.equal(persistCalls, 2);

  let scheduledCount = 0;
  const limitedPublic = await searchCatalogOrDiscover("Headphone MarcaX", 5, {
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX",
        success: true,
        scanned: 30,
        candidates: Array.from({ length: 30 }, (_, index) =>
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            brand: "MarcaX",
            externalId: `amz-after-${index}`,
            title: `Headphone MarcaX ZX${100 + index}`,
            price: 80 + index,
          }),
        ),
        error: null,
      })),
    ],
    persistProduct: async (product) => {
      scheduledCount += 1;
      return { id: `after-${product.externalId}` };
    },
    schedulePersist: (task) => {
      scheduled = task;
    },
  });
  assert.ok(limitedPublic.products.length <= 12);
  assert.ok(
    limitedPublic.products.every((product) => product.id.startsWith("after-")),
    "cards publicos recebem id persistido da cabeca canonica",
  );
  assert.equal(
    scheduledCount,
    limitedPublic.products.length,
    "oferta canonica de cada card persiste no caminho sincrono",
  );
  await scheduled!();
  assert.ok(scheduledCount <= 12, "after() nao inicia persistencia alem do limit");
  assert.equal(scheduledCount, limitedPublic.products.length);

  const logged = await persistSelectedSearchClusters(
    "Headphone MarcaX ZX100",
    [
      canonicalProduct("Headphone MarcaX ZX100", { clusterId: "err-1" }),
    ],
    {
      persistProduct: async () => {
        throw new Error("db down");
      },
    },
  );
  assert.equal(logged[0], "");

  let scheduleThrew = false;
  try {
    let afterTask: (() => Promise<void>) | null = null;
    scheduleSelectedClusterPersist(
      (task) => {
        afterTask = task;
      },
      "Headphone MarcaX ZX100",
      [canonicalProduct("Headphone MarcaX ZX100", { clusterId: "err-2" })],
      {
        persistProduct: async () => {
          throw new Error("db down after");
        },
      },
    );
    const pending = afterTask;
    assert.ok(pending);
    await pending();
  } catch {
    scheduleThrew = true;
  }
  assert.equal(
    scheduleThrew,
    false,
    "erro em saveProduct no trabalho pos-resposta e capturado e nao vira erro da pesquisa",
  );
}

void runPersistContract()
  .then(() => {
    console.log("multistore-v2 persist: invariantes estruturais passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
