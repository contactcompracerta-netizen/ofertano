/**
 * CATALOG_ARCHITECTURE_V1 — PLANO DE CONTROLE GLOBAL (FASE 7.1 / FASE P2).
 *
 * Orçamento de escrita e breaker do cutover AUTORITATIVO LIVE, compartilhados
 * entre TODAS as instâncias (Vercel/serverless) via PostgreSQL.
 *
 * Por que NADA de memória de processo aqui:
 *   Em N instâncias serverless, um contador em `process` NÃO é teto global —
 *   N instâncias × maxWrites = N×maxWrites concessões reais. O teto só é real
 *   se a subtração do orçamento for ATÔMICA no banco. É isso que este módulo
 *   faz: uma única instrução `UPDATE ... WHERE "usedWrites" < "maxWrites"
 *   RETURNING` que, sob o bloqueio de linha do PostgreSQL, concede no máximo
 *   `maxWrites` permissões para qualquer número de processos concorrentes.
 *
 * Garantias estruturais:
 *   - NENHUMA referência a nome de marketplace em código: tudo é por
 *     `marketplaceId` canônico (registry V1). Mercado Livre é apenas a
 *     primeira fonte de ativação.
 *   - `CATALOG_V1_GLOBAL_CUTOVER=NO` permanente: o rollout é SEMPRE
 *     source-scoped, uma linha por marketplaceId.
 *   - Fail-closed: sem `DATABASE_URL`, ou com o rollout ausente/desligado/
 *     breaker aberto/orçamento esgotado, a resolução é `LEGACY_ONLY` e
 *     NENHUM write autoritativo acontece.
 *   - O breaker é GLOBAL no sentido de "compartilhado": uma instância abre,
 *     TODAS as outras fail-closed no próximo acquire, SEM novo deploy.
 *   - O marcador durável de commit e a checagem de double-write são gravados
 *     pelo MESMO cliente de transação do catálogo, para que o commit do
 *     catálogo e o marcador sejam atômicos entre si.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { QueryResultRow } from "pg";
import { Prisma } from "@prisma/client";

import type { CutoverBreakerReason } from "./breaker";
import type { CatalogWriterMode } from "./policy";

/**
 * Executor SQL mínimo. Structuralmente compatível com `pg.Pool` e com
 * `Prisma.TransactionClient` (o que permite gravar o marcador de commit pelo
 * MESMO cliente da transação canônica do catálogo).
 */
export interface CutoverSqlExecutor {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rowCount: number | null; rows: R[] }>;
}

/** Subconjunto do TransactionClient do Prisma usado pelos marcadores. */
export interface CutoverTransactionWriter {
  $executeRaw(
    query: Prisma.Sql,
    ...values: unknown[]
  ): Promise<number>;
  $queryRaw<R = QueryResultRow>(
    query: Prisma.Sql,
    ...values: unknown[]
  ): Promise<R[]>;
}

/* -------------------------------------------------------------------------- */
/* POOL                                                                       */
/* -------------------------------------------------------------------------- */

const pools = new Map<string, Pool>();

/**
 * Pool preguiçoso por connection string. `null` (fail-closed) quando não há
 * `DATABASE_URL`: o chamador degrada para LEGACY_ONLY sem tocar o catálogo.
 */
export function globalControlPool(
  connectionString: string | undefined | null,
): CutoverSqlExecutor | null {
  const url = connectionString?.trim();
  if (!url) {
    return null;
  }

  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 30000,
    });
    pools.set(url, pool);
  }
  return pool;
}

/** Encerra todos os pools (testes / shutdown). */
export async function disconnectGlobalControlPools(): Promise<void> {
  const abiertos = [...pools.values()];
  pools.clear();
  await Promise.allSettled(abiertos.map((pool) => pool.end()));
}

/* -------------------------------------------------------------------------- */
/* TIPOS                                                                      */
/* -------------------------------------------------------------------------- */

export type GlobalRolloutRow = {
  id: string;
  marketplaceId: string;
  mode: CatalogWriterMode;
  enabled: boolean;
  legacyFallbackEnabled: boolean;
  maxWrites: number;
  usedWrites: number;
  breakerState: "CLOSED" | "OPEN";
  breakerReason: string | null;
  startedAt: Date | null;
  expiresAt: Date | null;
};

/** Motivo pelo qual uma aquisição de permissão global foi negada. */
export type GlobalPermitDenyReason =
  | "ROLLOUT_ABSENT"
  | "ROLLOUT_DISABLED"
  | "BREAKER_OPEN"
  | "MODE_NOT_AUTHORITATIVE"
  | "BUDGET_NOT_STARTED"
  | "BUDGET_EXPIRED"
  | "BUDGET_EXHAUSTED"
  | "BUDGET_EXCEEDED";

export type GlobalPermitOutcome =
  | {
      granted: true;
      rollout: GlobalRolloutRow;
      executionId: string;
      usedWrites: number;
      maxWrites: number;
    }
  | {
      granted: false;
      reason: GlobalPermitDenyReason;
      rollout: GlobalRolloutRow | null;
      usedWrites: number | null;
      maxWrites: number | null;
    };

/** Evento durável gravado no log de controle. */
export type GlobalEventInput = {
  rolloutId: string;
  marketplaceId: string;
  executionId: string;
  kind:
    | "ARM"
    | "PERMIT_GRANTED"
    | "PERMIT_DENIED"
    | "TRIP"
    | "RESET"
    | "ROLLBACK"
    | "BUDGET_RAISED"
    | "V1_COMMITTED"
    | "V1_FAILED"
    | "AMBIGUOUS_COMMIT"
    | "FALLBACK_ATTEMPTED"
    | "FALLBACK_COMMITTED"
    | "FALLBACK_FAILED"
    | "PARITY_MATCH"
    | "PARITY_DIFFERENCE"
    | "DOUBLE_WRITE";
  reason?: string | null;
  usedWrites?: number | null;
  maxWrites?: number | null;
  externalListingId?: string | null;
  /**
   * Serializado como JSON pelo próprio plano de controle. Tipado como
   * `unknown` de propósito: o chamador monta metadados livres (diferenças de
   * paridade, etc.) e o controle apenas os persiste.
   */
  metadata?: unknown;
};

const ROLLOUT_COLUMNS =
  '"id", "marketplaceId", "mode", "enabled", "legacyFallbackEnabled", "maxWrites", "usedWrites", "breakerState", "breakerReason", "startedAt", "expiresAt"';

/** Mesmas colunas, prefixadas para uso no RETURNING de um UPDATE/CTE. */
const ROLLOUT_COLUMNS_R =
  'r."id", r."marketplaceId", r."mode", r."enabled", r."legacyFallbackEnabled", r."maxWrites", r."usedWrites", r."breakerState", r."breakerReason", r."startedAt", r."expiresAt"';

function toRolloutRow(row: Record<string, unknown>): GlobalRolloutRow {
  return {
    id: String(row.id),
    marketplaceId: String(row.marketplaceId),
    mode: String(row.mode) as CatalogWriterMode,
    enabled: Boolean(row.enabled),
    legacyFallbackEnabled: Boolean(row.legacyFallbackEnabled),
    maxWrites: Number(row.maxWrites),
    usedWrites: Number(row.usedWrites),
    breakerState: row.breakerState === "OPEN" ? "OPEN" : "CLOSED",
    breakerReason:
      typeof row.breakerReason === "string" ? row.breakerReason : null,
    startedAt: row.startedAt ? new Date(row.startedAt as string) : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt as string) : null,
  };
}

const AUTHORITATIVE_MODES: readonly string[] = [
  "V1_PRIMARY",
  "V1_PRIMARY_WITH_LEGACY_FALLBACK",
];

/* -------------------------------------------------------------------------- */
/* LEITURA                                                                    */
/* -------------------------------------------------------------------------- */

/** Rollout global de UM marketplaceId (nunca agregação global). */
export async function readGlobalRollout(
  executor: CutoverSqlExecutor,
  marketplaceId: string,
): Promise<GlobalRolloutRow | null> {
  const res = await executor.query(
    `SELECT ${ROLLOUT_COLUMNS} FROM "CatalogCutoverRollout" WHERE "marketplaceId" = $1`,
    [marketplaceId],
  );
  if ((res.rowCount ?? 0) === 0) {
    return null;
  }
  return toRolloutRow(res.rows[0] as Record<string, unknown>);
}

/* -------------------------------------------------------------------------- */
/* AQUISIÇÃO ATÔMICA DO ORÇAMENTO GLOBAL                                      */
/* -------------------------------------------------------------------------- */

/*
 * A aquisição inteira — verificação de TODOS os pré-requisitos, incremento do
 * contador e registro durável da concessão — é UMA única instrução.
 *
 * atomicidade (READ COMMITTED + bloqueio de linha do MVCC):
 *   N contenderes executam este UPDATE na MESMA linha. O primeiro faz lock e
 *   grava `usedWrites + 1`. Cada contender subsequente, ao obter o lock,
 *   reavalia o WHERE contra a NOVA versão da linha: `usedWrites < maxWrites`
 *   já é falso. Logo, com maxWrites=5 e 20 processos concorrentes, no máximo 5
 *   linhas voltam — nunca 6. Não existe leitura-modificação-escrita em JS
 *   (que seria uma corrida), nem memória de processo.
 *
 * A gravação do evento na mesma instrução (CTE) garante que nenhuma
 * concessão pode existir sem rastro durável: se o evento falhar, a concessão
 * é desfeita junto.
 */
const ACQUIRE_PERMIT_SQL = `
WITH permit AS (
  UPDATE "CatalogCutoverRollout" r
     SET "usedWrites" = r."usedWrites" + 1,
         "lastPermitAt" = NOW(),
         "lastPermitBy" = $2,
         "lastObservedUsedWrites" = r."usedWrites" + 1,
         "lastObservedAt" = NOW(),
         "updatedAt" = NOW()
   WHERE r."marketplaceId" = $1
     AND r."enabled" = true
     AND r."breakerState" = 'CLOSED'::"CatalogCutoverBreakerState"
     AND r."mode" = ANY($4::text[])
     AND (r."startedAt" IS NULL OR r."startedAt" <= NOW())
     AND (r."expiresAt" IS NULL OR r."expiresAt" > NOW())
     AND r."usedWrites" < r."maxWrites"
  RETURNING ${ROLLOUT_COLUMNS_R}
), evt AS (
  INSERT INTO "CatalogCutoverEvent"
    ("id", "rolloutId", "marketplaceId", "kind", "executionId", "usedWrites", "maxWrites", "externalListingId", "metadata", "createdAt")
  SELECT gen_random_uuid()::text, permit."id", permit."marketplaceId",
         'PERMIT_GRANTED'::"CatalogCutoverEventKind", $2, permit."usedWrites", permit."maxWrites", $3, $5, NOW()
    FROM permit
  ON CONFLICT ("executionId", "kind") DO NOTHING
  RETURNING 1
)
SELECT permit."id", permit."marketplaceId", permit."mode", permit."enabled",
       permit."legacyFallbackEnabled", permit."maxWrites", permit."usedWrites",
       permit."breakerState", permit."breakerReason", permit."startedAt", permit."expiresAt",
       (SELECT COUNT(*) FROM evt) AS "eventsWritten"
  FROM permit`;

/**
 * Tenta adquirir UMA permissão de escrita global para `marketplaceId`.
 *
 * NUNCA lança por falta de permissão: uma negação é um resultado legítimo
 * (o chamador degrada para LEGACY_ONLY). Só propaga erro de infraestrutura,
 * que o chamador também trata como fail-closed.
 */
export async function acquireGlobalPermit(
  executor: CutoverSqlExecutor,
  input: {
    marketplaceId: string;
    externalListingId: string;
    executionId?: string;
    metadata?: unknown;
  },
): Promise<GlobalPermitOutcome> {
  const executionId = input.executionId ?? randomUUID();

  const res = await executor.query(
    ACQUIRE_PERMIT_SQL,
    [
      input.marketplaceId,
      executionId,
      input.externalListingId,
      [...AUTHORITATIVE_MODES],
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );

  if ((res.rowCount ?? 0) > 0) {
    const row = res.rows[0] as Record<string, unknown>;
    return {
      granted: true,
      rollout: toRolloutRow(row),
      executionId,
      usedWrites: Number(row.usedWrites),
      maxWrites: Number(row.maxWrites),
    };
  }

  // Nenhuma linha elegível: re-leitura para classificar a negação com precisão
  // (fail-closed: qualquer estado desconhecido => BUDGET_EXHAUSTED).
  const rollout = await readGlobalRollout(executor, input.marketplaceId);
  return {
    granted: false,
    reason: classifyDeny(rollout),
    rollout,
    usedWrites: rollout?.usedWrites ?? null,
    maxWrites: rollout?.maxWrites ?? null,
  };
}

function classifyDeny(rollout: GlobalRolloutRow | null): GlobalPermitDenyReason {
  if (!rollout) {
    return "ROLLOUT_ABSENT";
  }
  if (rollout.breakerState === "OPEN") {
    return "BREAKER_OPEN";
  }
  if (!rollout.enabled) {
    return "ROLLOUT_DISABLED";
  }
  if (!AUTHORITATIVE_MODES.includes(rollout.mode)) {
    return "MODE_NOT_AUTHORITATIVE";
  }
  const now = Date.now();
  if (rollout.startedAt && rollout.startedAt.getTime() > now) {
    return "BUDGET_NOT_STARTED";
  }
  if (rollout.expiresAt && rollout.expiresAt.getTime() <= now) {
    return "BUDGET_EXPIRED";
  }
  if (rollout.maxWrites <= 0) {
    return "BUDGET_EXHAUSTED";
  }
  if (rollout.usedWrites >= rollout.maxWrites) {
    return "BUDGET_EXHAUSTED";
  }
  if (rollout.usedWrites > rollout.maxWrites) {
    return "BUDGET_EXCEEDED";
  }
  return "BUDGET_EXHAUSTED";
}

/* -------------------------------------------------------------------------- */
/* LOG DE EVENTOS (idempotente por (executionId, kind))                       */
/* -------------------------------------------------------------------------- */

const INSERT_EVENT_SQL = `
INSERT INTO "CatalogCutoverEvent"
  ("id", "rolloutId", "marketplaceId", "kind", "reason", "usedWrites", "maxWrites", "executionId", "externalListingId", "metadata", "createdAt")
VALUES (gen_random_uuid()::text, $1, $2, $3::"CatalogCutoverEventKind", $4, $5, $6, $7, $8, $9, NOW())
ON CONFLICT ("executionId", "kind") DO NOTHING`;

/** Grava um evento de controle. Idempotente: replay não duplica. */
export async function recordGlobalEvent(
  executor: CutoverSqlExecutor,
  event: GlobalEventInput,
): Promise<boolean> {
  const written = await executor.query(INSERT_EVENT_SQL, [
    event.rolloutId,
    event.marketplaceId,
    event.kind,
    event.reason ?? null,
    event.usedWrites ?? null,
    event.maxWrites ?? null,
    event.executionId,
    event.externalListingId ?? null,
    event.metadata ? JSON.stringify(event.metadata) : null,
  ]);
  return (written.rowCount ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* BREAKER GLOBAL                                                             */
/* -------------------------------------------------------------------------- */

/*
 * Abertura do breaker: UMA instrução. `breakerState = OPEN` é gravado na MESMA
 * linha do rollout, então o `acquireGlobalPermit` de qualquer outra instância
 * passa a falhar imediatamente — rollback para LEGACY_ONLY sem novo deploy.
 * O TRIP é idempotente (`AND breakerState = 'CLOSED'`), então N instâncias
 * detectando a mesma violação produzem UM único evento TRIP.
 */
const TRIP_SQL = `
WITH trip AS (
  UPDATE "CatalogCutoverRollout" r
     SET "breakerState" = 'OPEN'::"CatalogCutoverBreakerState",
         "breakerReason" = $3,
         "breakerTrippedAt" = NOW(),
         "updatedAt" = NOW()
   WHERE r."id" = $1 AND r."breakerState" = 'CLOSED'::"CatalogCutoverBreakerState"
  RETURNING r."id", r."marketplaceId"
), evt AS (
  INSERT INTO "CatalogCutoverEvent"
    ("id", "rolloutId", "marketplaceId", "kind", "reason", "executionId", "metadata", "createdAt")
  SELECT gen_random_uuid()::text, trip."id", trip."marketplaceId",
         'TRIP'::"CatalogCutoverEventKind", $3, $2, $4, NOW()
    FROM trip
  ON CONFLICT ("executionId", "kind") DO NOTHING
  RETURNING 1
)
SELECT trip."id", trip."marketplaceId" FROM trip`;

/**
 * Abre o breaker global de UM marketplaceId (uma instância abre, todas
 * fail-closed). Idempotente.
 */
export async function tripGlobalBreaker(
  executor: CutoverSqlExecutor,
  input: {
    rolloutId: string;
    marketplaceId: string;
    reason: CutoverBreakerReason;
    executionId?: string;
    metadata?: unknown;
  },
): Promise<boolean> {
  const res = await executor.query(TRIP_SQL, [
    input.rolloutId,
    input.executionId ?? randomUUID(),
    input.reason,
    input.metadata ? JSON.stringify(input.metadata) : null,
  ]);
  return (res.rowCount ?? 0) > 0;
}

/** Fecha o breaker e devolve o marketplace ao modo configurado. */
export async function resetGlobalBreaker(
  executor: CutoverSqlExecutor,
  input: {
    rolloutId: string;
    marketplaceId: string;
    executionId?: string;
    note?: string | null;
  },
): Promise<boolean> {
  const executionId = input.executionId ?? randomUUID();
  const res = await executor.query(
    `
    WITH reset AS (
      UPDATE "CatalogCutoverRollout" r
         SET "breakerState" = 'CLOSED'::"CatalogCutoverBreakerState",
             "breakerReason" = NULL,
             "breakerTrippedAt" = NULL,
             "note" = COALESCE($3, r."note"),
             "updatedAt" = NOW()
       WHERE r."id" = $1
      RETURNING r."id", r."marketplaceId"
    ), evt AS (
      INSERT INTO "CatalogCutoverEvent"
        ("id", "rolloutId", "marketplaceId", "kind", "reason", "executionId", "metadata", "createdAt")
      SELECT gen_random_uuid()::text, reset."id", reset."marketplaceId",
             'RESET'::"CatalogCutoverEventKind", $2, $4, NULL, NOW()
        FROM reset
      ON CONFLICT ("executionId", "kind") DO NOTHING
      RETURNING 1
    )
    SELECT reset."id" FROM reset`,
    [input.rolloutId, input.note ?? null, input.note ?? null, executionId],
  );
  return (res.rowCount ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* ARM / RAISE (operação de configuração, fora do caminho de escrita)          */
/* -------------------------------------------------------------------------- */

/**
 * Configura (ou reconfigura) o rollout de UM marketplaceId.
 *
 * `usedWrites` NUNCA é alterado aqui quando o rollout já existe: subir o teto
 * (`BUDGET_RAISED`) preserva o consumo já realizado, de modo que o teto
 * global só cresce e nunca regride. `resetBudget` existe para o operador
 * reiniciar a janela de canário de forma explícita.
 */
export async function armGlobalRollout(
  executor: CutoverSqlExecutor,
  input: {
    marketplaceId: string;
    mode: CatalogWriterMode;
    enabled: boolean;
    legacyFallbackEnabled: boolean;
    maxWrites: number;
    startedAt?: Date | null;
    expiresAt?: Date | null;
    note?: string | null;
    resetBudget?: boolean;
    closeBreaker?: boolean;
  },
): Promise<GlobalRolloutRow> {
  const res = await executor.query(
    `
    /*
     * Um rollout ARMADO nasce CLOSED: armar é o ato explícito do operador que
     * autoriza o V1, então o estado inicial precisa ser utilizável. O
     * breaker não é o valor padrão seguro aqui — ele é o que a VIOLAÇÃO
     * abre. Quem precisa rearmar depois de um trip tem de dizer isso
     * explicitamente (closeBreaker = true), nunca por omissão.
     */
    INSERT INTO "CatalogCutoverRollout"
      ("id", "marketplaceId", "mode", "enabled", "legacyFallbackEnabled", "maxWrites", "usedWrites",
       "breakerState", "startedAt", "expiresAt", "note", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 0,
            'CLOSED'::"CatalogCutoverBreakerState", $7, $8, $9, NOW(), NOW())
    ON CONFLICT ("marketplaceId") DO UPDATE SET
      "mode" = EXCLUDED."mode",
      "enabled" = EXCLUDED."enabled",
      "legacyFallbackEnabled" = EXCLUDED."legacyFallbackEnabled",
      "maxWrites" = EXCLUDED."maxWrites",
      "breakerState" = CASE WHEN $6::boolean THEN 'CLOSED'::"CatalogCutoverBreakerState" ELSE "CatalogCutoverRollout"."breakerState" END,
      "breakerReason" = CASE WHEN $6::boolean THEN NULL ELSE "CatalogCutoverRollout"."breakerReason" END,
      "breakerTrippedAt" = CASE WHEN $6::boolean THEN NULL ELSE "CatalogCutoverRollout"."breakerTrippedAt" END,
      "startedAt" = EXCLUDED."startedAt",
      "expiresAt" = EXCLUDED."expiresAt",
      "note" = EXCLUDED."note",
      "usedWrites" = CASE WHEN $10::boolean THEN 0 ELSE "CatalogCutoverRollout"."usedWrites" END,
      "updatedAt" = NOW()
    RETURNING ${ROLLOUT_COLUMNS}`,
    [
      input.marketplaceId,
      input.mode,
      input.enabled,
      input.legacyFallbackEnabled,
      input.maxWrites,
      input.closeBreaker ?? false,
      input.startedAt ?? null,
      input.expiresAt ?? null,
      input.note ?? null,
      input.resetBudget ?? false,
    ],
  );

  const row = toRolloutRow(res.rows[0] as Record<string, unknown>);

  await recordGlobalEvent(executor, {
    rolloutId: row.id,
    marketplaceId: row.marketplaceId,
    executionId: `arm:${row.marketplaceId}:${row.maxWrites}`,
    kind: "ARM",
    reason: input.note ?? null,
    usedWrites: row.usedWrites,
    maxWrites: row.maxWrites,
    metadata: { mode: row.mode, enabled: row.enabled },
  });

  return row;
}

/* -------------------------------------------------------------------------- */
/* CONTAGEM DE FALHAS CRÍTICAS (breaker por volume, não por memória)          */
/* -------------------------------------------------------------------------- */

/**
 * Conta falhas V1 recentes do rollout numa janela. O breaker global de
 * "erros V1 acima do limite" NÃO pode usar memória de processo: em N
 * instâncias cada uma contaria só a sua parte.
 */
export async function countRecentV1Failures(
  executor: CutoverSqlExecutor,
  rolloutId: string,
  windowSeconds = 900,
): Promise<number> {
  const res = await executor.query(
    `SELECT COUNT(*)::int AS "total"
       FROM "CatalogCutoverEvent"
      WHERE "rolloutId" = $1
        AND "kind" = 'V1_FAILED'::"CatalogCutoverEventKind"
        AND "createdAt" > NOW() - ($2::int * INTERVAL '1 second')`,
    [rolloutId, windowSeconds],
  );
  return Number((res.rows[0] as { total: number }).total);
}

/* -------------------------------------------------------------------------- */
/* MARCADORES DE COMMIT — GRAVADOS NA TRANSAÇÃO DO CATÁLOGO                   */
/* -------------------------------------------------------------------------- */

/*
 * CRÍTICO — por que o marcador NÃO vai pelo pool `pg`:
 *
 * O pool do global control usa OUTRA conexão. Se o marcador fosse gravado por
 * ele, existiria a janela em que o commit do CATÁLOGO é confirmado e a
 * conexão do marcador cai antes de gravar: o catálogo foi escrito sem rastro
 * algum (e o breaker jamais veria a violação). Por isso o marcador é gravado
 * pelo MESMO `tx` da transação canônica — commit do catálogo e marcador são
 * uma única unidade atômica.
 *
 * E é nesse mesmo contexto que a detecção de double-write e de violação de
 * orçamento acontece: se V1 e o fallback tivessem escrito, o segundo `INSERT`
 * enxerga o marcador do primeiro (visível dentro da transação) e abre o
 * breaker NA MESMA transação do catálogo. Um double-write real, portanto, é
 * impossível de ocultar.
 */

async function siblingCommittedExists(
  tx: CutoverTransactionWriter,
  input: {
    rolloutId: string;
    executionId: string;
    siblingKind: "V1_COMMITTED" | "FALLBACK_COMMITTED";
  },
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ total: number }>(
    Prisma.sql`SELECT COUNT(*)::int AS "total"
                  FROM "CatalogCutoverEvent"
                 WHERE "rolloutId" = ${input.rolloutId}
                   AND "executionId" = ${input.executionId}
                   AND "kind" = ${input.siblingKind}::"CatalogCutoverEventKind"`,
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function insertEventInTransaction(
  tx: CutoverTransactionWriter,
  event: GlobalEventInput,
): Promise<boolean> {
  const written = await tx.$executeRaw(
    Prisma.sql`INSERT INTO "CatalogCutoverEvent"
      ("id", "rolloutId", "marketplaceId", "kind", "reason", "usedWrites", "maxWrites", "executionId", "externalListingId", "metadata", "createdAt")
      VALUES (gen_random_uuid()::text, ${event.rolloutId}, ${event.marketplaceId}, ${event.kind}::"CatalogCutoverEventKind", ${event.reason ?? null}, ${event.usedWrites ?? null}, ${event.maxWrites ?? null}, ${event.executionId}, ${event.externalListingId ?? null}, ${event.metadata ? JSON.stringify(event.metadata) : null}, NOW())
      ON CONFLICT ("executionId", "kind") DO NOTHING`,
  );
  return written > 0;
}

/** Abre o breaker na MESMA transação do catálogo (tabela é do mesmo banco). */
async function tripBreakerInTransaction(
  tx: CutoverTransactionWriter,
  input: {
    rolloutId: string;
    reason: CutoverBreakerReason;
    executionId: string;
  },
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`UPDATE "CatalogCutoverRollout"
                   SET "breakerState" = 'OPEN'::"CatalogCutoverBreakerState",
                       "breakerReason" = ${input.reason},
                       "breakerTrippedAt" = NOW(),
                       "updatedAt" = NOW()
                 WHERE "id" = ${input.rolloutId}
                   AND "breakerState" = 'CLOSED'::"CatalogCutoverBreakerState"`,
  );
}

/**
 * Fecha as duas violações que só podem ser provadas pelo próprio commit:
 *   1. DOUBLE_WRITE — marcador do irmão já existe para a MESMA execução.
 *   2. WRITE_BUDGET_EXCEEDED — `usedWrites > maxWrites` no marcador.
 *
 * Ambas abrem o breaker dentro da transação, de modo que a violação nunca
 * sobrevive ao commit que a produziu.
 */
async function assertNoCommitViolationInTransaction(
  tx: CutoverTransactionWriter,
  input: {
    rolloutId: string;
    marketplaceId: string;
    executionId: string;
    externalListingId: string | null;
    usedWrites: number | null;
    maxWrites: number | null;
    ownKind: "V1_COMMITTED" | "FALLBACK_COMMITTED";
    siblingKind: "V1_COMMITTED" | "FALLBACK_COMMITTED";
  },
): Promise<void> {
  if (await siblingCommittedExists(tx, {
    rolloutId: input.rolloutId,
    executionId: input.executionId,
    siblingKind: input.siblingKind,
  })) {
    await insertEventInTransaction(tx, {
      rolloutId: input.rolloutId,
      marketplaceId: input.marketplaceId,
      executionId: input.executionId,
      kind: "DOUBLE_WRITE",
      reason: `double-write:${input.ownKind}+${input.siblingKind}`,
      usedWrites: input.usedWrites,
      maxWrites: input.maxWrites,
      externalListingId: input.externalListingId,
      metadata: { ownKind: input.ownKind, siblingKind: input.siblingKind },
    });
    await tripBreakerInTransaction(tx, {
      rolloutId: input.rolloutId,
      reason: "DUPLICATE_UNEXPECTED",
      executionId: input.executionId,
    });
    return;
  }

  if (
    input.usedWrites !== null &&
    input.maxWrites !== null &&
    input.usedWrites > input.maxWrites
  ) {
    await insertEventInTransaction(tx, {
      rolloutId: input.rolloutId,
      marketplaceId: input.marketplaceId,
      executionId: input.executionId,
      kind: "PERMIT_DENIED",
      reason: "budget-exceeded-at-commit",
      usedWrites: input.usedWrites,
      maxWrites: input.maxWrites,
      externalListingId: input.externalListingId,
    });
    await tripBreakerInTransaction(tx, {
      rolloutId: input.rolloutId,
      reason: "WRITE_BUDGET_EXCEEDED",
      executionId: input.executionId,
    });
  }
}

/** Marcador durável de commit do V1 primário (gravado no `tx` do catálogo). */
export async function recordV1CommittedInTransaction(
  tx: CutoverTransactionWriter,
  event: {
    rolloutId: string;
    marketplaceId: string;
    executionId: string;
    externalListingId: string;
    usedWrites: number;
    maxWrites: number;
    metadata?: unknown;
  },
): Promise<void> {
  await insertEventInTransaction(tx, {
    ...event,
    kind: "V1_COMMITTED",
    reason: "COMMITTED",
  });
  await assertNoCommitViolationInTransaction(tx, {
    ...event,
    ownKind: "V1_COMMITTED",
    siblingKind: "FALLBACK_COMMITTED",
  });
}

/** Marcador durável de commit do fallback legado (mesma transação). */
export async function recordFallbackCommittedInTransaction(
  tx: CutoverTransactionWriter,
  event: {
    rolloutId: string;
    marketplaceId: string;
    executionId: string;
    externalListingId: string;
    usedWrites: number;
    maxWrites: number;
    metadata?: unknown;
  },
): Promise<void> {
  await insertEventInTransaction(tx, {
    ...event,
    kind: "FALLBACK_COMMITTED",
    reason: "COMMITTED",
  });
  await assertNoCommitViolationInTransaction(tx, {
    ...event,
    ownKind: "FALLBACK_COMMITTED",
    siblingKind: "V1_COMMITTED",
  });
}
