-- Motor de conteúdo social diário do Ofertano.
-- A publicação continua fora desta tabela, via Metricool/ChatGPT.

-- CreateEnum
CREATE TYPE "SocialPostType" AS ENUM (
    'DUEL_PRICE',
    'FOUND_DEAL',
    'PRICE_COMPARISON',
    'SAVING_TIP',
    'ENGAGEMENT_QUESTION',
    'SHOPPING_CURIOSITY'
);

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('READY', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SocialPostSlot" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "slot" "SocialPostSlot" NOT NULL,
    "type" "SocialPostType" NOT NULL,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'READY',
    "productId" TEXT,
    "caption" TEXT NOT NULL,
    "hashtags" TEXT[] NOT NULL,
    "data" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_dayKey_slot_key" ON "SocialPost"("dayKey", "slot");
CREATE INDEX "SocialPost_status_createdAt_idx" ON "SocialPost"("status", "createdAt");
CREATE INDEX "SocialPost_productId_createdAt_idx" ON "SocialPost"("productId", "createdAt");
CREATE INDEX "SocialPost_fingerprint_idx" ON "SocialPost"("fingerprint");

-- AddForeignKey
ALTER TABLE "SocialPost"
ADD CONSTRAINT "SocialPost_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
