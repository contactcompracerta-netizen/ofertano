-- CreateEnum
CREATE TYPE "RawListingStatus" AS ENUM ('DISCOVERED', 'NORMALIZED', 'MATCHED', 'UNMATCHED', 'STALE', 'ARCHIVED', 'ERROR');

-- CreateTable
CREATE TABLE "RawMarketplaceListing" (
    "id" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "externalId" TEXT NOT NULL,
    "sellerId" TEXT,
    "sellerName" TEXT,
    "sourceUrl" TEXT,
    "affiliateLink" TEXT,
    "title" TEXT,
    "normalizedTitle" TEXT,
    "brand" TEXT,
    "modelNumber" TEXT,
    "ean" TEXT,
    "gtin" TEXT,
    "mpn" TEXT,
    "category" TEXT,
    "attributes" JSONB,
    "rawPayload" JSONB,
    "image" TEXT,
    "price" DOUBLE PRECISION,
    "oldPrice" DOUBLE PRECISION,
    "stock" INTEGER,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "status" "RawListingStatus" NOT NULL DEFAULT 'DISCOVERED',
    "fingerprint" TEXT,
    "canonicalProductId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawMarketplaceListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawMarketplaceListing_canonicalProductId_updatedAt_idx"
    ON "RawMarketplaceListing"("canonicalProductId", "updatedAt");

-- CreateIndex
CREATE INDEX "RawMarketplaceListing_marketplace_active_idx"
    ON "RawMarketplaceListing"("marketplace", "active");

-- CreateIndex
CREATE INDEX "RawMarketplaceListing_lastCheckedAt_idx"
    ON "RawMarketplaceListing"("lastCheckedAt");

-- CreateIndex
CREATE INDEX "RawMarketplaceListing_brand_modelNumber_idx"
    ON "RawMarketplaceListing"("brand", "modelNumber");

-- CreateIndex
CREATE INDEX "RawMarketplaceListing_fingerprint_idx"
    ON "RawMarketplaceListing"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "RawMarketplaceListing_marketplace_externalId_key"
    ON "RawMarketplaceListing"("marketplace", "externalId");

-- AddForeignKey
ALTER TABLE "RawMarketplaceListing"
    ADD CONSTRAINT "RawMarketplaceListing_canonicalProductId_fkey"
    FOREIGN KEY ("canonicalProductId") REFERENCES "Product"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
