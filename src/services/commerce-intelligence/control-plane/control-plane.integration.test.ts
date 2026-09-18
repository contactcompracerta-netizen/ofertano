import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { runCommerceDistributedCanary } from './service';
import {
  createCanaryGrant, claimCanaryGrant, finalizeCanaryGrant, getGrantById,
  transitionCanaryGrant, expireEligibleGrants, disconnectControlPlanePools, type SqlExecutor,
} from './repository';
import { hashToken } from './token';
import { ensureFixture } from './multiprocess-fixture';
import type { CommerceShadowInput, ShadowEvent } from '../shadow/contracts';
import type { ControlPlaneEvent, DistributedCanaryResult } from './contracts';

const url = process.env.DATABASE_URL ?? '';
const target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.port !== '55433' || target.pathname !== '/ofertano_50ag3_control_plane') throw Error('LOCAL_TRIPWIRE');
void target;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const client = new Client({ connectionString: url });

const input: CommerceShadowInput = {
  marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', title: 'Headphone JBL Tune 520BT', brand: 'JBL', ean: '4006381333931',
  modelNumber: 'Tune 520BT', price: '100', oldPrice: '120', currency: 'BRL', stock: 5, available: true,
  sellerName: 'Synthetic Seller', sourceUrl: 'https://shop.example/item?api_key=private-shadow-secret', affiliateLink: 'https://shop.example/aff?tag=public-affiliate&token=private-affiliate-secret',
  capturedAt: '2026-09-18T12:00:00.000Z', attributes: { color: 'Preto', memory: '16 GB' },
  pricing: { oldPriceIsListPrice: true, shipping: 10, coupon: { amount: 5, eligible: true }, pix: { amount: 5, eligible: true } },
  provenance: { sourceFlow: 'offline-fixture' },
};

function baseEnv(token: string, overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    COMMERCE_SHADOW_ENABLED: 'true', COMMERCE_SHADOW_MARKETPLACE: 'AMAZON', COMMERCE_SHADOW_EXTERNAL_ID: 'SHADOW-ASIN1',
    COMMERCE_SHADOW_MAX_WRITES: '1', COMMERCE_SHADOW_DRY_RUN: 'false', COMMERCE_SHADOW_REQUIRE_EXACT_IDENTITY: 'true',
    COMMERCE_IDENTITY_GRAPH_ENABLED: 'true', COMMERCE_VARIANTS_ENABLED: 'true', OFFER_LEDGER_ENABLED: 'true',
    PRICE_TRUTH_ENABLED: 'true', TRUST_SIGNALS_ENABLED: 'true',
    COMMERCE_DISTRIBUTED_CANARY_ENABLED: 'true', COMMERCE_SHADOW_CANARY_TOKEN: token,
    ...overrides,
  };
}

async function counts() {
  return {
    product: await db.product.count(), offer: await db.marketplaceOffer.count(), history: await db.priceHistory.count(),
    raw: await db.rawMarketplaceListing.count(), observation: await db.offerObservation.count(),
    component: await db.offerPriceComponent.count(), grant: await (async () => (await client.query('SELECT count(*)::int AS n FROM "CommerceCanaryGrant"')).rows[0].n)(),
    attempt: await (async () => (await client.query('SELECT count(*)::int AS n FROM "CommerceCanaryAttempt"')).rows[0].n)(),
  };
}
const legacy = (c: Awaited<ReturnType<typeof counts>>) => ({ product: c.product, offer: c.offer, history: c.history, raw: c.raw });

function runDistributed(env: Record<string, string | undefined>, hooks: { events?: ControlPlaneEvent[]; shadowEvents?: ShadowEvent[]; queryCounter?: { n: number } } = {}) {
  const executor: SqlExecutor = {
    async query<R = any>(text: string, values?: unknown[]) {
      if (hooks.queryCounter) hooks.queryCounter.n++;
      return client.query(text as string, values as any[]) as any;
    },
  };
  return runCommerceDistributedCanary(input, {
    env,
    connectionString: url,
    getExecutor: () => executor,
    log: (e) => hooks.events?.push(e),
    shadowDeps: hooks.shadowEvents ? { log: (e) => hooks.shadowEvents!.push(e) } : undefined,
  });
}

async function main() {
  await client.connect();
  // Dedicated mission DB (LOCAL_TRIPWIRE above): reset synthetic state so reruns
  // are deterministic. Grant/audit tables are fully reset; commerce tables keep
  // only the local-fixture rows (products + EAN identifier) and drop every row
  // the shadow pipeline could have created on a previous run.
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
  const sock = client.connection.stream as unknown as { remoteAddress?: string; remotePort?: number };
  assert.equal(sock.remoteAddress, '127.0.0.1');
  assert.equal(sock.remotePort, 55433);
  const network = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('SHADOW_NETWORK_FORBIDDEN'); };
  const perf: { claimMs: number[]; blockedMs: number[]; finalizeMs: number[] } = { claimMs: [], blockedMs: [], finalizeMs: [] };
  const evidence: Record<string, unknown> = {};
  try {
    await ensureFixture(db);
    const baseline = await counts();

    // ================= PART E / R — OFF = no grant access =================
    {
      let queries = 0;
      const off = await runCommerceDistributedCanary(input, {
        env: { ...baseEnv(hashToken('x'), { COMMERCE_DISTRIBUTED_CANARY_ENABLED: 'false' }) },
        connectionString: url,
        getExecutor: () => ({ async query() { queries++; throw new Error('GRANT_ACCESS_FORBIDDEN'); } }) as unknown as SqlExecutor,
        log: () => {},
      });
      assert.equal(off.mode, 'LOCAL_PROCESS_BUDGET');
      assert.equal(off.status, 'NOT_DISTRIBUTED');
      assert.equal(queries, 0);
    }

    // ================= PART G2 — in-process claim atomicity =================
    const atom = await createCanaryGrant(client, { tokenHash: hashToken('atom-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    const race = await Promise.all([
      claimCanaryGrant(client, { tokenHash: hashToken('atom-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'race-a' }),
      claimCanaryGrant(client, { tokenHash: hashToken('atom-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'race-b' }),
      claimCanaryGrant(client, { tokenHash: hashToken('atom-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'race-c' }),
    ]);
    assert.equal(race.filter((r) => r.success).length, 1, 'exactly one in-process winner');
    assert.equal(race.filter((r) => !r.success && r.reason === 'ALREADY_CLAIMED').length, 2);
    evidence.inProcessRace = race.map((r) => (r.success ? 'CLAIM_SUCCESS' : r.reason));
    // grant row reflects exactly 1 claim
    const atomRow = await getGrantById(client, atom.id);
    assert.equal(atomRow?.status, 'CLAIMED');
    assert.equal(atomRow?.attemptsClaimed, 1);

    // ================= PART W — wrong token = 0 claims =================
    const wt = await createCanaryGrant(client, { tokenHash: hashToken('wt-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    assert.deepEqual(await claimCanaryGrant(client, { tokenHash: hashToken('wt-token-WRONG'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'x' }), { success: false, reason: 'GRANT_NOT_FOUND' });
    assert.deepEqual((await getGrantById(client, wt.id))?.status, 'ARMED');

    // ================= PART X — wrong marketplace = 0 claims =================
    const wm = await createCanaryGrant(client, { tokenHash: hashToken('wm-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    const wmClaim = await claimCanaryGrant(client, { tokenHash: hashToken('wm-token-0001'), marketplace: 'SHOPEE', externalId: 'SHADOW-ASIN1', executionId: 'x' });
    assert.equal(wmClaim.success, false);
    assert.equal((wmClaim as { reason: string }).reason, 'MARKETPLACE_MISMATCH');
    assert.deepEqual((await getGrantById(client, wm.id))?.status, 'ARMED');

    // ================= PART Y — wrong externalId = 0 claims =================
    const we = await createCanaryGrant(client, { tokenHash: hashToken('we-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    const weClaim = await claimCanaryGrant(client, { tokenHash: hashToken('we-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN9', executionId: 'x' });
    assert.equal(weClaim.success, false);
    assert.equal((weClaim as { reason: string }).reason, 'EXTERNAL_ID_MISMATCH');
    assert.deepEqual((await getGrantById(client, we.id))?.status, 'ARMED');

    // ================= PART Z — expired = 0 claims =================
    const ex = await createCanaryGrant(client, { tokenHash: hashToken('ex-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() - 60_000) });
    const exClaim = await claimCanaryGrant(client, { tokenHash: hashToken('ex-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'x' });
    assert.equal(exClaim.success, false);
    assert.equal((exClaim as { reason: string }).reason, 'EXPIRED');
    assert.deepEqual((await getGrantById(client, ex.id))?.status, 'ARMED', 'semantic expiry: row may stay ARMED until controlled transition');
    const expiredCount = await expireEligibleGrants(client);
    assert.ok(expiredCount >= 1);
    assert.deepEqual((await getGrantById(client, ex.id))?.status, 'EXPIRED', 'controlled EXPIRED transition');

    // ================= PART AA — disabled = 0 claims =================
    const dis = await createCanaryGrant(client, { tokenHash: hashToken('dis-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    assert.deepEqual(await transitionCanaryGrant(client, { id: dis.id, from: 'ARMED', to: 'DISABLED' }), { applied: true, status: 'DISABLED' });
    const disClaim = await claimCanaryGrant(client, { tokenHash: hashToken('dis-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'x' });
    assert.equal(disClaim.success, false);
    assert.equal((disClaim as { reason: string }).reason, 'DISABLED');
    // forbidden transition back
    const disBack = await transitionCanaryGrant(client, { id: dis.id, from: 'ARMED', to: 'EXPIRED' });
    assert.equal(disBack.applied, false);
    assert.equal(disBack.status, 'DISABLED');

    // ================= PART AB — already claimed = no auto rearm =================
    const ac = await createCanaryGrant(client, { tokenHash: hashToken('ac-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    assert.equal((await claimCanaryGrant(client, { tokenHash: hashToken('ac-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'a1' })).success, true);
    await new Promise((r) => setTimeout(r, 1200)); // wait — no auto re-arm
    const ac2 = await claimCanaryGrant(client, { tokenHash: hashToken('ac-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'a2' });
    assert.equal(ac2.success, false);
    assert.equal((ac2 as { reason: string }).reason, 'ALREADY_CLAIMED');
    assert.deepEqual((await getGrantById(client, ac.id))?.status, 'CLAIMED');

    // ================= PART AE — crash simulation: claimant never finalizes =================
    const crash = await createCanaryGrant(client, { tokenHash: hashToken('crash-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    const crashA = await claimCanaryGrant(client, { tokenHash: hashToken('crash-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'crash-exec-a' });
    assert.equal(crashA.success, true);
    // process A "dies" — no finalize. Process B retries:
    const crashB = await claimCanaryGrant(client, { tokenHash: hashToken('crash-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'crash-exec-b' });
    assert.equal(crashB.success, false);
    assert.equal((crashB as { reason: string }).reason, 'ALREADY_CLAIMED');
    const crashRow = await getGrantById(client, crash.id);
    assert.equal(crashRow?.status, 'CLAIMED');
    assert.equal(crashRow?.attemptsClaimed, 1);
    assert.equal(crashRow?.claimedBy, 'crash-exec-a');
    assert.equal(crashRow?.consumedAt, null, 'no auto recovery to CONSUMED');
    assert.equal(crashRow?.failedAt, null, 'no auto recovery to FAILED');

    // ================= PART AC/AD — consumed/failed terminal =================
    const cons = await createCanaryGrant(client, { tokenHash: hashToken('cons-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    await claimCanaryGrant(client, { tokenHash: hashToken('cons-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'c1' });
    await finalizeCanaryGrant(client, { grantId: cons.id, executionId: 'c1', finalStatus: 'CONSUMED' });
    const cons2 = await claimCanaryGrant(client, { tokenHash: hashToken('cons-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'c2' });
    assert.equal(cons2.success, false);
    assert.equal((cons2 as { reason: string }).reason, 'CONSUMED');
    const failg = await createCanaryGrant(client, { tokenHash: hashToken('fail-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    await claimCanaryGrant(client, { tokenHash: hashToken('fail-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'f1' });
    await finalizeCanaryGrant(client, { grantId: failg.id, executionId: 'f1', finalStatus: 'FAILED', failureCode: 'TEST_FAILURE' });
    const fail2 = await claimCanaryGrant(client, { tokenHash: hashToken('fail-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'f2' });
    assert.equal(fail2.success, false);
    assert.equal((fail2 as { reason: string }).reason, 'FAILED');

    // ================= PART L1 — finalize idempotence =================
    const fi = await createCanaryGrant(client, { tokenHash: hashToken('fi-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    await claimCanaryGrant(client, { tokenHash: hashToken('fi-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'fi-a' });
    assert.deepEqual(await finalizeCanaryGrant(client, { grantId: fi.id, executionId: 'fi-a', finalStatus: 'CONSUMED' }), { applied: true, status: 'CONSUMED' });
    assert.deepEqual(await finalizeCanaryGrant(client, { grantId: fi.id, executionId: 'fi-a', finalStatus: 'CONSUMED' }), { applied: false, reason: 'ALREADY_FINALIZED', status: 'CONSUMED' });
    // CONSUMED -> FAILED is forbidden
    assert.deepEqual(await finalizeCanaryGrant(client, { grantId: fi.id, executionId: 'fi-a', finalStatus: 'FAILED', failureCode: 'X' }), { applied: false, reason: 'ALREADY_FINALIZED', status: 'CONSUMED' });
    assert.deepEqual((await getGrantById(client, fi.id))?.status, 'CONSUMED');
    // only claimant may finalize
    const fi2 = await createCanaryGrant(client, { tokenHash: hashToken('fi2-token-001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    await claimCanaryGrant(client, { tokenHash: hashToken('fi2-token-001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: 'fi2-a' });
    assert.deepEqual(await finalizeCanaryGrant(client, { grantId: fi2.id, executionId: 'fi2-evil', finalStatus: 'CONSUMED' }), { applied: false, reason: 'NOT_CLAIMANT', status: 'CLAIMED' });
    assert.deepEqual(await finalizeCanaryGrant(client, { grantId: fi2.id, executionId: 'fi2-a', finalStatus: 'CONSUMED' }), { applied: true, status: 'CONSUMED' });

    // ================= PART AL — fail-closed config =================
    const cfgEvents: ControlPlaneEvent[] = [];
    const gate = async (overrides: Record<string, string | undefined>) => {
      let queries = 0;
      const r = await runCommerceDistributedCanary(input, {
        env: baseEnv('cfg-token-0001', overrides),
        connectionString: url,
        getExecutor: () => ({ async query<R = any>(text: string, values?: unknown[]) { queries++; return client.query(text, values as any[]) as any; } }),
        log: (e) => cfgEvents.push(e),
      });
      return { r, queries };
    };
    let g = await gate({ COMMERCE_SHADOW_ENABLED: 'false' });
    assert.equal(g.r.reason, 'SHADOW_DISABLED'); assert.equal(g.queries, 0);
    g = await gate({ COMMERCE_SHADOW_CANARY_TOKEN: undefined as unknown as string });
    assert.equal(g.r.reason, 'TOKEN_MISSING'); assert.equal(g.queries, 0);
    g = await gate({ COMMERCE_SHADOW_CANARY_TOKEN: '   ' });
    assert.equal(g.r.reason, 'TOKEN_INVALID'); assert.equal(g.queries, 0);
    g = await gate({ COMMERCE_SHADOW_MARKETPLACE: undefined as unknown as string });
    assert.equal(g.r.reason, 'MARKETPLACE_MISSING'); assert.equal(g.queries, 0);
    g = await gate({ COMMERCE_SHADOW_EXTERNAL_ID: undefined as unknown as string });
    assert.equal(g.r.reason, 'EXTERNAL_ID_MISSING'); assert.equal(g.queries, 0);
    g = await gate({ COMMERCE_SHADOW_MARKETPLACE: 'SHOPEE' });
    assert.equal(g.r.reason, 'MARKETPLACE_MISMATCH'); assert.equal(g.queries, 0);
    g = await gate({ COMMERCE_SHADOW_EXTERNAL_ID: 'other' });
    assert.equal(g.r.reason, 'EXTERNAL_ID_MISMATCH'); assert.equal(g.queries, 0);
    g = await gate({});
    assert.equal(g.r.reason, 'GRANT_NOT_FOUND', 'valid token but no grant yet -> 0 claims'); assert.equal(g.r.writesPerformed, 0);

    // ================= PART M + AM — dry run no claim; identity EXACT gate =================
    const dryToken = 'dry-token-0001';
    const dryGrant = await createCanaryGrant(client, { tokenHash: hashToken(dryToken), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    const dryRun = await runDistributed(baseEnv(dryToken, { COMMERCE_SHADOW_DRY_RUN: 'true' }));
    assert.equal(dryRun.status, 'DRY_RUN');
    assert.equal(dryRun.claimSucceeded, false);
    assert.equal(dryRun.writesPerformed, 0);
    const dryRow = await getGrantById(client, dryGrant.id);
    assert.equal(dryRow?.status, 'ARMED');
    assert.equal(dryRow?.attemptsClaimed, 0, 'dry run must not claim');
    // identity not EXACT -> block BEFORE claim
    const amGrant = await createCanaryGrant(client, { tokenHash: hashToken('am-token-0001'), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    const amRun = await runCommerceDistributedCanary({ ...input, ean: undefined }, {
      env: baseEnv('am-token-0001'), connectionString: url, getExecutor: () => client, log: () => {},
    });
    assert.equal(amRun.status, 'BLOCKED');
    assert.equal(amRun.reason, 'IDENTITY_NOT_EXACT');
    const amRow = await getGrantById(client, amGrant.id);
    assert.equal(amRow?.status, 'ARMED', 'claim must happen only after identity EXACT');
    assert.equal(amRow?.attemptsClaimed, 0);

    // ================= PART AF — success execution =================
    const okToken = 'ok-token-0001';
    const okGrant = await createCanaryGrant(client, { tokenHash: hashToken(okToken), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    const okEvents: ControlPlaneEvent[] = [];
    const beforeOk = await counts();
    const ok = await runCommerceDistributedCanary(input, {
      env: baseEnv(okToken), connectionString: url, getExecutor: () => client, log: (e) => okEvents.push(e),
    });
    assert.equal(ok.status, 'CREATED');
    assert.equal(ok.claimSucceeded, true);
    assert.equal(ok.grantStatus, 'CONSUMED');
    const afterOk = await counts();
    assert.equal(afterOk.observation - beforeOk.observation, 1);
    assert.deepEqual(legacy(afterOk), legacy(beforeOk));
    const okRow = await getGrantById(client, okGrant.id);
    assert.equal(okRow?.status, 'CONSUMED');
    assert.equal(okRow?.consumedAt !== null, true);
    // retry after CONSUMED is blocked
    const retry = await runCommerceDistributedCanary(input, {
      env: baseEnv(okToken), connectionString: url, getExecutor: () => client, log: () => {},
    });
    assert.equal(retry.status, 'BLOCKED');
    assert.equal(retry.reason, 'CONSUMED');
    assert.equal(retry.writesPerformed, 0);

    // ================= PART AJ — dedupe consumes the grant =================
    const ddToken = 'dedupe-token-01';
    await createCanaryGrant(client, { tokenHash: hashToken(ddToken), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
    const beforeDd = await counts();
    const dd = await runCommerceDistributedCanary(input, {
      env: baseEnv(ddToken), connectionString: url, getExecutor: () => client, log: () => {},
    });
    assert.equal(dd.status, 'DEDUPED');
    assert.equal(dd.grantStatus, 'CONSUMED', 'DEDUPED still consumes the one-shot grant');
    const commerceSide = (c: Awaited<ReturnType<typeof counts>>) => ({ product: c.product, offer: c.offer, history: c.history, raw: c.raw, observation: c.observation, component: c.component });
    assert.deepEqual(commerceSide(await counts()), commerceSide(beforeDd), 'dedupe writes nothing to commerce (audit rows grow by design)');

    // ================= PART AG — failed execution =================
    // Distinct externalId so the failing run takes the CREATED path (dedupe
    // would otherwise short-circuit before any component insert). Identity stays
    // EXACT via the fixture EAN, and the whole write transaction rolls back.
    const failInput: CommerceShadowInput = { ...input, externalId: 'SHADOW-ASIN2' };
    const failToken = 'failflow-token-1';
    const failFlowGrant = await createCanaryGrant(client, { tokenHash: hashToken(failToken), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN2', expiresAt: new Date(Date.now() + 60_000) });
    await db.$executeRawUnsafe(`CREATE FUNCTION public._50ag3_reject_component() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source = 'shadow-derived-v1' THEN RAISE EXCEPTION 'LOCAL_COMPONENT_FAILURE'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER _50ag3_component_failure BEFORE INSERT ON "OfferPriceComponent" FOR EACH ROW EXECUTE FUNCTION public._50ag3_reject_component()');
    const beforeFail = await counts();
    let failRun: DistributedCanaryResult;
    try {
      failRun = await runCommerceDistributedCanary(failInput, {
        env: baseEnv(failToken, { COMMERCE_SHADOW_EXTERNAL_ID: 'SHADOW-ASIN2' }), connectionString: url, getExecutor: () => client, log: () => {},
      });
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS _50ag3_component_failure ON "OfferPriceComponent"');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS public._50ag3_reject_component()');
    }
    assert.equal(failRun.status, 'FAILED');
    assert.equal(failRun.grantStatus, 'FAILED');
    const commerceSide2 = (c: Awaited<ReturnType<typeof counts>>) => ({ product: c.product, offer: c.offer, history: c.history, raw: c.raw, observation: c.observation, component: c.component });
    assert.deepEqual(commerceSide2(await counts()), commerceSide2(beforeFail), 'atomic rollback: no commerce rows from failed execution');
    assert.equal((await getGrantById(client, failFlowGrant.id))?.status, 'FAILED');
    // The trigger's RAISE EXCEPTION is surfaced through the Prisma adapter as
    // P2039 (database error); the pipeline records the code it can classify.
    assert.equal((await getGrantById(client, failFlowGrant.id))?.failureCode, 'P2039');
    // no automatic retry
    const failRetry = await runCommerceDistributedCanary(failInput, {
      env: baseEnv(failToken, { COMMERCE_SHADOW_EXTERNAL_ID: 'SHADOW-ASIN2' }), connectionString: url, getExecutor: () => client, log: () => {},
    });
    assert.equal(failRetry.status, 'BLOCKED');
    assert.equal(failRetry.reason, 'FAILED');

    // ================= PART P — audit trail =================
    // ok grant: CLAIM + CONSUMED from the run, plus BLOCKED from the retry attempt.
    const audit = (await client.query('SELECT kind, reason FROM "CommerceCanaryAttempt" WHERE "grantId" = $1 ORDER BY "createdAt"', [okGrant.id])).rows;
    assert.deepEqual(audit.map((a) => a.kind).sort(), ['BLOCKED', 'CLAIM', 'CONSUMED'].sort());
    const auditFail = (await client.query('SELECT kind FROM "CommerceCanaryAttempt" WHERE "grantId" = $1', [failFlowGrant.id])).rows.map((a) => a.kind).sort();
    assert.deepEqual(auditFail, ['BLOCKED', 'CLAIM', 'FAILED'].sort());

    // ================= PART AN — performance (observed locals only) =================
    for (let i = 0; i < 40; i++) {
      const token = `perf-token-${String(i).padStart(3, '0')}`;
      const grant = await createCanaryGrant(client, { tokenHash: hashToken(token), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', expiresAt: new Date(Date.now() + 60_000) });
      const t0 = performance.now();
      const c = await claimCanaryGrant(client, { tokenHash: hashToken(token), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: `perf-${i}` });
      perf.claimMs.push(performance.now() - t0);
      assert.equal(c.success, true);
      const t1 = performance.now();
      await claimCanaryGrant(client, { tokenHash: hashToken(token), marketplace: 'AMAZON', externalId: 'SHADOW-ASIN1', executionId: `perf-${i}-b` });
      perf.blockedMs.push(performance.now() - t1);
      const t2 = performance.now();
      await finalizeCanaryGrant(client, { grantId: grant.id, executionId: `perf-${i}`, finalStatus: 'CONSUMED' });
      perf.finalizeMs.push(performance.now() - t2);
    }
    const pct = (arr: number[], p: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)))]; };
    const perfReport = { claimLatency: { samples: perf.claimMs.length, p50Ms: pct(perf.claimMs, 50), p95Ms: pct(perf.claimMs, 95), minMs: Math.min(...perf.claimMs), maxMs: Math.max(...perf.claimMs) }, blockedLatency: { samples: perf.blockedMs.length, p50Ms: pct(perf.blockedMs, 50), p95Ms: pct(perf.blockedMs, 95) }, finalizeLatency: { samples: perf.finalizeMs.length, p50Ms: pct(perf.finalizeMs, 50), p95Ms: pct(perf.finalizeMs, 95) } };
    evidence.performance = perfReport;

    // ================= PART AI — legacy delta =================
    const final = await counts();
    assert.deepEqual(legacy(final), legacy(baseline), 'legacy tables unchanged: product/offer/history/raw delta=0');
    evidence.legacyDelta = { product: final.product - baseline.product, offer: final.offer - baseline.offer, history: final.history - baseline.history, raw: final.raw - baseline.raw };

    // ================= PART Q/AK — log redaction =================
    const allEvents = JSON.stringify([...cfgEvents, ...okEvents]);
    assert.ok(!allEvents.includes('private-shadow-secret'));
    for (const t of ['ok-token-0001', 'am-token-0001', 'perf-token-000', 'atom-token-0001', 'cfg-token-0001']) {
      assert.ok(!allEvents.includes(t), `token must never appear in events: ${t}`);
    }
    assert.ok(!allEvents.includes(hashToken('ok-token-0001')), 'full token hash must never appear in events');
    assert.ok(!allEvents.includes('SHADOW-ASIN1'), 'raw external id must never appear in events');

    evidence.baseline = { ...baseline };
    evidence.final = { ...final };
    evidence.grantStates = { atom: atomRow?.status, crash: crashRow?.status, dryRun: dryRow?.status, identityGate: amRow?.status, success: okRow?.status, failed: (await getGrantById(client, failFlowGrant.id))?.status };
    evidence.inProcess = { claims: 1, blocked: 2 };

    mkdirSync('docs/evidence/50ag3', { recursive: true });
    writeFileSync('docs/evidence/50ag3/control-plane-inprocess.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log('CONTROL_PLANE_INPROCESS_STATE_MACHINE_CLAIM_CRASH_FINALIZE_DEDUPE_CONFIG_LEGACY=PASS');
  } finally {
    globalThis.fetch = network;
    await client.end();
    await db.$disconnect();
    await disconnectControlPlanePools();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });