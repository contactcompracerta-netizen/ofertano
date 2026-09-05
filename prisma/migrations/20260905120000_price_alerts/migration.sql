-- CreateEnum
CREATE TYPE "PriceAlertType" AS ENUM ('ANY_DROP', 'TARGET');

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

-- CreateIndex
CREATE UNIQUE INDEX "PriceAlert_userId_productId_key" ON "PriceAlert"("userId", "productId");

-- CreateIndex
CREATE INDEX "PriceAlert_productId_active_idx" ON "PriceAlert"("productId", "active");

-- CreateIndex
CREATE INDEX "PriceAlert_active_updatedAt_idx" ON "PriceAlert"("active", "updatedAt");

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
