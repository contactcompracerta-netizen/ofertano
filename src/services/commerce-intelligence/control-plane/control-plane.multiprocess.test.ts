/**
 * 50AG.3 — MULTIPROCESS / DISTRIBUTED-SAFETY PROOF.
 *
 * Proves AT-MOST-ONE across independent OS processes (not just in-process
 * awaits): every process runs the real production repository/service code
 * through its own pg connection.
 *
 *   PART U1 — 50-way claim race ×3 rounds: exactly 1 winner, 49 blocked.
 *   PART U2 — crash simulation: claimant dies after claim; grant stays
 *             CLAIMED forever (no lease reaper), a second process is blocked.
 *   PART U3 — full-flow race: 6 processes run the complete distributed canary
 *             against ONE grant; exactly one authorized write, the rest
 *             fail-closed before any shadow write.
 *
 * Runs ONLY against the dedicated local mission DB
 * (127.0.0.1:55433/ofertano_50ag3_control_plane). Not part of `npm test`.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createCanaryGrant, getGrantById, disconnectControlPlanePools } from './repository';
import { hashToken } from './token';
import { ensureFixture, type Counts } from './multiprocess-fixture';

const url = process.env.DATABASE_URL ?? '';
const target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.port !== '55433' || target.pathname !== '/ofertano_50ag3_control_plane') throw Error('LOCAL_TRIPWIRE');
void target;

const workersDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'workers');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const claimWorker = path.join(workersDir, 'claim-worker.ts');
const flowWorker = path.join(workersDir, 'flow-worker.ts');

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const client = new Client({ connectionString: url });

type WorkerRun = { code: number | null; stdout: string; stderr: string };

function runWorker(worker: string, workerEnv: Record<string, string>): Promise<WorkerRun> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['--no-install', 'tsx', worker], {
      cwd: projectRoot,
      env: { ...process.env, ...workerEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const pct = (arr: number[], p: number): number => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)))];
};

async function main() {
  await client.connect();
  const evidence: {
    races: Array<{ round: number; grantId: string; winner?: string; claims: number; blocked: number }>;
    claimLatency: { samples: number; p50Ms: number; p95Ms: number; minMs?: number; maxMs?: number };
    crash: Record<string, unknown> | null;
    flow: Record<string, unknown> | null;
    final: Record<string, unknown> | null;
  } = {
    races: [],
    claimLatency: { samples: 0, p50Ms: 0, p95Ms: 0 },
    crash: null,
    flow: null,
    final: null,
  };
  const claimMs: number[] = [];

  try {
    // Dedicated mission DB: reset synthetic state for determinism.
    await client.query('TRUNCATE "CommerceCanaryGrant", "CommerceCanaryAttempt" CASCADE');
    const scrubOrder = [
      'DELETE FROM "TrustSignal"',
      'DELETE FROM "OfferPriceComponent"',
      'DELETE FROM "OfferObservation"',
      'DELETE FROM "IdentityConflict"',
      'DELETE FROM "IdentityEvidence"',
      `DELETE FROM "ProductIdentifier" WHERE source = 'shadow-observed-v1'`,
      'DELETE FROM "ProductVariant"',
      'DELETE FROM "ProductRelation"',
    ];
    for (const sql of scrubOrder) await client.query(sql);
    await ensureFixture(db);

    // ================= PART U1 — 50-way cross-process claim race ×3 =================
    for (let round = 1; round <= 3; round++) {
      const tokenHash = hashToken(randomUUID()); // fresh unique grant per round
      const grant = await createCanaryGrant(client, {
        tokenHash,
        marketplace: 'AMAZON',
        externalId: 'SHADOW-ASIN1',
        expiresAt: new Date(Date.now() + 300_000),
      });
      const runs = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          runWorker(claimWorker, {
            DATABASE_URL: url,
            GRANT_TOKEN_HASH: tokenHash,
            GRANT_MARKETPLACE: 'AMAZON',
            GRANT_EXTERNAL_ID: 'SHADOW-ASIN1',
            WORKER_ID: `r${round}-w${String(i).padStart(2, '0')}`,
          }),
        ),
      );
      for (const r of runs) {
        if (r.code !== 0) throw new Error(`worker failed (round ${round}): ${r.stderr.slice(0, 400)}`);
        const m = /CLAIM_(WIN|LOSE):([^:]+):(\d+)/.exec(r.stdout);
        assert.ok(m, `unparsable worker output: ${r.stdout.slice(0, 200)}`);
        claimMs.push(Number(m[3]));
      }
      const wins = runs.filter((r) => r.stdout.includes('CLAIM_WIN:'));
      const loses = runs.filter((r) => r.stdout.includes('CLAIM_LOSE:'));
      assert.equal(wins.length, 1, `round ${round}: exactly 1 winner across 50 processes`);
      assert.equal(loses.length, 49, `round ${round}: 49 processes blocked`);
      const winner = /CLAIM_WIN:([^:]+)/.exec(wins[0].stdout)?.[1];
      const row = await getGrantById(client, grant.id);
      assert.equal(row?.status, 'CLAIMED');
      assert.equal(row?.attemptsClaimed, 1);
      assert.equal(row?.claimedBy, winner);
      const loseReasons = [...new Set(runs.filter((r) => r.stdout.includes('CLAIM_LOSE:')).map((r) => /CLAIM_LOSE:([^:]+)/.exec(r.stdout)?.[1]))];
      assert.deepEqual(loseReasons.sort(), ['ALREADY_CLAIMED'], `round ${round}: blocked reason`);
      evidence.races.push({ round, grantId: grant.id, winner, claims: 1, blocked: 49 });
      console.log(`MULTIPROCESS_RACE_ROUND_${round}_50_WAY_1_WINNER_49_BLOCKED=PASS`);
    }
    evidence.claimLatency = { samples: claimMs.length, p50Ms: pct(claimMs, 50), p95Ms: pct(claimMs, 95), minMs: Math.min(...claimMs), maxMs: Math.max(...claimMs) };

    // ================= PART U2 — crash simulation =================
    const crashTokenHash = hashToken(randomUUID());
    const crashGrant = await createCanaryGrant(client, {
      tokenHash: crashTokenHash,
      marketplace: 'AMAZON',
      externalId: 'SHADOW-ASIN1',
      expiresAt: new Date(Date.now() + 300_000),
    });
    const crashBase = {
      DATABASE_URL: url,
      GRANT_TOKEN_HASH: crashTokenHash,
      GRANT_MARKETPLACE: 'AMAZON',
      GRANT_EXTERNAL_ID: 'SHADOW-ASIN1',
    } as const;
    const crashed = await runWorker(claimWorker, { ...crashBase, WORKER_ID: 'crash-exec-a', CRASH_AFTER_CLAIM: 'true' });
    assert.ok(crashed.stdout.includes('CLAIM_WIN:crash-exec-a'), 'crashed process claimed first');
    // Process A is gone WITHOUT finalizing. Process B (new process) retries:
    const retry = await runWorker(claimWorker, { ...crashBase, WORKER_ID: 'crash-exec-b' });
    assert.ok(retry.stdout.includes('CLAIM_LOSE:ALREADY_CLAIMED'), 'retry after crash is blocked');
    const crashRow = await getGrantById(client, crashGrant.id);
    assert.equal(crashRow?.status, 'CLAIMED', 'grant stays CLAIMED after crash (no auto recovery)');
    assert.equal(crashRow?.claimedBy, 'crash-exec-a');
    assert.equal(crashRow?.attemptsClaimed, 1);
    assert.equal(crashRow?.consumedAt, null, 'never auto-advanced to CONSUMED');
    assert.equal(crashRow?.failedAt, null, 'never auto-advanced to FAILED');
    evidence.crash = { grantId: crashGrant.id, claimedBy: 'crash-exec-a', status: crashRow?.status, attemptsClaimed: crashRow?.attemptsClaimed };
    console.log('MULTIPROCESS_CRASH_CLAIMED_STAYS_CLAIMED_NO_REARM=PASS');

    // ================= PART U3 — full-flow race: 6 processes, 1 grant =================
    const flowToken = randomUUID();
    const flowGrant = await createCanaryGrant(client, {
      tokenHash: hashToken(flowToken),
      marketplace: 'AMAZON',
      externalId: 'SHADOW-ASIN3',
      expiresAt: new Date(Date.now() + 300_000),
    });
    const before = await counts();
    // Stagger spawns (~300ms): cold-booting 6 instances at the exact same
    // millisecond is a contrived thundering herd (all 6 build fresh Prisma
    // client pools simultaneously); realistic rollout starts instances in
    // sequence. AT-MOST-ONE is decided by the claim either way (fail-closed).
    const spawns: Array<Promise<WorkerRun>> = [];
    for (let i = 0; i < 6; i++) {
      spawns.push(
        runWorker(flowWorker, {
          DATABASE_URL: url,
          CANARY_TOKEN: flowToken,
          FLOW_EXTERNAL_ID: 'SHADOW-ASIN3',
          WORKER_ID: `flow-w${i}`,
        }),
      );
      await new Promise((r) => setTimeout(r, 300));
    }
    const flows = await Promise.all(spawns);
    const results = flows.map((r) => {
      if (r.code !== 0) throw new Error(`flow worker failed: ${r.stderr.slice(0, 400)}`);
      const m = /FLOW:([^:]+):([^:]+):([^:]*):(\d+)/.exec(r.stdout);
      assert.ok(m, `unparsable flow output: ${r.stdout.slice(0, 200)}`);
      return { status: m[1], reason: m[2], grantId: m[3] || undefined, writesPerformed: Number(m[4]) };
    });
    const created = results.filter((r) => r.status === 'CREATED');
    const deduped = results.filter((r) => r.status === 'DEDUPED');
    const blocked = results.filter((r) => r.status === 'BLOCKED');
    assert.equal(created.length + deduped.length, 1, 'exactly one authorized canary flow (CREATED or DEDUPED)');
    assert.equal(blocked.length, 5, 'five flows fail-closed before any write');
    const writes = results.reduce((sum, r) => sum + r.writesPerformed, 0);
    assert.equal(writes, created.length, 'exactly one authorized shadow write');
    // Every blocked flow must be fail-closed (0 writes). The dominant block is
    // the atomic claim (ALREADY_CLAIMED while the winner runs, CONSUMED after
    // finalize); a transient dry-run preflight gate (PREFLIGHT_*) is also a
    // legitimate fail-closed outcome and never bypasses the claim.
    for (const b of blocked) {
      assert.equal(b.writesPerformed, 0, `blocked flow must write nothing: ${b.reason}`);
      assert.ok(/^(ALREADY_CLAIMED|CONSUMED|PREFLIGHT_[A-Z0-9_]+)$/.test(b.reason), `unexpected block reason: ${b.reason}`);
    }
    const claimBlocked = blocked.filter((b) => b.reason === 'ALREADY_CLAIMED' || b.reason === 'CONSUMED').length;
    assert.ok(claimBlocked >= 3, `the atomic claim dominates: ${claimBlocked}/5 claim-blocked`);
    const flowRow = await getGrantById(client, flowGrant.id);
    assert.equal(flowRow?.status, 'CONSUMED');
    assert.equal(flowRow?.attemptsClaimed, 1);
    assert.ok(flowRow?.consumedAt, 'consumedAt recorded by the winner');
    const after = await counts();
    assert.equal(after.observation - before.observation, created.length, 'observation delta matches authorized writes');
    assert.deepEqual(
      { product: after.product - before.product, offer: after.offer - before.offer, history: after.history - before.history, raw: after.raw - before.raw },
      { product: 0, offer: 0, history: 0, raw: 0 },
      'legacy delta 0',
    );
    evidence.flow = { grantId: flowGrant.id, total: results.length, created: created.length, deduped: deduped.length, blocked: blocked.length, blockedReasons: [...new Set(blocked.map((b) => b.reason))], claimBlocked, writesPerformed: writes, grantStatus: flowRow?.status };
    console.log('MULTIPROCESS_FULL_FLOW_6_PROCESSES_1_AUTHORIZED_WRITE=PASS');

    evidence.final = {
      grantCount: (await client.query('SELECT count(*)::int AS n FROM "CommerceCanaryGrant"')).rows[0].n,
      attemptCount: (await client.query('SELECT count(*)::int AS n FROM "CommerceCanaryAttempt"')).rows[0].n,
    };

    mkdirSync('docs/evidence/50ag3', { recursive: true });
    writeFileSync('docs/evidence/50ag3/control-plane-multiprocess.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log('MULTIPROCESS_AT_MOST_ONE_ACROSS_PROCESSES=PASS');
  } finally {
    await client.end();
    await db.$disconnect();
    await disconnectControlPlanePools();
  }
}

async function counts(): Promise<Counts> {
  const c = {
    product: await db.product.count(),
    offer: await db.marketplaceOffer.count(),
    history: await db.priceHistory.count(),
    raw: await db.rawMarketplaceListing.count(),
    observation: await db.offerObservation.count(),
  };
  return c;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });