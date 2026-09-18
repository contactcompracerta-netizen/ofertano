import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Marketplace } from '@prisma/client';
import type { ClaimOutcome, FinalizeInput, FinalizeOutcome, GrantDraft, SqlExecutor } from './contracts';
import { canTransition } from './state';
import type { CommerceCanaryAttemptKind, CommerceCanaryGrantStatus } from '@prisma/client';
import type { QueryResultRow } from 'pg';

export type { SqlExecutor } from './contracts';

const pools = new Map<string, Pool>();

/** Dedicated lazy pool per validated local connection string (fail-closed). */
export function controlPlanePool(connectionString: string): Pool {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 2000, idleTimeoutMillis: 30000 });
    pools.set(connectionString, pool);
  }
  return pool;
}

export function grantId(): string {
  return randomUUID();
}

type GrantRow = {
  id: string; status: CommerceCanaryGrantStatus; claimedBy: string | null;
  attemptsClaimed: number; maxAttempts: number; expiresAt: Date; dryRunOnly: boolean;
  consumedAt: Date | null; failedAt: Date | null; failureCode: string | null;
};

const CLAIM_SQL = `
  UPDATE "CommerceCanaryGrant" g
     SET "status" = 'CLAIMED'::"CommerceCanaryGrantStatus",
         "claimedAt" = NOW(),
         "claimedBy" = $3,
         "attemptsClaimed" = g."attemptsClaimed" + 1,
         "updatedAt" = NOW()
   WHERE g."tokenHash" = $1
     AND g."status" = 'ARMED'::"CommerceCanaryGrantStatus"
     AND g."marketplace" = $2::"Marketplace"
     AND g."externalId" = $4
     AND g."expiresAt" > NOW()
     AND g."attemptsClaimed" < g."maxAttempts"
     AND g."dryRunOnly" = false
   RETURNING g."id", g."status", g."claimedBy", g."attemptsClaimed", g."expiresAt", g."consumedAt", g."failedAt", g."failureCode"`;

/**
 * PART G — GLOBAL ATOMIC CLAIM.
 * A single row-level UPDATE ... WHERE ... RETURNING performs the whole check
 * (tokenHash match, status ARMED, exact marketplace, exact externalId,
 * expiresAt > NOW(), attemptsClaimed < maxAttempts, dryRunOnly=false) and the
 * state transition in one atomic statement. PostgreSQL row locking serializes
 * concurrent contenders: exactly one UPDATE matches the pre-claim state; every
 * other contender sees 0 rows and is classified by a follow-up SELECT.
 */
export async function claimCanaryGrant(
  executor: SqlExecutor,
  input: { tokenHash: string; marketplace: Marketplace; externalId: string; executionId: string },
): Promise<ClaimOutcome> {
  const res = await executor.query(CLAIM_SQL, [input.tokenHash, input.marketplace, input.executionId, input.externalId]);
  if ((res.rowCount ?? 0) === 1) {
    const row = res.rows[0];
    return {
      success: true,
      grant: {
        id: row.id, status: 'CLAIMED', claimedBy: row.claimedBy,
        attemptsClaimed: Number(row.attemptsClaimed), expiresAt: new Date(row.expiresAt),
      },
    };
  }
  const found = await executor.query<GrantRow & { marketplace: Marketplace; externalId: string }>(
    `SELECT "id", "status", "claimedBy", "attemptsClaimed", "maxAttempts", "expiresAt", "dryRunOnly", "consumedAt", "failedAt", "failureCode", "marketplace", "externalId"
       FROM "CommerceCanaryGrant" WHERE "tokenHash" = $1`,
    [input.tokenHash],
  );
  if ((found.rowCount ?? 0) === 0) return { success: false, reason: 'GRANT_NOT_FOUND' };
  const g = found.rows[0];
  if (g.marketplace !== input.marketplace) return { success: false, reason: 'MARKETPLACE_MISMATCH', grantId: g.id, grantStatus: g.status };
  if (g.externalId !== input.externalId) return { success: false, reason: 'EXTERNAL_ID_MISMATCH', grantId: g.id, grantStatus: g.status };
  return { success: false, ...classifyClaimBlock(g), grantId: g.id, grantStatus: g.status };
}

function classifyClaimBlock(g: GrantRow): { reason: 'ALREADY_CLAIMED' | 'CONSUMED' | 'FAILED' | 'DISABLED' | 'EXPIRED' | 'ATTEMPTS_EXHAUSTED' | 'DRY_RUN_ONLY' | 'CLAIM_UNEXPECTED' } {
  switch (g.status) {
    case 'CLAIMED': return { reason: 'ALREADY_CLAIMED' };
    case 'CONSUMED': return { reason: 'CONSUMED' };
    case 'FAILED': return { reason: 'FAILED' };
    case 'DISABLED': return { reason: 'DISABLED' };
    case 'EXPIRED': return { reason: 'EXPIRED' };
    case 'ARMED':
      if (new Date(g.expiresAt).getTime() <= Date.now()) return { reason: 'EXPIRED' };
      if (Number(g.attemptsClaimed) >= Number(g.maxAttempts)) return { reason: 'ATTEMPTS_EXHAUSTED' };
      if (g.dryRunOnly) return { reason: 'DRY_RUN_ONLY' };
      return { reason: 'CLAIM_UNEXPECTED' };
  }
}

/**
 * PART L — FINALIZATION.
 * Only the claimant (claimedBy == executionId) can move CLAIMED to a final
 * state. Idempotent: a repeated finalize never mutates an already-final grant
 * and never reopens it (L1).
 */
export async function finalizeCanaryGrant(
  executor: SqlExecutor,
  input: FinalizeInput,
): Promise<FinalizeOutcome> {
  const res = await executor.query(
    `UPDATE "CommerceCanaryGrant" g
        SET "status" = $2::"CommerceCanaryGrantStatus",
            "consumedAt" = CASE WHEN $2 = 'CONSUMED' THEN NOW() ELSE g."consumedAt" END,
            "failedAt"   = CASE WHEN $2 = 'FAILED'   THEN NOW() ELSE g."failedAt"   END,
            "failureCode" = $3,
            "resultObservationId" = $4,
            "resultStatus" = $5,
            "updatedAt" = NOW()
      WHERE g."id" = $1
        AND g."status" = 'CLAIMED'::"CommerceCanaryGrantStatus"
        AND g."claimedBy" = $6
      RETURNING g."id", g."status"`,
    [input.grantId, input.finalStatus, input.failureCode ?? null, input.resultObservationId ?? null, input.resultStatus ?? null, input.executionId],
  );
  if ((res.rowCount ?? 0) === 1) return { applied: true, status: input.finalStatus };
  const found = await executor.query<{ id: string; status: CommerceCanaryGrantStatus; claimedBy: string | null }>(
    `SELECT "id", "status", "claimedBy" FROM "CommerceCanaryGrant" WHERE "id" = $1`,
    [input.grantId],
  );
  if ((found.rowCount ?? 0) === 0) return { applied: false, reason: 'NOT_FOUND' };
  const g = found.rows[0];
  if (g.status === 'CLAIMED' && g.claimedBy !== input.executionId) return { applied: false, reason: 'NOT_CLAIMANT', status: g.status };
  return { applied: false, reason: 'ALREADY_FINALIZED', status: g.status };
}

export async function createCanaryGrant(
  executor: SqlExecutor,
  draft: GrantDraft,
): Promise<{ id: string }> {
  const id = grantId();
  const maxAttempts = Math.max(1, Math.floor(draft.maxAttempts ?? 1));
  const res = await executor.query(
    `INSERT INTO "CommerceCanaryGrant"
       ("id", "tokenHash", "status", "marketplace", "externalId", "maxAttempts", "attemptsClaimed",
        "dryRunOnly", "requireExactIdentity", "expiresAt", "metadata", "createdAt", "updatedAt")
     VALUES ($1, $2, 'ARMED'::"CommerceCanaryGrantStatus", $3::"Marketplace", $4, $5, 0, $6, $7, $8, $9::jsonb, NOW(), NOW())
     RETURNING "id"`,
    [id, draft.tokenHash, draft.marketplace, draft.externalId, maxAttempts, draft.dryRunOnly ?? false, draft.requireExactIdentity ?? true, draft.expiresAt, JSON.stringify(draft.metadata ?? {})],
  );
  return { id: res.rows[0].id };
}

/** Explicit operator transition (ARMED → DISABLED / EXPIRED), fail-closed. */
export async function transitionCanaryGrant(
  executor: SqlExecutor,
  input: { id: string; from: 'ARMED'; to: 'DISABLED' | 'EXPIRED' },
): Promise<{ applied: boolean; status?: CommerceCanaryGrantStatus }> {
  if (!canTransition(input.from, input.to)) return { applied: false };
  const res = await executor.query(
    `UPDATE "CommerceCanaryGrant" g SET "status" = $2::"CommerceCanaryGrantStatus", "updatedAt" = NOW()
      WHERE g."id" = $1 AND g."status" = $3::"CommerceCanaryGrantStatus" RETURNING g."id", g."status"`,
    [input.id, input.to, input.from],
  );
  if ((res.rowCount ?? 0) === 1) return { applied: true, status: input.to };
  const found = await executor.query<{ status: CommerceCanaryGrantStatus }>(
    `SELECT "status" FROM "CommerceCanaryGrant" WHERE "id" = $1`, [input.id],
  );
  return { applied: false, status: found.rows[0]?.status };
}

export async function getGrantByTokenHash(executor: SqlExecutor, tokenHash: string): Promise<GrantRow | null> {
  const res = await executor.query<GrantRow>(
    `SELECT "id", "status", "claimedBy", "attemptsClaimed", "maxAttempts", "expiresAt", "dryRunOnly", "consumedAt", "failedAt", "failureCode"
       FROM "CommerceCanaryGrant" WHERE "tokenHash" = $1`, [tokenHash],
  );
  return res.rows[0] ?? null;
}

export async function getGrantById(executor: SqlExecutor, id: string): Promise<GrantRow | null> {
  const res = await executor.query<GrantRow>(
    `SELECT "id", "status", "claimedBy", "attemptsClaimed", "maxAttempts", "expiresAt", "dryRunOnly", "consumedAt", "failedAt", "failureCode"
       FROM "CommerceCanaryGrant" WHERE "id" = $1`, [id],
  );
  return res.rows[0] ?? null;
}

/** Append-only audit row (Part P). Never carries secrets. */
export async function recordGrantAttempt(
  executor: SqlExecutor,
  input: { grantId: string; kind: CommerceCanaryAttemptKind; reason?: string; executionId?: string; latencyMs?: number; metadata?: Record<string, unknown> },
): Promise<void> {
  await executor.query(
    `INSERT INTO "CommerceCanaryAttempt"
       ("id", "grantId", "kind", "reason", "executionId", "latencyMs", "metadata", "createdAt")
     VALUES ($1, $2, $3::"CommerceCanaryAttemptKind", $4, $5, $6, $7::jsonb, NOW())`,
    [grantId(), input.grantId, input.kind, input.reason ?? null, input.executionId ?? null, input.latencyMs ?? null, JSON.stringify(input.metadata ?? {})],
  );
}

/** Lazy controlled expiry of ARMED grants past their TTL (Part Z). */
export async function expireEligibleGrants(executor: SqlExecutor): Promise<number> {
  const res = await executor.query(
    `UPDATE "CommerceCanaryGrant" g
        SET "status" = 'EXPIRED'::"CommerceCanaryGrantStatus", "updatedAt" = NOW()
      WHERE g."status" = 'ARMED'::"CommerceCanaryGrantStatus" AND g."expiresAt" <= NOW()
      RETURNING g."id"`,
  );
  return res.rowCount ?? 0;
}

export async function disconnectControlPlanePools(): Promise<void> {
  for (const pool of pools.values()) await pool.end().catch(() => {});
  pools.clear();
}