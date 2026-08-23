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
