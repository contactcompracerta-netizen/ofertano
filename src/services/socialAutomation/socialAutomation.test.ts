import assert from "node:assert/strict";

import {
  buildEvergreenContent,
  buildPriceContent,
  fallbackPostTypeForSlot,
  fallbackSocialPostType,
  hasComparablePrices,
  nextSocialPostType,
  pricePostTypeForSlot,
  prioritizeUnusedProducts,
} from "./content";
import { getBrazilDateKey } from "./format";
import {
  SOCIAL_POST_SLOTS,
  type ReliableProduct,
  type SocialHistoryEntry,
} from "./types";

const product: ReliableProduct = {
  id: "product-1",
  name: "Fone Bluetooth Ofertano com cancelamento de ruído",
  image: "https://images.example.com/fone.png",
  category: "Eletrônicos",
  offers: [
    {
      id: "offer-a",
      marketplace: "AMAZON",
      label: "Amazon",
      price: 199.9,
      oldPrice: null,
    },
    {
      id: "offer-b",
      marketplace: "SHOPEE",
      label: "Shopee",
      price: 229.9,
      oldPrice: null,
    },
    {
      id: "offer-c",
      marketplace: "MERCADO_LIVRE",
      label: "Mercado Livre",
      price: 249.9,
      oldPrice: 279.9,
    },
  ],
};

const product2: ReliableProduct = {
  ...product,
  id: "product-2",
  name: "Smartwatch Ofertano",
};

const product3: ReliableProduct = {
  ...product,
  id: "product-3",
  name: "Caixa de som Ofertano",
};

const history: SocialHistoryEntry[] = [
  {
    type: "DUEL_PRICE",
    productId: "older-product",
    fingerprint: "abc",
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
  },
];

/*
 * Política estrutural: exatamente três slots por dia.
 */
assert.deepEqual(SOCIAL_POST_SLOTS, [
  "MORNING",
  "AFTERNOON",
  "EVENING",
]);

assert.equal(SOCIAL_POST_SLOTS.length, 3);
assert.equal(new Set(SOCIAL_POST_SLOTS).size, 3);

/*
 * Política editorial dos três horários.
 */
assert.equal(pricePostTypeForSlot("MORNING"), "FOUND_DEAL");
assert.equal(
  pricePostTypeForSlot("AFTERNOON"),
  "PRICE_COMPARISON",
);
assert.equal(pricePostTypeForSlot("EVENING"), "DUEL_PRICE");

assert.equal(
  fallbackPostTypeForSlot("MORNING"),
  "SAVING_TIP",
);
assert.equal(
  fallbackPostTypeForSlot("AFTERNOON"),
  "SHOPPING_CURIOSITY",
);
assert.equal(
  fallbackPostTypeForSlot("EVENING"),
  "ENGAGEMENT_QUESTION",
);

assert.equal(
  new Set(
    SOCIAL_POST_SLOTS.map((slot) =>
      pricePostTypeForSlot(slot),
    ),
  ).size,
  3,
);

/*
 * Rotação: produtos ainda não usados têm prioridade.
 */
const products = [product, product2, product3];

const noProductsUsed = prioritizeUnusedProducts(
  products,
  new Set(),
);

assert.equal(noProductsUsed[0]?.id, "product-1");

const firstProductUsed = prioritizeUnusedProducts(
  products,
  new Set(["product-1"]),
);

assert.equal(firstProductUsed[0]?.id, "product-2");
assert.equal(firstProductUsed[1]?.id, "product-3");
assert.equal(firstProductUsed[2]?.id, "product-1");

const twoProductsUsed = prioritizeUnusedProducts(
  products,
  new Set(["product-1", "product-2"]),
);

assert.equal(twoProductsUsed[0]?.id, "product-3");

/*
 * Regras existentes de rotação e comparação.
 */
assert.equal(nextSocialPostType([]), "DUEL_PRICE");
assert.equal(nextSocialPostType(history), "FOUND_DEAL");
assert.equal(
  fallbackSocialPostType("PRICE_COMPARISON"),
  "SAVING_TIP",
);

assert.equal(hasComparablePrices(product), true);

assert.equal(
  hasComparablePrices({
    ...product,
    offers: product.offers.map((offer) => ({
      ...offer,
      price: 199.9,
    })),
  }),
  false,
);

/*
 * Conteúdo de preço usa somente valores reais recebidos.
 */
const duel = buildPriceContent(
  "DUEL_PRICE",
  product,
  0,
);

assert.equal(duel.type, "DUEL_PRICE");
assert.equal(duel.productId, product.id);
assert.equal(duel.data.template, "DUEL");
assert.equal(duel.data.offers.length, 3);
assert.equal(duel.data.bestOfferId, "offer-a");
assert.equal(duel.data.savings, 50);

assert.match(
  duel.caption,
  /Amazon — R\$\s?199,90/,
);

assert.match(
  duel.caption,
  /Economia possível: R\$\s?50,00/,
);

assert.match(
  duel.caption,
  /Ofertano — Compare preços antes de comprar\./,
);

assert.ok(duel.hashtags.includes("#Ofertano"));

const found = buildPriceContent(
  "FOUND_DEAL",
  product,
  1,
);

assert.equal(found.data.template, "FOUND_DEAL");
assert.equal(
  found.data.comparisonLabel,
  "Maior preço entre lojas",
);
assert.equal(found.data.comparisonPrice, 249.9);
assert.equal(found.data.savings, 50);

const afternoon = buildPriceContent(
  pricePostTypeForSlot("AFTERNOON"),
  product2,
  0,
);

assert.equal(
  afternoon.type,
  "PRICE_COMPARISON",
);

const evening = buildPriceContent(
  pricePostTypeForSlot("EVENING"),
  product3,
  0,
);

assert.equal(
  evening.type,
  "DUEL_PRICE",
);

/*
 * Fallback evergreen nunca fabrica preço.
 */
const engagement = buildEvergreenContent(
  "ENGAGEMENT_QUESTION",
  0,
);

assert.equal(engagement.productId, null);
assert.equal(engagement.data.offers.length, 0);
assert.ok(!engagement.caption.includes("R$"));
assert.match(engagement.caption, /Comente/i);

const morningFallback = buildEvergreenContent(
  fallbackPostTypeForSlot("MORNING"),
  0,
);

const afternoonFallback = buildEvergreenContent(
  fallbackPostTypeForSlot("AFTERNOON"),
  0,
);

const eveningFallback = buildEvergreenContent(
  fallbackPostTypeForSlot("EVENING"),
  0,
);

assert.ok(!morningFallback.caption.includes("R$"));
assert.ok(!afternoonFallback.caption.includes("R$"));
assert.ok(!eveningFallback.caption.includes("R$"));

assert.notEqual(
  morningFallback.type,
  afternoonFallback.type,
);

assert.notEqual(
  afternoonFallback.type,
  eveningFallback.type,
);

/*
 * dayKey usa America/Sao_Paulo.
 *
 * 02:30 UTC ainda corresponde a 23:30 do dia anterior
 * em São Paulo.
 */
assert.equal(
  getBrazilDateKey(
    new Date("2026-09-07T02:30:00.000Z"),
  ),
  "2026-09-06",
);

assert.equal(
  getBrazilDateKey(
    new Date("2026-09-07T12:00:00.000Z"),
  ),
  "2026-09-07",
);

console.log("socialAutomation.test: ok");