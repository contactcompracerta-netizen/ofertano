// V11 Read-Only TLS Probe — Safe URL Fingerprint
// FASE 5: Fingerprint Seguro

import { generateFullFingerprint } from "./url-normalizer.js";

/**
 * Compute a safe, non-revealing fingerprint of the normalized URL.
 * Never reveals username, password, host, or query parameters.
 * Only outputs a truncated SHA-256 hash suitable for reports.
 */
export function safeFingerprint(normalizedUrl: string): {
  display: string;
  full: string;
} {
  const full = generateFullFingerprint(normalizedUrl);
  const display = `sha256:${full.substring(0, 16)}`;

  return { display, full };
}

/**
 * Verify that two URLs (pg and Prisma) share the same fingerprint.
 * This proves both probes use the same normalized URL without
 * ever revealing the actual URL string.
 */
export function verifySameFingerprint(
  pgNormalizedUrl: string,
  prismaNormalizedUrl: string
): boolean {
  const pgFp = generateFullFingerprint(pgNormalizedUrl);
  const prismaFp = generateFullFingerprint(prismaNormalizedUrl);
  return pgFp === prismaFp;
}
