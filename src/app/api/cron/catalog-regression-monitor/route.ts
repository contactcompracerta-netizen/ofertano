import { NextResponse } from "next/server";

import {
  runCatalogRegressionCheck,
  type CatalogRegressionCheckResult,
} from "@/scripts/catalogRegressionMonitor";
import { sendPushToAllAdminSubscriptions } from "@/services/admin-push/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function buildMonitorPayload(
  monitorResult: "PASS" | "REGRESSION" | "ERROR",
  issueCount: number,
) {
  if (monitorResult === "ERROR") {
    return {
      title: "Ofertano — monitor do catálogo falhou",
      body: "Monitor detectou erro operacional. Verifique o painel.",
      tag: "ofertano-catalog-monitor",
      data: {
        url: "/admin/inteligencia",
      },
    };
  }

  return {
    title: "Ofertano — regressão no catálogo",
    body: `Monitor detectou ${issueCount} problema(s) no catálogo. Verifique o painel.`,
    tag: "ofertano-catalog-monitor",
    data: {
      url: "/admin/inteligencia",
    },
  };
}

export function computeIssueCount(result: CatalogRegressionCheckResult): number {
  return (
    (result.counters?.productsWithIssues ?? 0) +
    (result.evaluation?.regressedOfferIds.length ?? 0) +
    (result.counters?.titleIssues ?? 0) +
    (result.counters?.descriptionIssues ?? 0) +
    (result.counters?.brandConflicts ?? 0) +
    (result.counters?.invalidCanonicalBrands ?? 0) +
    (result.counters?.structuredBrandCleanupNeeded ?? 0)
  );
}

export type AdminPushOutcome = {
  sent: number;
  failed: number;
  removed: number;
  skipped: boolean;
};

export type CronDecision = {
  shouldAlert: boolean;
  kind: "PASS" | "REGRESSION" | "ERROR";
};

export function decideCronAction(
  result: CatalogRegressionCheckResult,
): CronDecision {
  if (result.monitorResult === "PASS") {
    return { shouldAlert: false, kind: "PASS" };
  }
  return {
    shouldAlert: true,
    kind: result.monitorResult === "ERROR" ? "ERROR" : "REGRESSION",
  };
}

export async function GET(request: Request) {
  const segredo = process.env.CRON_SECRET;

  const authorization = request.headers.get("authorization");

  if (!segredo || authorization !== `Bearer ${segredo}`) {
    return NextResponse.json(
      {
        success: false,
        error: "Acesso não autorizado.",
      },
      {
        status: 401,
      },
    );
  }

  try {
    const result = await runCatalogRegressionCheck();

    console.log(`CATALOG_REGRESSION=${result.catalogRegression}`);
    console.log(`MONITOR_RESULT=${result.monitorResult}`);
    console.log(`DB_WRITES=${result.dbWrites}`);
    for (const reason of result.reasons) {
      console.log(`REGRESSION_REASON=${reason}`);
    }

    const decision = decideCronAction(result);

    if (decision.kind === "PASS") {
      return NextResponse.json({
        ok: true,
        monitorResult: "PASS",
        catalogRegression: false,
      });
    }

    const issueCount = computeIssueCount(result);

    let push: AdminPushOutcome | null = null;
    if (decision.shouldAlert) {
      try {
        const payload = buildMonitorPayload(
          result.monitorResult,
          issueCount,
        );
        const notificationResult =
          await sendPushToAllAdminSubscriptions(payload);
        push = notificationResult;
        console.log(
          `ADMIN_PUSH_SENT=${notificationResult.sent} ADMIN_PUSH_FAILED=${notificationResult.failed} ADMIN_PUSH_SKIPPED=${notificationResult.skipped}`,
        );
      } catch (pushError) {
        console.error(
          "Falha ao enviar push do monitor:",
          pushError,
        );
      }
    }

    if (decision.kind === "ERROR") {
      return NextResponse.json(
        {
          ok: false,
          monitorResult: "ERROR",
          pushSent: push ? push.sent : null,
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        monitorResult: "REGRESSION",
        catalogRegression: true,
        pushSent: push ? push.sent : null,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error(
      "Erro no cron de regressão do catálogo:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        monitorResult: "ERROR",
      },
      {
        status: 500,
      },
    );
  }
}
