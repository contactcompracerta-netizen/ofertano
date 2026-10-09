-- CATALOG_WAVE1 — staging aditivo da pipeline AWIN (FASE D).
-- Migration 100% aditiva: cria APENAS tabela nova + índices.
-- Não altera nenhuma tabela/coluna/constraint existente.
-- Rollback: DROP TABLE "CatalogImportStagingItem";
CREATE TABLE "CatalogImportStagingItem" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "affiliateNetwork" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "gtin" TEXT,
    "mpn" TEXT,
    "model" TEXT,
    "category" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL,
    "imageUrl" TEXT,
    "destinationUrl" TEXT,
    "affiliateUrl" TEXT,
    "attributes" JSONB,
    "validationStatus" TEXT NOT NULL,
    "identityLevel" TEXT NOT NULL,
    "matchCandidateProductId" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "decision" TEXT NOT NULL,
    "reasonCodes" TEXT[],
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogImportStagingItem_pkey" PRIMARY KEY ("id")
);

-- Idempotência do staging: mesma fonte+merchant+externalId => uma linha (upsert).
CREATE UNIQUE INDEX "CatalogImportStagingItem_source_merchant_externalId_key" ON "CatalogImportStagingItem"("source", "merchant", "externalId");
CREATE INDEX "CatalogImportStagingItem_merchant_decision_idx" ON "CatalogImportStagingItem"("merchant", "decision");
CREATE INDEX "CatalogImportStagingItem_validationStatus_identityLevel_idx" ON "CatalogImportStagingItem"("validationStatus", "identityLevel");
