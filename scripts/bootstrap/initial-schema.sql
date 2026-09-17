-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('MERCADO_LIVRE', 'AMAZON', 'SHOPEE', 'MAGAZINE_LUIZA', 'CASAS_BAHIA', 'KABUM', 'TERABYTE', 'ALIEXPRESS', 'CARREFOUR');

-- CreateEnum
CREATE TYPE "ProductPublicationStatus" AS ENUM ('DRAFT', 'LIVE_PARTIAL', 'LIVE_COMPLETE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketplaceOfferStatus" AS ENUM ('DISCOVERED', 'PENDING_AFFILIATE', 'UNDER_REVIEW', 'ACTIVE', 'UNAVAILABLE', 'ERROR');

-- CreateEnum
CREATE TYPE "ProductMatchStatus" AS ENUM ('EXACT', 'HIGH', 'REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "DiscoverySource" AS ENUM ('MANUAL', 'OPPORTUNITY', 'ON_DEMAND_SEARCH', 'PRICE_MONITOR', 'API');

-- CreateEnum
CREATE TYPE "PriceAlertType" AS ENUM ('ANY_DROP', 'TARGET');

-- CreateEnum
CREATE TYPE "SearchRequestStatus" AS ENUM ('PENDING', 'SEARCHING', 'PARTIAL', 'COMPLETED', 'NOT_FOUND', 'ERROR');

-- CreateEnum
CREATE TYPE "RawListingStatus" AS ENUM ('DISCOVERED', 'NORMALIZED', 'MATCHED', 'UNMATCHED', 'STALE', 'ARCHIVED', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportQueueStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "OpportunitySourceType" AS ENUM ('PRODUCT', 'ITEM', 'USER_PRODUCT', 'SEARCH_RESULT');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('WAITING_AFFILIATE', 'READY_TO_QUEUE', 'QUEUED', 'PUBLISHED', 'DISMISSED', 'ERROR');

-- CreateEnum
CREATE TYPE "BlogPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SocialPostType" AS ENUM ('DUEL_PRICE', 'FOUND_DEAL', 'PRICE_COMPARISON', 'SAVING_TIP', 'ENGAGEMENT_QUESTION', 'SHOPPING_CURIOSITY');

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('READY', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SocialPostSlot" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "mlId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "image" TEXT NOT NULL,
    "images" TEXT[],
    "video" TEXT,
    "brand" TEXT,
    "description" TEXT,
    "specifications" JSONB,
    "category" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "affiliateLink" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "oldPrice" DOUBLE PRECISION,
    "installments" TEXT,
    "discount" INTEGER,
    "rating" DOUBLE PRECISION,
    "reviews" INTEGER,
    "sales" INTEGER,
    "stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "canonicalName" TEXT,
    "canonicalKey" TEXT,
    "modelNumber" TEXT,
    "ean" TEXT,
    "gtin" TEXT,
    "mpn" TEXT,
    "color" TEXT,
    "voltage" TEXT,
    "size" TEXT,
    "publicationStatus" "ProductPublicationStatus" NOT NULL DEFAULT 'LIVE_COMPLETE',
    "autoCreated" BOOLEAN NOT NULL DEFAULT false,
    "sourceQuery" TEXT,
    "lastSearchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "MarketplaceOffer" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "externalId" TEXT,
    "sourceUrl" TEXT,
    "affiliateLink" TEXT,
    "title" TEXT,
    "image" TEXT,
    "seller" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "oldPrice" DOUBLE PRECISION,
    "installments" TEXT,
    "stock" INTEGER,
    "status" "MarketplaceOfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "matchStatus" "ProductMatchStatus" NOT NULL DEFAULT 'HIGH',
    "matchScore" DOUBLE PRECISION,
    "discoverySource" "DiscoverySource" NOT NULL DEFAULT 'MANUAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "isBest" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "errorMessage" TEXT,
    "affiliateValidatedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "lastPriceChangeAt" TIMESTAMP(3),
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceConnection" (
    "id" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "sellerId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "offerId" TEXT,
    "marketplace" "Marketplace",
    "price" DOUBLE PRECISION NOT NULL,
    "oldPrice" DOUBLE PRECISION,
    "source" "DiscoverySource",
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "alertType" "PriceAlertType" NOT NULL DEFAULT 'ANY_DROP',
    "targetPrice" DOUBLE PRECISION,
    "referencePrice" DOUBLE PRECISION NOT NULL,
    "lowestSeenPrice" DOUBLE PRECISION,
    "percentageDrop" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyWhatsApp" BOOLEAN NOT NULL DEFAULT false,
    "lastEmailNotifiedPrice" DOUBLE PRECISION,
    "lastEmailNotifiedAt" TIMESTAMP(3),
    "lastWhatsAppNotifiedPrice" DOUBLE PRECISION,
    "lastWhatsAppNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "ImportQueue" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "status" "ImportQueueStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "productId" TEXT,
    "affiliateLink" TEXT,
    "opportunityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ImportQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOpportunity" (
    "id" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL DEFAULT 'MERCADO_LIVRE',
    "externalId" TEXT NOT NULL,
    "sourceType" "OpportunitySourceType" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "price" DOUBLE PRECISION,
    "oldPrice" DOUBLE PRECISION,
    "discount" INTEGER,
    "affiliateLink" TEXT,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'WAITING_AFFILIATE',
    "matchStatus" "ProductMatchStatus" NOT NULL DEFAULT 'HIGH',
    "matchScore" DOUBLE PRECISION,
    "reviewReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "productId" TEXT,
    "searchRequestId" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "queuedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "ProductOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "slot" "SocialPostSlot" NOT NULL,
    "type" "SocialPostType" NOT NULL,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'READY',
    "productId" TEXT,
    "caption" TEXT NOT NULL,
    "hashtags" TEXT[],
    "data" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'Ofertano',
    "readingTime" TEXT NOT NULL DEFAULT '5 min de leitura',
    "theme" TEXT NOT NULL DEFAULT 'emerald',
    "coverImage" TEXT,
    "sections" JSONB NOT NULL,
    "status" "BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "socialCaption" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "AdminPushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPushDispatch" (
    "id" TEXT NOT NULL,
    "opportunityKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPushDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_mlId_key" ON "Product"("mlId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

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
CREATE INDEX "RawMarketplaceListing_canonicalProductId_updatedAt_idx" ON "RawMarketplaceListing"("canonicalProductId", "updatedAt");

-- CreateIndex
CREATE INDEX "RawMarketplaceListing_marketplace_active_idx" ON "RawMarketplaceListing"("marketplace", "active");

-- CreateIndex
CREATE INDEX "RawMarketplaceListing_lastCheckedAt_idx" ON "RawMarketplaceListing"("lastCheckedAt");

-- CreateIndex
CREATE INDEX "RawMarketplaceListing_brand_modelNumber_idx" ON "RawMarketplaceListing"("brand", "modelNumber");

-- CreateIndex
CREATE INDEX "RawMarketplaceListing_fingerprint_idx" ON "RawMarketplaceListing"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "RawMarketplaceListing_marketplace_externalId_key" ON "RawMarketplaceListing"("marketplace", "externalId");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_status_updatedAt_idx" ON "MarketplaceOffer"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_matchStatus_updatedAt_idx" ON "MarketplaceOffer"("matchStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_nextCheckAt_active_idx" ON "MarketplaceOffer"("nextCheckAt", "active");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_productId_price_idx" ON "MarketplaceOffer"("productId", "price");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceOffer_productId_marketplace_key" ON "MarketplaceOffer"("productId", "marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceOffer_marketplace_externalId_key" ON "MarketplaceOffer"("marketplace", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceConnection_marketplace_key" ON "MarketplaceConnection"("marketplace");

-- CreateIndex
CREATE INDEX "PriceHistory_productId_recordedAt_idx" ON "PriceHistory"("productId", "recordedAt");

-- CreateIndex
CREATE INDEX "PriceHistory_offerId_recordedAt_idx" ON "PriceHistory"("offerId", "recordedAt");

-- CreateIndex
CREATE INDEX "PriceHistory_marketplace_recordedAt_idx" ON "PriceHistory"("marketplace", "recordedAt");

-- CreateIndex
CREATE INDEX "PriceAlert_productId_active_idx" ON "PriceAlert"("productId", "active");

-- CreateIndex
CREATE INDEX "PriceAlert_active_updatedAt_idx" ON "PriceAlert"("active", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceAlert_userId_productId_key" ON "PriceAlert"("userId", "productId");

-- CreateIndex
CREATE INDEX "SearchRequest_normalizedQuery_status_idx" ON "SearchRequest"("normalizedQuery", "status");

-- CreateIndex
CREATE INDEX "SearchRequest_status_createdAt_idx" ON "SearchRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SearchRequest_productId_createdAt_idx" ON "SearchRequest"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportQueue_url_key" ON "ImportQueue"("url");

-- CreateIndex
CREATE UNIQUE INDEX "ImportQueue_opportunityId_key" ON "ImportQueue"("opportunityId");

-- CreateIndex
CREATE INDEX "ImportQueue_status_createdAt_idx" ON "ImportQueue"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportQueue_marketplace_status_idx" ON "ImportQueue"("marketplace", "status");

-- CreateIndex
CREATE INDEX "ProductOpportunity_status_discoveredAt_idx" ON "ProductOpportunity"("status", "discoveredAt");

-- CreateIndex
CREATE INDEX "ProductOpportunity_categoryId_discoveredAt_idx" ON "ProductOpportunity"("categoryId", "discoveredAt");

-- CreateIndex
CREATE INDEX "ProductOpportunity_marketplace_status_discoveredAt_idx" ON "ProductOpportunity"("marketplace", "status", "discoveredAt");

-- CreateIndex
CREATE INDEX "ProductOpportunity_searchRequestId_discoveredAt_idx" ON "ProductOpportunity"("searchRequestId", "discoveredAt");

-- CreateIndex
CREATE INDEX "ProductOpportunity_matchStatus_discoveredAt_idx" ON "ProductOpportunity"("matchStatus", "discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOpportunity_marketplace_externalId_key" ON "ProductOpportunity"("marketplace", "externalId");

-- CreateIndex
CREATE INDEX "SocialPost_status_createdAt_idx" ON "SocialPost"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SocialPost_productId_createdAt_idx" ON "SocialPost"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialPost_fingerprint_idx" ON "SocialPost"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_dayKey_slot_key" ON "SocialPost"("dayKey", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_slug_key" ON "BlogPost"("slug");

-- CreateIndex
CREATE INDEX "BlogPost_status_publishedAt_idx" ON "BlogPost"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "BlogPost_status_scheduledAt_idx" ON "BlogPost"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "BlogPost_featured_status_idx" ON "BlogPost"("featured", "status");

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
CREATE UNIQUE INDEX "AnalyticsDailyAgg_day_grain_eventType_dimensionKey_key" ON "AnalyticsDailyAgg"("day", "grain", "eventType", "dimensionKey");

-- CreateIndex
CREATE INDEX "AnalyticsSessionDay_day_idx" ON "AnalyticsSessionDay"("day");

-- CreateIndex
CREATE INDEX "AnalyticsSessionDay_source_day_idx" ON "AnalyticsSessionDay"("source", "day");

-- CreateIndex
CREATE INDEX "AnalyticsSessionDay_deviceType_day_idx" ON "AnalyticsSessionDay"("deviceType", "day");

-- CreateIndex
CREATE INDEX "AnalyticsSessionDay_utmSource_utmMedium_utmCampaign_day_idx" ON "AnalyticsSessionDay"("utmSource", "utmMedium", "utmCampaign", "day");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSessionDay_sessionId_day_key" ON "AnalyticsSessionDay"("sessionId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPushSubscription_endpoint_key" ON "AdminPushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "AdminPushSubscription_lastSeenAt_idx" ON "AdminPushSubscription"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPushDispatch_opportunityKey_key" ON "AdminPushDispatch"("opportunityKey");

-- CreateIndex
CREATE INDEX "AdminPushDispatch_sentAt_idx" ON "AdminPushDispatch"("sentAt");

-- AddForeignKey
ALTER TABLE "RawMarketplaceListing" ADD CONSTRAINT "RawMarketplaceListing_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "MarketplaceOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRequest" ADD CONSTRAINT "SearchRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOpportunity" ADD CONSTRAINT "ProductOpportunity_searchRequestId_fkey" FOREIGN KEY ("searchRequestId") REFERENCES "SearchRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve the historical NOT NULL invariant for this required Prisma array.
ALTER TABLE "SocialPost" ALTER COLUMN "hashtags" SET NOT NULL;
