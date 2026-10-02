// V11 Read-Only TLS Probe — Query Allowlist
// FASE 10: Query Allowlist + FASE 3: Write Query Guard

import { QUERY_ALLOWLIST } from "./constants.js";

export type QueryResult = {
  label: string;
  sql: string;
  executed: boolean;
  rows?: unknown[];
  error?: string;
};

/**
 * Validate that a SQL query is in the allowlist.
 * FAIL_CLOSED: any query not in the allowlist is rejected immediately.
 */
export function validateQuery(sql: string): {
  allowed: boolean;
  label?: string;
  error?: string;
} {
  for (const entry of QUERY_ALLOWLIST) {
    if (entry.trim() === sql.trim()) {
      // Find the label for this query
      const label = getQueryLabel(entry);
      return { allowed: true, label };
    }
  }

  return {
    allowed: false,
    error: "FAIL_CLOSED: Query not in allowlist",
  };
}

/**
 * Get the human-readable label for a known query.
 */
function getQueryLabel(sql: string): string {
  if (sql.includes("pg_stat_ssl")) return "TLS_QUERY";
  if (sql.includes("transaction_read_only")) return "READ_ONLY_SESSION_QUERY";
  if (sql.includes("v11_probe_alive")) return "PROBE_ALIVE_QUERY";
  return "UNKNOWN";
}

/**
 * Check if a SQL string contains any write operations.
 * Returns true if SAFE (no write patterns found).
 */
export function isWriteQuery(sql: string): boolean {
  const upper = sql.toUpperCase().trim();

  // Keywords that indicate write operations
  const writePatterns = [
    /\bINSERT\b/,
    /\bUPDATE\b/,
    /\bDELETE\b/,
    /\bUPSERT\b/,
    /\bCREATE\s+TABLE\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bDROP\s+TABLE\b/i,
    /\bTRUNCATE\b/i,
    /\bCOPY\s+FROM\b/i,
    /\bMERGE\b/i,
    /\bGRANT\b/,
    /\bREVOKE\b/,
    /\bMIGRATE\b/i,
    /\bDEPLOY\b/i,
  ];

  return writePatterns.some((pattern) => pattern.test(upper));
}

/**
 * Validate all queries in a batch against the allowlist and write guard.
 */
export function validateAllQueries(
  queries: Array<{ label: string; sql: string }>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const { label, sql } of queries) {
    const allowlistResult = validateQuery(sql);
    if (!allowlistResult.allowed) {
      errors.push(`${label}: ${allowlistResult.error}`);
    }
    if (isWriteQuery(sql)) {
      errors.push(`${label}: WRITE_QUERY_REJECTED`);
    }
  }

  return { valid: errors.length === 0, errors };
}
