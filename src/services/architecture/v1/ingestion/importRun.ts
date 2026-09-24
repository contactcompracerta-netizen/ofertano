/**
 * CATALOG_ARCHITECTURE_V1 — IMPORT RUN / BATCH (FASE J) + RECONCILIATION PREP (FASE K).
 *
 * Preparação para grandes volumes (1.000.000 listings sem requisição HTTP
 * monolítica): cada execução de importação é registrada como ImportRun com
 * subdivisões operacionais (ImportBatch) e contadores de progresso.
 *
 * Reutilização: o schema legado NÃO possuía run/batch (ImportQueue é item-level).
 * Estas estruturas (aditivas, default-OFF no runtime) tornam possível a
 * reconciliação por FULL SNAPSHOT.
 *
 * FASE K — reconciliação NUNCA marca item indisponível no meio de importação
 * incompleta: somente reconciliamos após snapshot concluído com sucesso, e
 * itens sumidos respeitam grace period.
 */

export const IMPORT_RUN_MODES = {
  FULL_SNAPSHOT: "FULL_SNAPSHOT",
  INCREMENTAL: "INCREMENTAL",
  REPROCESS: "REPROCESS",
} as const;

export type ImportRunModeV1 = (typeof IMPORT_RUN_MODES)[keyof typeof IMPORT_RUN_MODES];

export const IMPORT_RUN_STATUS = {
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
} as const;

export type ImportRunStatusV1 =
  (typeof IMPORT_RUN_STATUS)[keyof typeof IMPORT_RUN_STATUS];

export const IMPORT_BATCH_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type ImportBatchStatusV1 =
  (typeof IMPORT_BATCH_STATUS)[keyof typeof IMPORT_BATCH_STATUS];

export interface ImportRunRecordV1 {
  id: string;
  source: string;
  /** marketplaceId canônico; null quando o run agrega vários marketplaces. */
  marketplaceId: string | null;
  mode: ImportRunModeV1;
  status: ImportRunStatusV1;
  startedAt: string;
  finishedAt: string | null;
  itemsReceived: number;
  itemsChanged: number;
  itemsUnchanged: number;
  itemsRejected: number;
  itemsFailed: number;
  /** Marcador de snapshot (último item visto) para reconciliação. */
  lastSeenAt: string | null;
  /** Grace period em minutos antes de reconciliar. Default 1440 (24h). */
  gracePeriodMinutes: number;
  cursor: string | null;
}

export interface ImportBatchRecordV1 {
  id: string;
  runId: string;
  index: number;
  status: ImportBatchStatusV1;
  cursorStart: string | null;
  cursorEnd: string | null;
  itemsReceived: number;
  itemsChanged: number;
  itemsUnchanged: number;
  itemsRejected: number;
  itemsFailed: number;
  startedAt: string;
  finishedAt: string | null;
  lastSeenAt: string | null;
}

/** Repositório injetável (Prisma real ou InMemory nos testes). */
export interface ImportRunRepositoryV1 {
  createRun(input: Omit<ImportRunRecordV1, "id" | "startedAt" | "status"> & {
    id?: string;
    startedAt?: string;
    status?: ImportRunStatusV1;
  }): Promise<ImportRunRecordV1>;

  getRun(runId: string): Promise<ImportRunRecordV1 | null>;

  /** Run mais recente de um marketplace/fonte (para FASE K). */
  findLastRun(marketplaceId: string, source?: string): Promise<ImportRunRecordV1 | null>;

  addBatch(runId: string, input: Partial<ImportBatchRecordV1>): Promise<ImportBatchRecordV1>;

  listBatches(runId: string): Promise<ImportBatchRecordV1[]>;

  completeRun(
    runId: string,
    totals: { received: number; changed: number; unchanged: number; rejected: number; failed: number },
    opts?: { status?: ImportRunStatusV1; lastSeenAt?: string; cursor?: string },
  ): Promise<ImportRunRecordV1>;

  completeBatch(
    runId: string,
    index: number,
    totals: { received: number; changed: number; unchanged: number; rejected: number; failed: number },
  ): Promise<ImportBatchRecordV1>;

  failRun(runId: string, reason: string): Promise<ImportRunRecordV1>;
}

export interface RunTotalsV1 {
  received: number;
  changed: number;
  unchanged: number;
  rejected: number;
  failed: number;
}

/** Acumula totais (somente para forward-looking; sem mutação de DB). */
export function mergeRunTotals(a: RunTotalsV1, b: RunTotalsV1): RunTotalsV1 {
  return {
    received: a.received + b.received,
    changed: a.changed + b.changed,
    unchanged: a.unchanged + b.unchanged,
    rejected: a.rejected + b.rejected,
    failed: a.failed + b.failed,
  };
}

export interface BatchProgressV1 {
  runId: string;
  index: number;
  totals: RunTotalsV1;
}

/**
 * Cria um ImportRun e um primeiro batch PENDING.
 * Retorna { run, batch }.
 */
export async function startImportRun(
  repo: ImportRunRepositoryV1,
  input: {
    source: string;
    marketplaceId?: string | null;
    mode: ImportRunModeV1;
    gracePeriodMinutes?: number;
    cursor?: string | null;
    id?: string;
    startedAt?: string;
  },
): Promise<{ run: ImportRunRecordV1; batch: ImportBatchRecordV1 }> {
  const run = await repo.createRun({
    source: input.source,
    marketplaceId: input.marketplaceId ?? null,
    mode: input.mode,
    status: "RUNNING",
    finishedAt: null,
    itemsReceived: 0,
    itemsChanged: 0,
    itemsUnchanged: 0,
    itemsRejected: 0,
    itemsFailed: 0,
    lastSeenAt: null,
    gracePeriodMinutes: input.gracePeriodMinutes ?? 1440,
    cursor: input.cursor ?? null,
  });
  const batch = await repo.addBatch(run.id, { index: 0, status: "RUNNING" });
  return { run, batch };
}

/**
 * Registra progresso de um batch. Conveniência pura/unitária:
 * soma totais do batch e devolve o novo total (persistência é do repo).
 */
export function accumulateBatchProgress(
  current: RunTotalsV1,
  delta: RunTotalsV1,
): RunTotalsV1 {
  return mergeRunTotals(current, delta);
}

export type SnapshotReconciliationVerdictV1 = "OK" | "SKIP_INCOMPLETE";

export interface MissingListingDetectionV1 {
  snapshotOk: boolean;
  previousTotal: number;
  currentTotal: number;
  missingCount: number;
  /** Chaves candidatas a indisponibilidade. */
  missingKeys: string[];
  /** Chaves ignoradas por grace period / importação incompleta. */
  skippedKeys: string[];
  gracePeriodMinutes: number;
  lastSeenAt: string | null;
}

export interface SnapshotCompareInputV1 {
  previousRun: ImportRunRecordV1 | null;
  previousKeys: string[];
  currentKeys: string[];
  nowIso: string;
  /** Intervalo decorrido desde o fim do snapshot anterior (ms). */
  gracePeriodMinutes?: number;
}

const notString = (s: string, now: string): string =>
  s && !Number.isNaN(Date.parse(s)) ? s : now;

/**
 * FASE K — detecta listagens ausentes num FULL SNAPSHOT.
 *
 * Regras:
 *  - Snapshot anterior não concluído (FAILED/PARTIAL sem sucesso) => SKIP.
 *  - Importação atual ainda em andamento => SKIP (grace period).
 *  - Apenas chaves que sumiram APÓS o fim do snapshot anterior são candidatas.
 */
export function detectMissingListingsFromSnapshot(
  input: SnapshotCompareInputV1,
): MissingListingDetectionV1 {
  const prev = input.previousRun;
  const previousOk =
    prev !== null &&
    prev.mode === "FULL_SNAPSHOT" &&
    prev.status === "COMPLETED";

  const snapshotOk = previousOk && input.previousKeys.length > 0;

  const previousSet = new Set(input.previousKeys);
  const currentSet = new Set(input.currentKeys);

  const missingKeys: string[] = [];
  const skippedKeys: string[] = [];

  if (snapshotOk) {
    const gone = input.previousKeys.filter((k) => !currentSet.has(k));
    const finish =
      notString(prev?.finishedAt ?? "", input.nowIso);
    const nowMs = Date.parse(input.nowIso);
    const finishMs = Date.parse(finish);
    const graceMs =
      (input.gracePeriodMinutes ?? prev?.gracePeriodMinutes ?? 1440) * 60 * 1000;
    const withinGrace = nowMs - finishMs < graceMs;

    if (withinGrace) {
      skippedKeys.push(...gone);
    } else {
      missingKeys.push(...gone);
    }
  } else if (prev !== null) {
    skippedKeys.push(...input.previousKeys.filter((k) => !currentSet.has(k)));
  }

  return {
    snapshotOk,
    previousTotal: input.previousKeys.length,
    currentTotal: input.currentKeys.length,
    missingCount: missingKeys.length,
    missingKeys,
    skippedKeys,
    gracePeriodMinutes: input.gracePeriodMinutes ?? prev?.gracePeriodMinutes ?? 1440,
    lastSeenAt: prev?.lastSeenAt ?? null,
  };
}

/** Adiciona/atualiza o marcador lastSeen do run. */
export function touchRunLastSeen(run: ImportRunRecordV1, nowIso: string): ImportRunRecordV1 {
  return { ...run, lastSeenAt: nowIso };
}