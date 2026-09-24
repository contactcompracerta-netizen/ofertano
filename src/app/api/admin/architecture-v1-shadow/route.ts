import { NextResponse } from "next/server";

import {
  maskShadowFlags,
  readShadowFlags,
  SHADOW_MAX_WRITES_PROGRESSION,
} from "@/services/architecture/v1/shadow/flags";
import { getShadowMetrics } from "@/services/architecture/v1/shadow/metrics";
import { evaluateShadowReadiness } from "@/services/architecture/v1/shadow/parityEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * ARCHITECTURE V1 — SHADOW STATUS (FASE 5).
 *
 * Rota ADMIN somente leitura: expõe flags (mascaradas), métricas da shadow
 * e o estado de readiness (CATALOG_V1_CUTOVER_READY). NENHUMA escrita — GET
 * não pode mutar nada. POST é explicitamente rejeitado (405).
 */
export async function GET() {
  const flags = readShadowFlags();
  const metrics = getShadowMetrics().snapshot();

  const readiness = evaluateShadowReadiness({
    realWrites: metrics.writeSuccess,
    unexpectedMismatch: metrics.parityUnexpectedMismatch,
    v1MorePermissiveThanLegacy: metrics.parityV1MorePermissive,
    writeFailed: metrics.writeFailed,
  });

  return NextResponse.json({
    ok: true,
    architectureV1Shadow: {
      readOnly: true,
      cutoverAuthorized: false,
      flags: maskShadowFlags(flags),
      metrics,
      readiness,
      canaryProgression: [...SHADOW_MAX_WRITES_PROGRESSION],
      note:
        "Rota somente leitura. Nenhuma escrita é realizada pelo GET. " +
        "Cutover NÃO é autorizado por esta missão, mesmo com READY=YES.",
    },
  });
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "METHOD_NOT_SUPPORTED_READ_ONLY",
      note: "Esta rota é somente leitura; use scripts/canary-shadow-replay.ts para o canário.",
    },
    { status: 405 },
  );
}