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

test("enabled dual-write persists sanitized payload fields without leaking secrets", async () => {
  const seen: Record<string, unknown> = {};
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async (listing: ReturnType<typeof normalizeMarketplaceListing>) => {
      seen.marketplace = listing.marketplace;
      seen.externalId = listing.externalId;
      seen.sourceUrl = listing.sourceUrl;
      seen.affiliateLink = listing.affiliateLink;
      seen.price = listing.price;
      seen.title = listing.title;
      return listing;
    },
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({
      marketplace: "MERCADO_LIVRE",
      externalId: "ML-ALLOWED",
      title: "Fone JBL Tune 520BT",
      brand: "JBL",
      category: "Áudio",
      sourceUrl: "https://example.com/listing?token=secret&source=ml",
      affiliateLink: "https://example.com/afiliado?auth=abc&campaign=promo",
      price: 499,
      canonicalProductId: "product-123",
    }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["MERCADO_LIVRE"],
      allowedExternalIds: ["ML-ALLOWED"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "CREATED");
  assert.equal(seen.marketplace, "MERCADO_LIVRE");
  assert.equal(seen.externalId, "ML-ALLOWED");
  assert.equal(seen.title, "Fone JBL Tune 520BT");
  assert.equal(seen.price, 499);
  assert.equal(String(seen.sourceUrl ?? "").includes("token"), false);
  assert.equal(String(seen.affiliateLink ?? "").includes("auth"), false);
});

test("repository failure is isolated and returns an error result instead of breaking legacy flow", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => {
      throw new Error("repository-down");
    },
    upsertRawMarketplaceListing: async () => {
      throw new Error("repository-down");
    },
    linkListingToProduct: async () => undefined,
  };

  await assert.doesNotReject(async () => {
    const result = await persistRawListingIfEnabled({
      listing: normalizeMarketplaceListing({
        marketplace: "AMAZON",
        externalId: "A-FAIL",
        title: "Kindle",
      }),
      repository,
      enabled: true,
      dryRun: false,
      canary: {
        allowedMarketplaces: ["AMAZON"],
        allowedExternalIds: ["A-FAIL"],
        maxWrites: 10,
        counter: { current: 0 },
      },
    });

    assert.equal(result.status, "ERROR");
  });
});

test("global off blocks writes even when the shadow path is otherwise configured", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-GLOBAL-OFF" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-GLOBAL-OFF", title: "Widget" }),
    repository,
    enabled: false,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-GLOBAL-OFF"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "DISABLED");
});

test("flag on without valid canary config blocks writes", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-NO-CANARY" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-NO-CANARY", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: { counter: { current: 0 } },
  });

  assert.equal(result.status, "DISABLED");
});

test("flag on without any canary configuration blocks writes and preserves legacy flow", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-FLAG-ONLY" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-FLAG-ONLY", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(result.reason, "canary-config-invalid");
});

test("marketplace allowlist enforces explicit permission", async () => {
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
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-ALLOW", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-ALLOW"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "CREATED");
  assert.equal(calls.length, 1);
});

test("marketplace deny blocks writes outside the allowlist", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "MERCADO_LIVRE", externalId: "ML-DENY" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "MERCADO_LIVRE", externalId: "ML-DENY", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["ML-DENY"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(result.reason, "canary-marketplace-denied");
});

test("external id allowlist enforces exact match", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-EXACT" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-EXACT", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-EXACT"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "CREATED");
});

test("external id deny blocks unlisted IDs", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DENY" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DENY", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-ALLOW"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(result.reason, "canary-external-id-denied");
});

test("max writes limit caps canary writes within a process", async () => {
  const calls: string[] = [];
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async (listing: ReturnType<typeof normalizeMarketplaceListing>) => {
      calls.push(listing.externalId);
      return listing;
    },
    linkListingToProduct: async () => undefined,
  };

  const counter = { current: 0 };

  const first = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-LIMIT-1", title: "Widget A" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-LIMIT-1", "A-LIMIT-2"],
      maxWrites: 1,
      counter,
    },
  });

  const second = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-LIMIT-2", title: "Widget B" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-LIMIT-1", "A-LIMIT-2"],
      maxWrites: 1,
      counter,
    },
  });

  assert.equal(first.status, "CREATED");
  assert.equal(second.status, "DISABLED");
  assert.equal(second.reason, "canary-max-writes-reached");
  assert.equal(calls.length, 1);
});

test("dry run keeps precedence over every canary permit", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DRY" }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-DRY", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: true,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-DRY"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(result.reason, "dry-run");
});

test("repository failure stays isolated and the legacy flow continues", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => {
      throw new Error("canary-repository-down");
    },
    upsertRawMarketplaceListing: async () => {
      throw new Error("canary-repository-down");
    },
    linkListingToProduct: async () => undefined,
  };

  await assert.doesNotReject(async () => {
    const result = await persistRawListingIfEnabled({
      listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "A-FAIL", title: "Widget" }),
      repository,
      enabled: true,
      dryRun: false,
      canary: {
        allowedMarketplaces: ["AMAZON"],
        allowedExternalIds: ["A-FAIL"],
        maxWrites: 10,
        counter: { current: 0 },
      },
    });

    assert.equal(result.status, "ERROR");
  });
});

test("invalid external ids are rejected before persisting", async () => {
  const repository = {
    findListingByMarketplaceExternalId: async () => null,
    upsertRawMarketplaceListing: async () => normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "   " }),
    linkListingToProduct: async () => undefined,
  };

  const result = await persistRawListingIfEnabled({
    listing: normalizeMarketplaceListing({ marketplace: "AMAZON", externalId: "   ", title: "Widget" }),
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-INVALID"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "REJECTED");
});

test("same marketplace and external id remains idempotent under canary controls", async () => {
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
    externalId: "ML-CANARY-1",
    title: "Fone JBL Tune 520BT",
    brand: "JBL",
    category: "Áudio",
    sourceUrl: "https://example.com/listing?token=secret",
    affiliateLink: "https://example.com/afiliado?auth=abc",
    canonicalProductId: "product-1",
  });

  const first = await persistRawListingIfEnabled({
    listing,
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["MERCADO_LIVRE"],
      allowedExternalIds: ["ML-CANARY-1"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  const second = await persistRawListingIfEnabled({
    listing,
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["MERCADO_LIVRE"],
      allowedExternalIds: ["ML-CANARY-1"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(first.status, "CREATED");
  assert.equal(second.status, "UPDATED");
  assert.equal(calls.length, 2);
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

  const first = await persistRawListingIfEnabled({
    listing,
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["MERCADO_LIVRE"],
      allowedExternalIds: ["ML-123"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });
  const second = await persistRawListingIfEnabled({
    listing,
    repository,
    enabled: true,
    dryRun: false,
    canary: {
      allowedMarketplaces: ["MERCADO_LIVRE"],
      allowedExternalIds: ["ML-123"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

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
    canary: {
      allowedMarketplaces: ["AMAZON"],
      allowedExternalIds: ["A-INVALID"],
      maxWrites: 10,
      counter: { current: 0 },
    },
  });

  assert.equal(result.status, "REJECTED");
});
