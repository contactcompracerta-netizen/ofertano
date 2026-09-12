import assert from "node:assert/strict";
import test from "node:test";

import {
  buildListingIdentity,
  buildProductSearchDocument,
  isRawListingDualWriteEnabled,
  linkListingToCanonicalProduct,
  listingFingerprint,
  normalizeMarketplaceListing,
  persistRawListingIfEnabled,
  sanitizeRawListingPayload,
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

test("raw listing dual-write flag is fail-closed and accepts explicit truthy values", () => {
  assert.equal(isRawListingDualWriteEnabled({}), false);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "false" }), false);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "0" }), false);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "no" }), false);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "true" }), true);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "1" }), true);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "yes" }), true);
  assert.equal(isRawListingDualWriteEnabled({ RAW_LISTING_DUAL_WRITE_ENABLED: "maybe" }), false);
});

test("dry-run overrides the dual-write flag and never persists", async () => {
  const calls: string[] = [];
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async (listing: ReturnType<typeof normalizeMarketplaceListing>) => {
      calls.push(`${listing.marketplace}:${listing.externalId}`);
      return listing;
    },
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({
      marketplace: "AMAZON",
      externalId: "A-DRY",
      title: "Monitor Samsung Odyssey",
      brand: "Samsung",
      category: "Eletrônicos",
    }),
    repository,
    enabled: true,
    dryRun: true,
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(calls.length, 0);
});

test("enabled dual-write persists idempotently for the same marketplace and external id", async () => {
  const calls: Array<{ marketplace: string; externalId: string }> = [];
  const repository = {
    findListingByMarketplaceExternalId: async (marketplace: string, externalId: string) => {
      const match = calls.find((entry) => entry.marketplace === marketplace && entry.externalId === externalId);
      return match ? normalizeMarketplaceListing({ marketplace: marketplace as any, externalId, title: "Existing", brand: "BrandX" }) : null;
    },
    upsertRawMarketplaceListing: async (listing: ReturnType<typeof normalizeMarketplaceListing>) => {
      calls.push({ marketplace: listing.marketplace, externalId: listing.externalId });
      return listing;
    },
    linkListingToProduct: async () => undefined,
  };

  const listing = normalizeMarketplaceListing({
    marketplace: "MERCADO_LIVRE",
    externalId: "ML-123",
    title: "Fone JBL Tune 520BT",
    brand: "JBL",
    category: "Áudio",
    sourceUrl: "https://example.com/listing?token=secret",
    affiliateLink: "https://example.com/afiliado?auth=abc",
    canonicalProductId: "product-1",
  });

  const first = await persistRawListingIfEnabled({ listing, repository, enabled: true, dryRun: false });
  const second = await persistRawListingIfEnabled({ listing, repository, enabled: true, dryRun: false });

  assert.equal(first.status, "CREATED");
  assert.equal(second.status, "UPDATED");
  assert.equal(calls.length >= 2, true);
  assert.equal(sanitizeRawListingPayload(listing).sourceUrl?.includes("token"), false);
  assert.equal(sanitizeRawListingPayload(listing).affiliateLink?.includes("auth"), false);
});

test("invalid listing is rejected before write attempt", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "x" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "   ", title: "Offer" }),
    repository,
    enabled: true,
    dryRun: false,
  });

  assert.equal(result.status, "REJECTED");
});
