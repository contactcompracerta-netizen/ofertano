import assert from "node:assert/strict";

import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "../discovery/core/types";
import { buildAliExpressCompactFallbackQuery, buildSearchPlan } from "./queryPlan";
import { searchMultistoreV2 } from "./search";
import { extractSanitizedIdentity } from "./sanitizedIdentity";

const query = "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos (Recondicionado)";
const identity = extractSanitizedIdentity(query);
const normalPlan = buildSearchPlan(query, identity.queryCore, identity);
const compactQuery = buildAliExpressCompactFallbackQuery(query, identity.queryCore, identity);

assert.ok(compactQuery, "AliExpress compact query must be available for this test");
assert.ok(!normalPlan.includes(compactQuery), "compact query must be a distinct fallback variant");

const budget = {
  globalMs: 2_000,
  marketplaceMs: 1_000,
  fetchMs: 100,
  persistReserveMs: 100,
  hangGraceMs: 0,
};

function candidate(
  marketplace: DiscoveryCandidate["marketplace"],
  externalId: string,
): DiscoveryCandidate {
  return {
    marketplace,
    marketplaceName: marketplace,
    externalId,
    title: "Console Playstation 4 PS4 Slim 1TB 2 Controles Recondicionado",
    price: 100,
    oldPrice: null,
    sourceUrl: `https://example.test/${externalId}`,
    image: null,
    brand: null,
    category: null,
    seller: null,
    affiliateLink: null,
    attributes: {},
    status: "FOUND",
    error: null,
  };
}

function result(
  marketplace: DiscoveryCandidate["marketplace"],
  requestQuery: string,
  candidates: DiscoveryCandidate[] = [],
): MarketplaceDiscoveryResult {
  return {
    marketplace,
    query: requestQuery,
    success: true,
    scanned: candidates.length,
    candidates,
    error: null,
  };
}

function adapter(
  marketplace: DiscoveryAdapter["marketplace"],
  searcher: NonNullable<DiscoveryAdapter["searcher"]>,
): DiscoveryAdapter {
  return {
    marketplace,
    marketplaceName: marketplace,
    enabled: true,
    searcher,
  };
}

async function run(): Promise<void> {
  const normalEmptyCalls: string[] = [];
  const fallbackResult = await searchMultistoreV2(query, {
    persist: false,
    budget,
    adapters: [
      adapter("ALIEXPRESS", async (request) => {
        normalEmptyCalls.push(request.query);
        return result(
          "ALIEXPRESS",
          request.query,
          request.query === compactQuery ? [candidate("ALIEXPRESS", "compact-hit")] : [],
        );
      }),
    ],
  });

  const compactCalls = normalEmptyCalls.filter((item) => item === compactQuery);
  const normalCalls = normalEmptyCalls.filter((item) => item !== compactQuery);
  assert.ok(normalCalls.length >= 1, "normal AliExpress variant must execute first");
  assert.equal(compactCalls.length, 1, "compact fallback must execute at most once");
  assert.equal(fallbackResult.acquisitions[0]?.raw, 1, "compact fallback must recover a candidate");
  assert.equal(fallbackResult.relevantCandidates.length, 1, "recovered candidate must be relevant");

  const normalSuccessCalls: string[] = [];
  await searchMultistoreV2(query, {
    persist: false,
    budget,
    adapters: [
      adapter("ALIEXPRESS", async (request) => {
        normalSuccessCalls.push(request.query);
        return result("ALIEXPRESS", request.query, [candidate("ALIEXPRESS", "normal-hit")]);
      }),
    ],
  });
  assert.equal(
    normalSuccessCalls.filter((item) => item === compactQuery).length,
    0,
    "compact fallback must not run after a relevant normal result",
  );

  const otherMarketplaceCalls = new Map<string, string[]>();
  const otherAdapters = (["AMAZON", "SHOPEE", "MAGAZINE_LUIZA", "MERCADO_LIVRE"] as const).map(
    (marketplace) => adapter(marketplace, async (request) => {
      const calls = otherMarketplaceCalls.get(marketplace) ?? [];
      calls.push(request.query);
      otherMarketplaceCalls.set(marketplace, calls);
      return result(marketplace, request.query);
    }),
  );
  await searchMultistoreV2(query, {
    persist: false,
    budget,
    adapters: otherAdapters,
  });
  for (const marketplace of otherMarketplaceCalls.keys()) {
    assert.equal(
      otherMarketplaceCalls.get(marketplace)?.includes(compactQuery),
      false,
      `${marketplace} must not use the AliExpress compact query`,
    );
  }

  const deadlineCalls: string[] = [];
  await searchMultistoreV2(query, {
    persist: false,
    budget: {
      globalMs: 2_000,
      marketplaceMs: 150,
      fetchMs: 150,
      persistReserveMs: 0,
      hangGraceMs: 0,
    },
    adapters: [
      adapter("ALIEXPRESS", async (request) => {
        deadlineCalls.push(request.query);
        await new Promise<void>((resolve) => {
          if (request.signal?.aborted) {
            resolve();
            return;
          }
          request.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return result("ALIEXPRESS", request.query);
      }),
    ],
  });
  assert.equal(deadlineCalls.length, 1, "no compact retry may start after acquisition deadline");
  assert.equal(deadlineCalls.includes(compactQuery), false, "deadline must prevent new compact network work");

  console.log("ALIEXPRESS_NORMAL_EMPTY=PASS");
  console.log("ALIEXPRESS_COMPACT_TRIGGERED=PASS");
  console.log("ALIEXPRESS_COMPACT_MAX_VARIANTS=1");
  console.log("ALIEXPRESS_COMPACT_RECOVERS_CANDIDATE=PASS");
  console.log("ALIEXPRESS_COMPACT_NOT_USED_AFTER_NORMAL_SUCCESS=PASS");
  console.log("AMAZON_DOES_NOT_USE_COMPACT=PASS");
  console.log("SHOPEE_DOES_NOT_USE_COMPACT=PASS");
  console.log("MAGALU_DOES_NOT_USE_COMPACT=PASS");
  console.log("MERCADO_LIVRE_DOES_NOT_USE_COMPACT=PASS");
  console.log("COMPACT_NOT_STARTED_AFTER_ACQUISITION_DEADLINE=PASS");
  console.log("NEW_NETWORK_AFTER_ACQUISITION_DEADLINE=NO");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
