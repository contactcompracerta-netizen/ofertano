-- CATALOG_ARCHITECTURE_V1 — FASE 7.2: AUTOPILOT DE PROGRESSAO DO CUTOVER LIVE.
--
-- ADITIVA. CREATE TYPE / CREATE TABLE / CREATE INDEX / CONSTRAINT apenas.
-- Nenhum DROP, TRUNCATE, DELETE, RENAME destrutivo ou backfill.
-- Nenhuma coluna nova em Product, MarketplaceOffer, PriceHistory,
-- RawMarketplaceListing ou qualquer entidade de comercio: as tres tabelas
-- abaixo SAO o plano de controle da progressao e nao tocam no catalogo.
--
-- Por que o estado do autopilot mora no banco e nao em memoria Node:
--   O objetivo e Progressao 1 -> 5 -> 25 -> 100 SEM operador presente. O
--   processo que observa o trafego real em Vercel e destruido a cada
--   requisicao e pode existir em N instancias ao mesmo tempo. Um estado em
--   memoria do processo (Map/variavel de modulo) perde a contabilidade a cada
--   execucao, duplica promocao quando duas instancias correm juntas e nao
--   sobrevive a um restart. O unico estado que sobrevive a isso e o mesmo
--   plano de controle ja usado pelo orcamento global e pelo breaker: o
--   PostgreSQL.
--
-- Por que versionamento otimista em vez de apenas "ler e escrever":
--   Duas execucoes simultaneas do controlador (duas funcoes serverless
--   disparadas pelo mesmo cron) leem o MESMO estado e podem decidir a MESMA
--   promocao. A transicao entao e um UPDATE condicional
--   `WHERE "version" = $lido AND "state" = $lido`: o perdedor da corrida
--   afeta ZERO linhas e aborta sem promover. E o alvo da promocao nunca vem
--   de um numero digitado: e funcao pura do estado persistido
--   (proximoEstado), o que torna impossivel pular um degrau (1 -> 25) mesmo
--   que dois atores decidam promover.
--
-- CATALOG_V1_GLOBAL_CUTOVER = NO (inalterado): as tabelas sao por
-- marketplaceId canonico do registry V1. Nao existe linha "todos os
-- marketplaces" e nada aqui promove o V1 a writer global.
--
-- PUBLICACAO: nenhuma das tres tabelas participa de decisao de publicacao.
-- PublicationEligibility, PUBLIC_MULTISTORE_MIN_MARKETPLACES=2 e
-- DRAFT/active=false continuam decididos exclusivamente dentro da transacao
-- canonica do catalogo. O autopilot apenas OBSERVA
-- AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES (leitura) e pode ABRIR o breaker
-- global (que devolve o marketplace a LEGACY_ONLY) — nunca publica.

-- CreateEnum
CREATE TYPE "CatalogCutoverAutopilotState" AS ENUM (
    'WAITING_1',
    'VALIDATING_1',
    'WAITING_5',
    'VALIDATING_5',
    'WAITING_25',
    'VALIDATING_25',
    'WAITING_100',
    'VALIDATING_100',
    'COMPLETED',
    'PAUSED',
    'TRIPPED'
);

-- CreateEnum
CREATE TYPE "CatalogCutoverAutopilotDecision" AS ENUM (
    'INIT',
    'NOOP',
    'WAIT',
    'PROMOTE',
    'TRIP',
    'PAUSE',
    'RESUME'
);

-- Tabela 1: o estado da maquina, por marketplaceId canônico do registry V1.
CREATE TABLE "CatalogCutoverAutopilot" (
    "id"                    TEXT                     NOT NULL,
    "marketplaceId"         TEXT                     NOT NULL,
    "state"                 "CatalogCutoverAutopilotState" NOT NULL DEFAULT 'WAITING_1',
    "stage"                 INTEGER                  NOT NULL DEFAULT 1,
    -- enabled e o interruptor DURAVEL do operador (so applyOperatorAction o
    -- muda). O interruptor de IMPLANTACAO e AUTOPILOT_ENABLED, lido a cada
    -- execucao e NUNCA persistido: por isso o default e TRUE. SENAO a primeira
    -- execucao com o deploy em OFF gravaria false e o autopilot morreria para
    -- sempre depois do ON. Fail-safe real = env desligado OU operador desligou.
    "enabled"               BOOLEAN                  NOT NULL DEFAULT true,
    "cooldownUntil"         TIMESTAMP(3)             NOT NULL,
    -- 24h: o menor intervalo que ainda cobre um ciclo diario de trafego
    -- organico do Mercado Livre (burst ~06:10 UTC). E o PISO, nao o teto: um
    -- estagio com trafego abaixo disso simplesmente nao promove.
    "minObservationMs"      INTEGER                  NOT NULL DEFAULT 86400000,
    "version"               INTEGER                  NOT NULL DEFAULT 0,
    "stageStartedAt"        TIMESTAMP(3)             NOT NULL,
    "lastRunAt"             TIMESTAMP(3),
    "lastDecision"          "CatalogCutoverAutopilotDecision",
    "lastReason"            TEXT,
    "tripReason"            TEXT,
    "trippedAt"             TIMESTAMP(3),
    "completedAt"           TIMESTAMP(3),
    "createdAt"             TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogCutoverAutopilot_pkey" PRIMARY KEY ("id")
);

-- Tabela 2: o log append-only de decisões (uma linha por execução do
-- controlador). É a prova de idempotência, de concorrência e de histórico.
CREATE TABLE "CatalogCutoverAutopilotRun" (
    "id"             TEXT                             NOT NULL,
    "marketplaceId"  TEXT                             NOT NULL,
    "stateBefore"    "CatalogCutoverAutopilotState",
    "stateAfter"     "CatalogCutoverAutopilotState",
    "decision"       "CatalogCutoverAutopilotDecision" NOT NULL,
    "stageBefore"    INTEGER,
    "stageAfter"     INTEGER,
    "maxWrites"      INTEGER,
    "usedWrites"     INTEGER,
    "versionBefore"  INTEGER,
    "versionAfter"   INTEGER,
    "promoted"       BOOLEAN                          NOT NULL DEFAULT false,
    "executionId"    TEXT                             NOT NULL,
    "reason"         TEXT,
    "blockers"       JSONB,
    "evidence"       JSONB,
    "metrics"        JSONB,
    "createdAt"      TIMESTAMP(3)                     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogCutoverAutopilotRun_pkey" PRIMARY KEY ("id")
);

-- Tabela 3: o agregado persistido por estágio (métricas FASE K). Recalculado
-- do ledger append-only a cada execução do controlador e gravado por UPSERT
-- (marketplaceId, stage) — é derivado, logo não pode divergir da verdade.
CREATE TABLE "CatalogCutoverStageMetric" (
    "id"                        TEXT        NOT NULL,
    "marketplaceId"             TEXT        NOT NULL,
    "stage"                     INTEGER     NOT NULL,
    "startedAt"                 TIMESTAMP(3),
    "completedAt"               TIMESTAMP(3),
    "maxWrites"                 INTEGER,
    "usedWrites"                INTEGER     NOT NULL DEFAULT 0,
    "v1Attempts"                INTEGER     NOT NULL DEFAULT 0,
    "v1Committed"               INTEGER     NOT NULL DEFAULT 0,
    "v1Noop"                    INTEGER     NOT NULL DEFAULT 0,
    "fallbackUsed"              INTEGER     NOT NULL DEFAULT 0,
    "budgetSkipped"             INTEGER     NOT NULL DEFAULT 0,
    "doubleWrites"              INTEGER     NOT NULL DEFAULT 0,
    "duplicates"                INTEGER     NOT NULL DEFAULT 0,
    "parityMatches"             INTEGER     NOT NULL DEFAULT 0,
    "parityDifferences"         INTEGER     NOT NULL DEFAULT 0,
    "publicationViolations"     INTEGER     NOT NULL DEFAULT 0,
    "policyBlocked"             INTEGER     NOT NULL DEFAULT 0,
    "systemErrors"              INTEGER     NOT NULL DEFAULT 0,
    "breakerTrips"              INTEGER     NOT NULL DEFAULT 0,
    "pathStructural"            INTEGER     NOT NULL DEFAULT 0,
    "pathOfferOnly"             INTEGER     NOT NULL DEFAULT 0,
    "pathUnknown"               INTEGER     NOT NULL DEFAULT 0,
    "uniqueExternalListings"    INTEGER     NOT NULL DEFAULT 0,
    "uniqueProducts"            INTEGER     NOT NULL DEFAULT 0,
    "uniqueSellers"             INTEGER     NOT NULL DEFAULT 0,
    "fastOfferReviewPending"    INTEGER     NOT NULL DEFAULT 0,
    "metadata"                  JSONB,
    "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogCutoverStageMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCutoverAutopilot_marketplaceId_key" ON "CatalogCutoverAutopilot"("marketplaceId");

-- CreateIndex
CREATE INDEX "CatalogCutoverAutopilot_state_cooldownUntil_idx" ON "CatalogCutoverAutopilot"("state", "cooldownUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCutoverAutopilotRun_executionId_key" ON "CatalogCutoverAutopilotRun"("executionId");

-- CreateIndex
CREATE INDEX "CatalogCutoverAutopilotRun_marketplaceId_createdAt_idx" ON "CatalogCutoverAutopilotRun"("marketplaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogCutoverAutopilotRun_promoted_decision_idx" ON "CatalogCutoverAutopilotRun"("promoted", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCutoverStageMetric_marketplaceId_stage_key" ON "CatalogCutoverStageMetric"("marketplaceId", "stage");
