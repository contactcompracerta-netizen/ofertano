// V11 Read-Only TLS Probe — URL Normalization
// V10 contract: forceSslRequire(rawDirectUrl) — exact logical replication
// FASE 4: Normalização da DIRECT_URL

import { ACCEPTED_PROTOCOLS } from "./constants.js";
import { createHash } from "node:crypto";

export interface NormalizationResult {
  success: boolean;
  normalizedUrl?: string;
  originalUrl: string;
  fingerprint: string;
  error?: string;
  sslmodeApplied: boolean;
}

/**
 * forceSslRequire — V10 contract, replicated exactly for V11.
 *
 * Parses the raw DIRECT_URL, validates it, sets sslmode=require via
 * URLSearchParams.set, and returns the normalized URL string.
 *
 * This operates ONLY in memory. The original DIRECT_URL environment
 * variable is NEVER modified. No .env file is written. No remote
 * Vercel call is made.
 *
 * Rules from V10 contract:
 *  1. Input must be a non-empty string
 *  2. Protocol must be postgres: or postgresql:
 *  3. Must have a hostname
 *  4. Must NOT have a hash fragment
 *  5. sslmode is set to "require" via URLSearchParams.set
 *  6. Other query parameters are preserved
 *  7. Original URL string is unchanged
 */
export function forceSslRequire(rawDirectUrl: string): NormalizationResult {
  try {
    // Rule 1: Input validation
    if (typeof rawDirectUrl !== "string" || rawDirectUrl.length === 0) {
      return {
        success: false,
        originalUrl: rawDirectUrl,
        fingerprint: "",
        error: "DIRECT_URL_INVALID",
        sslmodeApplied: false,
      };
    }

    // Parse the URL
    const url = new URL(rawDirectUrl);

    // Rule 2: Protocol validation
    if (!ACCEPTED_PROTOCOLS.includes(url.protocol)) {
      return {
        success: false,
        originalUrl: rawDirectUrl,
        fingerprint: "",
        error: "DIRECT_URL_INVALID_PROTOCOL",
        sslmodeApplied: false,
      };
    }

    // Rule 3: Must have hostname
    if (!url.hostname || url.hostname.length === 0) {
      return {
        success: false,
        originalUrl: rawDirectUrl,
        fingerprint: "",
        error: "DIRECT_URL_INVALID_HOSTNAME",
        sslmodeApplied: false,
      };
    }

    // Rule 4: Must NOT have hash fragment
    if (url.hash && url.hash.length > 0) {
      return {
        success: false,
        originalUrl: rawDirectUrl,
        fingerprint: "",
        error: "DIRECT_URL_INVALID_HASH",
        sslmodeApplied: false,
      };
    }

    // Rule 5: Set sslmode=require
    url.searchParams.set("sslmode", "require");

    const normalizedUrl = url.toString();

    // Rule 6: Verify sslmode was actually applied
    const sslmodeApplied = url.searchParams.get("sslmode") === "require";

    // Generate fingerprint of the normalized URL (not the raw one)
    const fingerprint = generateFingerprint(normalizedUrl);

    return {
      success: true,
      normalizedUrl,
      originalUrl: rawDirectUrl,
      fingerprint,
      sslmodeApplied,
    };
  } catch {
    return {
      success: false,
      originalUrl: rawDirectUrl,
      fingerprint: "",
      error: "DIRECT_URL_INVALID",
      sslmodeApplied: false,
    };
  }
}

/**
 * Generate a SHA-256 fingerprint of the normalized URL.
 * The fingerprint is truncated for display in reports.
 */
export function generateFingerprint(normalizedUrl: string): string {
  const hash = createHash("sha256").update(normalizedUrl).digest("hex");
  // Truncate to first 16 chars for report display
  return `sha256:${hash.substring(0, 16)}`;
}

/**
 * Generate a full SHA-256 fingerprint (for verification purposes).
 */
export function generateFullFingerprint(normalizedUrl: string): string {
  const hash = createHash("sha256").update(normalizedUrl).digest("hex");
  return hash;
}

/**
 * Validate that a URL string is present in the environment.
 * Returns the raw DIRECT_URL or null.
 */
export function getDirectUrlFromEnv(): string | null {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl || directUrl.trim().length === 0) {
    return null;
  }
  return directUrl;
}

/**
 * Full validation pipeline: env check → normalize → fingerprint.
 */
export function validateAndNormalizeUrl(): NormalizationResult {
  const rawUrl = getDirectUrlFromEnv();

  if (rawUrl === null) {
    return {
      success: false,
      originalUrl: "",
      fingerprint: "",
      error: "DIRECT_URL_MISSING",
      sslmodeApplied: false,
    };
  }

  return forceSslRequire(rawUrl);
}
