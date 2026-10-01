-- Existing offers and their histories remain intact. Version 0 denotes legacy evidence.
ALTER TABLE "MarketplaceOffer"
  ADD COLUMN IF NOT EXISTS "catalogProductId" TEXT,
  ADD COLUMN "rawPayload" JSONB,
  ADD COLUMN "condition" TEXT,
  ADD COLUMN "shipping" JSONB,
  ADD COLUMN "identityVersion" INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS "MarketplaceOffer_productId_marketplace_key";
CREATE INDEX "MarketplaceOffer_productId_marketplace_idx" ON "MarketplaceOffer"("productId", "marketplace");
-- Other marketplaces retain the pre-existing one-offer behavior.
CREATE UNIQUE INDEX "MarketplaceOffer_non_ml_product_marketplace_key"
  ON "MarketplaceOffer"("productId", "marketplace") WHERE "marketplace" <> 'MERCADO_LIVRE';
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "ml_listing_identity_v1" CHECK (
  "marketplace" <> 'MERCADO_LIVRE' OR "identityVersion" = 0 OR (
    "externalId" IS NOT NULL AND "externalId" ~ '^MLB[0-9]+$'
    AND "price" > 0 AND "price" < 'Infinity'::float8
    AND ("catalogProductId" IS NULL OR "externalId" <> "catalogProductId")
    AND "rawPayload" IS NOT NULL
    AND COALESCE("rawPayload"->'listing'->>'item_id' = "externalId", false)
    AND ("sourceUrl" IS NULL OR "sourceUrl" !~* '/p/')
  )
);
-- A legacy row may be retained; a new ML row cannot bypass the listing contract.
CREATE FUNCTION enforce_ml_new_listing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."marketplace" = 'MERCADO_LIVRE' AND NEW."identityVersion" <> 1 THEN
    RAISE EXCEPTION 'ML_NEW_OFFER_WITHOUT_LISTING_EVIDENCE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ml_new_listing BEFORE INSERT ON "MarketplaceOffer"
  FOR EACH ROW EXECUTE FUNCTION enforce_ml_new_listing();
