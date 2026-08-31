import assert from "node:assert/strict";

import { descobrirProdutosComAdapters } from "../discovery";
import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "../discovery/core/types";
import type { ProductImport } from "../importers/core/types";
import {
  avaliarSearchCompletionBarrier,
  classificarBuscaDoMarketplace,
} from "./searchCompletionBarrier";
import type { PublicSearchOffer } from "./persistPublicSearchCluster";

const QUERY = "Smartphone NovaTech Pulse NTX20-41-8C3 128GB 5G";
const SAME_TITLE =
  "Smartphone NovaTech Pulse NTX20-41-8C3 128GB 5G Dual Chip";

const ENABLED: Array<MarketplaceDiscoveryResult["marketplace"]> = [
  "MERCADO_LIVRE",
  "AMAZON",
  "SHOPEE",
  "MAGAZINE_LUIZA",
  "ALIEXPRESS",
];

function offer(input: {
  marketplace: ProductImport["marketplace"];
  externalId: string;
}): PublicSearchOffer {
  return {
    product: {
      marketplace: input.marketplace,
      externalId: input.externalId,
      url: `https://loja.example/${input.externalId}`,
      affiliateLink: `https://aff.example/${input.externalId}`,
      title: SAME_TITLE,
      description: null,
      brand: "NovaTech",
      category: "Eletronicos",
      image: "https://img.example/produto.jpg",
      images: ["https://img.example/produto.jpg"],
      price: 1999,
      oldPrice: 2199,
      discount: null,
      installments: null,
      rating: null,
      reviews: null,
      sales: null,
      stock: 6,
      seller: null,
      attributes: {},
    },
    affiliateLink: `https://aff.example/${input.externalId}`,
  };
}

function candidate(input: {
  marketplace: DiscoveryCandidate["marketplace"];
  marketplaceName: DiscoveryCandidate["marketplaceName"];
  title: string;
  externalId: string;
  price: number;
}): DiscoveryCandidate {
  return {
    marketplace: input.marketplace,
    marketplaceName: input.marketplaceName,
    externalId: input.externalId,
    sourceUrl: `https://loja.example/${input.externalId}`,
    affiliateLink: `https://aff.example/${input.externalId}`,
    title: input.title,
    image: "https://img.example/produto.jpg",
    price: input.price,
    oldPrice: null,
    brand: "NovaTech",
    attributes: {},
    status: "FOUND",
  };
}

function result(
  marketplace: MarketplaceDiscoveryResult["marketplace"],
  patch: Partial<MarketplaceDiscoveryResult> = {},
): MarketplaceDiscoveryResult {
  return {
    marketplace,
    query: QUERY,
    success: true,
    candidates: [],
    scanned: 3,
    error: null,
    ...patch,
  };
}

function adapter(
  marketplace: DiscoveryAdapter["marketplace"],
  marketplaceName: DiscoveryAdapter["marketplaceName"],
  searcher: NonNullable<DiscoveryAdapter["searcher"]>,
): DiscoveryAdapter {
  return {
    marketplace,
    marketplaceName,
    enabled: true,
    searcher,
  };
}

const mlCandidate = candidate({
  marketplace: "MERCADO_LIVRE",
  marketplaceName: "Mercado Livre",
  title: SAME_TITLE,
  externalId: "MLB111",
  price: 2199,
});

const fiveAttempted: MarketplaceDiscoveryResult[] = [
  result("MERCADO_LIVRE", { candidates: [mlCandidate] }),
  result("AMAZON"),
  result("SHOPEE"),
  result("MAGAZINE_LUIZA"),
  result("ALIEXPRESS"),
];

const singleExact = [
  offer({
    marketplace: "Mercado Livre",
    externalId: "MLB111",
  }),
];

const afterFullSearch = avaliarSearchCompletionBarrier({
  query: QUERY,
  enabledMarketplaces: ENABLED,
  results: fiveAttempted,
  exactOffers: singleExact,
});

assert.equal(afterFullSearch.allEnabledAttempted, true);
assert.equal(afterFullSearch.publicationAllowed, true);
assert.equal(afterFullSearch.exactMarketplaceCount, 1);
assert.equal(afterFullSearch.comparisonCoverage, "FULL_ATTEMPT");
assert.equal(
  afterFullSearch.result,
  "SINGLE_EXACT_AFTER_FULL_SEARCH",
  "1 EXACT apos busca completa pode persistir.",
);

const onlyOneStoreRan = avaliarSearchCompletionBarrier({
  query: QUERY,
  enabledMarketplaces: ENABLED,
  results: [result("MERCADO_LIVRE", { candidates: [mlCandidate] })],
  exactOffers: singleExact,
});

assert.equal(onlyOneStoreRan.publicationAllowed, false);
assert.ok(onlyOneStoreRan.notRunMarketplaces.length >= 4);
assert.equal(onlyOneStoreRan.result, "EARLY_PUBLISH_BLOCKED");

assert.equal(
  classificarBuscaDoMarketplace(
    result("AMAZON", {
      success: false,
      scanned: 0,
      error: "Amazon bloqueou temporariamente a busca HTML automatizada.",
    }),
  ),
  "BLOCKED",
);

const blockedButAttempted = avaliarSearchCompletionBarrier({
  query: QUERY,
  enabledMarketplaces: ENABLED,
  results: [
    result("MERCADO_LIVRE", { candidates: [mlCandidate] }),
    result("AMAZON", {
      success: false,
      scanned: 0,
      error: "captcha",
      blockedSources: ["amazon-html"],
      searchOutcome: "BLOCKED",
    }),
    result("SHOPEE"),
    result("MAGAZINE_LUIZA"),
    result("ALIEXPRESS"),
  ],
  exactOffers: singleExact,
});

assert.equal(blockedButAttempted.allEnabledAttempted, true);
assert.ok(blockedButAttempted.blockedMarketplaces.includes("AMAZON"));
assert.equal(
  blockedButAttempted.publicationAllowed,
  false,
  "Singleton bloqueado quando alguma loja termina em BLOCKED.",
);
assert.equal(blockedButAttempted.notRunMarketplaces.length, 0);

async function runDiscoveryIsolation() {
  let mercadoLivreCalls = 0;
  let amazonCalls = 0;
  let shopeeCalls = 0;
  let magaluCalls = 0;
  let aliexpressCalls = 0;

  const discovery = await descobrirProdutosComAdapters(
    QUERY,
    [
      adapter("MERCADO_LIVRE", "Mercado Livre", async () => {
        mercadoLivreCalls += 1;
        return result("MERCADO_LIVRE", { candidates: [mlCandidate] });
      }),
      adapter("AMAZON", "Amazon", async () => {
        amazonCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return result("AMAZON");
      }),
      adapter("SHOPEE", "Shopee", async () => {
        shopeeCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return result("SHOPEE");
      }),
      adapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => {
        magaluCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return result("MAGAZINE_LUIZA");
      }),
      adapter("ALIEXPRESS", "AliExpress", async () => {
        aliexpressCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return result("ALIEXPRESS");
      }),
    ],
    5,
    { mode: "MULTILOJA" },
  );

  assert.ok(
    mercadoLivreCalls >= 1 &&
      amazonCalls >= 1 &&
      shopeeCalls >= 1 &&
      magaluCalls >= 1 &&
      aliexpressCalls >= 1,
    "Todos os adapters devem ser chamados antes da persistencia.",
  );
  assert.equal(discovery.results.length, 5);

  const afterDiscovery = avaliarSearchCompletionBarrier({
    query: QUERY,
    enabledMarketplaces: ENABLED,
    results: discovery.results,
    exactOffers: singleExact,
  });
  assert.equal(afterDiscovery.allEnabledAttempted, true);
  assert.equal(afterDiscovery.publicationAllowed, true);
}

void runDiscoveryIsolation()
  .then(() => {
    console.log("search completion barrier: todos os casos passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
