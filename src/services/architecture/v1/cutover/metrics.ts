/**
 * CATALOG_ARCHITECTURE_V1 — CUTOVER METRICS (FASE Q / FASE 7.1 FASE P).
 *
 * Métricas do cutover progressivo POR MARKETPLACE.
 *
 * Nomes (FASE Q — canário/replay):
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
 * Nomes (FASE 7.1 FASE P — tráfego normal LIVE, controlado pelo plano global):
 *   v1_live_authoritative_attempt_total
 *   v1_live_authoritative_success_total
 *   v1_live_authoritative_failure_total
 *   legacy_live_fallback_total
 *   legacy_live_only_total
 *   global_cutover_budget_used
 *   global_cutover_budget_remaining
 *   global_cutover_breaker_total
 *   global_cutover_double_write_total
 *   live_parity_difference_total
 *   live_parity_match_total
 *   live_parity_expected_difference_total
 *   live_parity_unexpected_difference_total
 *
 * Os contadores `v1_live_*`/`legacy_live_*`/`live_parity_*` são
 * process-local por natureza (ocorrem no processo que executa a escrita), mas
 * `global_cutover_budget_used` / `_remaining` NÃO são um contador local: eles
 * refletem o valor devolvido pelo banco na aquisição atômica da permissão, ou
 * seja, o mesmo número para todas as instâncias.
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
  /* FASE 7.1 — tráfego normal (LIVE) */
  v1_live_authoritative_attempt_total: number;
  v1_live_authoritative_success_total: number;
  v1_live_authoritative_failure_total: number;
  legacy_live_fallback_total: number;
  legacy_live_fallback_success_total: number;
  legacy_live_fallback_failure_total: number;
  legacy_live_only_total: number;
  global_cutover_budget_used: number;
  global_cutover_budget_remaining: number;
  global_cutover_breaker_total: number;
  global_cutover_double_write_total: number;
  live_parity_match_total: number;
  live_parity_expected_difference_total: number;
  live_parity_unexpected_difference_total: number;
  /** Alias canônico exigido pelo contrato de métricas. */
  live_parity_difference_total: number;
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
  /* FASE 7.1 */
  incLiveAuthoritativeAttempt(marketplaceId: string): void;
  incLiveAuthoritativeSuccess(marketplaceId: string): void;
  incLiveAuthoritativeFailure(marketplaceId: string): void;
  incLiveLegacyFallback(marketplaceId: string): void;
  incLiveLegacyFallbackSuccess(marketplaceId: string): void;
  incLiveLegacyFallbackFailure(marketplaceId: string): void;
  incLiveLegacyOnly(marketplaceId: string): void;
  setGlobalBudget(marketplaceId: string, used: number, max: number): void;
  incLiveBreaker(marketplaceId: string): void;
  incLiveDoubleWrite(marketplaceId: string): void;
  incLiveParityMatch(marketplaceId: string): void;
  incLiveParityExpectedDifference(marketplaceId: string): void;
  incLiveParityUnexpectedDifference(marketplaceId: string): void;
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
  v1_live_authoritative_attempt_total: 0,
  v1_live_authoritative_success_total: 0,
  v1_live_authoritative_failure_total: 0,
  legacy_live_fallback_total: 0,
  legacy_live_fallback_success_total: 0,
  legacy_live_fallback_failure_total: 0,
  legacy_live_only_total: 0,
  global_cutover_budget_used: 0,
  global_cutover_budget_remaining: 0,
  global_cutover_breaker_total: 0,
  global_cutover_double_write_total: 0,
  live_parity_match_total: 0,
  live_parity_expected_difference_total: 0,
  live_parity_unexpected_difference_total: 0,
  live_parity_difference_total: 0,
};

function clone(counters: CutoverMeterCounters): CutoverMeterCounters {
  return { ...counters };
}

/** Contadores zerados (snapshot isolado por marketplace/relatório). */
export function emptyCutoverCounters(): CutoverMeterCounters {
  return clone(EMPTY_COUNTERS);
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
    incLiveAuthoritativeAttempt(marketplaceId) {
      countersFor(marketplaceId).v1_live_authoritative_attempt_total += 1;
    },
    incLiveAuthoritativeSuccess(marketplaceId) {
      countersFor(marketplaceId).v1_live_authoritative_success_total += 1;
    },
    incLiveAuthoritativeFailure(marketplaceId) {
      countersFor(marketplaceId).v1_live_authoritative_failure_total += 1;
    },
    incLiveLegacyFallback(marketplaceId) {
      countersFor(marketplaceId).legacy_live_fallback_total += 1;
    },
    incLiveLegacyFallbackSuccess(marketplaceId) {
      countersFor(marketplaceId).legacy_live_fallback_success_total += 1;
    },
    incLiveLegacyFallbackFailure(marketplaceId) {
      countersFor(marketplaceId).legacy_live_fallback_failure_total += 1;
    },
    incLiveLegacyOnly(marketplaceId) {
      countersFor(marketplaceId).legacy_live_only_total += 1;
    },
    setGlobalBudget(marketplaceId, used, max) {
      const counters = countersFor(marketplaceId);
      counters.global_cutover_budget_used = used;
      counters.global_cutover_budget_remaining = Math.max(0, max - used);
    },
    incLiveBreaker(marketplaceId) {
      countersFor(marketplaceId).global_cutover_breaker_total += 1;
    },
    incLiveDoubleWrite(marketplaceId) {
      countersFor(marketplaceId).global_cutover_double_write_total += 1;
    },
    incLiveParityMatch(marketplaceId) {
      const counters = countersFor(marketplaceId);
      counters.live_parity_match_total += 1;
    },
    incLiveParityExpectedDifference(marketplaceId) {
      const counters = countersFor(marketplaceId);
      counters.live_parity_expected_difference_total += 1;
      counters.live_parity_difference_total += 1;
    },
    incLiveParityUnexpectedDifference(marketplaceId) {
      const counters = countersFor(marketplaceId);
      counters.live_parity_unexpected_difference_total += 1;
      counters.live_parity_difference_total += 1;
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
