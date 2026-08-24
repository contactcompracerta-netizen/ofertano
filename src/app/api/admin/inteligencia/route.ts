import { NextResponse } from "next/server";

import { loadIntelligenceDashboard } from "@/services/analytics/dashboard";
import type { IntelligenceSort } from "@/services/analytics/dashboard";
import {
  parseDateKeyRange,
  periodFromPreset,
} from "@/services/analytics/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS = new Set<IntelligenceSort>([
  "searches",
  "avgResults",
  "zeros",
  "views",
  "clicks",
  "ctr",
  "trend",
  "impressions",
  "score",
]);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const preset = url.searchParams.get("preset");
    const fromKey = url.searchParams.get("from");
    const toKey = url.searchParams.get("to");
    const sortParam = url.searchParams.get("searchSort");
    const searchSort = SORTS.has(sortParam as IntelligenceSort)
      ? (sortParam as IntelligenceSort)
      : "searches";

    const custom = parseDateKeyRange(fromKey, toKey);
    const period =
      custom ??
      periodFromPreset(
        preset === "today" || preset === "30d" || preset === "90d"
          ? preset
          : "7d",
      );

    const data = await loadIntelligenceDashboard({
      from: period.from,
      to: period.to,
      searchSort,
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[inteligencia] falha ao carregar painel", error);

    return NextResponse.json(
      {
        success: false,
        error: "Não foi possível carregar o painel de inteligência.",
      },
      { status: 500 },
    );
  }
}
