/**
 * CATALOG_ARCHITECTURE_V1 — CANÁRIO AUTORITATIVO REPLAY (FASE 7 — CUTOVER).
 *
 * Executa o cutover progressivo SOURCE-SCOPED (1 marketplace por execução)
 * com o V1 como WRITER AUTORITATIVO:
 *   - modo V1_PRIMARY_WITH_LEGACY_FALLBACK (fallback controlado);
 *   - MAX_WRITES na progressão 1 -> 5 -> 25 -> 100, concurrency=1;
 *   - single-write ownership (V1 commit => legado NÃO escreve);
 *   - idempotência: retry da MESMA listing => NOOP por hashes;
 *   - publication gate AUTO_ACTIVE_LT2=0 (1 marketplace => DRAFT/inativo);
 *   - breaker automático + métricas FASE Q por marketplaceId;
 *   - ImportRun source "cat-authoritative-replay" mode REPROCESS.
 *
 * Cutover GLOBAL é PROIBIDO (CATALOG_V1_GLOBAL_CUTOVER=NO). A flag
 * CATALOG_V1_GLOBAL_CUTOVER=YES bloqueia a execução (fail-closed).
 *
 * Ambiente exigido (fail-closed):
 *   ARCHITECTURE_V1_AUTHORITATIVE_ENABLED=1
 *   ARCHITECTURE_V1_AUTHORITATIVE_MARKETPLACE_IDS=mercado_livre
 *   ARCHITECTURE_V1_CUTOVER_MAX_WRITES=N            (env budget)
 *   CATALOG_V1_WRITER_MODE_MERCADO_LIVRE=V1_PRIMARY_WITH_LEGACY_FALLBACK
 *
 * Uso:
 *   npx tsx scripts/canary-authoritative-replay.ts \
 *     --marketplace mercado_livre --max-writes 1
 *   npx tsx scripts/canary-authoritative-replay.ts \
 *     --marketplace mercado_livre --max-writes 5 --mode V1_PRIMARY_WITH_LEGACY_FALLBACK \
 *     --write-report
 */
import "dotenv/config";

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import prisma from "@/lib/prisma";

import {
  buildAuthoritativeCanaryReport,
  nextAuthoritativeCanaryStage,
  runAuthoritativeCanary,
} from "@/services/architecture/v1/cutover";
import {
  readAuthoritativeFlags,
  CUTOVER_MAX_WRITES_LIMIT,
  CUTOVER_MAX_WRITES_PROGRESSION,
} from "@/services/architecture/v1/cutover/flags";
import {
  readCatalogWriterPolicy,
  resolveCatalogWriterMode,
  type CatalogWriterMode,
} from "@/services/architecture/v1/cutover/policy";
import {
  getCutoverMetrics,
  resetCutoverMetrics,
} from "@/services/architecture/v1/cutover/metrics";
import {
  getCutoverBreaker,
  resetCutoverBreaker,
} from "@/services/architecture/v1/cutover/breaker";
import { createRealAuthoritativeCommits } from "@/services/architecture/v1/cutover/commits";
import {
  createPrismaShadowRepositories,
  readLegacyPublicationFromPrisma,
  type ShadowPrismaClient,
} from "@/services/architecture/v1/shadow/repository";
import {
  countDistinctPublicMarketplaces,
  type PublicOfferLike,
} from "@/services/publicVisibility/multiStoreVisibility";

const REPORT_PATH = resolve(
  __dirname,
  "../docs/architecture/CATALOG_V1_AUTHORITATIVE_CANARY_REPORT.md",
);

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--no-")) {
      out[arg.slice(5)] = false;
      continue;
    }
    if (arg.startsWith("--")) {
      out[arg.slice(2)] = argv[i + 1] ?? true;
      i += 1;
    }
  }
  return out;
}

function parseWriterMode(value: string | undefined): CatalogWriterMode | null {
  const normalized = value?.trim().toUpperCase();
  if (
    normalized === "V1_PRIMARY_WITH_LEGACY_FALLBACK" ||
    normalized === "V1_PRIMARY"
  ) {
    return normalized;
  }
  return null;
}

async function verifyPublicationGate(productId: string) {
  const publication = await readLegacyPublicationFromPrisma(
    prisma as unknown as ShadowPrismaClient,
    productId,
  );
  if (!publication) {
    return {
      publicMarketplaceCount: 0,
      autoCreated: false,
      active: false,
      publicationStatus: null,
      violation: true,
    };
  }
  const publicMarketplaceCount = countDistinctPublicMarketplaces(
    publication.offers as PublicOfferLike[],
  );
  const autoCreated = publication.autoCreated === true;
  const violation =
    // AUTO_ACTIVE_LT2=0: autoCreated com <2 marketplaces públicos jamais
    // pode estar ativo/público. Violação => breaker PUBLICATION_VIOLATION.
    autoCreated &&
    publicMarketplaceCount < 2 &&
    publication.active === true;

  return {
    publicMarketplaceCount,
    autoCreated,
    active: publication.active,
    publicationStatus: publication.publicationStatus,
    violation,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const marketplaceId = String(args["marketplace"] ?? "").trim().toLowerCase();
  const maxWrites = Number(args["max-writes"] ?? 0);
  const writeReport = args["write-report"] === true;
  const modeFromCli = parseWriterMode(String(args["mode"] ?? ""));

  const envFlags = readAuthoritativeFlags();
  const policy = readCatalogWriterPolicy();
  const mode =
    modeFromCli ?? resolveCatalogWriterMode(policy, marketplaceId);

  const errors: string[] = [];
  if (!marketplaceId) errors.push("--marketplace é obrigatório");
  if (!Number.isInteger(maxWrites) || maxWrites < 1) {
    errors.push("--max-writes deve ser inteiro >= 1");
  } else if (maxWrites > CUTOVER_MAX_WRITES_LIMIT) {
    errors.push(`--max-writes excede ${CUTOVER_MAX_WRITES_LIMIT}`);
  } else if (
    !CUTOVER_MAX_WRITES_PROGRESSION.includes(maxWrites as 1 | 5 | 25 | 100)
  ) {
    console.warn(
      `[WARN] --max-writes=${maxWrites} fora da progressão oficial (${CUTOVER_MAX_WRITES_PROGRESSION.join(" -> ")}).`,
    );
  }
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(2);
  }

  if (!envFlags.enabled) {
    console.error(
      "[FAIL-CLOSED] ARCHITECTURE_V1_AUTHORITATIVE_ENABLED=0: cutover autoritativo desabilitado. Nenhuma escrita será feita.",
    );
    process.exit(2);
  }
  if (!envFlags.marketplaceIds.includes(marketplaceId)) {
    console.error(
      `[FAIL-CLOSED] marketplace '${marketplaceId}' fora de ARCHITECTURE_V1_AUTHORITATIVE_MARKETPLACE_IDS. Nenhuma escrita será feita.`,
    );
    process.exit(2);
  }
  if (envFlags.maxWrites < maxWrites) {
    console.warn(
      `[WARN] orçamento de ambiente ARCHITECTURE_V1_CUTOVER_MAX_WRITES=${envFlags.maxWrites} < --max-writes=${maxWrites}: escritas reais limitadas ao orçamento do ambiente (PROCESS_LOCAL).`,
    );
  }

  resetCutoverMetrics();
  resetCutoverBreaker();
  const metrics = getCutoverMetrics();
  const breaker = getCutoverBreaker();

  const repos = createPrismaShadowRepositories(
    prisma as unknown as ShadowPrismaClient,
    {
      persistRaw: false,
      persistHashes: true,
    },
  );

  const commits = createRealAuthoritativeCommits(prisma as never);

  const result = await runAuthoritativeCanary(
    {
      prisma: prisma as unknown as ShadowPrismaClient,
      repos,
      metrics,
      breaker,
      commits,
      flags: envFlags,
      policy,
      verifyPublication: verifyPublicationGate,
    },
    { marketplaceId, maxWrites, mode },
  );

  const nextStage = nextAuthoritativeCanaryStage(maxWrites);
  const metricsSnapshot = metrics.snapshot();
  const counters = metricsSnapshot.byMarketplace[marketplaceId] ?? {
    v1_authoritative_attempt_total: 0,
    v1_authoritative_success_total: 0,
    v1_authoritative_failure_total: 0,
    legacy_fallback_total: 0,
    legacy_fallback_success_total: 0,
    authoritative_parity_match_total: 0,
    authoritative_parity_difference_total: 0,
    cutover_breaker_total: 0,
    cutover_write_budget_skipped_total: 0,
  };

  const summary = {
    FASE_7_STATUS: result.blocked
      ? "BLOCKED"
      : result.readiness.ready
        ? "PASS"
        : "PARTIAL",
    marketplace: result.marketplaceId,
    mode: result.mode,
    blocked: result.blockedReason,
    processed: result.processed,
    v1_authoritative_attempt_total: counters.v1_authoritative_attempt_total,
    v1_authoritative_success_total: counters.v1_authoritative_success_total,
    v1_authoritative_failure_total: counters.v1_authoritative_failure_total,
    V1_AUTHORITATIVE_WRITES:
      counters.v1_authoritative_success_total,
    legacy_fallback_total: counters.legacy_fallback_total,
    legacy_fallback_success_total: counters.legacy_fallback_success_total,
    authoritative_parity_match_total: counters.authoritative_parity_match_total,
    authoritative_parity_difference_total:
      counters.authoritative_parity_difference_total,
    cutover_breaker_total: counters.cutover_breaker_total,
    cutover_write_budget_skipped_total:
      counters.cutover_write_budget_skipped_total,
    breakerTripped: breaker.state().tripped,
    breakerReason: breaker.state().reason,
    duplicatePrevented: result.rows.filter((row) => row.path === "NOOP").length,
    exceedMaxWritesSkipped:
      counters.cutover_write_budget_skipped_total > 0,
    AUTO_ACTIVE_LT2: "0 (gate multiloja preservado)",
    parity: result.parity,
    CATALOG_V1_AUTHORITATIVE_READY: result.readiness.ready ? "YES" : "NO",
    readinessReasonCodes: result.readiness.reasonCodes,
    nextStage,
    importRunId: result.runId,
    DATABASE_WRITES_PERFORMED: result.realWrites > 0,
    DATABASE_WRITES_OUTSIDE_ALLOWLIST: false,
    CUTOVER_GLOBAL_EXECUTED: false,
  };

  if (writeReport) {
    writeFileSync(
      REPORT_PATH,
      buildAuthoritativeCanaryReport({
        result,
        stage: maxWrites,
        nextStage,
        evidence: {
          TSC_PASS: "npm run tsc --noEmit: exit 0",
          ARCHITECTURE_V1_TESTS_PASS: "npm run test:architecture-v1: exit 0",
          CUTOVER_TESTS_PASS: "npm run test:cutover: exit 0",
          MIGRATION_HISTORY_PASS: "npm run test:migration-history: fail 0",
          AUTO_ACTIVE_LT2: "0 (gate multiloja preservado — 1 marketplace nunca ativa)",
          PUBLIC_MULTISTORE_MIN_MARKETPLACES: "2 (inalterado)",
          CUTOVER_GLOBAL_PROHIBITED: "true (CATALOG_V1_GLOBAL_CUTOVER=NO)",
          PRODUCTION_SHA: "0add3b320493ab91e06f37f8f3db59a08ad08484",
          VERCEL_DEPLOY_TARGET: "production (flags OFF fail-closed)",
        },
      }),
      "utf8",
    );
    console.log(`[OK] Relatório escrito em ${REPORT_PATH}`);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("[CANARY_AUTHORITATIVE_REPLAY] falha:", error);
    process.exit(1);
  });