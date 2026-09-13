import assert from "node:assert/strict";

import {
  persistRawListingContextIfEnabled,
  type RawListingPersistenceContext,
} from "./saveProduct";
import type { RawListingRepository } from "@/services/catalog-listings";

const context: RawListingPersistenceContext = {
  marketplace: "MERCADO_LIVRE",
  externalId: "MLB-HOOK-TEST",
  sourceUrl: "https://mercadolivre.example/MLB-HOOK-TEST",
  title: "Raw hook test",
  price: 42,
};

function createRepositorySpy() {
  const calls = {
    find: 0,
    upsert: 0,
    link: 0,
  };
  const repository: RawListingRepository = {
    findListingByMarketplaceExternalId: async () => {
      calls.find += 1;
      return null;
    },
    upsertRawMarketplaceListing: async (listing) => {
      calls.upsert += 1;
      return {
        ...listing,
        sellerId: null,
        sellerName: null,
        sourceUrl: listing.sourceUrl ?? null,
        affiliateLink: null,
        title: listing.title ?? null,
        normalizedTitle: null,
        brand: null,
        modelNumber: null,
        ean: null,
        gtin: null,
        mpn: null,
        category: null,
        attributes: null,
        image: null,
        price: listing.price ?? null,
        oldPrice: null,
        stock: null,
        available: true,
        status: "DISCOVERED",
        fingerprint: null,
        canonicalProductId: listing.canonicalProductId ?? null,
      };
    },
    linkListingToProduct: async () => {
      calls.link += 1;
    },
    markListingStale: async () => {},
  };
  return { calls, repository };
}

async function run() {
  const disabled = createRepositorySpy();
  assert.equal(
    await persistRawListingContextIfEnabled(context, "product-1", {
      enabled: false,
      repository: disabled.repository,
    }),
    null,
  );
  assert.deepEqual(disabled.calls, { find: 0, upsert: 0, link: 0 });

  const missing = createRepositorySpy();
  assert.equal(
    await persistRawListingContextIfEnabled(undefined, "product-1", {
      enabled: true,
      repository: missing.repository,
    }),
    null,
  );
  assert.deepEqual(missing.calls, { find: 0, upsert: 0, link: 0 });

  const enabled = createRepositorySpy();
  const result = await persistRawListingContextIfEnabled(
    context,
    "product-42",
    {
      enabled: true,
      repository: enabled.repository,
      canary: {
        allowedMarketplaces: ["MERCADO_LIVRE"],
        allowedExternalIds: ["MLB-HOOK-TEST"],
        maxWrites: 1,
        counter: { current: 0 },
      },
    },
  );
  assert.equal(result?.status, "CREATED");
  assert.deepEqual(enabled.calls, { find: 1, upsert: 1, link: 1 });

  const blocked = createRepositorySpy();
  const blockedResult = await persistRawListingContextIfEnabled(
    {
      ...context,
      marketplace: "AMAZON",
      externalId: "ASIN-BLOCKED",
    },
    "product-42",
    {
      enabled: true,
      repository: blocked.repository,
    },
  );
  assert.equal(blockedResult?.status, "DISABLED");
  assert.deepEqual(blocked.calls, { find: 0, upsert: 0, link: 0 });

  console.log("SAVE_PRODUCT_RAW_HOOK_FLAG_OFF=PASS");
  console.log("SAVE_PRODUCT_RAW_HOOK_MOCK_ON=PASS");
  console.log("SAVE_PRODUCT_RAW_HOOK_SINGLE_CALL=PASS");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
