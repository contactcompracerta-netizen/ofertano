import {
  normalizeMarketplaceListing,
  type NormalizedMarketplaceListing,
  type RawListingRepository,
} from "./index";
import prisma from "../../lib/prisma";

export type RawMarketplaceListingRow = {
  marketplace: string;
  externalId: string;
  sellerId: string | null;
  sellerName: string | null;
  sourceUrl: string | null;
  affiliateLink: string | null;
  title: string | null;
  normalizedTitle: string | null;
  brand: string | null;
  modelNumber: string | null;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  category: string | null;
  attributes: unknown;
  image: string | null;
  price: number | null;
  oldPrice: number | null;
  stock: number | null;
  available: boolean;
  status: NormalizedMarketplaceListing["status"];
  fingerprint: string | null;
  canonicalProductId: string | null;
  // CATALOG_ARCHITECTURE_V1 (aditivo, shadow OFF): hashes duplos + version.
  catalogHash?: string | null;
  offerHash?: string | null;
  payloadVersion?: string | null;
};

type RawMarketplaceListingDelegate = {
  findUnique(args: unknown): Promise<RawMarketplaceListingRow | null>;
  upsert(args: unknown): Promise<RawMarketplaceListingRow>;
  update(args: unknown): Promise<RawMarketplaceListingRow>;
};

export type PrismaRawListingClient = {
  rawMarketplaceListing: RawMarketplaceListingDelegate;
};

export function createDefaultPrismaRawListingRepository(): RawListingRepository {
  return createPrismaRawListingRepository(prisma);
}

function isSupportedMarketplace(value: string): value is NormalizedMarketplaceListing["marketplace"] {
  return ["MERCADO_LIVRE", "AMAZON", "SHOPEE", "MAGAZINE_LUIZA", "ALIEXPRESS"].includes(value);
}

function toNormalizedListing(row: RawMarketplaceListingRow): NormalizedMarketplaceListing {
  if (!isSupportedMarketplace(row.marketplace)) {
    throw new Error(`Unsupported RawMarketplaceListing marketplace: ${row.marketplace}`);
  }

  return normalizeMarketplaceListing({
    marketplace: row.marketplace,
    externalId: row.externalId,
    sellerId: row.sellerId,
    sellerName: row.sellerName,
    sourceUrl: row.sourceUrl,
    affiliateLink: row.affiliateLink,
    title: row.title,
    normalizedTitle: row.normalizedTitle,
    brand: row.brand,
    modelNumber: row.modelNumber,
    ean: row.ean,
    gtin: row.gtin,
    mpn: row.mpn,
    category: row.category,
    attributes: (row.attributes as Record<string, string> | null) ?? null,
    image: row.image,
    price: row.price,
    oldPrice: row.oldPrice,
    stock: row.stock,
    available: row.available,
    status: row.status,
    fingerprint: row.fingerprint,
    canonicalProductId: row.canonicalProductId,
    catalogHash: row.catalogHash ?? null,
    offerHash: row.offerHash ?? null,
    payloadVersion: row.payloadVersion ?? null,
  });
}

function toPersistenceData(listing: NormalizedMarketplaceListing) {
  return {
    sellerId: listing.sellerId ?? null,
    sellerName: listing.sellerName ?? null,
    sourceUrl: listing.sourceUrl ?? null,
    affiliateLink: listing.affiliateLink ?? null,
    title: listing.title ?? null,
    normalizedTitle: listing.normalizedTitle ?? null,
    brand: listing.brand ?? null,
    modelNumber: listing.modelNumber ?? null,
    ean: listing.ean ?? null,
    gtin: listing.gtin ?? null,
    mpn: listing.mpn ?? null,
    category: listing.category ?? null,
    attributes: listing.attributes ?? null,
    image: listing.image ?? null,
    price: listing.price ?? null,
    oldPrice: listing.oldPrice ?? null,
    stock: listing.stock ?? null,
    available: listing.available ?? true,
    status: listing.status ?? "DISCOVERED",
    fingerprint: listing.fingerprint ?? null,
    canonicalProductId: listing.canonicalProductId ?? null,
    catalogHash: listing.catalogHash ?? null,
    offerHash: listing.offerHash ?? null,
    payloadVersion: listing.payloadVersion ?? null,
  };
}

/**
 * Creates the Prisma-backed implementation without enabling the production
 * flow. Callers decide when this repository is injected into ingestion.
 */
export function createPrismaRawListingRepository(
  prisma: PrismaRawListingClient,
): RawListingRepository {
  return {
    async findListingByMarketplaceExternalId(marketplace, externalId) {
      const row = await prisma.rawMarketplaceListing.findUnique({
        where: {
          marketplace_externalId: {
            marketplace,
            externalId,
          },
        },
      });

      return row ? toNormalizedListing(row) : null;
    },

    async upsertRawMarketplaceListing(listing) {
      const data = toPersistenceData(listing);
      const row = await prisma.rawMarketplaceListing.upsert({
        where: {
          marketplace_externalId: {
            marketplace: listing.marketplace,
            externalId: listing.externalId,
          },
        },
        create: {
          marketplace: listing.marketplace,
          externalId: listing.externalId,
          ...data,
        },
        update: {
          ...data,
          lastSeenAt: new Date(),
        },
      });

      return toNormalizedListing(row);
    },

    async linkListingToProduct(listingId, canonicalProductId, marketplace = "MERCADO_LIVRE") {
      await prisma.rawMarketplaceListing.update({
        where: {
          marketplace_externalId: {
            marketplace,
            externalId: listingId,
          },
        },
        data: {
          canonicalProductId,
        },
      });
    },

    async markListingStale(listingId) {
      await prisma.rawMarketplaceListing.update({
        where: { id: listingId },
        data: {
          status: "STALE",
          active: false,
          lastCheckedAt: new Date(),
        },
      });
    },
  };
}
