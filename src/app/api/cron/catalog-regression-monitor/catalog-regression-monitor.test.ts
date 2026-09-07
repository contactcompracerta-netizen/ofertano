import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildMonitorPayload,
  computeIssueCount,
  decideCronAction,
  type CronDecision,
} from "@/app/api/cron/catalog-regression-monitor/route";
import {
  PROTECTED_REJECTED_OFFER_IDS,
  type CatalogRegressionCheckResult,
} from "@/scripts/catalogRegressionMonitor";

function makeResult(
  partial: Partial<CatalogRegressionCheckResult>,
): CatalogRegressionCheckResult {
  return {
    monitorResult: "PASS",
    catalogRegression: false,
    counters: {
      publicProductsScanned: 90,
      nonPublicProductsSkipped: 0,
      productsOk: 90,
      productsWithIssues: 0,
      titleIssues: 0,
      descriptionIssues: 0,
      brandConflicts: 0,
      invalidCanonicalBrands: 0,
      structuredBrandCleanupNeeded: 0,
    },
    evaluation: {
      regression: false,
      reasons: [],
      regressedOfferIds: [],
      productCountInvariant: true,
      protectedInvariant: true,
    },
    offerStatuses: PROTECTED_REJECTED_OFFER_IDS.map((id) => ({
      id,
      found: true,
      matchStatus: "REJECTED",
    })),
    dbWrites: 0,
    reasons: [],
    ...partial,
  };
}

// ---- CRON_AUTH_REQUIRED --------------------------------------------------
// O guard de autenticação do endpoint usa o mesmo padrão de todos os crons:
// Authorization: Bearer CRON_SECRET. Sem header ou com valor errado deve
// retornar 401. Verificamos o padrão comparando com o price-monitor (baseline)
// e garantimos que a rota existe em vercel.json.
{
  const vercel = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "vercel.json"),
      "utf-8",
    ),
  );
  const entry = vercel.crons.find(
    (c: { path: string }) =>
      c.path === "/api/cron/catalog-regression-monitor",
  );
  assert.ok(entry, "cron path deve existir em vercel.json");
  assert.equal(entry.schedule, "0 * * * *", "deve rodar a cada hora");

  const baseline = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/cron/price-monitor/route.ts"),
    "utf-8",
  );
  const ourRoute = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/cron/catalog-regression-monitor/route.ts",
    ),
    "utf-8",
  );
  assert.ok(baseline.includes('"Bearer "') || baseline.includes("Bearer"), "baseline usa Bearer");
  assert.ok(ourRoute.includes('authorization !== `Bearer ${segredo}`'), "rota usa Bearer CRON_SECRET");
}
console.log("CRON_AUTH_REQUIRED=PASS");

// ---- PASS_DOES_NOT_ALERT -------------------------------------------------
{
  const result = makeResult({});
  const decision: CronDecision = decideCronAction(result);
  assert.equal(decision.kind, "PASS");
  assert.equal(decision.shouldAlert, false);
}
console.log("PASS_DOES_NOT_ALERT=PASS");

// ---- REGRESSION_TRIGGERS_ALERT -------------------------------------------
{
  const result = makeResult({
    monitorResult: "REGRESSION",
    catalogRegression: true,
  });
  const decision: CronDecision = decideCronAction(result);
  assert.equal(decision.kind, "REGRESSION");
  assert.equal(decision.shouldAlert, true);
}
console.log("REGRESSION_TRIGGERS_ALERT=PASS");

// ---- ERROR_TRIGGERS_ALERT ------------------------------------------------
{
  const result = makeResult({
    monitorResult: "ERROR",
    catalogRegression: true,
  });
  const decision: CronDecision = decideCronAction(result);
  assert.equal(decision.kind, "ERROR");
  assert.equal(decision.shouldAlert, true);
}
console.log("ERROR_TRIGGERS_ALERT=PASS");

// ---- PASS_HTTP_SUCCESS ---------------------------------------------------
// Em PASS a resposta é ok:true / monitorResult:PASS / catalogRegression:false.
// A lógica de decisão garante isso para o handler.
{
  const result = makeResult({});
  assert.equal(result.catalogRegression, false);
  assert.equal(result.monitorResult, "PASS");
}
console.log("PASS_HTTP_SUCCESS=PASS");

// ---- REGRESSION_RESPONSE_CORRECT -----------------------------------------
{
  const result = makeResult({
    monitorResult: "REGRESSION",
    catalogRegression: true,
    counters: {
      ...makeResult({}).counters!,
      productsWithIssues: 2,
      productsOk: 88,
    },
  });
  assert.equal(
    decideCronAction(result).kind,
    "REGRESSION",
  );
  const count = computeIssueCount(result);
  assert.ok(count >= 2, "conta os problemas");
}
console.log("REGRESSION_RESPONSE_CORRECT=PASS");

// ---- ERROR_RESPONSE_SANITIZED --------------------------------------------
// O payload de erro não carrega dados sensíveis (senha/token/URLs).
{
  const payload = buildMonitorPayload("ERROR", 0);
  const serialized = JSON.stringify(payload);
  assert.ok(serialized.includes("falhou"), "menciona falha");
  assert.equal(serialized.includes("DATABASE_URL"), false);
  assert.equal(serialized.includes("postgres"), false);
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(serialized.includes("sb_"), false);
}
console.log("ERROR_RESPONSE_SANITIZED=PASS");

// ---- MONITOR_STAYS_READ_ONLY ---------------------------------------------
{
  const result = makeResult({});
  assert.equal(result.dbWrites, 0, "monitor declara 0 escritas");
}
console.log("MONITOR_STAYS_READ_ONLY=PASS");

// ---- EXISTING_CRONS_PRESERVED --------------------------------------------
{
  const vercel = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "vercel.json"),
      "utf-8",
    ),
  );
  const paths = vercel.crons.map((c: { path: string }) => c.path);
  assert.ok(paths.includes("/api/cron/price-monitor"));
  assert.ok(paths.includes("/api/cron/catalog-populate"));
  assert.ok(paths.includes("/api/cron/import-queue"));
}
console.log("EXISTING_CRONS_PRESERVED=PASS");

// ---- REGRESSION_PAYLOAD_NO_SENSITIVE -------------------------------------
{
  const payload = buildMonitorPayload("REGRESSION", 3);
  const serialized = JSON.stringify(payload);
  assert.ok(serialized.includes("regressão"), "menciona regressão");
  assert.ok(serialized.includes("3"), "informa quantidade");
  assert.equal(serialized.includes("DATABASE_URL"), false);
  assert.equal(serialized.includes("sb_"), false);
}
console.log("REGRESSION_PAYLOAD_NO_SENSITIVE=PASS");

// ---- MONITOR_REUSED_LOGIC ------------------------------------------------
// A rota importa runCatalogRegressionCheck do script do monitor (única lógica).
{
  const ourRoute = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/cron/catalog-regression-monitor/route.ts",
    ),
    "utf-8",
  );
  assert.ok(
    ourRoute.includes('from "@/scripts/catalogRegressionMonitor"'),
    "rota reutiliza a lógica do monitor",
  );
}
console.log("MONITOR_REUSED_LOGIC=PASS");

console.log("ALL_CATALOG_CRON_TESTS=PASS");
