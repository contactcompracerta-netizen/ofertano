import { randomUUID } from 'node:crypto';
import type { CommerceCanaryGrantStatus } from '@prisma/client';
import { commerceFlagNames } from '../flags';
import { shadowFlagNames } from '../shadow/config';
import { runCommerceShadowCanary } from '../shadow/service';
import { WriteBudget, type CommerceShadowResult } from '../shadow/contracts';
import type {
  DistributedCanaryDependencies, DistributedCanaryInput, DistributedCanaryResult, ControlPlaneEvent,
} from './contracts';
import { distributedCanaryFlagNames, parseDistributedCanaryConfig, distributedTokenState, localControlPlaneTarget, productionControlModeRequirement, dbNameOf } from './config';
import { externalIdSafe, hashToken } from './token';
import { claimCanaryGrant, finalizeCanaryGrant, recordGrantAttempt, controlPlanePool, getGrantById, type SqlExecutor } from './repository';

/**
 * COMMERCE DISTRIBUTED CANARY ORCHESTRATOR (50AG.3).
 *
 * Fail-closed execution flow (Part K):
 *   1. Distributed flag OFF     -> LOCAL_PROCESS_BUDGET mode, NO grant access.
 *   2. Shadow gate / token / exact marketplace / exact externalId / local-only
 *      target / production-control-mode gates (Parts E,F,AL,R1).
 *   3. Dry-run preflight (0 writes, 0 claims) validates input + EXACT identity (Parts M, AM).
 *   4. Config dry-run            -> return DRY_RUN, still no claim.
 *   5. claimCanaryGrant()        -> Postgres-atomic ONE-SHOT claim.
 *   6. Claim failed              -> ZERO shadow writes, grant BLOCKED recorded.
 *   7. Claim won                 -> runCommerceShadowCanary write path (one canary execution).
 *   8. CREATED/DEDUPED           -> finalize CONSUMED.
 *   9. Otherwise / exception     -> finalize FAILED. NEVER retry automatically.
 *
 * Crash semantics (Part I): if the process dies after claim, the grant stays
 * CLAIMED forever (no lease reaper, no auto-recovery). AT-MOST-ONE > availability.
 */
export async function runCommerceDistributedCanary(
  input: DistributedCanaryInput,
  deps: DistributedCanaryDependencies = {},
): Promise<DistributedCanaryResult> {
  const started = performance.now();
  const sourceEnv = deps.env ?? process.env;
  const env = Object.fromEntries([...shadowFlagNames, ...commerceFlagNames, ...distributedCanaryFlagNames].map((k) => [k, sourceEnv[k]]));
  const dist = parseDistributedCanaryConfig(env);
  const deploymentEnv = deps.deploymentEnv ?? process.env.VERCEL_ENV;
  const connectionString = deps.connectionString ?? process.env.DATABASE_URL;
  const executionId = deps.executionId ?? randomUUID();

  const emit = (event: Omit<ControlPlaneEvent, 'durationMs'>): void => {
    const record: ControlPlaneEvent = { ...event, durationMs: performance.now() - started };
    try {
      (deps.log ?? ((e) => console.info(JSON.stringify(e))))(record);
    } catch {
      try { console.warn(JSON.stringify({ ...record, event: 'COMMERCE_CANARY_GRANT_BLOCKED' as const, reason: 'LOGGER_FAILED' })); } catch { /* isolated */ }
    }
  };
  const finish = (r: Omit<DistributedCanaryResult, 'durationMs'>): DistributedCanaryResult => ({ ...r, durationMs: performance.now() - started });

  // PART E / R — distributed flag OFF: no grant table read/write at all.
  if (!dist.enabled) {
    return finish({ mode: 'LOCAL_PROCESS_BUDGET', status: 'NOT_DISTRIBUTED', reason: 'DISTRIBUTED_DISABLED', claimSucceeded: false, writesPerformed: 0 });
  }

  const pool: SqlExecutor = deps.getExecutor ? deps.getExecutor() : controlPlanePool(connectionString!);
  const blocked = (reason: DistributedCanaryResult['reason'] | ControlPlaneEvent['reason'], grant?: { id: string; status?: CommerceCanaryGrantStatus }): DistributedCanaryResult => {
    const safeGrantId = grant?.id;
    if (safeGrantId) void recordGrantAttempt(pool, { grantId: safeGrantId, kind: 'BLOCKED', reason, executionId }).catch(() => {});
    emit({ event: 'COMMERCE_CANARY_GRANT_BLOCKED', marketplace: input.marketplace, externalIdSafe: externalIdSafe(input.externalId ?? ''), status: grant?.status, reason, grantId: safeGrantId, executionId });
    return finish({ mode: 'DISTRIBUTED_GRANT', status: 'BLOCKED', reason, claimSucceeded: false, grantId: safeGrantId, grantStatus: grant?.status, executionId, writesPerformed: 0 });
  };

  // Fail-closed config gates (Part AL): each divergence blocks BEFORE any grant access.
  if (!dist.shadowEnabled) return blocked('SHADOW_DISABLED');
  const tokenState = distributedTokenState(env);
  if (tokenState.reason !== 'OK') return blocked(tokenState.reason);
  if (!dist.marketplace) return blocked('MARKETPLACE_MISSING');
  if (!dist.externalId) return blocked('EXTERNAL_ID_MISSING');
  if (input.marketplace !== dist.marketplace) return blocked('MARKETPLACE_MISMATCH');
  if (!input.externalId || input.externalId !== dist.externalId) return blocked('EXTERNAL_ID_MISMATCH');
  const targetError = localControlPlaneTarget(connectionString, deploymentEnv, deps.localDbNames);
  if (targetError) return blocked(targetError);
  const prodGate = productionControlModeRequirement(env, deploymentEnv);
  if (!prodGate.ok) return blocked(prodGate.reason!);

  // The shadow write targets the SAME validated local control-plane database;
  // its (already whitelisted) name is an explicit local shadow target override.
  const controlPlaneDbName = dbNameOf(connectionString);
  const shadowLocalDbNames = [...(deps.localDbNames ?? []), ...(controlPlaneDbName ? [controlPlaneDbName] : [])];

  const claimed = { grantId: null as string | null, finalized: false };

  try {
    // PART M / AM — dry-run preflight: bounded reads, NO writes, NO claim.
    const dryEnv = { ...env, COMMERCE_SHADOW_DRY_RUN: 'true' };
    const preflight = await runCommerceShadowCanary(input, {
      env: dryEnv, connectionString, deploymentEnv, localDbNames: shadowLocalDbNames, log: deps.shadowDeps?.log,
    });
    if (preflight.status === 'FAILED') return blocked(`PREFLIGHT_${preflight.reason}`);
    if (preflight.status !== 'DRY_RUN') return blocked(preflight.reason ?? 'SHADOW_PREFLIGHT_FAILED');
    if (preflight.identity?.status !== 'EXACT') return blocked('IDENTITY_NOT_EXACT');
    if (dist.dryRun) {
      // Dry-run mission: no claim, no write (Part M separation).
      return finish({ mode: 'DISTRIBUTED_GRANT', status: 'DRY_RUN', reason: 'DRY_RUN', claimSucceeded: false, executionId, writesPerformed: 0 });
    }

    // PART G — GLOBAL ATOMIC CLAIM.
    const claimStarted = performance.now();
    const claim = await claimCanaryGrant(pool, {
      tokenHash: hashToken(tokenState.token!), marketplace: input.marketplace, externalId: input.externalId, executionId,
    });
    const claimMs = Math.round(performance.now() - claimStarted);
    if (!claim.success) {
      const reason = claim.reason as ControlPlaneEvent['reason'];
      if (claim.grantId) await recordGrantAttempt(pool, { grantId: claim.grantId, kind: 'BLOCKED', reason, executionId, latencyMs: claimMs }).catch(() => {});
      emit({ event: 'COMMERCE_CANARY_GRANT_BLOCKED', marketplace: input.marketplace, externalIdSafe: externalIdSafe(input.externalId), status: claim.grantStatus, reason, grantId: claim.grantId, executionId });
      return finish({ mode: 'DISTRIBUTED_GRANT', status: 'BLOCKED', reason, claimSucceeded: false, grantId: claim.grantId, grantStatus: claim.grantStatus, executionId, writesPerformed: 0 });
    }
    claimed.grantId = claim.grant.id;
    await recordGrantAttempt(pool, { grantId: claim.grant.id, kind: 'CLAIM', reason: 'CLAIMED', executionId, latencyMs: claimMs });
    emit({ event: 'COMMERCE_CANARY_GRANT_CLAIMED', marketplace: input.marketplace, externalIdSafe: externalIdSafe(input.externalId), status: 'CLAIMED', reason: 'CLAIMED', grantId: claim.grant.id, executionId });

    // PART H — the winning claimant runs the single authorized shadow canary.
    const writeEnv = { ...env, COMMERCE_SHADOW_DRY_RUN: 'false' };
    let shadow: CommerceShadowResult;
    try {
      shadow = await runCommerceShadowCanary(input, {
        env: writeEnv, connectionString, deploymentEnv, localDbNames: shadowLocalDbNames,
        budget: new WriteBudget(), log: deps.shadowDeps?.log,
      });
    } catch (error) {
      // In-process exception after claim: finalize FAILED (never auto-retry).
      const code = (error as { code?: string })?.code;
      const raw = (error as { message?: string })?.message;
      const failureCode = code && /^[A-Z0-9_]{1,32}$/.test(code) ? code : ['IDENTITY_CHANGED', 'WRITER_DISABLED'].includes(raw ?? '') ? raw! : 'DISTRIBUTED_EXECUTION_FAILED';
      await finalizeFail(pool, claim.grant.id, executionId, failureCode);
      claimed.finalized = true;
      emit({ event: 'COMMERCE_CANARY_FAILED', marketplace: input.marketplace, externalIdSafe: externalIdSafe(input.externalId), status: 'FAILED', reason: 'WRITE_EXCEPTION', grantId: claim.grant.id, executionId });
      return finish({ mode: 'DISTRIBUTED_GRANT', status: 'FAILED', reason: 'WRITE_EXCEPTION', claimSucceeded: true, grantId: claim.grant.id, grantStatus: 'FAILED', executionId, writesPerformed: 0 });
    }

    // PART L — FINALIZATION by the claimant only.
    if (shadow.status === 'CREATED' || shadow.status === 'DEDUPED') {
      const final = await finalizeCanaryGrant(pool, {
        grantId: claim.grant.id, executionId, finalStatus: 'CONSUMED',
        resultObservationId: shadow.observation?.id ?? undefined, resultStatus: shadow.status,
      });
      claimed.finalized = true;
      await recordGrantAttempt(pool, { grantId: claim.grant.id, kind: 'CONSUMED', reason: final.applied ? shadow.status : final.reason, executionId, metadata: { writesPerformed: shadow.writesPerformed } }).catch(() => {});
      emit({ event: 'COMMERCE_CANARY_CONSUMED', marketplace: input.marketplace, externalIdSafe: externalIdSafe(input.externalId), status: 'CONSUMED', reason: shadow.status, grantId: claim.grant.id, executionId, resultObservationId: shadow.observation?.id ?? undefined, resultStatus: shadow.status });
      return finish({
        mode: 'DISTRIBUTED_GRANT', status: shadow.status === 'CREATED' ? 'CREATED' : 'DEDUPED', reason: shadow.status,
        claimSucceeded: true, grantId: claim.grant.id, grantStatus: 'CONSUMED', executionId, shadow, writesPerformed: shadow.writesPerformed,
      });
    }
    // Any non-authorized outcome after a successful claim is a FAILED execution.
    const failureCode = shadow.status === 'FAILED' ? (shadow.reason || 'SHADOW_WRITE_FAILED') : `WRITE_${shadow.status}`;
    await finalizeFail(pool, claim.grant.id, executionId, failureCode);
    claimed.finalized = true;
    emit({ event: 'COMMERCE_CANARY_FAILED', marketplace: input.marketplace, externalIdSafe: externalIdSafe(input.externalId), status: 'FAILED', reason: failureCode, grantId: claim.grant.id, executionId });
    return finish({ mode: 'DISTRIBUTED_GRANT', status: 'FAILED', reason: failureCode, claimSucceeded: true, grantId: claim.grant.id, grantStatus: 'FAILED', executionId, shadow, writesPerformed: shadow.writesPerformed });
  } catch (error) {
    // Guard: if something unexpected threw AFTER the claim, fail-closed to FAILED.
    if (claimed.grantId && !claimed.finalized) {
      const code = (error as { code?: string })?.code;
      const failureCode = code && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'DISTRIBUTED_EXECUTION_FAILED';
      await finalizeFail(pool, claimed.grantId, executionId, failureCode).catch(() => {});
      emit({ event: 'COMMERCE_CANARY_FAILED', marketplace: input.marketplace, externalIdSafe: externalIdSafe(input.externalId), status: 'FAILED', reason: 'UNEXPECTED_FAILURE', grantId: claimed.grantId, executionId });
    }
    return finish({ mode: 'DISTRIBUTED_GRANT', status: 'FAILED', reason: 'UNEXPECTED_FAILURE', claimSucceeded: !!claimed.grantId, grantId: claimed.grantId ?? undefined, grantStatus: claimed.grantId ? (await getGrantById(pool, claimed.grantId).catch(() => null))?.status ?? 'FAILED' : undefined, executionId, writesPerformed: 0 });
  }
}

async function finalizeFail(pool: SqlExecutor, grantId: string, executionId: string, failureCode: string): Promise<void> {
  const final = await finalizeCanaryGrant(pool, { grantId, executionId, finalStatus: 'FAILED', failureCode });
  await recordGrantAttempt(pool, { grantId, kind: 'FAILED', reason: final.applied ? failureCode : final.reason, executionId }).catch(() => {});
}

export type { DistributedCanaryDependencies } from './contracts';