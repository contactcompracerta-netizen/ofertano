import assert from "node:assert/strict";

import { descobrirProdutosComAdapters } from "../discovery";
import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "../discovery/core/types";
import type { ProductImport } from "../importers/core/types";
import {
  escolherClusterExatoDaPesquisaPublica,
} from "./persistPublicSearchCluster";
import type { PublicSearchOffer } from "./persistPublicSearchCluster";
import {
  avaliarPublicationGate,
  classificarBuscaDoMarketplace,
} from "./publicationGate";

const QUERY =
  "Smartphone NovaTech Pulse NTX20-41-8C3 128GB 5G";

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
  title?: string;
  price?: number;
}): PublicSearchOffer {
  return {
    product: {
      marketplace: input.marketplace,
      externalId: input.externalId,
      url: `https://loja.example/${input.externalId}`,
      affiliateLink: `https://aff.example/${input.externalId}`,
      title: input.title ?? SAME_TITLE,
      description: null,
      brand: "NovaTech",
      category: "Eletronicos",
      image: "https://img.example/produto.jpg",
      images: ["https://img.example/produto.jpg"],
      price: input.price ?? 1999,
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

const shopeeCandidate = candidate({
  marketplace: "SHOPEE",
  marketplaceName: "Shopee",
  title: SAME_TITLE,
  externalId: "shp-8c3",
  price: 2050,
});

const fiveCompleted: MarketplaceDiscoveryResult[] = [
  result("MERCADO_LIVRE", { candidates: [mlCandidate] }),
  result("AMAZON"),
  result("SHOPEE"),
  result("MAGAZINE_LUIZA"),
  result("ALIEXPRESS"),
];

const mlAndShopeeExact = [
  offer({
    marketplace: "Mercado Livre",
    externalId: "MLB111",
    price: 2199,
  }),
  offer({
    marketplace: "Shopee",
    externalId: "shp-8c3",
    price: 2050,
  }),
];

const test1 = avaliarPublicationGate({
  query: QUERY,
  enabledMarketplaces: ENABLED,
  results: fiveCompleted,
  exactOffers: mlAndShopeeExact,
});

assert.equal(test1.marketplacesSearchCompleted, 5);
assert.equal(test1.exactMarketplaceCount, 2);
assert.equal(
  test1.publicationEligible,
  true,
  "TESTE 1: 5 pesquisados + ML/Shopee EXACT deve publicar.",
);

const test2 = avaliarPublicationGate({
  query: QUERY,
  enabledMarketplaces: ENABLED,
  results: fiveCompleted,
  exactOffers: [
    offer({
      marketplace: "Mercado Livre",
      externalId: "MLB111",
    }),
  ],
});

assert.equal(test2.marketplacesSearchCompleted, 5);
assert.equal(test2.exactMarketplaceCount, 1);
assert.equal(
  test2.publicationEligible,
  false,
  "TESTE 2: somente ML EXACT nao publica.",
);
assert.match(test2.reason, /Somente uma oferta EXACT/i);
assert.equal(test2.status, "INSUFFICIENT_EXACT");

const test3 = avaliarPublicationGate({
  query: QUERY,
  enabledMarketplaces: ENABLED,
  results: [
    result("MERCADO_LIVRE", { candidates: [mlCandidate] }),
    result("AMAZON", {
      success: false,
      scanned: 0,
      error: "403 access denied",
      blockedSources: ["amazon-html"],
    }),
    result("SHOPEE", {
      success: false,
      scanned: 0,
      error: "fetch failed",
    }),
    result("MAGAZINE_LUIZA", {
      success: false,
      scanned: 0,
      error: "timeout",
    }),
    result("ALIEXPRESS", {
      success: false,
      scanned: 0,
      error: "pagina invalida sem estrutura",
    }),
  ],
  exactOffers: [
    offer({
      marketplace: "Mercado Livre",
      externalId: "MLB111",
    }),
  ],
});

assert.equal(test3.marketplacesSearchCompleted, 1);
assert.equal(
  test3.publicationEligible,
  false,
  "TESTE 3: cobertura insuficiente bloqueia.",
);
assert.equal(test3.status, "SEARCH_INCOMPLETE");
assert.match(test3.reason, /Cobertura insuficiente/i);

assert.equal(
  classificarBuscaDoMarketplace(
    result("AMAZON", {
      success: true,
      candidates: [],
      scanned: 12,
      error: null,
    }),
  ),
  "EMPTY_VALID",
  "TESTE 5: EMPTY valido conta como pesquisa realizada.",
);

const test5 = avaliarPublicationGate({
  query: QUERY,
  enabledMarketplaces: ["MERCADO_LIVRE", "SHOPEE", "AMAZON"],
  results: [
    result("MERCADO_LIVRE", { success: true, candidates: [], scanned: 8 }),
    result("SHOPEE", { candidates: [shopeeCandidate] }),
    result("AMAZON", { success: true, candidates: [], scanned: 4 }),
  ],
  exactOffers: [
    offer({
      marketplace: "Shopee",
      externalId: "shp-8c3",
    }),
  ],
});

assert.equal(
  test5.marketplacesSearchCompleted,
  3,
  "TESTE 5: EMPTY_VALID soma cobertura.",
);
assert.equal(test5.publicationEligible, false);
assert.equal(test5.status, "INSUFFICIENT_EXACT");

assert.equal(
  classificarBuscaDoMarketplace(
    result("SHOPEE", {
      success: false,
      candidates: [],
      scanned: 0,
      error: "captcha challenge",
      blockedSources: ["shopee-html"],
    }),
  ),
  "BLOCKED",
  "TESTE 6: BLOCKED nao conta como pesquisa concluida.",
);

const test6 = avaliarPublicationGate({
  query: QUERY,
  enabledMarketplaces: ["MERCADO_LIVRE", "SHOPEE"],
  results: [
    result("MERCADO_LIVRE", { candidates: [mlCandidate] }),
    result("SHOPEE", {
      success: false,
      scanned: 0,
      error: "captcha",
      blockedSources: ["shopee-html"],
    }),
  ],
  exactOffers: mlAndShopeeExact,
});

assert.equal(test6.marketplacesSearchCompleted, 1);
assert.equal(
  test6.publicationEligible,
  false,
  "TESTE 6: BLOCKED nao completa cobertura.",
);
assert.ok(test6.blockedMarketplaces.includes("SHOPEE"));

const clusterComReferencia = escolherClusterExatoDaPesquisaPublica(
  QUERY,
  [
    offer({
      marketplace: "Mercado Livre",
      externalId: "MLB111",
    }),
  ],
);

assert.equal(
  clusterComReferencia.length,
  1,
  "TESTE 7: reference com 1 marketplace ainda pode existir internamente.",
);

const test7 = avaliarPublicationGate({
  query: QUERY,
  enabledMarketplaces: ENABLED,
  results: fiveCompleted,
  exactOffers: clusterComReferencia,
});

assert.equal(
  test7.publicationEligible,
  false,
  "TESTE 7: reference de 1 loja nao autoriza persistencia publica.",
);
assert.equal(test7.exactMarketplaceCount, 1);

const clusterDoisExact = escolherClusterExatoDaPesquisaPublica(
  QUERY,
  mlAndShopeeExact,
);

assert.ok(
  clusterDoisExact.length >= 2,
  "TESTE 8: duas ofertas EXACT da mesma identidade formam cluster.",
);

const test8 = avaliarPublicationGate({
  query: QUERY,
  enabledMarketplaces: ENABLED,
  results: fiveCompleted,
  exactOffers: clusterDoisExact,
});

assert.equal(
  test8.publicationEligible,
  true,
  "TESTE 8: 2 EXACT da mesma identidade podem publicar.",
);
assert.equal(test8.exactMarketplaceCount, 2);

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
        return result("SHOPEE", { candidates: [shopeeCandidate] });
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
    "TESTE 4: ML encontrar produto cedo nao encerra as demais lojas.",
  );
  assert.equal(discovery.results.length, 5);
}

void runDiscoveryIsolation()
  .then(() => {
    console.log("publication gate: todos os casos passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
