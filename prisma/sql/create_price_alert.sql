-- Tabelas isoladas de alertas de preço.
-- Não altera Product, MarketplaceOffer, Favorite nem PriceHistory.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'PriceAlertType'
  ) THEN
    CREATE TYPE "PriceAlertType" AS ENUM ('ANY_DROP', 'TARGET_PRICE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PriceAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "PriceAlertType" NOT NULL,
    "targetPrice" DOUBLE PRECISION,
    "referencePrice" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "armed" BOOLEAN NOT NULL DEFAULT true,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastEvaluatedPrice" DOUBLE PRECISION,
    "lastEvaluatedHadExact" BOOLEAN,
    "lastTriggeredAt" TIMESTAMP(3),
    "lastTriggeredPrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PriceAlert_userId_productId_type_key"
    ON "PriceAlert"("userId", "productId", "type");

CREATE INDEX IF NOT EXISTS "PriceAlert_userId_createdAt_idx"
    ON "PriceAlert"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "PriceAlert_productId_idx"
    ON "PriceAlert"("productId");

CREATE INDEX IF NOT EXISTS "PriceAlert_active_updatedAt_idx"
    ON "PriceAlert"("active", "updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceAlert_productId_fkey'
  ) THEN
    ALTER TABLE "PriceAlert"
      ADD CONSTRAINT "PriceAlert_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PriceAlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "type" "PriceAlertType" NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "previousReferencePrice" DOUBLE PRECISION,
    "targetPrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceAlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PriceAlertEvent_alertId_createdAt_idx"
    ON "PriceAlertEvent"("alertId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceAlertEvent_alertId_fkey'
  ) THEN
    ALTER TABLE "PriceAlertEvent"
      ADD CONSTRAINT "PriceAlertEvent_alertId_fkey"
      FOREIGN KEY ("alertId") REFERENCES "PriceAlert"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
