-- Upgrade IN-PLACE da tabela legada "PriceAlert" para o schema canonico.
--
-- Contexto: a tabela fisica "PriceAlert" e o enum "PriceAlertType" ja
-- existem (criados fora do Prisma) com schema legado. Este arquivo NAO
-- pode recriar estruturas existentes: nenhum CREATE TABLE, nenhum DROP
-- TABLE, nenhum TRUNCATE, nenhum DELETE, nenhuma coluna e destruida.
-- Apenas alteracoes aditivas/renomeacao para transformar a tabela
-- existente no schema do schema.prisma.
--
-- Dados: CANONICAL_ALERT_COUNT=0 hoje; mesmo assim a migration preserva
-- todas as colunas legadas compativeis e nao apaga nada.

-- 1) Alinhar o enum "PriceAlertType" ao valor canonico da aplicacao.
-- A aplicacao grava alertType 'ANY_DROP' ou 'TARGET'. O valor legado
-- 'TARGET_PRICE' continua existindo (PriceAlertEvent legado usa o mesmo
-- enum); a migracao apenas adiciona 'TARGET'.
ALTER TYPE "PriceAlertType" ADD VALUE IF NOT EXISTS 'TARGET';

-- 2) Renomear a coluna legada "type" para o nome canonico "alertType".
-- O PostgreSQL acompanha automaticamente os index/constraints que
-- referenciam a coluna renomeada; nenhum dado e alterado.
ALTER TABLE "PriceAlert" RENAME COLUMN "type" TO "alertType";

-- 3) Defaults/constraints do schema canonico.
-- "alertType" passa a ter default; "referencePrice" passa a ser NOT
-- NULL (a tabela esta vazia; a aplicacao sempre informa o valor).
ALTER TABLE "PriceAlert" ALTER COLUMN "alertType" SET DEFAULT 'ANY_DROP';
ALTER TABLE "PriceAlert" ALTER COLUMN "referencePrice" SET NOT NULL;

-- 4) Colunas faltantes do schema canonico (aditivas, sem perda de dado).
ALTER TABLE "PriceAlert" ADD COLUMN "lowestSeenPrice" DOUBLE PRECISION;
ALTER TABLE "PriceAlert" ADD COLUMN "percentageDrop" DOUBLE PRECISION;
ALTER TABLE "PriceAlert" ADD COLUMN "notifyEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PriceAlert" ADD COLUMN "notifyWhatsApp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PriceAlert" ADD COLUMN "lastEmailNotifiedPrice" DOUBLE PRECISION;
ALTER TABLE "PriceAlert" ADD COLUMN "lastEmailNotifiedAt" TIMESTAMP(3);
ALTER TABLE "PriceAlert" ADD COLUMN "lastWhatsAppNotifiedPrice" DOUBLE PRECISION;
ALTER TABLE "PriceAlert" ADD COLUMN "lastWhatsAppNotifiedAt" TIMESTAMP(3);

-- 5) Recompor index/unique para a forma canonica.
-- A unica legada exigia (userId, productId, alertType). O schema canonico
-- exige UNIQUE(userId, productId): o upsert da API usa esse composite key.
DROP INDEX IF EXISTS "PriceAlert_userId_productId_type_key";
CREATE UNIQUE INDEX "PriceAlert_userId_productId_key"
  ON "PriceAlert"("userId", "productId");

-- Index de varredura do monitor: (productId, active) no lugar do legado
-- (productId).
DROP INDEX IF EXISTS "PriceAlert_productId_idx";
CREATE INDEX "PriceAlert_productId_active_idx"
  ON "PriceAlert"("productId", "active");

-- Index legado nao usado pelo schema canonico (a unica acima ja indexa
-- "userId"); removido para nao deixar drift estrutural.
DROP INDEX IF EXISTS "PriceAlert_userId_createdAt_idx";

-- Mantidos (ja existem e conferem com o schema):
--   * PK "PriceAlert_pkey" ("id")
--   * "PriceAlert_active_updatedAt_idx" ("active", "updatedAt")
--   * FK "PriceAlert_productId_fkey" -> "Product"("id") ON DELETE CASCADE