-- Local-only prerequisites absent from the pinned fresh DDL.
-- Favorite: Git blob c38acb4275f6a4336c3745e3d6a484ff85117986 (entire SQL).
-- PriceAlertEvent: exact suffix of Git blob dec41069809cbf22fff39baae1bbca54275f3603.
-- Never run independently or against a remote database.
-- Tabela isolada de favoritos. Não altera Product, MarketplaceOffer nem PriceHistory.
CREATE TABLE IF NOT EXISTS "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Favorite_userId_productId_key"
    ON "Favorite"("userId", "productId");

CREATE INDEX IF NOT EXISTS "Favorite_userId_createdAt_idx"
    ON "Favorite"("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Favorite_productId_fkey'
  ) THEN
    ALTER TABLE "Favorite"
      ADD CONSTRAINT "Favorite_productId_fkey"
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
