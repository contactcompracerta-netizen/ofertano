import { formatCtr } from "./metrics";
import type { FunnelMetrics, TrendResult } from "./types";

export const PRODUCT_NAME_CELL_CLASS =
  "min-w-0 max-w-[22rem] overflow-hidden break-words";

export const PRODUCT_NAME_TEXT_CLASS =
  "line-clamp-2 text-sm font-medium leading-5 text-slate-950";

export const TABLE_WRAP_CLASS = "overflow-x-auto overscroll-x-contain";

export const DESKTOP_TABLE_CLASS =
  "hidden min-w-full table-fixed md:table";

export const MOBILE_STACK_CLASS = "space-y-3 md:hidden";

export type SeriesPoint = {
  day: string;
  searches: number;
  views: number;
  clicks: number;
};

export type FunnelStepPresentation = {
  key: string;
  label: string;
  volume: number;
  details: string[];
};

export function seriesBarHeightPct(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(max) || max <= 0) {
    return 0;
  }

  return Math.max(12, (value / max) * 100);
}

export function seriesChartLayout(series: SeriesPoint[]) {
  const activePoints = series.filter(
    (point) => point.searches + point.views + point.clicks > 0,
  );

  return {
    isEmpty: series.length === 0 || activePoints.length === 0,
    isSinglePoint: series.length === 1 || activePoints.length === 1,
    columnMinWidthClass:
      series.length <= 1 ? "min-w-[4.5rem]" : "min-w-[1.15rem]",
    showMarkers: series.length === 1 || activePoints.length <= 1,
    max: Math.max(
      1,
      ...series.map((point) =>
        Math.max(point.searches, point.views, point.clicks),
      ),
    ),
  };
}

export function compactMarketplaces(
  labels: string[],
  maxVisible = 2,
): {
  visible: string[];
  extra: number;
  hidden: string[];
  text: string;
} {
  const unique: string[] = [];

  for (const label of labels) {
    const trimmed = label.trim();

    if (!trimmed || unique.includes(trimmed)) {
      continue;
    }

    unique.push(trimmed);
  }

  const visible = unique.slice(0, maxVisible);
  const hidden = unique.slice(maxVisible);
  const extra = hidden.length;
  const text =
    extra > 0
      ? `${visible.join(" · ")} +${extra}`
      : visible.join(" · ") || "—";

  return { visible, extra, hidden, text };
}

export function formatImpressionsPerSearch(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  const formatted = value.toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });

  return `${formatted} por pesquisa`;
}

export function buildFunnelPresentation(
  funnel: FunnelMetrics,
): FunnelStepPresentation[] {
  const impressionDetails = [
    `${new Intl.NumberFormat("pt-BR").format(funnel.impression)} impressões`,
    formatImpressionsPerSearch(funnel.impressionsPerSearch),
  ].filter((item): item is string => Boolean(item));

  const viewDetails = [
    funnel.impressionToView != null
      ? `${formatCtr(funnel.impressionToView)} views / impressões`
      : null,
  ].filter((item): item is string => Boolean(item));

  const clickDetails = [
    funnel.viewToClick != null
      ? `${formatCtr(funnel.viewToClick)} cliques / views`
      : null,
    funnel.clickThroughRate != null
      ? `${formatCtr(funnel.clickThroughRate)} CTR (cliques / impressões)`
      : null,
  ].filter((item): item is string => Boolean(item));

  return [
    {
      key: "SEARCH",
      label: "Pesquisas",
      volume: funnel.search,
      details: [],
    },
    {
      key: "PRODUCT_IMPRESSION",
      label: "Impressões",
      volume: funnel.impression,
      details: impressionDetails,
    },
    {
      key: "PRODUCT_VIEW",
      label: "Visualizações",
      volume: funnel.view,
      details: viewDetails,
    },
    {
      key: "MARKETPLACE_CLICK",
      label: "Cliques externos",
      volume: funnel.click,
      details: clickDetails,
    },
  ];
}

export function funnelShowsAmbiguousConversion(
  steps: FunnelStepPresentation[],
): boolean {
  return steps.some((step) =>
    step.details.some((detail) =>
      /convers[aã]o|400\s*%|impressões\s*=\s*\d/i.test(detail),
    ),
  );
}

export function trendBadgeTone(trend: TrendResult): string {
  if (trend.direction === "new") {
    return "bg-sky-50 text-sky-800";
  }

  if (trend.direction === "up") {
    return "bg-emerald-50 text-emerald-800";
  }

  if (trend.direction === "down") {
    return "bg-rose-50 text-rose-800";
  }

  return "bg-slate-100 text-slate-600";
}
