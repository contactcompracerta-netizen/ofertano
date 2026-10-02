// V11 Read-Only TLS Probe — Report Generation
// Generates safe reports that never reveal secrets

import { NormalizationResult } from "./url-normalizer.js";
import { PgProbeResult } from "./pg-probe.js";
import { PrismaProbeResult } from "./prisma-probe.js";

export interface V11Report {
  version: string;
  timestamp: string;
  environment: string;
  dryRun: boolean;
  urlNormalization: {
    success: boolean;
    fingerprint: string;
    sslmodeApplied: boolean;
    error?: string;
  };
  pgProbe: PgProbeResult | null;
  prismaProbe: PrismaProbeResult | null;
  sameNormalizedUrl: boolean;
  forbiddenPatternsFound: string[];
  summary: {
    allPassed: boolean;
    tlsConfirmed: boolean;
    noWritesDetected: boolean;
    dryRunNetworkAccess: boolean;
    dryRunDatabaseAccess: boolean;
  };
}

/**
 * Generate a safe report that never reveals the actual URL, username,
 * password, or any secret information.
 */
export function generateReport(
  normalization: NormalizationResult,
  pgResult: PgProbeResult | null,
  prismaResult: PrismaProbeResult | null,
  forbiddenViolations: string[],
  dryRun: boolean
): V11Report {
  const sameNormalizedUrl =
    pgResult?.normalizedUrlUsed === prismaResult?.normalizedUrlUsed;

  const allPassed =
    normalization.success &&
    pgResult?.success === true &&
    prismaResult?.success === true &&
    forbiddenViolations.length === 0;

  const tlsConfirmed =
    pgResult?.tlsEncrypted === true && prismaResult?.tlsEncrypted === true;

  const noWritesDetected = forbiddenViolations.length === 0;

  return {
    version: "11.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV ?? "local",
    dryRun,
    urlNormalization: {
      success: normalization.success,
      fingerprint: normalization.fingerprint,
      sslmodeApplied: normalization.sslmodeApplied,
      error: normalization.error,
    },
    pgProbe: pgResult,
    prismaProbe: prismaResult,
    sameNormalizedUrl,
    forbiddenPatternsFound: forbiddenViolations,
    summary: {
      allPassed,
      tlsConfirmed,
      noWritesDetected,
      dryRunNetworkAccess: dryRun,
      dryRunDatabaseAccess: dryRun,
    },
  };
}

/**
 * Format the report for console output — safe for logs.
 * Never prints the actual URL, username, or password.
 */
export function formatReport(report: V11Report): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════════",
    "  V11 READ-ONLY TLS PROBE REPORT",
    "═══════════════════════════════════════════════════════════",
    "",
    `  Version: ${report.version}`,
    `  Timestamp: ${report.timestamp}`,
    `  Environment: ${report.environment}`,
    `  Dry Run: ${report.dryRun}`,
    "",
    "─── URL NORMALIZATION ───",
    `  Success: ${report.urlNormalization.success}`,
    `  sslmode=require: ${report.urlNormalization.sslmodeApplied}`,
    `  Fingerprint: ${report.urlNormalization.fingerprint}`,
    report.urlNormalization.error
      ? `  Error: ${report.urlNormalization.error}`
      : "",
    "",
    "─── PG PROBE ───",
    `  Connected: ${report.pgProbe?.connected ?? "N/A (dry-run)"}`,
    `  TLS Encrypted: ${report.pgProbe?.tlsEncrypted ?? "N/A (dry-run)"}`,
    `  Read-Only Verified: ${report.pgProbe?.readOnlyVerified ?? "N/A (dry-run)"}`,
    "",
    "─── PRISMA PROBE ───",
    `  Connected: ${report.prismaProbe?.connected ?? "N/A (dry-run)"}`,
    `  TLS Encrypted: ${report.prismaProbe?.tlsEncrypted ?? "N/A (dry-run)"}`,
    `  Read-Only Verified: ${report.prismaProbe?.readOnlyVerified ?? "N/A (dry-run)"}`,
    "",
    "─── VERIFICATION ───",
    `  Same Normalized URL (pg & Prisma): ${report.sameNormalizedUrl}`,
    `  Forbidden Patterns Found: ${report.forbiddenPatternsFound.length}`,
    "",
    "─── SUMMARY ───",
    `  All Passed: ${report.summary.allPassed}`,
    `  TLS Confirmed: ${report.summary.tlsConfirmed}`,
    `  No Writes Detected: ${report.summary.noWritesDetected}`,
    `  Dry Run (Network Access): ${report.summary.dryRunNetworkAccess ? "BLOCKED" : "POSSIBLE"}`,
    `  Dry Run (Database Access): ${report.summary.dryRunDatabaseAccess ? "BLOCKED" : "POSSIBLE"}`,
    "",
    "═══════════════════════════════════════════════════════════",
  ];

  return lines.filter((l) => l !== "").join("\n");
}
