-- CATALOG_ARCHITECTURE_V1 — FASE 7.1: PLANO DE CONTROLE GLOBAL DO CUTOVER LIVE.
--
-- ADITIVA. CREATE TYPE / CREATE TABLE / CREATE INDEX / CONSTRAINT apenas.
-- Nenhum DROP, TRUNCATE, DELETE, RENAME destrutivo ou backfill.
-- Nenhuma coluna nova em Product, MarketplaceOffer, PriceHistory,
-- RawMarketplaceListing ou qualquer entidade de comércio: as duas tabelas
-- abaixo SÃO o plano de controle, e não tocam no catálogo.
--
-- Por que o orçamento precisa existir no banco:
--   O teto de escrita do canário anterior (PROCESS_LOCAL) não é teto em
--   Vercel/serverless — N instâncias × maxWrites = N×maxWrites concessões
--   reais. O orçamento global só é real se a subtração for ATÔMICA, e a
--   subtração atômica entre instâncias só existe no banco. Por isso
--   "usedWrites" mora aqui e é incrementado por um único
--   UPDATE ... WHERE "usedWrites" < "maxWrites" RETURNING.
--
-- Por que o breaker mora aqui:
--   Rollback para LEGACY_ONLY SEM novo deploy exige que o estado do breaker
--   seja compartilhado. Uma instância que abre o breaker precisa fazer TODAS
--   as outras fail-closed no próximo pedido, e isso só é garantido se o
--   estado estiver no mesmo banco que todas leem.
--
-- O roll-out é SEMPRE source-scoped: uma linha por marketplaceId canônico do
-- registry V1. Não existe linha "todos os marketplaces" (cutover global é
-- PROIBIDO: CATALOG_V1_GLOBAL_CUTOVER=NO).

-- CreateEnum
CREATE TYPE "CatalogCutoverBreakerState" AS ENUM ('CLOSED', 'OPEN');

-- CreateEnum
CREATE TYPE "CatalogCutoverEventKind" AS ENUM (
    'ARM',
    'PERMIT_GRANTED',
    'PERMIT_DENIED',
    'TRIP',
    'RESET',
    'ROLLBACK',
    'BUDGET_RAISED',
    'V1_COMMITTED',
    'V1_FAILED',
    'AMBIGUOUS_COMMIT',
    'FALLBACK_ATTEMPTED',
    'FALLBACK_COMMITTED',
    'FALLBACK_FAILED',
    'PARITY_MATCH',
    'PARITY_DIFFERENCE',
    'DOUBLE_WRITE'
);

-- CreateTable
CREATE TABLE "CatalogCutoverRollout" (
    "id" TEXT NOT NULL,
    -- marketplaceId CANÔNICO do registry V1. NUNCA um nome de marketplace em
    -- código; o cutover é resolvido por configuração.
    "marketplaceId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'LEGACY_ONLY',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "legacyFallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
    -- Orçamento GLOBAL. maxWrites = 0 => fail-closed (LEGACY_ONLY).
    "maxWrites" INTEGER NOT NULL DEFAULT 0,
    "usedWrites" INTEGER NOT NULL DEFAULT 0,
    -- Breaker global: uma instância abre, todas fail-closed, sem novo deploy.
    "breakerState" "CatalogCutoverBreakerState" NOT NULL DEFAULT 'CLOSED',
    "breakerReason" TEXT,
    "breakerTrippedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastPermitAt" TIMESTAMP(3),
    "lastPermitBy" TEXT,
    "lastObservedUsedWrites" INTEGER,
    "lastObservedAt" TIMESTAMP(3),
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogCutoverRollout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogCutoverEvent" (
    "id" TEXT NOT NULL,
    "rolloutId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "kind" "CatalogCutoverEventKind" NOT NULL,
    "reason" TEXT,
    "usedWrites" INTEGER,
    "maxWrites" INTEGER,
    -- Uma execução por listagem. A unicidade (executionId, kind) é o que torna
    -- o marcador de commit IDEMPOTENTE: retry/replay não duplica evento, e
    -- (já com o marcador do irmão gravado) é o que permite DETECTAR
    -- double-write antes que ele se confirme como estado normal.
    "executionId" TEXT NOT NULL,
    "externalListingId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogCutoverEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCutoverRollout_marketplaceId_key" ON "CatalogCutoverRollout"("marketplaceId");

-- CreateIndex
CREATE INDEX "CatalogCutoverRollout_enabled_breakerState_idx" ON "CatalogCutoverRollout"("enabled", "breakerState");

-- CreateIndex (uso do gate live: resolve por marketplaceId)
CREATE INDEX "CatalogCutoverRollout_breakerState_idx" ON "CatalogCutoverRollout"("breakerState");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCutoverEvent_executionId_kind_key" ON "CatalogCutoverEvent"("executionId", "kind");

-- CreateIndex
CREATE INDEX "CatalogCutoverEvent_rolloutId_createdAt_idx" ON "CatalogCutoverEvent"("rolloutId", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogCutoverEvent_marketplaceId_createdAt_idx" ON "CatalogCutoverEvent"("marketplaceId", "createdAt");

-- CreateIndex (contagem de falhas críticas do breaker, por kind)
CREATE INDEX "CatalogCutoverEvent_rolloutId_kind_createdAt_idx" ON "CatalogCutoverEvent"("rolloutId", "kind", "createdAt");

-- AddForeignKey
-- ON DELETE RESTRICT: o log de controle é evidência de auditoria. Apagar um
-- rollout não pode apagar o histórico do que foi escrito com o orçamento dele.
ALTER TABLE "CatalogCutoverEvent" ADD CONSTRAINT "CatalogCutoverEvent_rolloutId_fkey" FOREIGN KEY ("rolloutId") REFERENCES "CatalogCutoverRollout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraints (autoridade no banco, não validação só em JS)
ALTER TABLE "CatalogCutoverRollout" ADD CONSTRAINT "CatalogCutoverRollout_maxWrites_ge_0" CHECK ("maxWrites" >= 0);
ALTER TABLE "CatalogCutoverRollout" ADD CONSTRAINT "CatalogCutoverRollout_usedWrites_ge_0" CHECK ("usedWrites" >= 0);
-- O teto NUNCA pode ser ultrapassado. Esta constraint é a rede de segurança
-- final do orçamento global: mesmo que uma futura instrução de aquisição
-- tivesse um erro, o banco se recusa a persistir usedWrites > maxWrites.
ALTER TABLE "CatalogCutoverRollout" ADD CONSTRAINT "CatalogCutoverRollout_usedWrites_le_maxWrites" CHECK ("usedWrites" <= "maxWrites");
ALTER TABLE "CatalogCutoverRollout" ADD CONSTRAINT "CatalogCutoverRollout_marketplaceId_not_empty" CHECK (length("marketplaceId") > 0);
ALTER TABLE "CatalogCutoverRollout" ADD CONSTRAINT "CatalogCutoverRollout_mode_known" CHECK ("mode" IN ('SHADOW', 'V1_PRIMARY_WITH_LEGACY_FALLBACK', 'V1_PRIMARY', 'LEGACY_ONLY'));
ALTER TABLE "CatalogCutoverEvent" ADD CONSTRAINT "CatalogCutoverEvent_executionId_not_empty" CHECK (length("executionId") > 0);
