-- Painel de inteligência / analytics first-party do Ofertano.
-- Modelo genérico de eventos + agregação diária para consultas do Admin.

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
