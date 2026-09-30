-- LISTING-FIRST: catálogo vira metadado, nunca identidade de oferta.
--
-- Mercado Livre: MarketplaceOffer.externalId passa a ser SEMPRE o
-- listingItemId (ITEM_ID concreto do anúncio). O catalog_product_id do
-- anúncio passa a viver em coluna própria, apenas como metadado.

ALTER TABLE "MarketplaceOffer"
  ADD COLUMN "catalogProductId" TEXT;

CREATE INDEX "MarketplaceOffer_marketplace_catalogProductId_idx"
  ON "MarketplaceOffer"("marketplace", "catalogProductId");
