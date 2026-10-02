// V11 Read-Only TLS Probe — Immutable Constants
// V10 contract reference: cca0ce6e7ae9ff2116c923263abdaf664365ff60

export const V11_VERSION = "11.0.0";
export const V10_CONTRACT_APP_SHA = "cca0ce6e7ae9ff2116c923263abdaf664365ff60";
export const EXPECTED_PRISMA_VERSION = "7.9.0";

// Protocol schemes accepted by V10 forceSslRequire contract
export const ACCEPTED_PROTOCOLS = ["postgres:", "postgresql:"] as const;

// Fingerprint algorithm
export const FINGERPRINT_ALGORITHM = "sha256";

// Query allowlist — only these SQL strings may ever be executed
export const QUERY_ALLOWLIST = [
  "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();",
  "SELECT current_setting('transaction_read_only') AS tr;",
  "SELECT 1 AS v11_probe_alive;",
] as const;

// Type for allowlist entries
export type QueryLabel = "TLS_QUERY" | "READ_ONLY_SESSION_QUERY" | "PROBE_ALIVE_QUERY";

// Read-only transaction mode
export const READ_ONLY_SETTING = "SET default_transaction_read_only = on;";

// Environment detection
export const EXPECTED_ENVIRONMENT = "production";

// Allowed env signals that can indicate production
export const PRODUCTION_SIGNALS = ["VERCEL_ENV=production", "VERCEL_TARGET_ENV=production"] as const;

// Forbidden commands — structural guard for static scan
export const FORBIDDEN_PATTERNS = [
  "migrate deploy",
  "db push",
  "migrate dev",
  "prisma seed",
  "INSERT",
  "UPDATE",
  "DELETE",
  "UPSERT",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "TRUNCATE",
  "COPY FROM",
  "MERGE",
  "GRANT",
  "REVOKE",
] as const;

// Forbidden subprocess patterns
export const FORBIDDEN_SUBPROCESS = [
  "child_process",
  "exec(",
  "execSync(",
  "spawn(",
  "spawnSync(",
] as const;
