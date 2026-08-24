import assert from "node:assert/strict";

import { buildEventHash, dedupWindowMs } from "./hash";
import {
  computeCtr,
  computeFunnel,
  computeOpportunityScore,
  computeTrend,
  minMaxNorm,
  parseDateKeyRange,
  periodFromPreset,
  previousPeriodRange,
} from "./metrics";
import { detectDeviceType } from "./device";
import { classifyTrafficOrigin } from "./origin";
import {
  isKnownAnalyticsEventType,
  isValidSessionId,
  parseAnalyticsRequest,
  sanitizeMetadata,
  validateAnalyticsEvent,
  MAX_METADATA_BYTES,
} from "./payload";
import { buildRollupWrites } from "./rollup";
import { parseUtmParams, referrerHostFromUrl } from "./utm";
import { ANALYTICS_EVENT_TYPES } from "./types";

const SESSION = "11111111-1111-4111-8111-111111111111";

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventType: "SEARCH",
    sessionId: SESSION,
    query: "smartphone 128gb",
    ...overrides,
  };
}

assert.equal(isValidSessionId(SESSION), true);
assert.equal(isValidSessionId("abc"), false);
assert.equal(isValidSessionId(""), false);
assert.equal(isValidSessionId("x".repeat(90)), false);

for (const eventType of ANALYTICS_EVENT_TYPES) {
  assert.equal(isKnownAnalyticsEventType(eventType), true);
}

const searchParsed = validateAnalyticsEvent(event());
assert.equal(searchParsed.ok, true);
if (searchParsed.ok) {
  assert.equal(searchParsed.event.eventType, "SEARCH");
  assert.equal(searchParsed.event.normalizedQuery, "smartphone 128gb");
  assert.equal(searchParsed.event.sessionId, SESSION);
}

const zeroParsed = validateAnalyticsEvent(
  event({ eventType: "ZERO_RESULT", resultCount: 0 }),
);
assert.equal(zeroParsed.ok, true);
if (zeroParsed.ok) {
  assert.equal(zeroParsed.event.eventType, "ZERO_RESULT");
  assert.equal(zeroParsed.event.resultCount, 0);
}

const viewParsed = validateAnalyticsEvent(
  event({
    eventType: "PRODUCT_VIEW",
    productId: "prod-1",
    query: null,
  }),
);
assert.equal(viewParsed.ok, true);
if (viewParsed.ok) {
  assert.equal(viewParsed.event.eventType, "PRODUCT_VIEW");
  assert.equal(viewParsed.event.productId, "prod-1");
}

const clickParsed = validateAnalyticsEvent(
  event({
    eventType: "MARKETPLACE_CLICK",
    productId: "prod-1",
    marketplace: "AMAZON",
    position: 2,
    metadata: { price: 199.9 },
  }),
);
assert.equal(clickParsed.ok, true);
if (clickParsed.ok) {
  assert.equal(clickParsed.event.marketplace, "AMAZON");
  assert.equal(clickParsed.event.position, 2);
  assert.equal(clickParsed.event.metadata?.price, 199.9);
}

const futureParsed = validateAnalyticsEvent(
  event({ eventType: "PRICE_ALERT_SUBSCRIBE" }),
);
assert.equal(futureParsed.ok, true);
if (futureParsed.ok) {
  assert.equal(futureParsed.event.eventType, "PRICE_ALERT_SUBSCRIBE");
}

const invalidType = validateAnalyticsEvent(event({ eventType: "click" }));
assert.equal(invalidType.ok, false);
if (!invalidType.ok) {
  assert.equal(invalidType.code, "invalid_event_type");
}

const invalidSession = validateAnalyticsEvent(event({ sessionId: "nope" }));
assert.equal(invalidSession.ok, false);
if (!invalidSession.ok) {
  assert.equal(invalidSession.code, "invalid_session");
}

const invalidPayload = parseAnalyticsRequest(null);
assert.equal(invalidPayload.ok, false);

const emptyBatch = parseAnalyticsRequest({ events: [] });
assert.equal(emptyBatch.ok, false);

const tooMany = parseAnalyticsRequest({
  events: Array.from({ length: 21 }, () => event()),
});
assert.equal(tooMany.ok, false);
if (!tooMany.ok) {
  assert.equal(tooMany.code, "batch_too_large");
}

const bodyTooLarge = parseAnalyticsRequest({ events: [event()] }, 30_000);
assert.equal(bodyTooLarge.ok, false);
if (!bodyTooLarge.ok) {
  assert.equal(bodyTooLarge.code, "body_too_large");
}

const pii = sanitizeMetadata({
  cpf: "123.456.789-00",
  email: "a@b.com",
  nome: "João",
  surface: "search",
  durationMs: 1200,
});
assert.equal(pii.ok, true);
if (pii.ok) {
  assert.equal(pii.metadata?.cpf, undefined);
  assert.equal(pii.metadata?.email, undefined);
  assert.equal(pii.metadata?.nome, undefined);
  assert.equal(pii.metadata?.surface, "search");
  assert.equal(pii.metadata?.durationMs, 1200);
}

const hugeMetadata = sanitizeMetadata(
  Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `campo${index}`,
      "x".repeat(200),
    ]),
  ),
);
assert.equal(hugeMetadata.ok, false);
if (!hugeMetadata.ok) {
  assert.equal(hugeMetadata.code, "metadata_too_large");
}

const tooManyKeys = sanitizeMetadata(
  Object.fromEntries(
    Array.from({ length: 25 }, (_, index) => [`k${index}`, "v"]),
  ),
);
assert.equal(tooManyKeys.ok, false);

const utm = parseUtmParams(
  "?utm_source=instagram&utm_medium=social&utm_campaign=ofertas-maio&utm_content=story",
);
assert.equal(utm.utmSource, "instagram");
assert.equal(utm.utmMedium, "social");
assert.equal(utm.utmCampaign, "ofertas-maio");
assert.equal(utm.utmContent, "story");

assert.equal(referrerHostFromUrl("https://www.google.com/search?q=tv"), "google.com");
assert.equal(classifyTrafficOrigin({ referrerHost: "google.com" }), "Google");
assert.equal(
  classifyTrafficOrigin({ utmSource: "instagram" }),
  "Instagram",
);
assert.equal(
  classifyTrafficOrigin({ referrerHost: "l.facebook.com" }),
  "Facebook",
);
assert.equal(classifyTrafficOrigin({ referrerHost: null, utmSource: null }), "Direct");
assert.equal(
  classifyTrafficOrigin({ referrerHost: "ofertano.vercel.app" }),
  "Direct",
);
assert.equal(
  classifyTrafficOrigin({ utmSource: "tiktok" }),
  "Outras",
);

assert.equal(detectDeviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), "mobile");
assert.equal(detectDeviceType("Mozilla/5.0 (iPad; CPU OS 17_0)"), "tablet");
assert.equal(
  detectDeviceType("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"),
  "desktop",
);
assert.equal(detectDeviceType(""), "unknown");

assert.equal(computeCtr(5, 20), 0.25);
assert.equal(computeCtr(1, 0), null);
assert.equal(computeCtr(0, 10), 0);

const up = computeTrend(12, 8);
assert.equal(up.direction, "up");
assert.ok((up.pct ?? 0) > 0);

const down = computeTrend(8, 12);
assert.equal(down.direction, "down");

const flat = computeTrend(0, 0);
assert.equal(flat.direction, "flat");
assert.equal(flat.pct, 0);

const newVolume = computeTrend(10, 0);
assert.equal(newVolume.direction, "up");
assert.equal(newVolume.pct, 100);

const funnel = computeFunnel({
  search: 100,
  impression: 80,
  view: 40,
  click: 10,
});
assert.equal(funnel.searchToImpression, 0.8);
assert.equal(funnel.impressionToView, 0.5);
assert.equal(funnel.viewToClick, 0.25);

assert.equal(minMaxNorm(5, 0, 10), 0.5);
assert.equal(minMaxNorm(0, 0, 0), 0);
assert.equal(minMaxNorm(3, 3, 3), 1);

const lowVolumeHighCtr = computeOpportunityScore(
  {
    productId: "a",
    searches: 4,
    searchGrowthPct: 80,
    impressions: 20,
    views: 12,
    clicks: 6,
    favorites: 2,
    ctr: 0.3,
    marketplaceCount: 4,
  },
  [
    {
      productId: "a",
      searches: 4,
      searchGrowthPct: 80,
      impressions: 20,
      views: 12,
      clicks: 6,
      favorites: 2,
      ctr: 0.3,
      marketplaceCount: 4,
    },
    {
      productId: "b",
      searches: 200,
      searchGrowthPct: -20,
      impressions: 400,
      views: 50,
      clicks: 2,
      favorites: 0,
      ctr: 0.005,
      marketplaceCount: 1,
    },
  ],
);

const highVolumeLowQuality = computeOpportunityScore(
  {
    productId: "b",
    searches: 200,
    searchGrowthPct: -20,
    impressions: 400,
    views: 50,
    clicks: 2,
    favorites: 0,
    ctr: 0.005,
    marketplaceCount: 1,
  },
  [
    {
      productId: "a",
      searches: 4,
      searchGrowthPct: 80,
      impressions: 20,
      views: 12,
      clicks: 6,
      favorites: 2,
      ctr: 0.3,
      marketplaceCount: 4,
    },
    {
      productId: "b",
      searches: 200,
      searchGrowthPct: -20,
      impressions: 400,
      views: 50,
      clicks: 2,
      favorites: 0,
      ctr: 0.005,
      marketplaceCount: 1,
    },
  ],
);

assert.ok(lowVolumeHighCtr.score >= 0 && lowVolumeHighCtr.score <= 100);
assert.ok(highVolumeLowQuality.score >= 0 && highVolumeLowQuality.score <= 100);
assert.ok(
  lowVolumeHighCtr.score > highVolumeLowQuality.score,
  `Opportunity Score não deve ranquear só por volume. quality=${lowVolumeHighCtr.score} volume=${highVolumeLowQuality.score}`,
);

const createdAt = new Date("2026-08-24T12:00:00.000Z");
const hashA = buildEventHash({
  eventType: "SEARCH",
  sessionId: SESSION,
  productId: null,
  query: "tv 50",
  marketplace: null,
  position: null,
  createdAt,
});
const hashB = buildEventHash({
  eventType: "SEARCH",
  sessionId: SESSION,
  productId: null,
  query: "tv 50",
  marketplace: null,
  position: null,
  createdAt: new Date(createdAt.getTime() + 1000),
});
assert.equal(hashA, hashB);

const hashLater = buildEventHash({
  eventType: "SEARCH",
  sessionId: SESSION,
  productId: null,
  query: "tv 50",
  marketplace: null,
  position: null,
  createdAt: new Date(createdAt.getTime() + dedupWindowMs("SEARCH") + 50),
});
assert.notEqual(hashA, hashLater);

if (!searchParsed.ok) {
  throw new Error("SEARCH deveria ser válido");
}

const rollups = buildRollupWrites({
  ...searchParsed.event,
  metadata: {
    productIds: ["prod-1", "prod-2"],
  },
});
const grains = rollups.map((row) => row.grain);
assert.ok(grains.includes("TOTAL"));
assert.ok(grains.includes("QUERY"));
assert.ok(grains.includes("QUERY_PRODUCT"));
assert.equal(
  rollups.filter((row) => row.grain === "QUERY_PRODUCT").length,
  2,
);

const classified = validateAnalyticsEvent(
  event({
    utmSource: "google",
    referrer: "google.com",
  }),
);
assert.equal(classified.ok, true);
if (classified.ok) {
  assert.equal(classified.event.source, "Google");
}

const seven = periodFromPreset("7d", new Date("2026-08-24T15:00:00-03:00"));
assert.equal(seven.to.getTime() - seven.from.getTime(), 7 * 24 * 60 * 60 * 1000);

const previous = previousPeriodRange(seven.from, seven.to);
assert.equal(previous.to.getTime(), seven.from.getTime());
assert.equal(
  previous.to.getTime() - previous.from.getTime(),
  seven.to.getTime() - seven.from.getTime(),
);

const custom = parseDateKeyRange("2026-08-01", "2026-08-10");
assert.ok(custom);
assert.equal(custom?.from.toISOString().slice(0, 10), "2026-08-01");
assert.equal(custom?.to.toISOString().slice(0, 10), "2026-08-11");

const batch = parseAnalyticsRequest({
  events: [
    event({ eventType: "SEARCH" }),
    event({ eventType: "ZERO_RESULT", resultCount: 0 }),
  ],
});
assert.equal(batch.ok, true);
if (batch.ok) {
  assert.equal(batch.events.length, 2);
}

console.log("analytics tests: ok");
