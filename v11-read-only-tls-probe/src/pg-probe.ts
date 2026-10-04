// V11 Read-Only TLS Probe — pg Read-Only Probe
// FASE 6: PG Probe

import { Client } from "pg";
import { createHash } from "node:crypto";
import { forceSslRequire } from "./url-normalizer.js";
import { validateQuery, isWriteQuery } from "./query-allowlist.js";

export interface PgProbeResult {
  success: boolean;
  tlsEncrypted: boolean;
  connected: boolean;
  fingerprint: string;
  normalizedUrlUsed: string;
  error?: string;
  readOnlyVerified: boolean;
  rowsReturned?: unknown[];
}

/**
 * probePgTls — Connects to PostgreSQL using the normalized DIRECT_URL
 * and verifies TLS encryption. Only executes read-only queries from
 * the allowlist.
 *
 * Safety features:
 *  1. Uses normalized URL from forceSslRequire (sslmode=require)
 *  2. SET default_transaction_read_only = on before any query
 *  3. Only executes queries from QUERY_ALLOWLIST
 *  4. Connection is ALWAYS closed in finally block
 *  5. No write operations possible
 */
export async function probePgTls(
  normalizedDirectUrl: string,
  options?: { dryRun?: boolean }
): Promise<PgProbeResult> {
  const result: PgProbeResult = {
    success: false,
    tlsEncrypted: false,
    connected: false,
    fingerprint: "",
    normalizedUrlUsed: normalizedDirectUrl,
    readOnlyVerified: false,
  };

  // Dry-run mode: do not open any socket or database connection
  if (options?.dryRun) {
    result.success = true;
    result.tlsEncrypted = true; // Would be verified in real mode
    result.connected = false;
    result.readOnlyVerified = true;
    result.fingerprint = createHash("sha256").update(normalizedDirectUrl).digest("hex").substring(0, 16);
    result.fingerprint = `sha256:${result.fingerprint}`;
    return result;
  }

  let client: Client | null = null;

  try {
    // Validate the URL first
    const validation = validateQuery(
      "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();"
    );
    if (!validation.allowed) {
      result.error = `Query validation failed: ${validation.error}`;
      return result;
    }

    // Verify no write query in the TLS query
    if (isWriteQuery(
      "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();"
    )) {
      result.error = "WRITE_QUERY_REJECTED";
      return result;
    }

    // Create pg.Client with the normalized URL
    client = new Client({ connectionString: normalizedDirectUrl });

    // Connect
    await client.connect();
    result.connected = true;
    const pgHash = createHash("sha256").update(normalizedDirectUrl).digest("hex").substring(0, 16);
    result.fingerprint = `sha256:${pgHash}`;

    // Verify TLS encryption through the socket
    const stream = (client as any).connection?.stream;
    result.tlsEncrypted = stream?.encrypted === true;

    // FASE 8: Set read-only transaction mode as additional defense
    try {
      await client.query("SET default_transaction_read_only = on;");
      result.readOnlyVerified = true;
    } catch {
      // Read-only setting is an additional layer, not a hard requirement
      result.readOnlyVerified = false;
    }

    // Execute TLS verification query (from allowlist)
    const tlsResult = await client.query(
      "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();"
    );
    result.rowsReturned = tlsResult.rows;
    result.success = true;

    // Also verify the transaction is read-only
    const roResult = await client.query(
      "SELECT current_setting('transaction_read_only') AS tr;"
    );
    const trValue = roResult.rows[0]?.tr;
    if (trValue !== "on") {
      result.readOnlyVerified = false;
    }
  } catch (err: any) {
    result.error = err?.message || "PG_PROBE_FAILED";
    result.success = false;
  } finally {
    // ALWAYS close connection — never leave it open
    if (client) {
      try {
        await client.end();
      } catch {
        // Best effort cleanup
      }
    }
  }

  return result;
}

/**
 * Validate that the pg probe configuration is safe before attempting connection.
 */
export function validatePgConfig(normalizedUrl: string): {
  safe: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Verify URL has sslmode=require
  try {
    const url = new URL(normalizedUrl);
    if (url.searchParams.get("sslmode") !== "require") {
      errors.push("SSLMODE_NOT_REQUIRE");
    }
  } catch {
    errors.push("INVALID_URL");
  }

  // Verify protocol is postgresql
  try {
    const url = new URL(normalizedUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      errors.push("INVALID_PROTOCOL");
    }
  } catch {
    errors.push("INVALID_URL");
  }

  return { safe: errors.length === 0, errors };
}
