-- CATALOG_ARCHITECTURE_V1 — FASE 8.3B: CandidateBlockingKey (derivadas).
--
-- ADITIVA. Somente CREATE TYPE / CREATE TABLE / CREATE INDEX / CONSTRAINT.
-- Nenhum DROP, TRUNCATE, DELETE, RENAME ou ALTER destrutivo.
-- Nenhuma coluna nova em Product, MarketplaceOffer, PriceHistory ou
-- RawMarketplaceListing: a tabela abaixo e SO o indice de blocking.
--
-- POR QUE NAO APROVEITAR ProductIdentifier (que ja existe e ja e indexado):
--   ProductIdentifier e a tabela de IDENTIDADE. O enum dela contem apenas
--   identificadores (GTIN|EAN|UPC|ISBN|MPN|MODEL|BRAND_SKU|
--   MARKETPLACE_EXTERNAL_ID) e cada linha carrega `confidence`. Ela AFIRMA
--   identidade.
--
--   Uma assinatura derivada de titulo nao afirma identidade: e HIPOTESE de
--   blocking. Misturar as duas criaria um caminho em que, no futuro,
--   alguem lesse "MODEL_CODE:iphone" (extraido de um titulo) como se fosse
--   identificador confiavel. A separacao fisica e o que garante que
--   PERSISTIR uma chave derivada nunca concede autoridade a ela.
--
--   Persistencia melhora LOOKUP. Nunca melhora CONFIDENCE.
--
-- O indice (keyType, normalizedValue) e o caminho de producao do candidate
-- generation: NENHUM scan cartesiano de Product, NENHUM LIKE '%token%'.

-- CreateEnum
CREATE TYPE "CandidateBlockingKeyType" AS ENUM ('GTIN', 'EAN', 'UPC', 'MPN', 'MANUFACTURER_MODEL', 'BRAND_CATEGORY_MODEL', 'BRAND_MODEL_SIGNATURE', 'MODEL_CODE');

-- CreateEnum
CREATE TYPE "CandidateBlockingKeyStrength" AS ENUM ('STRONG', 'MEDIUM');

-- CreateEnum
CREATE TYPE "CandidateBlockingProvenance" AS ENUM ('STRUCTURED_FIELD', 'TITLE_EXTRACTED', 'CANONICAL_DERIVED');

-- CreateTable
CREATE TABLE "CandidateBlockingKey" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "keyType" "CandidateBlockingKeyType" NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "strength" "CandidateBlockingKeyStrength" NOT NULL,
    "provenance" "CandidateBlockingProvenance" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "sourceMarketplace" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CandidateBlockingKey_pkey" PRIMARY KEY ("id")
);

-- Idempotencia do backfill: mesma chave do mesmo dono nao duplica.
CREATE UNIQUE INDEX "CandidateBlockingKey_productId_keyType_normalizedValue_policyVersion_key" ON "CandidateBlockingKey"("productId", "keyType", "normalizedValue", "policyVersion");

-- Indice do LOOKUP de producao (o caminho quente do candidate generation).
CREATE INDEX "CandidateBlockingKey_keyType_normalizedValue_idx" ON "CandidateBlockingKey"("keyType", "normalizedValue");
CREATE INDEX "CandidateBlockingKey_keyType_normalizedValue_strength_idx" ON "CandidateBlockingKey"("keyType", "normalizedValue", "strength");
CREATE INDEX "CandidateBlockingKey_productId_idx" ON "CandidateBlockingKey"("productId");

-- AddForeignKey
ALTER TABLE "CandidateBlockingKey" ADD CONSTRAINT "CandidateBlockingKey_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
