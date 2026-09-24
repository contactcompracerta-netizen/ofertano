/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW METRICS (FASE 5).
 *
 * Contadores em memória da shadow (por processo/execução), espelhando o
 * padrão de canary metrics do caminho legado de RawMarketplaceListing.
 * Nenhuma métrica é regra de negócio: servem exclusivamente para o
 * readiness report e diagnóstico operacional.
 */

export type ShadowMetricsSnapshot = {
  attempted: number;
  skippedDisabled: number;
  skippedDryRun: number;
  skippedMarketplace: number;
  skippedMaxWrites: number;
  skippedInvalid: number;
  writeSuccess: number;
  writeFailed: number;
  hashBackfilled: number;
  parityMatch: number;
  parityV1MorePermissive: number;
  parityUnexpectedMismatch: number;
  paritySkipPartialView: number;
  byMarketplace: Record<string, {
    attempted: number;
    writeSuccess: number;
    writeFailed: number;
  }>;
};

type MutableShadowMetrics = {
  attempted: number;
  skippedDisabled: number;
  skippedDryRun: number;
  skippedMarketplace: number;
  skippedMaxWrites: number;
  skippedInvalid: number;
  writeSuccess: number;
  writeFailed: number;
  hashBackfilled: number;
  parityMatch: number;
  parityV1MorePermissive: number;
  parityUnexpectedMismatch: number;
  paritySkipPartialView: number;
  byMarketplace: Record<string, {
    attempted: number;
    writeSuccess: number;
    writeFailed: number;
  }>;
};

function emptyMarketplaceCounter() {
  return { attempted: 0, writeSuccess: 0, writeFailed: 0 };
}

function createEmptyMetrics(): MutableShadowMetrics {
  return {
    attempted: 0,
    skippedDisabled: 0,
    skippedDryRun: 0,
    skippedMarketplace: 0,
    skippedMaxWrites: 0,
    skippedInvalid: 0,
    writeSuccess: 0,
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
  incSkippedDisabled(marketplaceId: string): void;
  incSkippedDryRun(marketplaceId: string): void;
  incSkippedMarketplace(marketplaceId: string): void;
  incSkippedMaxWrites(marketplaceId: string): void;
  incSkippedInvalid(marketplaceId: string): void;
  incWriteSuccess(marketplaceId: string): void;
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
        skippedDisabled: state.skippedDisabled,
        skippedDryRun: state.skippedDryRun,
        skippedMarketplace: state.skippedMarketplace,
        skippedMaxWrites: state.skippedMaxWrites,
        skippedInvalid: state.skippedInvalid,
        writeSuccess: state.writeSuccess,
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