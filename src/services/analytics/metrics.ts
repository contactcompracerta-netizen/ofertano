import type {
  FunnelMetrics,
  OpportunityScoreBreakdown,
  OpportunityScoreInput,
  TrendResult,
} from "./types";

export function computeCtr(
  clicks: number,
  impressions: number,
): number | null {
  if (!Number.isFinite(clicks) || !Number.isFinite(impressions)) {
    return null;
  }

  if (impressions <= 0) {
    return null;
  }

  if (clicks < 0) {
    return 0;
  }

  return clicks / impressions;
}

export function formatCtr(ctr: number | null): string {
  if (ctr == null || !Number.isFinite(ctr)) {
    return "—";
  }

  return `${(ctr * 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  })}%`;
}

export function computeTrend(current: number, previous: number): TrendResult {
  const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
  const safePrevious = Number.isFinite(previous) ? Math.max(0, previous) : 0;

  if (safePrevious === 0 && safeCurrent === 0) {
    return {
      current: safeCurrent,
      previous: safePrevious,
      pct: null,
      direction: "flat",
    };
  }

  if (safePrevious === 0) {
    return {
      current: safeCurrent,
      previous: safePrevious,
      pct: null,
      direction: "new",
    };
  }

  const pct = ((safeCurrent - safePrevious) / safePrevious) * 100;
  const rounded = Math.round(pct * 10) / 10;

  return {
    current: safeCurrent,
    previous: safePrevious,
    pct: rounded,
    direction: rounded > 0.5 ? "up" : rounded < -0.5 ? "down" : "flat",
  };
}

export function formatTrendLabel(trend: TrendResult): string {
  if (trend.direction === "new") {
    return "Novo";
  }

  if (trend.pct == null || !Number.isFinite(trend.pct)) {
    return "—";
  }

  const sign = trend.pct > 0 ? "+" : "";

  return `${sign}${trend.pct.toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })}%`;
}

export function trendPctForOpportunityScore(
  trend: TrendResult,
): number | null {
  if (trend.direction === "new") {
    return 100;
  }

  return trend.pct;
}

export function computeFunnel(input: {
  search: number;
  impression: number;
  view: number;
  click: number;
}): FunnelMetrics {
  const search = Math.max(0, input.search);
  const impression = Math.max(0, input.impression);
  const view = Math.max(0, input.view);
  const click = Math.max(0, input.click);

  return {
    search,
    impression,
    view,
    click,
    impressionsPerSearch: search > 0 ? impression / search : null,
    impressionToView: computeCtr(view, impression),
    viewToClick: computeCtr(click, view),
    clickThroughRate: computeCtr(click, impression),
  };
}

export function minMaxNorm(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (max <= min) {
    return value > 0 ? 1 : 0;
  }

  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function growthToUnit(growthPct: number | null): number {
  if (growthPct == null || !Number.isFinite(growthPct)) {
    return 0.33;
  }

  return Math.min(1, Math.max(0, (growthPct + 50) / 150));
}

function ctrToUnit(ctr: number | null): number {
  if (ctr == null || !Number.isFinite(ctr) || ctr <= 0) {
    return 0;
  }

  return Math.min(1, ctr / 0.15);
}

/**
 * Opportunity Score (0–100)
 *
 * Calculado apenas no período selecionado, com métricas normalizadas
 * entre os produtos do recorte. Isso evita que um produto antigo
 * com volume acumulado domine o ranking.
 *
 * Pesos:
 * - 18% volume de pesquisas relacionadas
 * - 18% crescimento da procura (vs período anterior equivalente)
 * - 10% impressões
 * - 14% visualizações
 * - 14% cliques em marketplace
 * - 12% CTR (cliques / impressões), com 15% como teto
 * - 8% favoritos
 * - 6% cobertura de marketplaces (até 4 lojas)
 *
 * O score não usa só volume: CTR, crescimento e cobertura entram
 * com peso relevante.
 */
export const OPPORTUNITY_SCORE_WEIGHTS = {
  searchVolume: 0.18,
  searchGrowth: 0.18,
  impressions: 0.1,
  views: 0.14,
  clicks: 0.14,
  ctr: 0.12,
  favorites: 0.08,
  marketplaceCoverage: 0.06,
} as const;

export function computeOpportunityScore(
  item: OpportunityScoreInput,
  cohort: OpportunityScoreInput[],
): OpportunityScoreBreakdown {
  const searches = cohort.map((row) => row.searches);
  const impressions = cohort.map((row) => row.impressions);
  const views = cohort.map((row) => row.views);
  const clicks = cohort.map((row) => row.clicks);
  const favorites = cohort.map((row) => row.favorites);

  const parts = {
    searchVolume: minMaxNorm(
      item.searches,
      Math.min(...searches),
      Math.max(...searches),
    ),
    searchGrowth: growthToUnit(item.searchGrowthPct),
    impressions: minMaxNorm(
      item.impressions,
      Math.min(...impressions),
      Math.max(...impressions),
    ),
    views: minMaxNorm(item.views, Math.min(...views), Math.max(...views)),
    clicks: minMaxNorm(item.clicks, Math.min(...clicks), Math.max(...clicks)),
    ctr: ctrToUnit(item.ctr),
    favorites: minMaxNorm(
      item.favorites,
      Math.min(...favorites),
      Math.max(...favorites),
    ),
    marketplaceCoverage: Math.min(1, Math.max(0, item.marketplaceCount / 4)),
  };

  const score = Math.round(
    100 *
      (parts.searchVolume * OPPORTUNITY_SCORE_WEIGHTS.searchVolume +
        parts.searchGrowth * OPPORTUNITY_SCORE_WEIGHTS.searchGrowth +
        parts.impressions * OPPORTUNITY_SCORE_WEIGHTS.impressions +
        parts.views * OPPORTUNITY_SCORE_WEIGHTS.views +
        parts.clicks * OPPORTUNITY_SCORE_WEIGHTS.clicks +
        parts.ctr * OPPORTUNITY_SCORE_WEIGHTS.ctr +
        parts.favorites * OPPORTUNITY_SCORE_WEIGHTS.favorites +
        parts.marketplaceCoverage *
          OPPORTUNITY_SCORE_WEIGHTS.marketplaceCoverage),
  );

  return {
    score: Math.min(100, Math.max(0, score)),
    parts,
  };
}

export function previousPeriodRange(from: Date, to: Date): { from: Date; to: Date } {
  const durationMs = to.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - durationMs),
    to: new Date(from.getTime()),
  };
}

export const ANALYTICS_TIME_ZONE = "America/Sao_Paulo";

export function dateKeyInTimeZone(
  date: Date,
  timeZone = ANALYTICS_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function utcDateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function periodFromPreset(
  preset: "today" | "7d" | "30d" | "90d",
  now = new Date(),
): { from: Date; to: Date } {
  const todayKey = dateKeyInTimeZone(now);
  const today = utcDateFromKey(todayKey);
  const tomorrow = addUtcDays(today, 1);

  if (preset === "today") {
    return { from: today, to: tomorrow };
  }

  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  return {
    from: addUtcDays(tomorrow, -days),
    to: tomorrow,
  };
}

export function parseDateKeyRange(
  fromKey: string | null | undefined,
  toKey: string | null | undefined,
): { from: Date; to: Date } | null {
  if (!fromKey || !toKey) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) {
    return null;
  }

  const from = utcDateFromKey(fromKey);
  const toInclusive = utcDateFromKey(toKey);

  if (Number.isNaN(from.getTime()) || Number.isNaN(toInclusive.getTime())) {
    return null;
  }

  const to = addUtcDays(toInclusive, 1);

  if (to.getTime() <= from.getTime()) {
    return null;
  }

  const maxMs = 366 * 24 * 60 * 60 * 1000;

  if (to.getTime() - from.getTime() > maxMs) {
    return null;
  }

  return { from, to };
}

export function enumerateDateKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  let cursor = new Date(from.getTime());

  while (cursor.getTime() < to.getTime()) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor = addUtcDays(cursor, 1);
  }

  return keys;
}
