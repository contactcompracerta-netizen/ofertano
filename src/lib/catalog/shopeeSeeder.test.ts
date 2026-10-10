import assert from "node:assert/strict";

import {
  dedupeShopeeSeedCandidates,
  SHOPEE_CATALOG_KEYWORDS,
  toShopeeProductImport,
  type ShopeeSeedCandidate,
} from "./shopeeSeeder";
import type { ShopeeAffiliateOffer } from "@/services/importers/shopee/api";

const base: ShopeeAffiliateOffer = {
  itemId: 123456789,
  shopId: 998877,
  productName: "Smartphone Samsung Galaxy A55 5G 256GB",
  shopName: "Loja Oficial",
  price: "1899.90",
  priceMin: "1899.90",
  priceMax: "1899.90",
  imageUrl: "https://cf.shopee.com.br/file/example-image",
  productLink: "https://shopee.com.br/product/998877/123456789",
  offerLink: "https://s.shopee.com.br/example-affiliate",
  ratingStar: "4.9",
  sales: 1500,
  priceDiscountRate: 12,
  commissionRate: "0.04",
  commission: "75.99",
  appExistRate: "0.04",
  appNewRate: "0.04",
  webExistRate: "0.04",
  webNewRate: "0.04",
  periodStartTime: 0,
  periodEndTime: 0,
  productCatIds: [100013, 100073],
  shopType: [1],
  sellerCommissionRate: "0",
  shopeeCommissionRate: "0",
};

const product = toShopeeProductImport(base);
assert.ok(product);
assert.equal(product.marketplace, "Shopee");
assert.equal(product.externalId, "123456789");
assert.equal(product.price, 1899.9);
assert.equal(product.affiliateLink, base.offerLink);
assert.equal(product.url, base.productLink);
assert.equal(product.image, base.imageUrl);
assert.equal(product.seller, "Loja Oficial");
assert.equal(product.attributes.SHOP_ID, "998877");

assert.equal(
  toShopeeProductImport({ ...base, price: "0" }),
  null,
  "preço inválido nunca vira seed",
);
assert.equal(
  toShopeeProductImport({ ...base, offerLink: "" }),
  null,
  "sem link afiliado nunca vira seed",
);
assert.equal(
  toShopeeProductImport({ ...base, productLink: "javascript:alert(1)" }),
  null,
  "URL insegura nunca vira seed",
);

const candidate = (id: string): ShopeeSeedCandidate => ({
  externalId: id,
  shopId: "1",
  keyword: "smartphone",
  product: { ...product, externalId: id },
});

const dedupe = dedupeShopeeSeedCandidates([
  candidate("1"),
  candidate("1"),
  candidate("2"),
]);
assert.equal(dedupe.rows.length, 2);
assert.equal(dedupe.duplicates, 1);
assert.ok(SHOPEE_CATALOG_KEYWORDS.length >= 20);

console.log("SHOPEE_CATALOG_SEEDER_TESTS=PASS");
