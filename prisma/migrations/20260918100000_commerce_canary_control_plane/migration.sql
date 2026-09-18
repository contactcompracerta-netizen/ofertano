-- 50AG.3 distributed-safe canary control plane (ONE-SHOT GRANT).
-- Additive migration: CREATE TYPE / CREATE TABLE / CREATE INDEX / CONSTRAINT only.
-- No DROP, no RENAME, no backfill, no Product mutation.
-- The grant table is control plane; it deliberately has NO FK to Product,
-- OfferObservation, RawMarketplaceListing or MarketplaceOffer (Part O).

-- CreateEnum
CREATE TYPE "CommerceCanaryGrantStatus" AS ENUM ('ARMED', 'CLAIMED', 'CONSUMED', 'FAILED', 'EXPIRED', 'DISABLED');

-- CreateEnum
CREATE TYPE "CommerceCanaryAttemptKind" AS ENUM ('CLAIM', 'BLOCKED', 'CONSUMED', 'FAILED', 'EXPIRE', 'DISABLE');

-- CreateTable
CREATE TABLE "CommerceCanaryGrant" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "CommerceCanaryGrantStatus" NOT NULL DEFAULT 'ARMED',
    "marketplace" "Marketplace" NOT NULL,
    "externalId" TEXT NOT NULL,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "attemptsClaimed" INTEGER NOT NULL DEFAULT 0,
    "dryRunOnly" BOOLEAN NOT NULL DEFAULT false,
    "requireExactIdentity" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "consumedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "resultObservationId" TEXT,
    "resultStatus" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceCanaryGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceCanaryAttempt" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "kind" "CommerceCanaryAttemptKind" NOT NULL,
    "reason" TEXT,
    "executionId" TEXT,
    "latencyMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceCanaryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCanaryGrant_tokenHash_key" ON "CommerceCanaryGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "CommerceCanaryGrant_status_expiresAt_idx" ON "CommerceCanaryGrant"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CommerceCanaryGrant_marketplace_externalId_idx" ON "CommerceCanaryGrant"("marketplace", "externalId");

-- CreateIndex
CREATE INDEX "CommerceCanaryAttempt_grantId_createdAt_idx" ON "CommerceCanaryAttempt"("grantId", "createdAt");

-- CreateIndex
CREATE INDEX "CommerceCanaryAttempt_kind_createdAt_idx" ON "CommerceCanaryAttempt"("kind", "createdAt");

-- AddForeignKey (internal control-plane audit only; no commerce entity FK)
ALTER TABLE "CommerceCanaryAttempt" ADD CONSTRAINT "CommerceCanaryAttempt_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "CommerceCanaryGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraints (DB authority, not JS-only validation)
ALTER TABLE "CommerceCanaryGrant" ADD CONSTRAINT "CommerceCanaryGrant_maxAttempts_ge_1" CHECK ("maxAttempts" >= 1);
ALTER TABLE "CommerceCanaryGrant" ADD CONSTRAINT "CommerceCanaryGrant_attemptsClaimed_ge_0" CHECK ("attemptsClaimed" >= 0);
ALTER TABLE "CommerceCanaryGrant" ADD CONSTRAINT "CommerceCanaryGrant_attemptsClaimed_le_maxAttempts" CHECK ("attemptsClaimed" <= "maxAttempts");
ALTER TABLE "CommerceCanaryGrant" ADD CONSTRAINT "CommerceCanaryGrant_tokenHash_not_empty" CHECK (length("tokenHash") >= 32);
ALTER TABLE "CommerceCanaryGrant" ADD CONSTRAINT "CommerceCanaryGrant_externalId_not_empty" CHECK (length("externalId") > 0);