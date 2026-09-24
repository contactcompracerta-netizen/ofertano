/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW METRICS (FASE 5 + FASE 6 ADITIVA).
 *
 * Contadores em memória da shadow (por processo/execução), espelhando o
 * padrão de canary metrics do caminho legado de RawMarketplaceListing.
 * Nenhuma métrica é regra de negócio: servem exclusivamente para o
 * readiness report e diagnóstico operacional.
 *
 * FASE 6 (aditiva, sem quebrar contrato FASE 5):
 *  - `processed`: listings que passaram pela pipeline V1 (handled, sem skip);
 *  - `rawWrites`: escritas reais que persistiram rawPayload (PERSIST_RAW);
 *  - `hashWrites`: escritas reais que persistiram hashes (PERSIST_HASHES).
 * `writeSuccess` mantém a semântica FASE 5 (uma contagem por escrita real que
 * tocou o banco), pois o orçamento canário (`maxWrites - writeSuccess`) é
 * process-local e depende desse valor exato.
 */

export type ShadowMetricsSnapshot = {
  attempted: number;
  processed: number;
  skippedDisabled: number;
  skippedDryRun: number;
  skippedMarketplace: number;
  skippedMaxWrites: number;
  skippedInvalid: number;
  writeSuccess: number;
  rawWrites: number;
  hashWrites: number;
  writeFailed: number;
  hashBackfilled: number;
  parityMatch: number;
  parityV1MorePermissive: number;
  parityUnexpectedMismatch: number;
  paritySkipPartialView: number;
  byMarketplace: Record<string, {
    attempted: number;
    processed: number;
    writeSuccess: number;
    rawWrites: number;
    hashWrites: number;
    writeFailed: number;
  }>;
};

type MutableShadowMetrics = {
  attempted: number;
  processed: number;
  skippedDisabled: number;
  skippedDryRun: number;
  skippedMarketplace: number;
  skippedMaxWrites: number;
  skippedInvalid: number;
  writeSuccess: number;
  rawWrites: number;
  hashWrites: number;
  writeFailed: number;
  hashBackfilled: number;
  parityMatch: number;
  parityV1MorePermissive: number;
  parityUnexpectedMismatch: number;
  paritySkipPartialView: number;
  byMarketplace: Record<string, {
    attempted: number;
    processed: number;
    writeSuccess: number;
    rawWrites: number;
    hashWrites: number;
    writeFailed: number;
  }>;
};

function emptyMarketplaceCounter() {
  return {
    attempted: 0,
    processed: 0,
    writeSuccess: 0,
    rawWrites: 0,
    hashWrites: 0,
    writeFailed: 0,
  };
}

function createEmptyMetrics(): MutableShadowMetrics {
  return {
    attempted: 0,
    processed: 0,
    skippedDisabled: 0,
    skippedDryRun: 0,
    skippedMarketplace: 0,
    skippedMaxWrites: 0,
    skippedInvalid: 0,
    writeSuccess: 0,
    rawWrites: 0,
    hashWrites: 0,
    writeFailed: 0,
    hashBackfilled: 0,
    parityMatch: 0,
    parityV1MorePermissive: 0,
    parityUnexpectedMismatch: 0,
    paritySkipPartialView: 0,
    byMarketplace: {},
  };
}

export interface ShadowMetrics {
  snapshot(): ShadowMetricsSnapshot;
  reset(): ShadowMetricsSnapshot;
  incAttempted(marketplaceId: string): void;
  incProcessed(marketplaceId: string): void;
  incSkippedDisabled(marketplaceId: string): void;
  incSkippedDryRun(marketplaceId: string): void;
  incSkippedMarketplace(marketplaceId: string): void;
  incSkippedMaxWrites(marketplaceId: string): void;
  incSkippedInvalid(marketplaceId: string): void;
  incWriteSuccess(marketplaceId: string): void;
  incRawWrite(marketplaceId: string): void;
  incHashWrite(marketplaceId: string): void;
  incWriteFailed(marketplaceId: string): void;
  incHashBackfilled(marketplaceId: string): void;
  incParityMatch(): void;
  incParityV1MorePermissive(): void;
  incParityUnexpectedMismatch(): void;
  incParitySkipPartialView(): void;
}

function createShadowMetrics(): ShadowMetrics {
  const state: MutableShadowMetrics = createEmptyMetrics();

  function byMarketplace(marketplaceId: string) {
    state.byMarketplace[marketplaceId] ??= emptyMarketplaceCounter();
    return state.byMarketplace[marketplaceId];
  }

  return {
    snapshot(): ShadowMetricsSnapshot {
      return {
        attempted: state.attempted,
        processed: state.processed,
        skippedDisabled: state.skippedDisabled,
        skippedDryRun: state.skippedDryRun,
        skippedMarketplace: state.skippedMarketplace,
        skippedMaxWrites: state.skippedMaxWrites,
        skippedInvalid: state.skippedInvalid,
        writeSuccess: state.writeSuccess,
        rawWrites: state.rawWrites,
        hashWrites: state.hashWrites,
        writeFailed: state.writeFailed,
        hashBackfilled: state.hashBackfilled,
        parityMatch: state.parityMatch,
        parityV1MorePermissive: state.parityV1MorePermissive,
        parityUnexpectedMismatch: state.parityUnexpectedMismatch,
        paritySkipPartialView: state.paritySkipPartialView,
        byMarketplace: Object.fromEntries(
          Object.entries(state.byMarketplace).map(([marketplace, counters]) => [
            marketplace,
            { ...counters },
          ]),
        ),
      };
    },

    reset(): ShadowMetricsSnapshot {
      const snapshot = this.snapshot();
      Object.assign(state, createEmptyMetrics());
      return snapshot;
    },

    incAttempted(marketplaceId: string): void {
      state.attempted += 1;
      byMarketplace(marketplaceId).attempted += 1;
    },
    incProcessed(marketplaceId: string): void {
      state.processed += 1;
      byMarketplace(marketplaceId).processed += 1;
    },
    incSkippedDisabled(marketplaceId: string): void {
      state.skippedDisabled += 1;
    },
    incSkippedDryRun(marketplaceId: string): void {
      state.skippedDryRun += 1;
    },
    incSkippedMarketplace(marketplaceId: string): void {
      state.skippedMarketplace += 1;
    },
    incSkippedMaxWrites(marketplaceId: string): void {
      state.skippedMaxWrites += 1;
    },
    incSkippedInvalid(marketplaceId: string): void {
      state.skippedInvalid += 1;
    },
    incWriteSuccess(marketplaceId: string): void {
      state.writeSuccess += 1;
      byMarketplace(marketplaceId).writeSuccess += 1;
    },
    incRawWrite(marketplaceId: string): void {
      state.rawWrites += 1;
      byMarketplace(marketplaceId).rawWrites += 1;
    },
    incHashWrite(marketplaceId: string): void {
      state.hashWrites += 1;
      byMarketplace(marketplaceId).hashWrites += 1;
    },
    incWriteFailed(marketplaceId: string): void {
      state.writeFailed += 1;
      byMarketplace(marketplaceId).writeFailed += 1;
    },
    incHashBackfilled(marketplaceId: string): void {
      state.hashBackfilled += 1;
    },
    incParityMatch(): void {
      state.parityMatch += 1;
    },
    incParityV1MorePermissive(): void {
      state.parityV1MorePermissive += 1;
    },
    incParityUnexpectedMismatch(): void {
      state.parityUnexpectedMismatch += 1;
    },
    incParitySkipPartialView(): void {
      state.paritySkipPartialView += 1;
    },
  };
}

let metrics: ShadowMetrics | null = null;

export function getShadowMetrics(): ShadowMetrics {
  metrics ??= createShadowMetrics();
  return metrics;
}

export function resetShadowMetrics(): ShadowMetricsSnapshot {
  return getShadowMetrics().reset();
}