import assert from "node:assert/strict";
import test from "node:test";

import {
  buildListingIdentity,
  buildProductSearchDocument,
  linkListingToCanonicalProduct,
  listingFingerprint,
  normalizeMarketplaceListing,
} from "./index";

test("same marketplace and external id share listing identity", () => {
  const left = buildListingIdentity({ marketplace: "AMAZON", externalId: "B07L2XYZ1P" });
  const right = buildListingIdentity({ marketplace: "AMAZON", externalId: "B07L2XYZ1P" });

  assert.deepEqual(left, right);
});

test("different marketplaces produce different listing identity", () => {
  const left = buildListingIdentity({ marketplace: "AMAZON", externalId: "B07L2XYZ1P" });
  const right = buildListingIdentity({ marketplace: "MERCADO_LIVRE", externalId: "B07L2XYZ1P" });

  assert.notDeepEqual(left, right);
});

test("different sellers same marketplace are allowed when externalId differs", () => {
  const first = buildListingIdentity({ marketplace: "MERCADO_LIVRE", externalId: "ML-001", sellerId: "seller-a" });
  const second = buildListingIdentity({ marketplace: "MERCADO_LIVRE", externalId: "ML-002", sellerId: "seller-b" });

  assert.notDeepEqual(first, second);
});

test("normalization preserves brand and model details", () => {
  const normalized = normalizeMarketplaceListing({
    marketplace: "AMAZON",
    externalId: "A-001",
    title: "Samsung Galaxy S21 5G 128GB Preto",
    brand: "Samsung",
    modelNumber: "S21",
  });

  assert.equal(normalized.brand, "Samsung");
  assert.equal(normalized.modelNumber, "S21");
  assert.match(normalized.normalizedTitle ?? "", /samsung|galaxy|s21/);
});

test("search document de-dupes marketplace offers by marketplace", () => {
  const document = buildProductSearchDocument({
    productId: "product-1",
    title: "Notebook Dell Inspiron 15",
    brand: "Dell",
    category: "Eletrônicos",
    marketplaceOffers: [
      { marketplace: "AMAZON", price: 2500 },
      { marketplace: "AMAZON", price: 2700 },
      { marketplace: "MAGAZINE_LUIZA", price: 2900 },
    ],
  });

  assert.equal(document.marketplaceCount, 2);
  assert.equal(document.offerCount, 3);
  assert.equal(document.lowestPrice, 2500);
});

test("canonical linking can keep raw listing unmatched", () => {
  const decision = linkListingToCanonicalProduct({
    listing: normalizeMarketplaceListing({ marketplace: "SHOPEE", externalId: "SH-999" }),
    decision: "UNMATCHED",
  });

  assert.equal(decision.status, "UNMATCHED");
  assert.equal(decision.canonicalProductId, null);
});

test("listing fingerprint remains stable for repeated normalization", () => {
  const input = normalizeMarketplaceListing({
    marketplace: "MERCADO_LIVRE",
    externalId: "ML-777",
    title: "Fone JBL Tune 520BT Preto",
    brand: "JBL",
    modelNumber: "Tune 520BT",
    price: 499,
  });

  const first = listingFingerprint(input);
  const second = listingFingerprint(normalizeMarketplaceListing({
    marketplace: "MERCADO_LIVRE",
    externalId: "ML-777",
    title: "Fone JBL Tune 520BT Preto",
    brand: "JBL",
    modelNumber: "Tune 520BT",
    price: 499,
  }));

  assert.equal(first, second);
});

test("cross-brand canonical match is rejected at the linking layer", () => {
  const decision = linkListingToCanonicalProduct({
    listing: normalizeMarketplaceListing({
      marketplace: "AMAZON",
      externalId: "A-ERR",
      title: "Monitor Acer Predator",
      brand: "Acer",
      modelNumber: "Predator",
    }),
    canonicalProductId: "product-samsung",
    decision: "REJECTED",
  });

  assert.equal(decision.status, "ERROR");
});
