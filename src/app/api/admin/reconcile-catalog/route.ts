import { NextResponse } from "next/server";

import { reconcileCatalog } from "@/services/catalog/reconciliation";
import { createPrismaCatalogReconciliationRepository } from "@/services/catalog/reconciliationRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReconcileBody = {
  dryRun?: boolean;
  maxWrites?: number;
};

export async function POST(request: Request) {
  let body: ReconcileBody = {};

  try {
    const parsed =
      (await request.json()) as unknown;

    if (
      parsed !== null &&
      typeof parsed === "object"
    ) {
      body = parsed as ReconcileBody;
    }
  } catch {
    /* corpo ausente ou inválido => defaults conservadores */
  }

  const dryRun = body.dryRun ?? true;
  const maxWrites = body.maxWrites;

  const result =
    await reconcileCatalog(
      createPrismaCatalogReconciliationRepository(),
      {
        dryRun,
        maxWrites,
      },
    );

  return NextResponse.json({
    ok: true,
    result,
    metric:
      result.violations.length === 0
        ? "AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0"
        : `AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=${result.violations.length}`,
  });
}

export async function GET() {
  /*
   * GET roda somente em DRY-RUN (nunca escreve): conveniente para a
   * auditoria sem riscos.
   */
  const result =
    await reconcileCatalog(
      createPrismaCatalogReconciliationRepository(),
      {
        dryRun: true,
      },
    );

  return NextResponse.json({
    ok: true,
    dryRunOnly: true,
    result,
    metric:
      result.violations.length === 0
        ? "AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0"
        : `AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=${result.violations.length}`,
  });
}