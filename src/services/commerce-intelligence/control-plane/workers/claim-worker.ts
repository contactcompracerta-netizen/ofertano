/**
 * 50AG.3 — multiprocess claim worker (spawned by control-plane.multiprocess.test.ts).
 *
 * Runs under tsx so it exercises the EXACT production repository claim
 * (claimCanaryGrant + its single-statement atomic SQL). There is no duplicated
 * SQL here, so the cross-process race can never drift from the real code path.
 *
 * Modes:
 *   - default: claim once, print result, close cleanly.
 *   - CRASH_AFTER_CLAIM=true: claim once, then terminate abruptly BEFORE any
 *     finalization or connection teardown — simulating a process crash. The
 *     grant must stay CLAIMED (no lease reaper, no auto recovery).
 */
import { Client } from 'pg';
import type { Marketplace } from '@prisma/client';
import { claimCanaryGrant } from '../repository';

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`MISSING_ENV:${name}`);
  return v;
};

async function main(): Promise<void> {
  const started = performance.now();
  const url = required('DATABASE_URL');
  const tokenHash = required('GRANT_TOKEN_HASH');
  const marketplace = required('GRANT_MARKETPLACE') as Marketplace;
  const externalId = required('GRANT_EXTERNAL_ID');
  const workerId = required('WORKER_ID');

  const client = new Client({ connectionString: url });
  await client.connect();
  const outcome = await claimCanaryGrant(client, {
    tokenHash,
    marketplace,
    externalId,
    executionId: workerId,
  });
  const ms = Math.round(performance.now() - started);

  if (outcome.success) {
    process.stdout.write(`CLAIM_WIN:${workerId}:${ms}\n`, () => {
      if (process.env.CRASH_AFTER_CLAIM === 'true') {
        // Simulated crash: hard-exit, no client.end(), no finalize call.
        // The claim's autocommitted UPDATE is already durable in Postgres.
        process.exit(1);
      }
      void client.end().finally(() => process.exit(0));
    });
    return;
  }
  process.stdout.write(`CLAIM_LOSE:${outcome.reason}:${ms}\n`, () => {
    void client.end().finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});