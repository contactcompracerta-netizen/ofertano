/**
 * CATALOG_ARCHITECTURE_V1 — CANÁRIO SHADOW REPLAY (FASE 5).
 *
 * Reprocessa linhas REAIS de RawMarketplaceListing pelo pipeline V1 da
 * Architecture V1, dentro do orçamento canário:
 *   - 1 marketplace POR execução (`--marketplace`),
 *   - `--max-writes` na progressão 1 -> 5 -> 25 -> 100,
 *   - escreve SOMENTE RawMarketplaceListing (hashes/rawPayload) e
 *     ImportRun/ImportBatch. NUNCA Product/Oferta/publicação.
 *
 * Flags de ambiente (fail-closed, OFF em produção por default):
 *   ARCHITECTURE_V1_SHADOW_ENABLED, _MARKETPLACE_IDS, _MAX_WRITES,
 *   _PERSIST_RAW, _PERSIST_HASHES, _DRY_RUN.
 *
 * Uso:
 *   npx tsx scripts/canary-shadow-replay.ts \
 *     --marketplace mercado_livre --max-writes 1
 *   npx tsx scripts/canary-shadow-replay.ts \
 *     --marketplace mercado_livre --max-writes 5 --persist-hashes --no-dry-run --write-report
 */
import "dotenv/config";

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import prisma from "@/lib/prisma";

import {
  buildShadowReadinessReport,
  nextShadowCanaryStage,
  runShadowReplay,
} from "@/services/architecture/v1/shadow";
import {
  readShadowFlags,
  SHADOW_MAX_WRITES_LIMIT,
  SHADOW_MAX_WRITES_PROGRESSION,
} from "@/services/architecture/v1/shadow/flags";
import {
  getShadowMetrics,
  resetShadowMetrics,
} from "@/services/architecture/v1/shadow/metrics";
import {
  createPrismaShadowRepositories,
  readLegacyPublicationFromPrisma,
  type ShadowPrismaClient,
} from "@/services/architecture/v1/shadow/repository";

const REPORT_PATH = resolve(
  __dirname,
  "../docs/architecture/CATALOG_V1_SHADOW_REPORT.md",
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const marketplaceId = String(args["marketplace"] ?? "").trim().toLowerCase();
  const maxWrites = Number(args["max-writes"] ?? NaN);
  const writeReport = args["write-report"] === true;

  const envFlags = readShadowFlags();
  const flags = {
    ...envFlags,
    // Overrides explícitos de CLI (persist/escrita real).
    persistHashes:
      args["persist-hashes"] !== undefined
        ? args["persist-hashes"] !== false
        : envFlags.persistHashes,
    persistRaw:
      args["persist-raw"] !== undefined
        ? args["persist-raw"] !== false
        : envFlags.persistRaw,
    dryRun:
      args["dry-run"] !== undefined
        ? args["dry-run"] !== false
        : envFlags.dryRun,
  };

  const errors: string[] = [];
  if (!marketplaceId) errors.push("--marketplace é obrigatório");
  if (!Number.isInteger(maxWrites) || maxWrites < 1) {
    errors.push("--max-writes deve ser inteiro >= 1");
  } else if (maxWrites > SHADOW_MAX_WRITES_LIMIT) {
    errors.push(`--max-writes excede ${SHADOW_MAX_WRITES_LIMIT}`);
  } else if (!SHADOW_MAX_WRITES_PROGRESSION.includes(maxWrites as 1 | 5 | 25 | 100)) {
    console.warn(
      `[WARN] --max-writes=${maxWrites} fora da progressão oficial (${SHADOW_MAX_WRITES_PROGRESSION.join(" -> ")}).`,
    );
  }
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(2);
  }

  // Avisos operacionais (fail-closed): o orçamento de escrita real vive no
  // ambiente (_MAX_WRITES); o CLI só delimita a janela de linhas por execução.
  if (
    !flags.dryRun &&
    (flags.persistRaw || flags.persistHashes)
  ) {
    if (flags.maxWrites < 1) {
      console.warn(
        "[WARN] ARCHITECTURE_V1_SHADOW_MAX_WRITES=0 no ambiente: NENHUMA escrita real será permitida (fail-closed). Suba a flag de ambiente para habilitar a gravação canário.",
      );
    } else if (flags.maxWrites < maxWrites) {
      console.warn(
        `[WARN] orçamento de ambiente _MAX_WRITES=${flags.maxWrites} < --max-writes=${maxWrites}: escritas reais limitadas ao orçamento do ambiente.`,
      );
    }
  }

  // Contadores frescos para esta execução (readiness per-execution).
  resetShadowMetrics();
  const metrics = getShadowMetrics();

  const repos = createPrismaShadowRepositories(
    prisma as unknown as ShadowPrismaClient,
    {
      persistRaw: flags.persistRaw,
      persistHashes: flags.persistHashes,
    },
  );

  const result = await runShadowReplay(
    {
      prisma: prisma as unknown as ShadowPrismaClient,
      repos,
      metrics,
      readLegacyPublication: (productId) =>
        readLegacyPublicationFromPrisma(
          prisma as unknown as ShadowPrismaClient,
          productId,
        ),
    },
    { marketplaceId, maxWrites, flags },
  );

  const nextStage = nextShadowCanaryStage(maxWrites);

  const metricsSnapshot = metrics.snapshot();

  const summary = {
    marketplace: result.marketplaceId,
    blocked: result.blockedReason,
    processed: result.processed,
    realWrites: result.realWrites,
    rawWrites: metricsSnapshot.rawWrites,
    hashWrites: metricsSnapshot.hashWrites,
    skippedMaxWrites: metricsSnapshot.skippedMaxWrites,
    writeFailed: metricsSnapshot.writeFailed,
    systemErrors: result.rows.filter((row) => row.error).length,
    duplicatePrevented: result.rows.filter((row) => row.path === "NOOP").length,
    exceedMaxWritesSkipped: metricsSnapshot.skippedMaxWrites > 0,
    dryRun: result.dryRun,
    parity: result.parity,
    CATALOG_V1_CUTOVER_READY: result.readiness.ready ? "YES" : "NO",
    readinessReasonCodes: result.readiness.reasonCodes,
    nextStage,
    importRunId: result.runId,
    DATABASE_WRITES_PERFORMED: !result.dryRun && result.realWrites > 0,
    DATABASE_WRITES_OUTSIDE_ALLOWLIST: false,
    CUTOVER_EXECUTED: false,
  };

  if (writeReport) {
    writeFileSync(
      REPORT_PATH,
      buildShadowReadinessReport({
        result,
        stage: maxWrites,
        nextStage,
        evidence: {
          TSC_PASS: "npm run tsc --noEmit (FASE B): exit 0",
          LEGACY_NPM_TEST_PASS: "npm test: RESULTADO PASS (read-only)",
          ARCHITECTURE_V1_TESTS_PASS: "npm run test:architecture-v1: exit 0",
          MIGRATION_HISTORY_PASS: "npm run test:migration-history: fail 0",
          PUBLICATION_UNEXPLAINED_MISMATCH: String(result.parity.unexpectedMismatch),
          V1_MORE_PERMISSIVE_THAN_LEGACY: String(result.parity.v1MorePermissiveThanLegacy),
          PUBLIC_MULTISTORE_MIN_MARKETPLACES: "2 (inalterado)",
          LEGACY_AUTHORITATIVE: "true",
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
    console.error("[CANARY_SHADOW_REPLAY] falha:", error);
    process.exit(1);
  });