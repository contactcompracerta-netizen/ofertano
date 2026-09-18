/**
 * 50AG.3A — 10×50 MULTIPROCESS FINAL AUDIT (EVIDENCE HARDENING).
 *
 * Reuses the SAME real cross-process claim infrastructure as
 * control-plane.multiprocess.test.ts — each contender is an independent OS
 * process (`child_process.spawn` + `npx --no-install tsx`) running the real
 * production `claimCanaryGrant` (single-statement atomic SQL). No duplicated
 * SQL, no Promise.all within a single process for the race itself.
 *
 * Runs 10 independent rounds × 50 concurrent contenders against the SAME
 * grant parameters (marketplace AMAZON, externalId SHADOW-ASIN1) with a NEW
 * grant + NEW synthetic token per round, ARMED, maxAttempts=1.
 *
 * Per round (fail-hard on any anomaly):
 *   - exactly 1 CLAIM_WIN, 49 CLAIM_LOSE, all blocked by ALREADY_CLAIMED;
 *   - the grant row ends CLAIMED, attemptsClaimed=1, claimedBy == winner;
 *   - zero commerce writes (product/offer/history/raw/observation deltas 0).
 *
 * Leaves each round's grant CLAIMED (no finalize — claim-only proof) and
 * cleans up only at the start of the whole run (TRUNCATE + scrub).
 *
 * Writes docs/evidence/50ag3/control-plane-multiprocess-10-rounds.json.
 * Runs ONLY against 127.0.0.1:55433/ofertano_50ag3_control_plane.
 * NOT part of `npm test`. Not a Production SLA.
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

const ROUNDS = 10;
const CONTENDERS = 50;
const BASE_SHA = '49a83ccec9902908c4f30a8598dc94f1c9ba50e9';

const url = process.env.DATABASE_URL ?? '';
const target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.port !== '55433' || target.pathname !== '/ofertano_50ag3_control_plane') {
  throw Error('LOCAL_TRIPWIRE');
}
void target;

const workersDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'workers');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const claimWorker = path.join(workersDir, 'claim-worker.ts');

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

async function counts(): Promise<Counts> {
  return {
    product: await db.product.count(),
    offer: await db.marketplaceOffer.count(),
    history: await db.priceHistory.count(),
    raw: await db.rawMarketplaceListing.count(),
    observation: await db.offerObservation.count(),
  };
}

type RoundEvidence = {
  round: number; grantId: string; winner: string | undefined; claims: number; blocked: number; durationMs: number;
};

async function main(): Promise<void> {
  await client.connect();
  const claimMs: number[] = [];
  const rounds: RoundEvidence[] = [];
  const started = Date.now();

  try {
    // Dedicated mission DB: reset synthetic state for determinism (kept
    // between rounds per claim-only proof; grants stay CLAIMED).
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
    const baseline = await counts();

    for (let round = 1; round <= ROUNDS; round++) {
      const roundStart = Date.now();
      const tokenHash = hashToken(randomUUID()); // NEW synthetic token per round
      const grant = await createCanaryGrant(client, {
        tokenHash,
        marketplace: 'AMAZON',
        externalId: 'SHADOW-ASIN1',
        expiresAt: new Date(Date.now() + 300_000), // TTL required
      });

      const runs = await Promise.all(
        Array.from({ length: CONTENDERS }, (_, i) =>
          runWorker(claimWorker, {
            DATABASE_URL: url,
            GRANT_TOKEN_HASH: tokenHash,
            GRANT_MARKETPLACE: 'AMAZON',
            GRANT_EXTERNAL_ID: 'SHADOW-ASIN1',
            WORKER_ID: `r${String(round).padStart(2, '0')}-w${String(i).padStart(2, '0')}`,
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
      assert.equal(wins.length, 1, `round ${round}: EXACTLY_ONE_WINNER violated (${wins.length} wins)`);
      assert.equal(loses.length, CONTENDERS - 1, `round ${round}: expected ${CONTENDERS - 1} blocked`);
      const winner = /CLAIM_WIN:([^:]+)/.exec(wins[0].stdout)?.[1];
      assert.ok(winner, `round ${round}: winner id missing`);

      // Part E — grant row: CLAIMED, attemptsClaimed=1, claimant == winner.
      const row = await getGrantById(client, grant.id);
      assert.equal(row?.status, 'CLAIMED', `round ${round}: grant status`);
      assert.equal(row?.attemptsClaimed, 1, `round ${round}: single claim (no second claimant)`);
      assert.equal(row?.claimedBy, winner, `round ${round}: claimant is the winner`);
      assert.equal(row?.consumedAt, null, `round ${round}: claim-only, never CONSUMED`);
      assert.equal(row?.failedAt, null, `round ${round}: claim-only, never FAILED`);

      // Only reason a loser process can see: ALREADY_CLAIMED (fresh ARMED grant).
      const loseReasons = [...new Set(loses.map((r) => /CLAIM_LOSE:([^:]+)/.exec(r.stdout)?.[1]))];
      assert.deepEqual(loseReasons.sort(), ['ALREADY_CLAIMED'], `round ${round}: blocked reason`);

      // Part F — zero commerce writes per round (against post-fixture baseline).
      const after = await counts();
      assert.deepEqual(
        { product: after.product - baseline.product, offer: after.offer - baseline.offer, history: after.history - baseline.history, raw: after.raw - baseline.raw, observation: after.observation - baseline.observation },
        { product: 0, offer: 0, history: 0, raw: 0, observation: 0 },
        `round ${round}: zero commerce write violated`,
      );

      const durationMs = Date.now() - roundStart;
      rounds.push({ round, grantId: grant.id, winner, claims: 1, blocked: CONTENDERS - 1, durationMs });
      console.log(`ROUND_${String(round).padStart(2, '0')}_50_WAY_1_WINNER_49_BLOCKED=PASS (winner=${winner}, grant=${grant.id}, ${durationMs}ms)`);
    }

    assert.equal(rounds.length, ROUNDS, 'all 10 rounds recorded');
    const successRounds = rounds.filter((r) => r.claims === 1 && r.blocked === CONTENDERS - 1).length;
    assert.equal(successRounds, ROUNDS, 'ALL_ROUNDS_EXACTLY_ONE_WINNER');
    const sorted = [...claimMs].sort((a, b) => a - b);
    const evidence = {
      timestamp: new Date().toISOString(),
      baseSha: BASE_SHA,
      rounds,
      summary: {
        rounds: ROUNDS,
        successRounds,
        failedRounds: 0,
        totalProcesses: ROUNDS * CONTENDERS,
        totalClaims: rounds.reduce((s, r) => s + r.claims, 0),
        totalBlocked: rounds.reduce((s, r) => s + r.blocked, 0),
      },
      latency: {
        samples: claimMs.length,
        minMs: sorted[0],
        p50Ms: pct(sorted, 50),
        p95Ms: pct(sorted, 95),
        maxMs: sorted[sorted.length - 1],
      },
      note: 'Observed local measurements (127.0.0.1:55433/ofertano_50ag3_control_plane), included worker cold boot. Not a Production SLA.',
    };
    assert.equal(evidence.summary.totalClaims, 10);
    assert.equal(evidence.summary.totalBlocked, 490);

    mkdirSync('docs/evidence/50ag3', { recursive: true });
    writeFileSync('docs/evidence/50ag3/control-plane-multiprocess-10-rounds.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(`AUDIT_10X50_DONE rounds=${evidence.summary.rounds} success=${evidence.summary.successRounds} failed=${evidence.summary.failedRounds} totalProcesses=${evidence.summary.totalProcesses} claims=${evidence.summary.totalClaims} blocked=${evidence.summary.totalBlocked} totalWallMs=${Date.now() - started}`);
  } finally {
    await client.end();
    await db.$disconnect();
    await disconnectControlPlanePools();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });