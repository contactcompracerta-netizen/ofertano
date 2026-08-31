import assert from "node:assert/strict";

import {
  countDistinctMarketplaces,
  isClusterPublishable,
  isPublicationAllowed,
  isSearchVisible,
} from "./publicationBarrier";
import type { CanonicalProduct } from "./types";
import { buildQueryIntent } from "./queryIntent";
import { normalizeCandidate, tokenize, extractModelTokens, extractQuantity } from "./normalizeCandidate";
import { scoreQueryRelevance } from "./queryRelevance";
import { extractIdentityAnchors } from "./identityAnchors";

function product(
  offers: CanonicalProduct["offers"],
  coverageStatus: CanonicalProduct["coverageStatus"] = "COMPLETE",
  rankTier: CanonicalProduct["rankTier"] = 1,
): CanonicalProduct {
  return {
    clusterId: "cluster",
    title: offers[0]?.title ?? "Produto",
    image: offers[0]?.image ?? "https://img.example/a.jpg",
    description: null,
    brand: offers[0]?.brand ?? null,
    price: offers[0]?.price ?? 10,
    oldPrice: null,
    primaryMarketplace: offers[0]?.marketplaceName ?? "Shopee",
    offers,
    marketplaces: offers.map((offer) => offer.marketplace),
    confidence: 1,
    rankTier,
    coverageStatus,
  };
}

const offer = (
  marketplace: CanonicalProduct["offers"][number]["marketplace"],
  externalId: string,
  title: string,
) => ({
  marketplace,
  marketplaceName: marketplace,
  externalId,
  title,
  url: `https://loja.example/${externalId}`,
  image: "https://img.example/a.jpg",
  price: 99,
  oldPrice: null,
  brand: null,
  affiliateLink: null,
  attributes: {},
  seller: null,
});

assert.equal(
  isPublicationAllowed(
    product([offer("SHOPEE", "s1", "Cabide"), offer("MERCADO_LIVRE", "m1", "Cabide")], "INCOMPLETE"),
  ),
  true,
  "2 lojas + cobertura parcial publica",
);

assert.equal(
  isPublicationAllowed(product([offer("SHOPEE", "s1", "Cabide")], "INCOMPLETE")),
  false,
  "singleton incompleto nao publica",
);

assert.equal(
  isPublicationAllowed(product([offer("SHOPEE", "s1", "Cabide")], "COMPLETE")),
  true,
  "singleton completo publica",
);

assert.equal(
  countDistinctMarketplaces([
    offer("SHOPEE", "s1", "A"),
    offer("SHOPEE", "s2", "B"),
  ]),
  1,
  "2 ofertas mesma loja = 1",
);

assert.equal(isSearchVisible(product([offer("SHOPEE", "s1", "Cabide")], "INCOMPLETE")), false);
assert.equal(isClusterPublishable(product([offer("SHOPEE", "s1", "Cabide")], "INCOMPLETE")), false);

const hangerQuery =
  "Kit Cabides Veludo De Roupa Antideslizante Slim Adulto 50 Un";
const hangerIntent = buildQueryIntent(hangerQuery);
const hangerRelevant = scoreQueryRelevance(
  hangerIntent,
  normalizeCandidate({
    marketplace: "SHOPEE",
    marketplaceName: "Shopee",
    externalId: "cabide-1",
    title: "Kit Cabides Veludo De Roupa Antideslizante Slim Adulto 50 Un",
    price: 39,
    url: "https://shopee.example/cabide-1",
    image: "https://img.example/cabide.jpg",
    brand: null,
    category: null,
    seller: null,
    affiliateLink: null,
    attributes: {},
  }),
);
assert.equal(hangerRelevant.status, "RELEVANT", "cabide exato e RELEVANT");

const nutraRejected = scoreQueryRelevance(
  hangerIntent,
  normalizeCandidate({
    marketplace: "SHOPEE",
    marketplaceName: "Shopee",
    externalId: "nutra-1",
    title: "Nutra Senior Diabetics Care Adulto 50 Capsulas",
    price: 79,
    url: "https://shopee.example/nutra-1",
    image: "https://img.example/nutra.jpg",
    brand: null,
    category: null,
    seller: null,
    affiliateLink: null,
    attributes: {},
  }),
);
assert.equal(nutraRejected.status, "REJECTED", "suplemento compartilhando adulto+50 e rejeitado");

const hangerTokens = tokenize(hangerQuery);
assert.equal(extractQuantity(hangerTokens), "50un", "50 un vira quantidade");
assert.equal(
  extractIdentityAnchors(hangerQuery).some((anchor) => anchor.value.includes("adulto50")),
  false,
  "adulto50 nao vira ancora",
);

const modelTokens520 = extractModelTokens(tokenize("fone JBL Tune 520BT preto"));
assert.ok(
  modelTokens520.some((token) => token.includes("520")),
  "520BT continua modelo",
);

const a55Tokens = extractModelTokens(tokenize("Smartphone Samsung Galaxy A55 5G"));
assert.ok(a55Tokens.some((token) => token.includes("55")), "A55 continua modelo");

const anvTokens = extractModelTokens(tokenize("Notebook Acer Nitro ANV15-52"));
assert.ok(anvTokens.some((token) => token.includes("anv15")), "ANV15-52 continua modelo");

const aspiradorQuery =
  "Aspirador de Po e Agua Wap GTW Inox 12 1400W com Bocal de Sopro - 220V";
const aspiradorIntent = buildQueryIntent(aspiradorQuery);
const aspirador220 = scoreQueryRelevance(
  aspiradorIntent,
  normalizeCandidate({
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "asp-220",
    title: "Aspirador De Po E Agua Wap Gtw Inox 12 1400w Bocal Sopro 220v",
    price: 499,
    url: "https://produto.mercadolivre.com.br/MLB-asp-220",
    image: "https://img.example/asp.jpg",
    brand: "Wap",
    category: null,
    seller: null,
    affiliateLink: null,
    attributes: { VOLTAGE: "220V" },
  }),
);
assert.equal(aspirador220.status, "RELEVANT", "aspirador 220V equivalente aceito");

const aspirador127 = scoreQueryRelevance(
  aspiradorIntent,
  normalizeCandidate({
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "asp-127",
    title: "Aspirador De Po E Agua Wap Gtw Inox 12 1400w Bocal Sopro 127v",
    price: 479,
    url: "https://produto.mercadolivre.com.br/MLB-asp-127",
    image: "https://img.example/asp.jpg",
    brand: "Wap",
    category: null,
    seller: null,
    affiliateLink: null,
    attributes: { VOLTAGE: "127V" },
  }),
);
assert.equal(aspirador127.status, "REJECTED", "mesmo aspirador 127V e rejeitado");

console.log("publicationBarrier + relevancia: todos os casos passaram");
