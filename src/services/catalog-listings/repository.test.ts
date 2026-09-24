import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultPrismaRawListingRepository,
  createPrismaRawListingRepository,
  type RawMarketplaceListingRow,
} from "./repository";
import type {
  MarketplaceListingMarket,
  NormalizedMarketplaceListing,
} from "./index";

const marketplace: MarketplaceListingMarket = "MERCADO_LIVRE";

const row: RawMarketplaceListingRow = {
  marketplace,
  externalId: "MLB7184373436",
  sellerId: null,
  sellerName: "Seller",
  sourceUrl: "https://produto.mercadolivre.com.br/MLB-7184373436",
  affiliateLink: null,
  title: "Produto de teste",
  normalizedTitle: "produto de teste",
  brand: "Marca",
  modelNumber: null,
  ean: null,
  gtin: null,
  mpn: null,
  category: "Categoria",
  attributes: { color: "black" },
  image: null,
  price: 12.5,
  oldPrice: null,
  stock: 1,
  available: true,
  status: "MATCHED",
  fingerprint: "fingerprint",
  canonicalProductId: "48fabfff-c918-4265-b26a-6573006620f6",
};

function createFakePrisma() {
  const calls: { method: string; args: unknown }[] = [];

  return {
    calls,
    rawMarketplaceListing: {
      async findUnique(args: unknown): Promise<RawMarketplaceListingRow | null> {
        calls.push({ method: "findUnique", args });
        return null;
      },
      async upsert(args: unknown) {
        calls.push({ method: "upsert", args });
        return row;
      },
      async update(args: unknown) {
        calls.push({ method: "update", args });
        return row;
      },
    },
  };
}

test("find returns null when the composite key does not exist", async () => {
  const prisma = createFakePrisma();
  const repository = createPrismaRawListingRepository(prisma);

  const result = await repository.findListingByMarketplaceExternalId("MERCADO_LIVRE", row.externalId);

  assert.equal(result, null);
  assert.deepEqual(prisma.calls[0], {
    method: "findUnique",
    args: {
      where: {
        marketplace_externalId: {
          marketplace: "MERCADO_LIVRE",
          externalId: row.externalId,
        },
      },
    },
  });
});

test("find maps an existing row without changing identity or product link", async () => {
  const prisma = createFakePrisma();
  prisma.rawMarketplaceListing.findUnique = async (args: unknown) => {
    prisma.calls.push({ method: "findUnique", args });
    return row;
  };
  const repository = createPrismaRawListingRepository(prisma);

  const result = await repository.findListingByMarketplaceExternalId("MERCADO_LIVRE", row.externalId);

  assert.equal(result?.marketplace, row.marketplace);
  assert.equal(result?.externalId, row.externalId);
  assert.equal(result?.canonicalProductId, row.canonicalProductId);
  assert.equal(result?.sourceUrl, row.sourceUrl);
});

test("upsert preserves the composite key and maps create/update data", async () => {
  const prisma = createFakePrisma();
  const repository = createPrismaRawListingRepository(prisma);
  const listing: NormalizedMarketplaceListing = {
    marketplace,
    externalId: row.externalId,
    sourceUrl: row.sourceUrl,
    title: row.title,
    brand: row.brand,
    category: row.category,
    attributes: row.attributes as Record<string, string>,
    price: row.price,
    stock: row.stock,
    available: row.available,
    status: row.status,
    fingerprint: row.fingerprint,
    canonicalProductId: row.canonicalProductId,
  };

  const result = await repository.upsertRawMarketplaceListing({
    ...listing,
    sellerId: row.sellerId,
    sellerName: row.sellerName,
    affiliateLink: row.affiliateLink,
    oldPrice: row.oldPrice,
    image: row.image,
    modelNumber: row.modelNumber,
    ean: row.ean,
    gtin: row.gtin,
    mpn: row.mpn,
  });

  const call = prisma.calls[0];
  assert.equal(call.method, "upsert");
  const args = call.args as {
    where: { marketplace_externalId: { marketplace: string; externalId: string } };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
  assert.deepEqual(args.where.marketplace_externalId, {
    marketplace: row.marketplace,
    externalId: row.externalId,
  });
  assert.equal(args.create.marketplace, row.marketplace);
  assert.equal(args.create.externalId, row.externalId);
  assert.equal(args.create.canonicalProductId, row.canonicalProductId);
  assert.equal(args.create.sourceUrl, row.sourceUrl);
  assert.equal(args.update.canonicalProductId, row.canonicalProductId);
  assert.equal(args.update.marketplace, undefined);
  assert.equal(result.canonicalProductId, row.canonicalProductId);
});

test("linkListingToProduct updates only the explicit composite identity", async () => {
  const prisma = createFakePrisma();
  const repository = createPrismaRawListingRepository(prisma);

  await repository.linkListingToProduct(row.externalId, row.canonicalProductId!, marketplace);

  assert.deepEqual(prisma.calls[0], {
    method: "update",
    args: {
      where: {
        marketplace_externalId: {
          marketplace: "MERCADO_LIVRE",
          externalId: row.externalId,
        },
      },
      data: {
        canonicalProductId: row.canonicalProductId,
      },
    },
  });
});

test("markListingStale updates only the explicit row id", async () => {
  const prisma = createFakePrisma();
  const repository = createPrismaRawListingRepository(prisma);

  await repository.markListingStale("raw-listing-id");

  const call = prisma.calls[0];
  assert.equal(call.method, "update");
  const args = call.args as {
    where: { id: string };
    data: { status: string; active: boolean; lastCheckedAt: Date };
  };
  assert.deepEqual(args.where, { id: "raw-listing-id" });
  assert.equal(args.data.status, "STALE");
  assert.equal(args.data.active, false);
  assert.ok(args.data.lastCheckedAt instanceof Date);
});

test("Prisma errors propagate and the repository does not retry", async () => {
  const prisma = createFakePrisma();
  let calls = 0;
  prisma.rawMarketplaceListing.upsert = async () => {
    calls += 1;
    throw new Error("prisma-error");
  };
  const repository = createPrismaRawListingRepository(prisma);

  await assert.rejects(
    repository.upsertRawMarketplaceListing({
      marketplace,
      externalId: row.externalId,
    }),
    /prisma-error/,
  );
  assert.equal(calls, 1);
});

test("default factory uses the official Prisma singleton without executing a query", () => {
  const repository = createDefaultPrismaRawListingRepository();

  assert.equal(typeof repository.findListingByMarketplaceExternalId, "function");
  assert.equal(typeof repository.upsertRawMarketplaceListing, "function");
});
