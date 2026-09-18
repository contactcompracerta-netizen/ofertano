import { createHash } from 'node:crypto';

/**
 * Distributed canary token handling (Part D1 / AK).
 * The database stores only the SHA-256 hex digest of the runtime token.
 * The plaintext token is never persisted and never interpolated into logs or
 * errors. Lookup is by exact hash equality against a UNIQUE index, so no
 * token-level timing comparison exists between attacker-controlled inputs and
 * the stored secret. Constant-time comparison is not required for the hash
 * lookup itself; we document that and keep the hash comparison exact.
 */

/** SHA-256 hex digest (64 chars). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Fail-closed token validation:
 * - reject empty, whitespace-only and any token containing whitespace;
 * - reject tokens shorter than 8 chars or longer than 512 chars;
 * - accept any other Unicode input (non-whitespace) — the hash is fixed-size.
 */
export function validCanaryToken(token: string | undefined): token is string {
  return typeof token === 'string' && /^\S{8,512}$/u.test(token);
}

/**
 * Short non-reversible diagnostic prefix. Never used in default logs/events;
 * available only for local test diagnostics (Part Q keeps logs secret-free).
 */
export function tokenHashPrefix(token: string): string {
  return hashToken(token).slice(0, 8);
}

/** Deterministic short external-ID fingerprint for events (mirrors 50AG.2). */
export function externalIdSafe(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}