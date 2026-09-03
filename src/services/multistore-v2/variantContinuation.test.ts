import assert from "node:assert/strict";

import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
} from "../discovery/core/types";
import { buildSearchPlan, searchMultistoreV2 } from "./search";

function candidate(
  marketplace: DiscoveryCandidate["marketplace"],
  title: string,
  externalId: string,
): DiscoveryCandidate {
  return {
    marketplace,
    marketplaceName: marketplace,
    externalId,
    title,
    price: 100,
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

function adapter(
  marketplace: DiscoveryAdapter["marketplace"],
  searcher: NonNullable<DiscoveryAdapter["searcher"]>,
): DiscoveryAdapter {
  return { marketplace, marketplaceName: marketplace, enabled: true, searcher };
}

const budget = {
  globalMs: 2_000,
  marketplaceMs: 1_000,
  fetchMs: 100,
  persistReserveMs: 100,
  hangGraceMs: 0,
};

async function run(): Promise<void> {
  const compatibleQuery = "Console Playstation 4 Ps4 Slim 1 Tb";
  assert.ok(buildSearchPlan(compatibleQuery).length >= 2);
  let compatibleCalls = 0;
  await searchMultistoreV2(compatibleQuery, {
    persist: false,
    budget,
    adapters: [
      adapter("AMAZON", async (request) => {
        compatibleCalls += 1;
        return {
          marketplace: "AMAZON",
          query: request.query,
          success: true,
          scanned: 1,
          candidates: [candidate("AMAZON", "PlayStation 4 PS4 Slim 1TB", "compatible")],
          error: null,
        };
      }),
    ],
  });
  assert.equal(compatibleCalls, 1, "compatible first variant stops fallback");

  const fallbackQuery = "Console Playstation 4 Ps4 Slim 1 Tb";
  assert.ok(buildSearchPlan(fallbackQuery).length >= 2);
  let fallbackCalls = 0;
  const fallbackResult = await searchMultistoreV2(fallbackQuery, {
    persist: false,
    budget,
    adapters: [
      adapter("AMAZON", async (request) => {
        fallbackCalls += 1;
        const title = fallbackCalls === 1
          ? "PlayStation 4 PS4 Slim 500GB"
          : "PlayStation 4 PS4 Slim 1TB";
        return {
          marketplace: "AMAZON",
          query: request.query,
          success: true,
          scanned: 1,
          candidates: [candidate("AMAZON", title, `fallback-${fallbackCalls}`)],
          error: null,
        };
      }),
    ],
  });
  assert.equal(fallbackCalls, 2, "incompatible first variant continues fallback");
  assert.equal(fallbackResult.relevantCandidates.length, 1);

  const bundleQuery = "KIT 4 Camisa Termica Protecao UV 50+";
  assert.ok(buildSearchPlan(bundleQuery).length >= 2);
  let bundleCalls = 0;
  const bundleResult = await searchMultistoreV2(bundleQuery, {
    persist: false,
    budget,
    adapters: [
      adapter("AMAZON", async (request) => {
        bundleCalls += 1;
        const title = bundleCalls === 1
          ? "Camisa Termica Protecao UV 50"
          : "Kit 4 Camisas Termicas Protecao UV 50";
        return {
          marketplace: "AMAZON",
          query: request.query,
          success: true,
          scanned: 1,
          candidates: [candidate("AMAZON", title, `bundle-${bundleCalls}`)],
          error: null,
        };
      }),
    ],
  });
  assert.equal(bundleCalls, 2, "unit candidate continues bundle fallback");
  assert.equal(bundleResult.relevantCandidates.length, 1);

  console.log("variant continuation: all cases passed");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});