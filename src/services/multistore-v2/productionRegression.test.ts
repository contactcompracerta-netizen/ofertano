import assert from "node:assert/strict";

import type {
  DiscoveryAdapter,
  MarketplaceDiscoveryResult,
} from "@/services/discovery/core/types";
import { criarCandidatos, selectAmazonProductTitle } from "@/services/discovery/amazon";
import { searchMultistoreV2 } from "./search";
import { detectDistinctiveConflict } from "./distinctiveAnchors";
import { extractSanitizedIdentity } from "./sanitizedIdentity";
import { sanitizeCommerceQuery } from "./querySanitizer";
import { buildCommerceSearchPlan } from "./searchPlan";

const candidateResult = (
  marketplace: "AMAZON" | "SHOPEE",
  title: string,
): MarketplaceDiscoveryResult => ({
  marketplace,
  query: title,
  success: true,
  searchOutcome: "SEARCH_COMPLETED",
  candidates: [{
    marketplace,
    marketplaceName: marketplace === "AMAZON" ? "Amazon" : "Shopee",
    externalId: `${marketplace}-1`,
    sourceUrl: `https://example.com/${marketplace}-1`,
    title,
    image: "https://example.com/image.jpg",
    price: 100,
    oldPrice: null,
    brand: marketplace === "AMAZON" ? "adidas" : null,
    seller: null,
    status: "FOUND",
    error: null,
  }],
  scanned: 1,
});

const amazon = (result: MarketplaceDiscoveryResult): DiscoveryAdapter => ({
  marketplace: "AMAZON",
  marketplaceName: "Amazon",
  enabled: true,
  searcher: async () => result,
});

const blockedShopee: DiscoveryAdapter = {
  marketplace: "SHOPEE",
  marketplaceName: "Shopee",
  enabled: true,
  searcher: async () => ({
    marketplace: "SHOPEE",
    query: "disco de serra 80 dentes",
    success: false,
    searchOutcome: "BLOCKED",
    candidates: [],
    scanned: 0,
    error: "challenge",
  }),
};

const nikeQuery = "Tênis Nike Revolution 8 Feminino 4.9 Avaliação 4.9 de 5. 523 opiniões. (523)";
const nikeSanitized = sanitizeCommerceQuery(nikeQuery).sanitizedQuery;
assert.equal(nikeSanitized, "Tênis Nike Revolution 8 Feminino");
const nikeIdentity = extractSanitizedIdentity(nikeQuery);
assert.equal(detectDistinctiveConflict(nikeIdentity, "Tênis Nike Revolution 8 Feminino").conflict, false);
assert.equal(detectDistinctiveConflict(nikeIdentity, "Tênis Nike Revolution 6 Feminino").conflict, true);
assert.equal(detectDistinctiveConflict(nikeIdentity, "Tênis Nike Revolution 7 Feminino").conflict, true);

const adidasIdentity = extractSanitizedIdentity("Tênis adidas Feminino Corrida Caminhada Leve Confortável");
assert.equal(adidasIdentity.strongIdentity.brand, "adidas");
assert.equal(adidasIdentity.queryCore.productClass, "apparel");
assert.ok(!adidasIdentity.strongIdentity.modelLine?.includes("corrida"));
assert.ok(buildCommerceSearchPlan(adidasIdentity).some((variant) => /tenis.*adidas|adidas.*tenis/i.test(variant.originalText)));

const amazonCandidates = criarCandidatos(
  [{
    asin: "B0TESTASIN",
    title: "Tênis adidas Feminino Corrida Caminhada Leve Confortável",
    brand: "adidas",
    extracted_price: 199,
    thumbnail: "https://example.com/image.jpg",
  }],
  "Tênis adidas Feminino",
  5,
  true,
);
assert.equal(amazonCandidates[0]?.title, "Tênis adidas Feminino Corrida Caminhada Leve Confortável");
assert.notEqual(amazonCandidates[0]?.title, amazonCandidates[0]?.brand);
assert.equal(selectAmazonProductTitle({ title: "adidas", brand: "adidas", asin: "B0TESTASIN" }), null);
assert.equal(selectAmazonProductTitle({ title: "Nike", brand: "Nike", asin: "B0TESTASIN" }), null);
assert.equal(selectAmazonProductTitle({ title: "B0TESTASIN", brand: "adidas", asin: "B0TESTASIN" }), null);
assert.equal(selectAmazonProductTitle({ title: "adidas Duramo SL 2 Tênis Feminino", brand: "adidas", asin: "B0TESTASIN" }), "adidas Duramo SL 2 Tênis Feminino");
assert.equal(selectAmazonProductTitle({ title: "Nike Revolution 8 Tênis Feminino", brand: "Nike", asin: "B0TESTASIN" }), "Nike Revolution 8 Tênis Feminino");

async function main(): Promise<void> {
const fallback = await searchMultistoreV2("Disco de serra 80 dentes", {
  adapters: [amazon(candidateResult("AMAZON", "Disco de serra 80 dentes")), blockedShopee],
  budget: { globalMs: 3000, marketplaceMs: 500, fetchMs: 300, responseReserveMs: 200, persistReserveMs: 200, hangGraceMs: 50 },
});
assert.equal(fallback.views.length, 1);
assert.equal(fallback.multiStoreClusters, 0);
assert.equal(fallback.singleStoreClusters, 1);
assert.equal(fallback.persistedProductIds[0], "");
assert.equal(fallback.products[0]?.publishable, false);

for (const [query, candidate] of [
  ["Disco de serra 80 dentes", "Disco de serra 60 dentes"],
  ["Bicicleta GTS Dexter 24 Marchas", "Bicicleta GTS Dexter 21 Marchas"],
  ["WAP GTW Inox 12 1400W 220V", "WAP GTW Inox 12 1200W 220V"],
  ["KIT 4 Camisa", "KIT 3 Camisa"],
  ["EDA 8TN 11 Peças", "EDA 8TN 10 Peças"],
  ["PS4 Slim 1TB", "PS4 Slim 500GB"],
] as const) {
  assert.notEqual(
    detectDistinctiveConflict(extractSanitizedIdentity(query), candidate).reason,
    "model_line_mismatch",
    `${query} does not create a nominal model conflict`,
  );
}

let aliAttempts = 0;
const ali: DiscoveryAdapter = {
  marketplace: "ALIEXPRESS",
  marketplaceName: "AliExpress",
  enabled: true,
  searcher: async () => {
    aliAttempts += 1;
    return {
      marketplace: "ALIEXPRESS",
      query: "tenis adidas feminino",
      success: false,
      searchOutcome: "ERROR",
      candidates: [],
      scanned: 0,
      error: "AliExpress API: InvalidAppKey The specified App Key is invalid",
    };
  },
};
await searchMultistoreV2("Tênis adidas Feminino Corrida", {
  adapters: [ali],
  budget: { globalMs: 3000, marketplaceMs: 1000, fetchMs: 300, responseReserveMs: 200, persistReserveMs: 200, hangGraceMs: 50 },
});
assert.equal(aliAttempts, 1);

const huntCandidate = (
  marketplace: "AMAZON" | "SHOPEE" | "MAGAZINE_LUIZA",
  externalId: string,
  title: string,
) => ({
  marketplace,
  marketplaceName:
    marketplace === "AMAZON"
      ? "Amazon"
      : marketplace === "SHOPEE"
        ? "Shopee"
        : "Magazine Luiza",
  externalId,
  sourceUrl: `https://example.com/${externalId}`,
  title,
  image: "https://example.com/image.jpg",
  price: 100,
  oldPrice: null,
  brand: "JBL",
  seller: null,
  status: "FOUND" as const,
  error: null,
});
const huntResult = (
  marketplace: "AMAZON" | "SHOPEE" | "MAGAZINE_LUIZA",
  query: string,
  candidates: ReturnType<typeof huntCandidate>[],
) => ({
  marketplace,
  query,
  success: true,
  searchOutcome: "SEARCH_COMPLETED" as const,
  candidates,
  scanned: candidates.length,
});

const huntTitleA = "Headphone JBL Tune 520BT";
const huntTitleB = "Headphone JBL Tune 510BT";
const huntCalls: string[] = [];
const huntRegression = await searchMultistoreV2("Headphone JBL", {
  persist: false,
  hunt: true,
  limit: 10,
  budget: { globalMs: 12000, marketplaceMs: 2000, fetchMs: 200, responseReserveMs: 200, persistReserveMs: 200, hangGraceMs: 50 },
  adapters: [
    {
      marketplace: "AMAZON",
      marketplaceName: "Amazon",
      enabled: true,
      searcher: async (request) => huntResult("AMAZON", request.query, [
        huntCandidate("AMAZON", "hunt-a-amazon", huntTitleA),
        huntCandidate("AMAZON", "hunt-b-amazon", huntTitleB),
      ]),
    },
    {
      marketplace: "SHOPEE",
      marketplaceName: "Shopee",
      enabled: true,
      searcher: async (request) => {
        if (request.query.includes("Tune 510BT")) {
          huntCalls.push("SHOPEE:510BT");
          return huntResult("SHOPEE", request.query, [
            huntCandidate("SHOPEE", "hunt-b-shopee", huntTitleB),
          ]);
        }
        return huntResult("SHOPEE", request.query, [
          huntCandidate("SHOPEE", "hunt-a-shopee", huntTitleA),
        ]);
      },
    },
    {
      marketplace: "MAGAZINE_LUIZA",
      marketplaceName: "Magazine Luiza",
      enabled: true,
      searcher: async (request) => {
        if (request.query.includes("Tune 520BT")) {
          huntCalls.push("MAGAZINE_LUIZA:520BT");
          return huntResult("MAGAZINE_LUIZA", request.query, [
            huntCandidate("MAGAZINE_LUIZA", "hunt-a-magalu", huntTitleA),
          ]);
        }
        return huntResult("MAGAZINE_LUIZA", request.query, []);
      },
    },
  ],
});
const huntedA = huntRegression.products.find((product) =>
  product.offers.some((offer) => offer.externalId === "hunt-a-amazon"),
);
const huntedB = huntRegression.products.find((product) =>
  product.offers.some((offer) => offer.externalId === "hunt-b-amazon"),
);
assert.ok(huntCalls.includes("SHOPEE:510BT"), "hunt continua mesmo com o Cluster A Multi Loja visivel");
assert.ok(huntCalls.includes("MAGAZINE_LUIZA:520BT"), "hunt consulta Magalu para o Cluster A ja Multi Loja");
assert.equal(huntRegression.multiStoreClusters, 2, "os dois clusters ficam Multi Loja apos o hunt");
assert.deepEqual(huntedB?.marketplaces.slice().sort(), ["AMAZON", "SHOPEE"]);
assert.deepEqual(huntedA?.marketplaces.slice().sort(), ["AMAZON", "MAGAZINE_LUIZA", "SHOPEE"]);

console.log("production regressions: sanitizer, identity, Amazon title, fallback, AliExpress short-circuit and hunt coverage passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
