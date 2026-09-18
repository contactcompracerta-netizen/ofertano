import { createHash } from 'node:crypto';
import { scheduleCommerceShadowAfterBarrier } from '../shadow/integration';
import type { RawCandidate } from '../../multistore-v2/types';
import type { CommerceShadowInput } from '../shadow/contracts';
import { parseDistributedCanaryConfig, distributedTokenState, localControlPlaneTarget } from './config';

function logBoundary(event: Record<string, unknown>, failed = false) {
  try {
    (failed ? console.warn : console.info)(JSON.stringify(event));
  } catch {
    try { console.error('COMMERCE_CANARY_FAILED LOGGING_FAILED'); } catch { /* never break legacy */ }
  }
}

/**
 * PART R — distributed-aware post-response boundary.
 *
 * WITHOUT_DISTRIBUTED = OFF: byte-identical delegation to the existing
 * 50AG.2 `scheduleCommerceShadowAfterBarrier` (local behavior unchanged and
 * still fully testable). ON: fail-closed distributed orchestration: only the
 * single one-shot grant winner runs the shadow write; every other contender
 * blocks at the claim and performs ZERO shadow writes.
 */
export function scheduleCommerceDistributedCanaryAfterBarrier(
  candidates: readonly RawCandidate[],
  options: {
    env?: Record<string, string | undefined>;
    defer?: (work: () => Promise<void>) => void;
    run?: (input: CommerceShadowInput) => Promise<unknown>;
  } = {},
) {
  const env = options.env ?? process.env;
  const config = parseDistributedCanaryConfig(env);
  if (!config.enabled) {
    scheduleCommerceShadowAfterBarrier(candidates, options as Parameters<typeof scheduleCommerceShadowAfterBarrier>[1]);
    return;
  }
  const blocked = (reason: string) => logBoundary({
    event: 'COMMERCE_CANARY_GRANT_BLOCKED', marketplace: config.marketplace ?? 'UNKNOWN',
    externalIdSafe: createHash('sha256').update(config.externalId ?? '').digest('hex').slice(0, 12), reason,
    durationMs: 0, writeCount: 0,
  });
  if (!config.shadowEnabled) { blocked('SHADOW_DISABLED'); return; }
  const tokenState = distributedTokenState(env);
  if (tokenState.reason !== 'OK') { blocked(tokenState.reason); return; }
  if (!config.marketplace) { blocked('MARKETPLACE_MISSING'); return; }
  if (!config.externalId) { blocked('EXTERNAL_ID_MISSING'); return; }
  const targetError = localControlPlaneTarget(process.env.DATABASE_URL, process.env.VERCEL_ENV);
  if (targetError) { blocked(targetError); return; }
  const match = candidates.find((c) => c.marketplace === config.marketplace && c.externalId === config.externalId);
  if (!match) { blocked('NO_MATCHING_SNAPSHOT'); return; }
  try {
    const input: CommerceShadowInput = {
      marketplace: match.marketplace, externalId: match.externalId, title: match.title,
      price: match.price, currency: 'BRL', sellerName: match.seller, sourceUrl: match.url, affiliateLink: match.affiliateLink,
      attributes: structuredClone(match.attributes), brand: match.brand ?? undefined, capturedAt: new Date().toISOString(),
      provenance: { sourceFlow: 'multistore-v2-distributed-canary' },
    };
    const run = options.run ?? ((snapshot: CommerceShadowInput) =>
      import('./service').then(({ runCommerceDistributedCanary }) =>
        runCommerceDistributedCanary(snapshot, { env, connectionString: process.env.DATABASE_URL, deploymentEnv: process.env.VERCEL_ENV })));
    const work = async () => {
      try { await run(input); }
      catch { logBoundary({ event: 'COMMERCE_CANARY_FAILED', reason: 'BACKGROUND_BOUNDARY_FAILURE', durationMs: 0, writeCount: 0 }, true); }
    };
    if (options.defer) options.defer(work);
    else {
      try {
        const { after } = require('next/server') as typeof import('next/server');
        after(work);
      } catch {
        if (process.env.VERCEL_ENV) throw new Error('AFTER_CONTEXT_REQUIRED');
        setTimeout(() => { void work(); }, 0);
      }
    }
  } catch { logBoundary({ event: 'COMMERCE_CANARY_FAILED', reason: 'SCHEDULING_FAILED', durationMs: 0, writeCount: 0 }, true); }
}