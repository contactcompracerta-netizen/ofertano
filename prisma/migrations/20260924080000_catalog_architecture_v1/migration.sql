-- CATALOG_ARCHITECTURE_V1 — FASE S (aditivo, additive-first).
-- 1) Colunas nullable em RawMarketplaceListing (catalogHash/offerHash/payloadVersion)
--    para o DOUBLE HASH (FASE G) e RAW REPROCESSABLE (FASE I).
-- 2) Tabelas ImportRun/ImportBatch (FASE J/K) para ingestão em volume e
--    reconciliação por FULL SNAPSHOT com grace period.
-- Regras: somente CREATE TYPE / CREATE TABLE / ADD COLUMN nullable / ADD INDEX.
-- Nenhum DROP, RENAME, TRUNCATE, backfill ou mudança de tipo.

-- Additive columns on RawMarketplaceListing
ALTER TABLE "RawMarketplaceListing" ADD COLUMN "catalogHash" TEXT;
ALTER TABLE "RawMarketplaceListing" ADD COLUMN "offerHash" TEXT;
ALTER TABLE "RawMarketplaceListing" ADD COLUMN "payloadVersion" TEXT;

-- CreateEnum
CREATE TYPE "ImportRunMode" AS ENUM ('FULL_SNAPSHOT', 'INCREMENTAL', 'REPROCESS');

-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "marketplaceId" TEXT,
    "mode" "ImportRunMode" NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemsReceived" INTEGER NOT NULL DEFAULT 0,
    "itemsChanged" INTEGER NOT NULL DEFAULT 0,
    "itemsUnchanged" INTEGER NOT NULL DEFAULT 0,
    "itemsRejected" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 1440,
    "cursor" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PENDING',
    "cursorStart" TEXT,
    "cursorEnd" TEXT,
    "itemsReceived" INTEGER NOT NULL DEFAULT 0,
    "itemsChanged" INTEGER NOT NULL DEFAULT 0,
    "itemsUnchanged" INTEGER NOT NULL DEFAULT 0,
    "itemsRejected" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportRun_source_marketplaceId_startedAt_idx" ON "ImportRun"("source", "marketplaceId", "startedAt");

-- CreateIndex
CREATE INDEX "ImportRun_status_startedAt_idx" ON "ImportRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "ImportBatch_status_startedAt_idx" ON "ImportBatch"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_runId_index_key" ON "ImportBatch"("runId", "index");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;