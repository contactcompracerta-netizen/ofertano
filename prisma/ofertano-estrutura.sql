-- CreateEnum
CREATE TYPE "ProductPublicationStatus" AS ENUM ('DRAFT', 'LIVE_PARTIAL', 'LIVE_COMPLETE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketplaceOfferStatus" AS ENUM ('DISCOVERED', 'PENDING_AFFILIATE', 'UNDER_REVIEW', 'ACTIVE', 'UNAVAILABLE', 'ERROR');

-- CreateEnum
CREATE TYPE "ProductMatchStatus" AS ENUM ('EXACT', 'HIGH', 'REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "DiscoverySource" AS ENUM ('MANUAL', 'OPPORTUNITY', 'ON_DEMAND_SEARCH', 'PRICE_MONITOR', 'API');

-- CreateEnum
CREATE TYPE "SearchRequestStatus" AS ENUM ('PENDING', 'SEARCHING', 'PARTIAL', 'COMPLETED', 'NOT_FOUND', 'ERROR');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Marketplace" ADD VALUE 'MAGAZINE_LUIZA';
ALTER TYPE "Marketplace" ADD VALUE 'CASAS_BAHIA';
ALTER TYPE "Marketplace" ADD VALUE 'KABUM';
ALTER TYPE "Marketplace" ADD VALUE 'TERABYTE';
ALTER TYPE "Marketplace" ADD VALUE 'ALIEXPRESS';
ALTER TYPE "Marketplace" ADD VALUE 'CARREFOUR';

-- AlterEnum
ALTER TYPE "OpportunitySourceType" ADD VALUE 'SEARCH_RESULT';

-- DropIndex
DROP INDEX "ProductOpportunity_externalId_key";

-- AlterTable
ALTER TABLE "MarketplaceOffer" ADD COLUMN     "affiliateValidatedAt" TIMESTAMP(3),
ADD COLUMN     "available" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discoverySource" "DiscoverySource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "image" TEXT,
ADD COLUMN     "isBest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastPriceChangeAt" TIMESTAMP(3),
ADD COLUMN     "matchScore" DOUBLE PRECISION,
ADD COLUMN     "matchStatus" "ProductMatchStatus" NOT NULL DEFAULT 'HIGH',
ADD COLUMN     "nextCheckAt" TIMESTAMP(3),
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "seller" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "status" "MarketplaceOfferStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "title" TEXT,
ALTER COLUMN "affiliateLink" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PriceHistory" ADD COLUMN     "marketplace" "Marketplace",
ADD COLUMN     "offerId" TEXT,
ADD COLUMN     "oldPrice" DOUBLE PRECISION,
ADD COLUMN     "source" "DiscoverySource";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "autoCreated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canonicalKey" TEXT,
ADD COLUMN     "canonicalName" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "ean" TEXT,
ADD COLUMN     "gtin" TEXT,
ADD COLUMN     "lastSearchedAt" TIMESTAMP(3),
ADD COLUMN     "modelNumber" TEXT,
ADD COLUMN     "mpn" TEXT,
ADD COLUMN     "publicationStatus" "ProductPublicationStatus" NOT NULL DEFAULT 'LIVE_COMPLETE',
ADD COLUMN     "size" TEXT,
ADD COLUMN     "sourceQuery" TEXT,
ADD COLUMN     "voltage" TEXT;

-- AlterTable
ALTER TABLE "ProductOpportunity" ADD COLUMN     "marketplace" "Marketplace" NOT NULL DEFAULT 'MERCADO_LIVRE',
ADD COLUMN     "matchScore" DOUBLE PRECISION,
ADD COLUMN     "matchStatus" "ProductMatchStatus" NOT NULL DEFAULT 'HIGH',
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "searchRequestId" TEXT;

-- CreateTable
CREATE TABLE "SearchRequest" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "status" "SearchRequestStatus" NOT NULL DEFAULT 'PENDING',
    "productId" TEXT,
    "requesterKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SearchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchRequest_normalizedQuery_status_idx" ON "SearchRequest"("normalizedQuery", "status");

-- CreateIndex
CREATE INDEX "SearchRequest_status_createdAt_idx" ON "SearchRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SearchRequest_productId_createdAt_idx" ON "SearchRequest"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportQueue_marketplace_status_idx" ON "ImportQueue"("marketplace", "status");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_status_updatedAt_idx" ON "MarketplaceOffer"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_matchStatus_updatedAt_idx" ON "MarketplaceOffer"("matchStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_nextCheckAt_active_idx" ON "MarketplaceOffer"("nextCheckAt", "active");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_productId_price_idx" ON "MarketplaceOffer"("productId", "price");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceOffer_marketplace_externalId_key" ON "MarketplaceOffer"("marketplace", "externalId");

-- CreateIndex
CREATE INDEX "PriceHistory_offerId_recordedAt_idx" ON "PriceHistory"("offerId", "recordedAt");

-- CreateIndex
CREATE INDEX "PriceHistory_marketplace_recordedAt_idx" ON "PriceHistory"("marketplace", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_canonicalKey_key" ON "Product"("canonicalKey");

-- CreateIndex
CREATE INDEX "Product_active_updatedAt_idx" ON "Product"("active", "updatedAt");

-- CreateIndex
CREATE INDEX "Product_category_active_idx" ON "Product"("category", "active");

-- CreateIndex
CREATE INDEX "Product_brand_modelNumber_idx" ON "Product"("brand", "modelNumber");

-- CreateIndex
CREATE INDEX "Product_publicationStatus_updatedAt_idx" ON "Product"("publicationStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "ProductOpportunity_marketplace_status_discoveredAt_idx" ON "ProductOpportunity"("marketplace", "status", "discoveredAt");

-- CreateIndex
CREATE INDEX "ProductOpportunity_searchRequestId_discoveredAt_idx" ON "ProductOpportunity"("searchRequestId", "discoveredAt");

-- CreateIndex
CREATE INDEX "ProductOpportunity_matchStatus_discoveredAt_idx" ON "ProductOpportunity"("matchStatus", "discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOpportunity_marketplace_externalId_key" ON "ProductOpportunity"("marketplace", "externalId");

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "MarketplaceOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRequest" ADD CONSTRAINT "SearchRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOpportunity" ADD CONSTRAINT "ProductOpportunity_searchRequestId_fkey" FOREIGN KEY ("searchRequestId") REFERENCES "SearchRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
