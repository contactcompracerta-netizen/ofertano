-- Subscriptions Web Push do Admin e registro de disparos
-- para não repetir a mesma oportunidade.

-- CreateTable
CREATE TABLE "AdminPushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPushDispatch" (
    "id" TEXT NOT NULL,
    "opportunityKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPushDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminPushSubscription_endpoint_key" ON "AdminPushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "AdminPushSubscription_lastSeenAt_idx" ON "AdminPushSubscription"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPushDispatch_opportunityKey_key" ON "AdminPushDispatch"("opportunityKey");

-- CreateIndex
CREATE INDEX "AdminPushDispatch_sentAt_idx" ON "AdminPushDispatch"("sentAt");
