"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { IntelligenceDashboard } from "@/services/analytics/dashboard";
import type { IntelligenceSort } from "@/services/analytics/dashboard";
import { dateKeyInTimeZone, formatCtr, formatTrendLabel } from "@/services/analytics/metrics";
import {
  DESKTOP_TABLE_CLASS,
  MOBILE_STACK_CLASS,
  PRODUCT_NAME_CELL_CLASS,
  PRODUCT_NAME_TEXT_CLASS,
  TABLE_WRAP_CLASS,
  buildFunnelPresentation,
  compactMarketplaces,
  seriesBarHeightPct,
  seriesChartLayout,
  trendBadgeTone,
} from "@/services/analytics/presentation";
import type { TrendResult } from "@/services/analytics/types";

type Preset = "today" | "7d" | "30d" | "90d" | "custom";

const cardClass =
  "rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const thClass =
  "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";

const thNumClass = `${thClass} text-right`;

const tdClass = "px-3 py-2 text-sm text-slate-800";

const tdNumClass = `${tdClass} text-right tabular-nums`;

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(Math.round(value));
}

function formatAvg(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }

  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}

function formatMarketplace(marketplace: string) {
  const nomes: Record<string, string> = {
    MERCADO_LIVRE: "Mercado Livre",
    AMAZON: "Amazon",
    SHOPEE: "Shopee",
    MAGAZINE_LUIZA: "Magalu",
    CASAS_BAHIA: "Casas Bahia",
    KABUM: "KaBuM!",
    TERABYTE: "Terabyte",
    ALIEXPRESS: "AliExpress",
    CARREFOUR: "Carrefour",
  };

  return (
    nomes[marketplace] ||
    marketplace
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letra) => letra.toUpperCase())
  );
}

function formatDevice(deviceType: string) {
  if (deviceType === "mobile") return "Mobile";
  if (deviceType === "desktop") return "Desktop";
  if (deviceType === "tablet") return "Tablet";
  return "Não identificado";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TrendBadge({ trend }: { trend: TrendResult }) {
  const label = formatTrendLabel(trend);
  const color = trendBadgeTone(trend);
  const arrow =
    trend.direction === "new"
      ? "●"
      : trend.direction === "up"
        ? "▲"
        : trend.direction === "down"
          ? "▼"
          : "▬";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}
    >
      <span aria-hidden="true">{arrow}</span>
      {label}
    </span>
  );
}

function ScoreBar({ score }: { score: number | null }) {
  const value = score ?? 0;

  return (
    <div className="flex min-w-[5.5rem] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-emerald-600"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">
        {score == null ? "—" : Math.round(value)}
      </span>
    </div>
  );
}

function MarketplaceChips({ marketplaces }: { marketplaces: string[] }) {
  const model = compactMarketplaces(marketplaces.map(formatMarketplace), 2);

  if (model.visible.length === 0) {
    return <span className="text-slate-400">—</span>;
  }

  return (
    <div className="flex max-w-[11rem] flex-wrap gap-1">
      {model.visible.map((name) => (
        <span
          key={name}
          title={name}
          className="inline-flex max-w-[6.5rem] truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700"
        >
          {name}
        </span>
      ))}
      {model.extra > 0 ? (
        <span
          title={model.hidden.join(" · ")}
          className="inline-flex rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500"
        >
          +{model.extra}
        </span>
      ) : null}
    </div>
  );
}

function ProductName({
  name,
  extra,
}: {
  name: string;
  extra?: string | null;
}) {
  return (
    <div className={PRODUCT_NAME_CELL_CLASS}>
      <p className={PRODUCT_NAME_TEXT_CLASS} title={name}>
        {name}
      </p>
      {extra ? (
        <p className="mt-1 truncate text-[11px] text-slate-500" title={extra}>
          {extra}
        </p>
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: TrendResult;
}) {
  return (
    <article className={cardClass}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-2xl font-semibold tracking-tight text-slate-950">
          {value}
        </p>
        {trend ? <TrendBadge trend={trend} /> : null}
      </div>
      {hint ? (
        <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>
      ) : null}
    </article>
  );
}

function SeriesChart({
  series,
}: {
  series: IntelligenceDashboard["series"];
}) {
  const layout = seriesChartLayout(series);

  return (
    <div className={cardClass}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Tendência do período
          </p>
          <h2 className="mt-1 text-sm font-semibold text-slate-950">
            Pesquisas, views e cliques
          </h2>
        </div>
        <div className="flex gap-3 text-[11px] font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-slate-400" /> Pesquisas
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Views
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-800" /> Cliques
          </span>
        </div>
      </div>
      {layout.isEmpty ? (
        <p className="flex h-28 items-center text-sm text-slate-500">
          Sem dados no período.
        </p>
      ) : (
        <div
          className={`flex h-28 items-end gap-1 ${layout.isSinglePoint ? "max-w-xs" : ""}`}
        >
          {series.map((point) => (
            <div
              key={point.day}
              className={`flex h-full ${layout.columnMinWidthClass} min-w-0 flex-1 items-end justify-center gap-px`}
              title={`${point.day}: ${point.searches} pesquisas, ${point.views} views, ${point.clicks} cliques`}
            >
              {(
                [
                  ["searches", "bg-slate-300", point.searches],
                  ["views", "bg-emerald-500", point.views],
                  ["clicks", "bg-emerald-800", point.clicks],
                ] as const
              ).map(([key, color, value]) => (
                <div
                  key={key}
                  className="relative flex h-full w-[30%] items-end justify-center"
                >
                  <div
                    className={`w-full rounded-t ${color} ${layout.showMarkers && value > 0 ? "min-h-3" : ""}`}
                    style={{
                      height: `${seriesBarHeightPct(value, layout.max)}%`,
                    }}
                  />
                  {layout.showMarkers && value > 0 ? (
                    <span
                      aria-hidden="true"
                      className={`absolute h-2.5 w-2.5 rounded-full ring-2 ring-white ${color}`}
                      style={{
                        bottom: `calc(${seriesBarHeightPct(value, layout.max)}% - 5px)`,
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Funnel({ funnel }: { funnel: IntelligenceDashboard["funnel"] }) {
  const steps = buildFunnelPresentation(funnel);
  const max = Math.max(1, ...steps.map((step) => step.volume));

  return (
    <div className={cardClass}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Funil
      </p>
      <h2 className="mt-1 text-sm font-semibold text-slate-950">
        Pesquisa até clique externo
      </h2>
      <div className="mt-4 space-y-3">
        {steps.map((step) => (
          <div key={step.key}>
            <div className="mb-1 flex items-start justify-between gap-3 text-xs">
              <div className="min-w-0">
                <p className="font-semibold text-slate-700">{step.label}</p>
                {step.details.length > 0 ? (
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                    {step.details.join(" · ")}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 tabular-nums font-semibold text-slate-800">
                {formatNumber(step.volume)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-600"
                style={{ width: `${(step.volume / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductTable({
  rows,
  showScore = false,
}: {
  rows: IntelligenceDashboard["products"]["mostViewed"];
  showScore?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-3 py-6 text-sm text-slate-500">
        Sem dados de produto neste período.
      </p>
    );
  }

  return (
    <>
      <div className={MOBILE_STACK_CLASS}>
        {rows.map((row) => (
          <article
            key={row.productId}
            className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
          >
            <ProductName
              name={row.name}
              extra={
                showScore && row.relatedQueries.length > 0
                  ? row.relatedQueries.join(" · ")
                  : null
              }
            />
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              {showScore ? (
                <div>
                  <dt className="text-slate-500">Pesquisas</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatNumber(row.relatedSearchCount)}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-slate-500">Impressões</dt>
                <dd className="font-semibold tabular-nums">
                  {formatNumber(row.impressions)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Views</dt>
                <dd className="font-semibold tabular-nums">
                  {formatNumber(row.views)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Cliques</dt>
                <dd className="font-semibold tabular-nums">
                  {formatNumber(row.clicks)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">CTR</dt>
                <dd className="font-semibold tabular-nums">
                  {formatCtr(row.ctr)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Favoritos</dt>
                <dd className="font-semibold tabular-nums">
                  {formatNumber(row.favorites)}
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex items-center justify-between gap-2">
              <MarketplaceChips marketplaces={row.marketplaces} />
              <TrendBadge trend={row.trend} />
            </div>
            {showScore ? (
              <div className="mt-2">
                <ScoreBar score={row.opportunityScore} />
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <div className={`${TABLE_WRAP_CLASS} hidden md:block`}>
        <table className={DESKTOP_TABLE_CLASS}>
          <colgroup>
            <col className="w-[32%]" />
            {showScore ? <col className="w-[8%]" /> : null}
            <col className="w-[9%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[14%]" />
            <col className="w-[9%]" />
            {showScore ? <col className="w-[12%]" /> : null}
          </colgroup>
          <thead className="border-b border-slate-100 bg-slate-50/80">
            <tr>
              <th className={thClass}>Produto</th>
              {showScore ? <th className={thNumClass}>Pesquisas</th> : null}
              <th className={thNumClass}>Impressões</th>
              <th className={thNumClass}>Views</th>
              <th className={thNumClass}>Cliques</th>
              <th className={thNumClass} title="Cliques / impressões">
                CTR
              </th>
              <th className={thNumClass}>Favoritos</th>
              <th className={thClass}>Marketplaces</th>
              <th className={thClass}>Tendência</th>
              {showScore ? <th className={thClass}>Score</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.productId} className="border-b border-slate-100">
                <td className={`${tdClass} align-top`}>
                  <ProductName
                    name={row.name}
                    extra={
                      showScore && row.relatedQueries.length > 0
                        ? row.relatedQueries.join(" · ")
                        : null
                    }
                  />
                </td>
                {showScore ? (
                  <td className={`${tdNumClass} align-top`}>
                    {formatNumber(row.relatedSearchCount)}
                  </td>
                ) : null}
                <td className={`${tdNumClass} align-top`}>
                  {formatNumber(row.impressions)}
                </td>
                <td className={`${tdNumClass} align-top`}>
                  {formatNumber(row.views)}
                </td>
                <td className={`${tdNumClass} align-top`}>
                  {formatNumber(row.clicks)}
                </td>
                <td className={`${tdNumClass} align-top`}>
                  {formatCtr(row.ctr)}
                </td>
                <td className={`${tdNumClass} align-top`}>
                  {formatNumber(row.favorites)}
                </td>
                <td className={`${tdClass} align-top`}>
                  <MarketplaceChips marketplaces={row.marketplaces} />
                </td>
                <td className={`${tdClass} align-top`}>
                  <TrendBadge trend={row.trend} />
                </td>
                {showScore ? (
                  <td className={`${tdClass} align-top`}>
                    <ScoreBar score={row.opportunityScore} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function InteligenciaDashboard() {
  const [preset, setPreset] = useState<Preset>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searchSort, setSearchSort] = useState<IntelligenceSort>("searches");
  const [productTab, setProductTab] = useState<
    "viewed" | "clicked" | "ctr" | "growing"
  >("viewed");
  const [data, setData] = useState<IntelligenceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("searchSort", searchSort);

    if (preset === "custom" && from && to) {
      params.set("from", from);
      params.set("to", to);
    } else if (preset !== "custom") {
      params.set("preset", preset);
    } else {
      params.set("preset", "7d");
    }

    return params.toString();
  }, [preset, from, to, searchSort]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/inteligencia?${query}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        success: boolean;
        data?: IntelligenceDashboard;
        error?: string;
      };

      if (!response.ok || !payload.success || !payload.data) {
        setError(payload.error || "Não foi possível carregar o painel.");
        setData(null);
        return;
      }

      setData(payload.data);
    } catch {
      setError("Não foi possível carregar o painel.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = dateKeyInTimeZone(new Date());

  const productRows =
    productTab === "viewed"
      ? data?.products.mostViewed ?? []
      : productTab === "clicked"
        ? data?.products.mostClicked ?? []
        : productTab === "ctr"
          ? data?.products.bestCtr ?? []
          : data?.products.growing ?? [];

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-[1200px]">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Inteligência
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              Analytics do Ofertano
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Comportamento first-party para decidir tráfego pago, conteúdo e
              descoberta. Clique em marketplace não é compra. CTR é sempre
              cliques / impressões.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["today", "Hoje"],
                  ["7d", "7 dias"],
                  ["30d", "30 dias"],
                  ["90d", "90 dias"],
                  ["custom", "Personalizado"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPreset(value)}
                  className={`h-9 rounded-lg px-3 text-sm font-semibold ${
                    preset === value
                      ? "bg-emerald-600 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {preset === "custom" ? (
              <div className="flex gap-2">
                <input
                  type="date"
                  value={from}
                  max={today}
                  onChange={(event) => setFrom(event.target.value)}
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                />
                <input
                  type="date"
                  value={to}
                  max={today}
                  onChange={(event) => setTo(event.target.value)}
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
                />
              </div>
            ) : null}
          </div>
        </header>

        {error ? (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {loading && !data ? (
          <p className="text-sm text-slate-500">Carregando métricas...</p>
        ) : null}

        {data ? (
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3 xl:grid-cols-6">
              <KpiCard
                label="Sessões"
                value={formatNumber(data.overview.sessions)}
                trend={data.overview.trends.sessions}
              />
              <KpiCard
                label="Pesquisas"
                value={formatNumber(data.overview.searches)}
                trend={data.overview.trends.searches}
              />
              <KpiCard
                label="Visualizações"
                value={formatNumber(data.overview.views)}
                trend={data.overview.trends.views}
              />
              <KpiCard
                label="Cliques externos"
                value={formatNumber(data.overview.clicks)}
                trend={data.overview.trends.clicks}
              />
              <KpiCard
                label="CTR"
                value={formatCtr(data.overview.ctr)}
                hint="Cliques / impressões"
              />
              <KpiCard
                label="Zero resultados"
                value={formatNumber(data.overview.zeroResults)}
                trend={data.overview.trends.zeroResults}
              />
            </section>

            <section className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <SeriesChart series={data.series} />
              <Funnel funnel={data.funnel} />
            </section>

            <section className={cardClass}>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Demanda
                  </p>
                  <h2 className="mt-1 text-sm font-semibold text-slate-950">
                    Pesquisas mais feitas
                  </h2>
                </div>
                <label className="text-xs font-medium text-slate-600">
                  Ordenar
                  <select
                    value={searchSort}
                    onChange={(event) =>
                      setSearchSort(event.target.value as IntelligenceSort)
                    }
                    className="ml-2 h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                  >
                    <option value="searches">Pesquisas</option>
                    <option value="avgResults">Resultados médios</option>
                    <option value="zeros">Zero resultados</option>
                    <option value="views">Visualizações</option>
                    <option value="clicks">Cliques</option>
                    <option value="ctr">CTR</option>
                  </select>
                </label>
              </div>

              <div className={MOBILE_STACK_CLASS}>
                {data.searches.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    Nenhuma pesquisa no período.
                  </p>
                ) : (
                  data.searches.map((row) => (
                    <article
                      key={row.query}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                    >
                      <p className="line-clamp-2 text-sm font-medium text-slate-950" title={row.query}>
                        {row.query}
                      </p>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <dt className="text-slate-500">Pesquisas</dt>
                          <dd className="font-semibold tabular-nums">
                            {formatNumber(row.searches)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Impressões</dt>
                          <dd className="font-semibold tabular-nums">
                            {formatNumber(row.impressions)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">CTR</dt>
                          <dd className="font-semibold tabular-nums">
                            {formatCtr(row.ctr)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Views</dt>
                          <dd className="font-semibold tabular-nums">
                            {formatNumber(row.views)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Cliques</dt>
                          <dd className="font-semibold tabular-nums">
                            {formatNumber(row.clicks)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Tendência</dt>
                          <dd className="mt-1">
                            <TrendBadge trend={row.trend} />
                          </dd>
                        </div>
                      </dl>
                    </article>
                  ))
                )}
              </div>

              <div className={`${TABLE_WRAP_CLASS} hidden md:block`}>
                <table className={DESKTOP_TABLE_CLASS}>
                  <colgroup>
                    <col className="w-[28%]" />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                  </colgroup>
                  <thead className="border-b border-slate-100 bg-slate-50/80">
                    <tr>
                      <th className={thClass}>Termo</th>
                      <th className={thNumClass}>Pesquisas</th>
                      <th className={thNumClass}>Resultados médios</th>
                      <th className={thNumClass}>Zero resultados</th>
                      <th className={thNumClass}>Impressões</th>
                      <th className={thNumClass}>Visualizações</th>
                      <th className={thNumClass}>Cliques</th>
                      <th className={thNumClass} title="Cliques / impressões da query">
                        CTR
                      </th>
                      <th className={thClass}>Tendência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.searches.length === 0 ? (
                      <tr>
                        <td className={`${tdClass} text-slate-500`} colSpan={9}>
                          Nenhuma pesquisa no período.
                        </td>
                      </tr>
                    ) : (
                      data.searches.map((row) => (
                        <tr key={row.query} className="border-b border-slate-100">
                          <td className={`${tdClass} font-medium`}>
                            <p className="line-clamp-2 break-words" title={row.query}>
                              {row.query}
                            </p>
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.searches)}
                          </td>
                          <td className={tdNumClass}>
                            {formatAvg(row.avgResults)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.zeros)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.impressions)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.views)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.clicks)}
                          </td>
                          <td className={tdNumClass}>
                            {formatCtr(row.ctr)}
                          </td>
                          <td className={tdClass}>
                            <TrendBadge trend={row.trend} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={cardClass}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700">
                Lacuna de catálogo
              </p>
              <h2 className="mt-1 text-sm font-semibold text-slate-950">
                Zero resultados
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Termos com demanda e nenhuma resposta útil. Priorize Discovery
                por volume.
              </p>
              <div className={`${TABLE_WRAP_CLASS} mt-3`}>
                <table className="min-w-full table-fixed">
                  <thead className="border-b border-slate-100 bg-slate-50/80">
                    <tr>
                      <th className={thClass}>Termo</th>
                      <th className={thNumClass}>Vezes pesquisado</th>
                      <th className={thClass}>Última ocorrência</th>
                      <th className={thClass}>Tendência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.zeroResults.length === 0 ? (
                      <tr>
                        <td className={`${tdClass} text-slate-500`} colSpan={4}>
                          Nenhum zero resultado no período.
                        </td>
                      </tr>
                    ) : (
                      data.zeroResults.map((row) => (
                        <tr key={row.query} className="border-b border-slate-100">
                          <td className={`${tdClass} font-medium`}>
                            <p className="line-clamp-2 break-words" title={row.query}>
                              {row.query}
                            </p>
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.searches)}
                          </td>
                          <td className={tdClass}>
                            {formatDateTime(row.lastEventAt)}
                          </td>
                          <td className={tdClass}>
                            <TrendBadge trend={row.trend} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={cardClass}>
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Catálogo
                  </p>
                  <h2 className="mt-1 text-sm font-semibold text-slate-950">
                    Produtos
                  </h2>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["viewed", "Mais visualizados"],
                      ["clicked", "Mais clicados"],
                      ["ctr", "Melhor CTR"],
                      ["growing", "Em crescimento"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setProductTab(value)}
                      className={`h-8 rounded-lg px-3 text-xs font-semibold ${
                        productTab === value
                          ? "bg-slate-900 text-white"
                          : "border border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <ProductTable rows={productRows} />
            </section>

            <section className={cardClass}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                Tráfego pago
              </p>
              <h2 className="mt-1 text-sm font-semibold text-slate-950">
                Produtos com potencial para tráfego
              </h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
                Opportunity Score 0–100 no período selecionado: volume e
                crescimento de procura, impressões, views, cliques, CTR,
                favoritos e cobertura de lojas. Não usa só volume e não acumula
                histórico antigo.
              </p>
              <div className="mt-3">
                <ProductTable
                  rows={data.products.opportunities}
                  showScore
                />
              </div>
            </section>

            <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div className={cardClass}>
                <h2 className="text-sm font-semibold text-slate-950">
                  Marketplaces
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  CTR = cliques da loja / impressões de produtos que incluem
                  essa loja. Clique externo não é compra confirmada.
                </p>
                <div className={`${TABLE_WRAP_CLASS} mt-3`}>
                  <table className="min-w-full table-fixed">
                    <thead className="border-b border-slate-100 bg-slate-50/80">
                      <tr>
                        <th className={thClass}>Loja</th>
                        <th className={thNumClass}>Impressões</th>
                        <th className={thNumClass}>Cliques</th>
                        <th className={thNumClass} title="Cliques / impressões atribuídas">
                          CTR
                        </th>
                        <th className={thNumClass}>Participação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.marketplaces.map((row) => (
                        <tr
                          key={row.marketplace}
                          className="border-b border-slate-100"
                        >
                          <td className={`${tdClass} font-medium`}>
                            {formatMarketplace(row.marketplace)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.impressions)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.clicks)}
                          </td>
                          <td className={tdNumClass}>
                            {formatCtr(row.ctr)}
                          </td>
                          <td className={tdNumClass}>
                            {formatCtr(row.clickShare)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={cardClass}>
                <h2 className="text-sm font-semibold text-slate-950">
                  Origem do tráfego
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  CTR = cliques / impressões da origem.
                </p>
                <div className={`${TABLE_WRAP_CLASS} mt-3`}>
                  <table className="min-w-full table-fixed">
                    <thead className="border-b border-slate-100 bg-slate-50/80">
                      <tr>
                        <th className={thClass}>Origem</th>
                        <th className={thNumClass}>Sessões</th>
                        <th className={thNumClass}>Pesquisas</th>
                        <th className={thNumClass}>Impressões</th>
                        <th className={thNumClass}>Views</th>
                        <th className={thNumClass}>Cliques</th>
                        <th className={thNumClass} title="Cliques / impressões">
                          CTR
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.origins.map((row) => (
                        <tr key={row.source} className="border-b border-slate-100">
                          <td className={`${tdClass} font-medium`}>
                            {row.source}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.sessions)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.searches)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.impressions)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.views)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.clicks)}
                          </td>
                          <td className={tdNumClass}>
                            {formatCtr(row.ctr)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div className={cardClass}>
                <h2 className="text-sm font-semibold text-slate-950">
                  Campanhas UTM
                </h2>
                <div className={`${TABLE_WRAP_CLASS} mt-3`}>
                  <table className="min-w-full table-fixed">
                    <thead className="border-b border-slate-100 bg-slate-50/80">
                      <tr>
                        <th className={thClass}>Source</th>
                        <th className={thClass}>Medium</th>
                        <th className={thClass}>Campaign</th>
                        <th className={thNumClass}>Sessões</th>
                        <th className={thNumClass}>Pesquisas</th>
                        <th className={thNumClass}>Cliques</th>
                        <th className={thNumClass} title="Cliques / impressões">
                          CTR
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.utms.length === 0 ? (
                        <tr>
                          <td className={`${tdClass} text-slate-500`} colSpan={7}>
                            Nenhuma UTM no período.
                          </td>
                        </tr>
                      ) : (
                        data.utms.map((row, index) => (
                          <tr
                            key={`${row.utmSource}-${row.utmMedium}-${row.utmCampaign}-${index}`}
                            className="border-b border-slate-100"
                          >
                            <td className={`${tdClass} truncate`}>
                              {row.utmSource || "—"}
                            </td>
                            <td className={`${tdClass} truncate`}>
                              {row.utmMedium || "—"}
                            </td>
                            <td className={`${tdClass} truncate`}>
                              {row.utmCampaign || "—"}
                            </td>
                            <td className={tdNumClass}>
                              {formatNumber(row.sessions)}
                            </td>
                            <td className={tdNumClass}>
                              {formatNumber(row.searches)}
                            </td>
                            <td className={tdNumClass}>
                              {formatNumber(row.clicks)}
                            </td>
                            <td className={tdNumClass}>
                              {formatCtr(row.ctr)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={cardClass}>
                <h2 className="text-sm font-semibold text-slate-950">
                  Dispositivos
                </h2>
                <div className={`${TABLE_WRAP_CLASS} mt-3`}>
                  <table className="min-w-full table-fixed">
                    <thead className="border-b border-slate-100 bg-slate-50/80">
                      <tr>
                        <th className={thClass}>Dispositivo</th>
                        <th className={thNumClass}>Sessões</th>
                        <th className={thNumClass}>Impressões</th>
                        <th className={thNumClass}>Views</th>
                        <th className={thNumClass}>Cliques</th>
                        <th className={thNumClass} title="Cliques / impressões">
                          CTR
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.devices.map((row) => (
                        <tr
                          key={row.deviceType}
                          className="border-b border-slate-100"
                        >
                          <td className={`${tdClass} font-medium`}>
                            {formatDevice(row.deviceType)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.sessions)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.impressions)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.views)}
                          </td>
                          <td className={tdNumClass}>
                            {formatNumber(row.clicks)}
                          </td>
                          <td className={tdNumClass}>
                            {formatCtr(row.ctr)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
