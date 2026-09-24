/**
 * CATALOG_ARCHITECTURE_V1 — CUTOVER METRICS (FASE Q).
 *
 * Métricas do cutover progressivo POR MARKETPLACE.
 *
 * Nomes (FASE Q):
 *   v1_authoritative_attempt_total
 *   v1_authoritative_success_total
 *   v1_authoritative_failure_total
 *   legacy_fallback_total
 *   legacy_fallback_success_total
 *   authoritative_parity_match_total
 *   authoritative_parity_difference_total
 *   cutover_breaker_total
 *   cutover_write_budget_skipped_total
 *
 * Todas são process-local (PROCESS_LOCAL); o canário agrega por
 * marketplaceId e o snapshot final alimenta o relatório.
 */

export type CutoverMeterCounters = {
  v1_authoritative_attempt_total: number;
  v1_authoritative_success_total: number;
  v1_authoritative_failure_total: number;
  legacy_fallback_total: number;
  legacy_fallback_success_total: number;
  authoritative_parity_match_total: number;
  authoritative_parity_difference_total: number;
  cutover_breaker_total: number;
  cutover_write_budget_skipped_total: number;
};

export type CutoverMetricsSnapshot = {
  byMarketplace: Record<string, CutoverMeterCounters>;
};

export interface CutoverMetrics {
  incV1Attempt(marketplaceId: string): void;
  incV1Success(marketplaceId: string): void;
  incV1Failure(marketplaceId: string): void;
  incLegacyFallback(marketplaceId: string): void;
  incLegacyFallbackSuccess(marketplaceId: string): void;
  incParityMatch(marketplaceId: string): void;
  incParityDifference(marketplaceId: string): void;
  incBreaker(marketplaceId: string): void;
  incWriteBudgetSkipped(marketplaceId: string): void;
  snapshot(): CutoverMetricsSnapshot;
  reset(): CutoverMetricsSnapshot;
}

const EMPTY_COUNTERS: CutoverMeterCounters = {
  v1_authoritative_attempt_total: 0,
  v1_authoritative_success_total: 0,
  v1_authoritative_failure_total: 0,
  legacy_fallback_total: 0,
  legacy_fallback_success_total: 0,
  authoritative_parity_match_total: 0,
  authoritative_parity_difference_total: 0,
  cutover_breaker_total: 0,
  cutover_write_budget_skipped_total: 0,
};

function clone(counters: CutoverMeterCounters): CutoverMeterCounters {
  return { ...counters };
}

function createCutoverMetrics(): CutoverMetrics {
  const state = new Map<string, CutoverMeterCounters>();

  function countersFor(marketplaceId: string): CutoverMeterCounters {
    let counters = state.get(marketplaceId);
    if (!counters) {
      counters = clone(EMPTY_COUNTERS);
      state.set(marketplaceId, counters);
    }
    return counters;
  }

  return {
    incV1Attempt(marketplaceId) {
      countersFor(marketplaceId).v1_authoritative_attempt_total += 1;
    },
    incV1Success(marketplaceId) {
      countersFor(marketplaceId).v1_authoritative_success_total += 1;
    },
    incV1Failure(marketplaceId) {
      countersFor(marketplaceId).v1_authoritative_failure_total += 1;
    },
    incLegacyFallback(marketplaceId) {
      countersFor(marketplaceId).legacy_fallback_total += 1;
    },
    incLegacyFallbackSuccess(marketplaceId) {
      countersFor(marketplaceId).legacy_fallback_success_total += 1;
    },
    incParityMatch(marketplaceId) {
      countersFor(marketplaceId).authoritative_parity_match_total += 1;
    },
    incParityDifference(marketplaceId) {
      countersFor(marketplaceId).authoritative_parity_difference_total += 1;
    },
    incBreaker(marketplaceId) {
      countersFor(marketplaceId).cutover_breaker_total += 1;
    },
    incWriteBudgetSkipped(marketplaceId) {
      countersFor(marketplaceId).cutover_write_budget_skipped_total += 1;
    },
    snapshot() {
      const byMarketplace: Record<string, CutoverMeterCounters> = {};
      for (const [marketplaceId, counters] of state.entries()) {
        byMarketplace[marketplaceId] = clone(counters);
      }
      return { byMarketplace };
    },
    reset() {
      const previous = this.snapshot();
      state.clear();
      return previous;
    },
  };
}

let cutoverMetrics: CutoverMetrics | null = null;

export function getCutoverMetrics(): CutoverMetrics {
  cutoverMetrics ??= createCutoverMetrics();
  return cutoverMetrics;
}

export function resetCutoverMetrics(): CutoverMetricsSnapshot {
  return getCutoverMetrics().reset();
}

export function cutoverMetricsForMarketplace(
  marketplaceId: string,
  snapshot: CutoverMetricsSnapshot,
): CutoverMeterCounters {
  return snapshot.byMarketplace[marketplaceId] ?? clone(EMPTY_COUNTERS);
}