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

-- Analytics / inteligência (eventos genéricos + agregação diária)

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT,
    "query" TEXT,
    "marketplace" TEXT,
    "position" INTEGER,
    "resultCount" INTEGER,
    "source" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "deviceType" TEXT,
    "eventHash" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyAgg" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "grain" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "query" TEXT,
    "productId" TEXT,
    "marketplace" TEXT,
    "source" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "deviceType" TEXT,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "resultCountSum" INTEGER NOT NULL DEFAULT 0,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsDailyAgg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSessionDay" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "source" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "deviceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSessionDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_eventHash_key" ON "AnalyticsEvent"("eventHash");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventType_createdAt_idx" ON "AnalyticsEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_productId_createdAt_idx" ON "AnalyticsEvent"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_query_createdAt_idx" ON "AnalyticsEvent"("query", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_marketplace_createdAt_idx" ON "AnalyticsEvent"("marketplace", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_sessionId_createdAt_idx" ON "AnalyticsEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDailyAgg_day_grain_eventType_dimensionKey_key" ON "AnalyticsDailyAgg"("day", "grain", "eventType", "dimensionKey");

-- CreateIndex
CREATE INDEX "AnalyticsDailyAgg_grain_eventType_day_idx" ON "AnalyticsDailyAgg"("grain", "eventType", "day");

-- CreateIndex
CREATE INDEX "AnalyticsDailyAgg_productId_day_idx" ON "AnalyticsDailyAgg"("productId", "day");

-- CreateIndex
CREATE INDEX "AnalyticsDailyAgg_query_day_idx" ON "AnalyticsDailyAgg"("query", "day");

-- CreateIndex
CREATE INDEX "AnalyticsDailyAgg_marketplace_day_idx" ON "AnalyticsDailyAgg"("marketplace", "day");

-- CreateIndex
CREATE INDEX "AnalyticsDailyAgg_source_day_idx" ON "AnalyticsDailyAgg"("source", "day");

-- CreateIndex
CREATE INDEX "AnalyticsDailyAgg_deviceType_day_idx" ON "AnalyticsDailyAgg"("deviceType", "day");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSessionDay_sessionId_day_key" ON "AnalyticsSessionDay"("sessionId", "day");

-- CreateIndex
CREATE INDEX "AnalyticsSessionDay_day_idx" ON "AnalyticsSessionDay"("day");

-- CreateIndex
CREATE INDEX "AnalyticsSessionDay_source_day_idx" ON "AnalyticsSessionDay"("source", "day");

-- CreateIndex
CREATE INDEX "AnalyticsSessionDay_deviceType_day_idx" ON "AnalyticsSessionDay"("deviceType", "day");

-- CreateIndex
CREATE INDEX "AnalyticsSessionDay_utmSource_utmMedium_utmCampaign_day_idx" ON "AnalyticsSessionDay"("utmSource", "utmMedium", "utmCampaign", "day");
