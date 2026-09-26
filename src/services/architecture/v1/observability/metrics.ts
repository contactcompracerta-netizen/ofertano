/**
 * CATALOG_ARCHITECTURE_V1 — OBSERVABILITY METRICS (FASE W).
 *
 * Métricas conceituais por marketplaceId (NUNCA por nome hardcoded).
 * Implementação baseada em contadores em memória (processo único) e labels
 * estruturados — suficiente para diagnóstico e dashboards; sem migração.
 */

export const CATALOG_METRIC_NAMES = [
  "ingestion_received_total",
  "ingestion_changed_total",
  "ingestion_noop_total",
  "catalog_hash_changed_total",
  "offer_hash_changed_total",
  "identity_exact_total",
  "identity_review_total",
  "policy_blocked_total",
  "system_error_total",
  "publication_eligible_total",
  "publication_blocked_total",
  "raw_reprocess_total",
  "duplicate_prevented_total",

  /*
   * FASE 8 (SEGUNDO MARKETPLACE) — métricas aditivas, por marketplaceId.
   * Nenhuma delas é regra: existem para responder "o conector da segunda fonte
   * está saudável?" e "o shadow está vazando publicação?".
   */
  "connector_collect_total",
  "connector_collect_failed_total",
  "normalized_listing_total",
  "raw_write_total",
  "hash_noop_total",
  "hash_offer_only_total",
  "hash_structural_total",
  "identity_reject_total",
  "cross_market_match_total",
  "hard_conflict_total",
  "shadow_publication_excluded_total",
] as const;

export type CatalogMetricName = (typeof CATALOG_METRIC_NAMES)[number];

export interface MetricLabel {
  marketplaceId: string;
  [key: string]: string;
}

export interface CatalogMetricsSnapshot {
  metric: string;
  marketplaceId: string;
  value: number;
  labels: Record<string, string>;
  at: string;
}

/** Diferencia observabilidade de POLICY BLOCK vs SYSTEM FAILURE (FASE N). */
export const OPERATIONAL_OUTCOME = {
  POLICY_BLOCKED: "policy_blocked",
  SYSTEM_FAILURE: "system_failure",
  SUCCESS: "success",
} as const;

export type OperationalOutcome =
  (typeof OPERATIONAL_OUTCOME)[keyof typeof OPERATIONAL_OUTCOME];

function defaultCounters(): Record<string, number> {
  const base: Record<string, number> = {};
  for (const name of CATALOG_METRIC_NAMES) base[name] = 0;
  return base;
}

export interface CatalogMetricsOptions {
  /** Se true, cada incremento é registrado num log estruturado (diagnóstico). */
  verbose?: boolean;
  now?: () => string;
}

/** Registro de métricas por marketplaceId. */
export class CatalogMetrics {
  private readonly counters = new Map<string, Record<string, number>>();
  private readonly events: CatalogMetricsSnapshot[] = [];
  private readonly options: Required<Pick<CatalogMetricsOptions, "verbose">> &
    CatalogMetricsOptions;

  constructor(options: CatalogMetricsOptions = {}) {
    this.options = { verbose: false, ...options };
  }

  private labelsKey(labels: Record<string, string>): string {
    return Object.keys(labels)
      .sort()
      .map((k) => `${k}=${labels[k]}`)
      .join("&");
  }

  private bucket(labels: Record<string, string>): Record<string, number> {
    const key = this.labelsKey(labels);
    let bucket = this.counters.get(key);
    if (!bucket) {
      bucket = defaultCounters();
      this.counters.set(key, bucket);
    }
    return bucket;
  }

  /** Incrementa uma métrica com labels (ao menos marketplaceId). */
  inc(metric: CatalogMetricName, labels: MetricLabel, by = 1): void {
    const bucket = this.bucket(labels);
    bucket[metric] = (bucket[metric] ?? 0) + by;
    if (this.options.verbose) {
      this.events.push({
        metric,
        marketplaceId: labels.marketplaceId,
        value: bucket[metric],
        labels: { ...labels },
        at: this.options.now ? this.options.now() : new Date().toISOString(),
      });
    }
  }

  /** Snapshot plano: métrica + marketplaceId + valor + labels. */
  snapshot(): CatalogMetricsSnapshot[] {
    const out: CatalogMetricsSnapshot[] = [];
    for (const [key, counters] of this.counters) {
      const labels = Object.fromEntries(
        key.split("&").map((part) => {
          const eq = part.indexOf("=");
          return [part.slice(0, eq), part.slice(eq + 1)];
        }),
      ) as Record<string, string>;
      for (const metric of CATALOG_METRIC_NAMES) {
        out.push({
          metric,
          marketplaceId: labels.marketplaceId ?? "",
          value: counters[metric] ?? 0,
          labels,
          at: this.options.now ? this.options.now() : new Date().toISOString(),
        });
      }
    }
    return out;
  }

  /** Total de um evento (através de todos os marketplaceIds). */
  total(metric: CatalogMetricName): number {
    let sum = 0;
    for (const counters of this.counters.values()) sum += (counters[metric] ?? 0);
    return sum;
  }

  /** Eventos granulares (verbose only) — para diagnóstico. */
  recentEvents(limit = 100): CatalogMetricsSnapshot[] {
    return this.events.slice(-limit);
  }
}

/** Registry global default (processo único). */
export const catalogMetrics = new CatalogMetrics();

/** Counter por (métrica, marketplaceId) — forma legada/simples de consulta. */
export function metricCountByMarketplace(
  snapshots: CatalogMetricsSnapshot[],
  metric: CatalogMetricName,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of snapshots) {
    if (s.metric === metric) out[s.marketplaceId] = s.value;
  }
  return out;
}