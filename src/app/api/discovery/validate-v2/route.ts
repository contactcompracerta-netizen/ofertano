import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SEARCH_BUDGET,
  searchMultistoreV2,
} from "@/services/multistore-v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_QUERY =
  "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V";

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json(
      {
        success: false,
        error: "Diagnostic endpoint disabled in production.",
      },
      { status: 404 },
    );
  }

  const query =
    request.nextUrl.searchParams.get("q")?.replace(/\s+/g, " ").trim() ?? "";

  if (query !== ALLOWED_QUERY) {
    return NextResponse.json(
      {
        success: false,
        error: "Diagnostic query not allowed.",
      },
      { status: 400 },
    );
  }

  const previousTrace = process.env.ML_DIAGNOSTIC_TRACE;
  process.env.ML_DIAGNOSTIC_TRACE = "1";

  const startedAt = Date.now();

  try {
    const result = await searchMultistoreV2(query, {
      persist: false,
      limit: 8,
      budget: DEFAULT_SEARCH_BUDGET,
    });

    return NextResponse.json(
      {
        success: true,
        diagnostic: true,
        production: false,
        persist: false,
        query,
        wallElapsedMs: Date.now() - startedAt,
        result,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        diagnostic: true,
        production: false,
        persist: false,
        query,
        wallElapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  } finally {
    if (previousTrace === undefined) {
      delete process.env.ML_DIAGNOSTIC_TRACE;
    } else {
      process.env.ML_DIAGNOSTIC_TRACE = previousTrace;
    }
  }
}
