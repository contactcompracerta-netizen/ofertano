/**
 * 50AG.3 — multiprocess full-flow worker (spawned by control-plane.multiprocess.test.ts).
 *
 * Runs the real distributed canary orchestrator
 * (runCommerceDistributedCanary) end-to-end with a shared grant: N processes
 * race the complete flow; the single atomic claim authorizes exactly one
 * canary write, all others block/fail-closed.
 *
 * Input/env must be identical across workers, so the outcome is decided purely
 * by the Postgres-atomic claim.
 */
import { runCommerceDistributedCanary } from '../service';
import type { CommerceShadowInput } from '../../shadow/contracts';

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`MISSING_ENV:${name}`);
  return v;
};

const externalId = required('FLOW_EXTERNAL_ID');

const input: CommerceShadowInput = {
  marketplace: 'AMAZON',
  externalId,
  title: 'Headphone JBL Tune 520BT',
  brand: 'JBL',
  ean: '4006381333931',
  modelNumber: 'Tune 520BT',
  price: '100',
  oldPrice: '120',
  currency: 'BRL',
  stock: 5,
  available: true,
  sellerName: 'Synthetic Seller',
  sourceUrl: 'https://shop.example/item?api_key=private-shadow-secret',
  affiliateLink: 'https://shop.example/aff?tag=public-affiliate&token=private-affiliate-secret',
  capturedAt: '2026-09-18T12:00:00.000Z',
  attributes: { color: 'Preto', memory: '16 GB' },
  pricing: { oldPriceIsListPrice: true, shipping: 10, coupon: { amount: 5, eligible: true }, pix: { amount: 5, eligible: true } },
  provenance: { sourceFlow: 'offline-fixture' },
};

const env: Record<string, string> = {
  COMMERCE_DISTRIBUTED_CANARY_ENABLED: 'true',
  COMMERCE_SHADOW_ENABLED: 'true',
  COMMERCE_SHADOW_MARKETPLACE: 'AMAZON',
  COMMERCE_SHADOW_EXTERNAL_ID: externalId,
  COMMERCE_SHADOW_MAX_WRITES: '1',
  COMMERCE_SHADOW_DRY_RUN: 'false',
  COMMERCE_SHADOW_REQUIRE_EXACT_IDENTITY: 'true',
  COMMERCE_IDENTITY_GRAPH_ENABLED: 'true',
  COMMERCE_VARIANTS_ENABLED: 'true',
  OFFER_LEDGER_ENABLED: 'true',
  PRICE_TRUTH_ENABLED: 'true',
  TRUST_SIGNALS_ENABLED: 'true',
  COMMERCE_SHADOW_CANARY_TOKEN: required('CANARY_TOKEN'),
};

async function main(): Promise<void> {
  const r = await runCommerceDistributedCanary(input, {
    env,
    connectionString: required('DATABASE_URL'),
    executionId: required('WORKER_ID'),
    log: () => {},
  });
  process.stdout.write(`FLOW:${r.status}:${r.reason}:${r.grantId ?? ''}:${r.writesPerformed}\n`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});