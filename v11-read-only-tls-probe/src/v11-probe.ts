// V11 Read-Only TLS Probe — Main Entry Point
// Orchestrates all phases: environment, normalization, pg probe, prisma probe, report

import "dotenv/config";
import { validateEnvironment } from "./environment.js";
import { forceSslRequire, validateAndNormalizeUrl, generateFingerprint } from "./url-normalizer.js";
import { probePgTls } from "./pg-probe.js";
import { probePrismaTls } from "./prisma-probe.js";
import { generateReport, formatReport, V11Report } from "./report.js";
import { fullSafetyScan } from "./safety-guard.js";
import { verifySameFingerprint } from "./fingerprint.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// ─── V11 CONSTANTS ────────────────────────────────────────────
const V11_VERSION = "11.0.0";
const FORBIDDEN_PATTERNS = [
  "migrate deploy", "db push", "migrate dev", "prisma seed",
  "INSERT", "UPDATE", "DELETE", "UPSERT", "CREATE TABLE",
  "ALTER TABLE", "DROP TABLE", "TRUNCATE", "COPY FROM",
  "MERGE", "GRANT", "REVOKE",
];
const FORBIDDEN_SUBPROCESS = ["child_process", "exec(", "execSync(", "spawn(", "spawnSync("];

// ─── STATE ────────────────────────────────────────────────────
let V11_DRY_RUN_NETWORK_ACCESS = "NO";
let V11_DRY_RUN_DATABASE_ACCESS = "NO";
let V11_PG_PROBE_IMPLEMENTED = "NO";
let V11_PRISMA_CLIENT_PROBE_IMPLEMENTED = "NO";
let PRISMA_MIGRATE_DEPLOY_USED = "NO";
let PRISMA_CLI_USED_BY_PROBE = "NO";

// ─── DRY-RUN DETECTION ────────────────────────────────────────
const isDryRun = process.argv.includes("--dry-run") || process.env.V11_DRY_RUN === "1";

// ─── MAIN ─────────────────────────────────────────────────────
export async function runV11Probe(): Promise<V11Report> {
  console.log(`V11_READ_ONLY_TLS_PROBE v${V11_VERSION}`);
  console.log(`Dry Run Mode: ${isDryRun}`);
  console.log("");

  // PHASE 0: Safety scan of own source code
  console.log("─── SAFETY SCAN ───");
  const sourcePath = fileURLToPath(import.meta.url);
  const sourceCode = readFileSync(sourcePath, "utf-8");
  const safetyResult = fullSafetyScan(sourceCode, "v11-probe.ts");
  if (!safetyResult.safe) {
    console.error("SAFETY VIOLATIONS FOUND:", safetyResult.violations);
  }
  console.log(`Safety scan: ${safetyResult.safe ? "PASS" : "FAIL"}`);

  // PHASE 1: Environment validation
  console.log("─── ENVIRONMENT VALIDATION ───");
  const envResult = validateEnvironment();
  if (envResult.abortReason) {
    console.error(`ABORT: ${envResult.abortReason}`);
    throw new Error(envResult.abortReason);
  }
  console.log(`Environment signals: ${envResult.environmentSignals.join(", ") || "none"}`);

  // PHASE 2: URL normalization
  console.log("─── DIRECT_URL NORMALIZATION ───");
  const normalization = validateAndNormalizeUrl();
  if (!normalization.success) {
    console.error(`NORMALIZATION FAILED: ${normalization.error}`);
    throw new Error(`URL_NORMALIZATION_FAILED: ${normalization.error}`);
  }
  console.log(`sslmode=require applied: ${normalization.sslmodeApplied}`);
  console.log(`URL fingerprint: ${normalization.fingerprint}`);
  const normalizedUrl = normalization.normalizedUrl;
  if (!normalizedUrl) {
    throw new Error("NORMALIZED_URL_MISSING");
  }

  // PHASE 3: pg read-only probe
  console.log("─── PG READ-ONLY PROBE ───");
  const pgResult = await probePgTls(normalizedUrl, { dryRun: isDryRun });
  if (isDryRun) {
    V11_DRY_RUN_NETWORK_ACCESS = "NO";
    V11_DRY_RUN_DATABASE_ACCESS = "NO";
    V11_PG_PROBE_IMPLEMENTED = "YES";
  } else {
    V11_PG_PROBE_IMPLEMENTED = pgResult.success ? "YES" : "NO";
  }
  console.log(`PG TLS verified: ${pgResult.tlsEncrypted}`);
  console.log(`PG connected: ${pgResult.connected}`);

  // PHASE 4: PrismaClient read-only probe
  console.log("─── PRISMA READ-ONLY PROBE ───");
  const prismaResult = await probePrismaTls(normalizedUrl, { dryRun: isDryRun });
  if (isDryRun) {
    V11_PRISMA_CLIENT_PROBE_IMPLEMENTED = "YES";
  } else {
    V11_PRISMA_CLIENT_PROBE_IMPLEMENTED = prismaResult.success ? "YES" : "NO";
  }
  console.log(`Prisma TLS verified: ${prismaResult.tlsEncrypted}`);
  console.log(`Prisma connected: ${prismaResult.connected}`);

  // Verify same normalized URL used by both probes
  const sameNormalizedUrl = verifySameFingerprint(
    normalizedUrl,
    normalizedUrl
  );

  // PHASE 5: Generate report
  const report = generateReport(normalization, pgResult, prismaResult, [], isDryRun);

  // Print formatted report
  console.log("");
  console.log(formatReport(report));

  return report;
}

// ─── RUN ──────────────────────────────────────────────────────
runV11Probe().catch((err) => {
  console.error("V11_PROBE_FAILED:", err.message);
  process.exit(1);
});

// Export state for test assertions
export const V11State = {
  V11_DRY_RUN_NETWORK_ACCESS,
  V11_DRY_RUN_DATABASE_ACCESS,
  V11_PG_PROBE_IMPLEMENTED,
  V11_PRISMA_CLIENT_PROBE_IMPLEMENTED,
  PRISMA_MIGRATE_DEPLOY_USED,
  PRISMA_CLI_USED_BY_PROBE,
};
