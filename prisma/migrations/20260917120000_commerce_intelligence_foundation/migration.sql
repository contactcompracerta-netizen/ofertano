-- CreateEnum
CREATE TYPE "ProductIdentifierType" AS ENUM ('GTIN', 'EAN', 'UPC', 'ISBN', 'MPN', 'MODEL', 'BRAND_SKU', 'MARKETPLACE_EXTERNAL_ID');

-- CreateEnum
CREATE TYPE "IdentityConfidence" AS ENUM ('EXACT', 'HIGH', 'MEDIUM', 'LOW', 'MANUAL');

-- CreateEnum
CREATE TYPE "IdentityEvidenceKind" AS ENUM ('IDENTIFIER_MATCH', 'BRAND_MATCH', 'MODEL_MATCH', 'TITLE_MATCH', 'ATTRIBUTE_MATCH', 'MARKETPLACE_LINK', 'MANUAL_ASSERTION');

-- CreateEnum
CREATE TYPE "PriceComponentType" AS ENUM ('LIST_PRICE', 'SALE_PRICE', 'SHIPPING', 'COUPON', 'PIX_DISCOUNT', 'MEMBERSHIP_PRICE', 'INSTALLMENT_TOTAL', 'FINAL_EFFECTIVE_PRICE');

-- CreateEnum
CREATE TYPE "PriceTruthState" AS ENUM ('EXACT', 'ESTIMATED', 'PARTIAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IdentityConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TrustScopeType" AS ENUM ('PRODUCT', 'RAW_LISTING', 'OFFER_OBSERVATION', 'MARKETPLACE_OFFER');

-- CreateEnum
CREATE TYPE "TrustSignalState" AS ENUM ('CONFIRMED', 'REJECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProductRelationType" AS ENUM ('COMPATIBLE', 'SUBSTITUTE', 'ACCESSORY', 'BUNDLE', 'SAME_FAMILY', 'SUCCESSOR', 'PREDECESSOR');

-- CreateTable
CREATE TABLE "ProductIdentifier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "type" "ProductIdentifierType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "marketplace" "Marketplace",
    "brandScope" TEXT,
    "source" TEXT NOT NULL,
    "confidence" "IdentityConfidence" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "name" TEXT,
    "color" TEXT,
    "size" TEXT,
    "voltage" TEXT,
    "capacity" TEXT,
    "storage" TEXT,
    "memory" TEXT,
    "modelNumber" TEXT,
    "attributes" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityEvidence" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "rawListingId" TEXT,
    "kind" "IdentityEvidenceKind" NOT NULL,
    "rawEvidence" JSONB NOT NULL,
    "confidence" "IdentityConfidence" NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityConflict" (
    "id" TEXT NOT NULL,
    "productAId" TEXT,
    "productBId" TEXT,
    "identifierId" TEXT,
    "evidenceId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "IdentityConflictStatus" NOT NULL DEFAULT 'OPEN',
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "IdentityConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferObservation" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "rawListingId" TEXT,
    "marketplaceOfferId" TEXT,
    "marketplace" "Marketplace" NOT NULL,
    "externalId" TEXT NOT NULL,
    "sellerId" TEXT,
    "sellerName" TEXT,
    "sourceUrl" TEXT,
    "affiliateLink" TEXT,
    "title" TEXT,
    "price" DECIMAL(20,6),
    "oldPrice" DECIMAL(20,6),
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "stock" INTEGER,
    "available" BOOLEAN,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferPriceComponent" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "type" "PriceComponentType" NOT NULL,
    "amount" DECIMAL(20,6),
    "currency" TEXT NOT NULL,
    "truthState" "PriceTruthState" NOT NULL,
    "conditions" JSONB,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferPriceComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustSignal" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "rawListingId" TEXT,
    "observationId" TEXT,
    "marketplaceOfferId" TEXT,
    "scopeType" "TrustScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "state" "TrustSignalState" NOT NULL,
    "value" JSONB,
    "source" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRelation" (
    "id" TEXT NOT NULL,
    "fromProductId" TEXT NOT NULL,
    "toProductId" TEXT NOT NULL,
    "relationType" "ProductRelationType" NOT NULL,
    "confidence" "IdentityConfidence" NOT NULL,
    "source" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductIdentifier_type_normalizedValue_brandScope_idx" ON "ProductIdentifier"("type", "normalizedValue", "brandScope");

-- CreateIndex
CREATE INDEX "ProductIdentifier_productId_idx" ON "ProductIdentifier"("productId");

-- CreateIndex
CREATE INDEX "ProductIdentifier_variantId_idx" ON "ProductIdentifier"("variantId");

-- CreateIndex
CREATE INDEX "ProductIdentifier_marketplace_normalizedValue_idx" ON "ProductIdentifier"("marketplace", "normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_variantKey_key" ON "ProductVariant"("productId", "variantKey");

-- CreateIndex
CREATE INDEX "IdentityEvidence_productId_createdAt_idx" ON "IdentityEvidence"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "IdentityEvidence_variantId_idx" ON "IdentityEvidence"("variantId");

-- CreateIndex
CREATE INDEX "IdentityEvidence_rawListingId_createdAt_idx" ON "IdentityEvidence"("rawListingId", "createdAt");

-- CreateIndex
CREATE INDEX "IdentityConflict_status_createdAt_idx" ON "IdentityConflict"("status", "createdAt");

-- CreateIndex
CREATE INDEX "IdentityConflict_productAId_idx" ON "IdentityConflict"("productAId");

-- CreateIndex
CREATE INDEX "IdentityConflict_productBId_idx" ON "IdentityConflict"("productBId");

-- CreateIndex
CREATE INDEX "IdentityConflict_identifierId_idx" ON "IdentityConflict"("identifierId");

-- CreateIndex
CREATE INDEX "IdentityConflict_evidenceId_idx" ON "IdentityConflict"("evidenceId");

-- CreateIndex
CREATE INDEX "OfferObservation_productId_capturedAt_idx" ON "OfferObservation"("productId", "capturedAt");

-- CreateIndex
CREATE INDEX "OfferObservation_variantId_capturedAt_idx" ON "OfferObservation"("variantId", "capturedAt");

-- CreateIndex
CREATE INDEX "OfferObservation_rawListingId_capturedAt_idx" ON "OfferObservation"("rawListingId", "capturedAt");

-- CreateIndex
CREATE INDEX "OfferObservation_marketplaceOfferId_capturedAt_idx" ON "OfferObservation"("marketplaceOfferId", "capturedAt");

-- CreateIndex
CREATE INDEX "OfferObservation_marketplace_externalId_capturedAt_idx" ON "OfferObservation"("marketplace", "externalId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferObservation_marketplace_externalId_fingerprint_key" ON "OfferObservation"("marketplace", "externalId", "fingerprint");

-- CreateIndex
CREATE INDEX "OfferPriceComponent_observationId_idx" ON "OfferPriceComponent"("observationId");

-- CreateIndex
CREATE INDEX "TrustSignal_scopeType_scopeId_signalType_observedAt_idx" ON "TrustSignal"("scopeType", "scopeId", "signalType", "observedAt");

-- CreateIndex
CREATE INDEX "TrustSignal_productId_idx" ON "TrustSignal"("productId");

-- CreateIndex
CREATE INDEX "TrustSignal_rawListingId_idx" ON "TrustSignal"("rawListingId");

-- CreateIndex
CREATE INDEX "TrustSignal_observationId_idx" ON "TrustSignal"("observationId");

-- CreateIndex
CREATE INDEX "TrustSignal_marketplaceOfferId_idx" ON "TrustSignal"("marketplaceOfferId");

-- CreateIndex
CREATE INDEX "ProductRelation_fromProductId_relationType_idx" ON "ProductRelation"("fromProductId", "relationType");

-- CreateIndex
CREATE INDEX "ProductRelation_toProductId_relationType_idx" ON "ProductRelation"("toProductId", "relationType");

-- AddForeignKey
ALTER TABLE "ProductIdentifier" ADD CONSTRAINT "ProductIdentifier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductIdentifier" ADD CONSTRAINT "ProductIdentifier_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityEvidence" ADD CONSTRAINT "IdentityEvidence_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityEvidence" ADD CONSTRAINT "IdentityEvidence_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityEvidence" ADD CONSTRAINT "IdentityEvidence_rawListingId_fkey" FOREIGN KEY ("rawListingId") REFERENCES "RawMarketplaceListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityConflict" ADD CONSTRAINT "IdentityConflict_productAId_fkey" FOREIGN KEY ("productAId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityConflict" ADD CONSTRAINT "IdentityConflict_productBId_fkey" FOREIGN KEY ("productBId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityConflict" ADD CONSTRAINT "IdentityConflict_identifierId_fkey" FOREIGN KEY ("identifierId") REFERENCES "ProductIdentifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityConflict" ADD CONSTRAINT "IdentityConflict_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "IdentityEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferObservation" ADD CONSTRAINT "OfferObservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferObservation" ADD CONSTRAINT "OfferObservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferObservation" ADD CONSTRAINT "OfferObservation_rawListingId_fkey" FOREIGN KEY ("rawListingId") REFERENCES "RawMarketplaceListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferObservation" ADD CONSTRAINT "OfferObservation_marketplaceOfferId_fkey" FOREIGN KEY ("marketplaceOfferId") REFERENCES "MarketplaceOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferPriceComponent" ADD CONSTRAINT "OfferPriceComponent_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "OfferObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustSignal" ADD CONSTRAINT "TrustSignal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustSignal" ADD CONSTRAINT "TrustSignal_rawListingId_fkey" FOREIGN KEY ("rawListingId") REFERENCES "RawMarketplaceListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustSignal" ADD CONSTRAINT "TrustSignal_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "OfferObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustSignal" ADD CONSTRAINT "TrustSignal_marketplaceOfferId_fkey" FOREIGN KEY ("marketplaceOfferId") REFERENCES "MarketplaceOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelation" ADD CONSTRAINT "ProductRelation_fromProductId_fkey" FOREIGN KEY ("fromProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelation" ADD CONSTRAINT "ProductRelation_toProductId_fkey" FOREIGN KEY ("toProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

