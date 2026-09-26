-- CATALOG_ARCHITECTURE_V1 — FASE 7.1: ALINHA O PLANO DE CONTROLE A timestamptz.
--
-- ADITIVA. Só toca as DUAS tabelasNovas desta mesma fase
-- (CatalogCutoverRollout / CatalogCutoverEvent), que estão vazias em
-- produção e cuja migration criadora (20260925120000) já foi aplicada.
-- Nenhum DROP, TRUNCATE, DELETE, RENAME, nem alteração em Product,
-- MarketplaceOffer, PriceHistory, RawMarketplaceListing ou em qualquer
-- entidade de comércio.
--
-- Por que esta migration existe:
--   A 20260925120000 criou as colunas de tempo como TIMESTAMP(3) (sem fuso),
--   enquanto o restante do schema — e o próprio schema.prisma destas duas
--   models — usa @db.Timestamptz(3). A divergência não é cosmética:
--
--   1. `DEFAULT CURRENT_TIMESTAMP` é timestamptz. Atribuir timestamptz a uma
--      coluna `timestamp` converte para o fuso do SERVIDOR, não para UTC. Uma
--      mudança de fuso no Postgres passa a reescrever o que o plano de controle
--      entende por "agora", e o orçamento/breaker perderiam a ordem temporal real.
--   2. O gate live compara `startedAt`/`expiresAt`/`lastPermitAt` com o relógio
--      do processo. Instâncias serverless em fusos diferentes passariam a ler
--      janelas de rollout deslocadas.
--
--   O projeto inteiro é @db.Timestamptz(3) (8 colunas, todas destas). Esta
--   migration fecha a divergência para que `prisma migrate diff` entre o banco
--   e o schema seja VAZIO — sem isso, o próximo `migrate dev` geraria uma
--   migration de drift em produção.
--
-- USANDO timestamptz: as tabelas estão vazias, então a conversão é uma
-- reinterpretação sem risco de perda. FROM/TO explícitos porque a conversão
-- usa o fuso do servidor na leitura — valores que já existissem (nenhum) seriam
-- lidos como o instante local correspondente. USING elimina essa ambiguidade
-- para sempre.

-- CatalogCutoverRollout: colunas de tempo
ALTER TABLE "CatalogCutoverRollout"
  ALTER COLUMN "breakerTrippedAt" TYPE TIMESTAMPTZ(3) USING "breakerTrippedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "startedAt"         TYPE TIMESTAMPTZ(3) USING "startedAt"         AT TIME ZONE 'UTC',
  ALTER COLUMN "expiresAt"         TYPE TIMESTAMPTZ(3) USING "expiresAt"         AT TIME ZONE 'UTC',
  ALTER COLUMN "lastPermitAt"      TYPE TIMESTAMPTZ(3) USING "lastPermitAt"      AT TIME ZONE 'UTC',
  ALTER COLUMN "lastObservedAt"    TYPE TIMESTAMPTZ(3) USING "lastObservedAt"    AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt"         TYPE TIMESTAMPTZ(3) USING "createdAt"         AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt"         TYPE TIMESTAMPTZ(3) USING "updatedAt"         AT TIME ZONE 'UTC';

-- CatalogCutoverEvent: colunas de tempo
ALTER TABLE "CatalogCutoverEvent"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
