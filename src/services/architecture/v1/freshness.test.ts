/**
 * CATALOG_ARCHITECTURE_V1 — FRESHNESS TESTS (FASE L, puro-lógica).
 *
 *  - FRESH => dado atual (disputa melhor oferta);
 *  - AGING => válido dentro do limite de transição (disputa melhor oferta);
 *  - STALE => não disputa melhor oferta;
 *  - EXPIRED => além do TTL (indisponível, fail-closed sem timestamps);
 *  - canCompeteForBestOffer regra oficial.
 */
import assert from "node:assert/strict";
import {
  classifyFreshness,
  deriveExpiresAt,
  canCompeteForBestOffer,
  DEFAULT_FRESHNESS_CONTRACT,
} from "./freshness";

const nowIso = "2026-09-24T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;

// FRESH: evidência recente.
{
  const state = classifyFreshness({ lastSeenAt: new Date(Date.parse(nowIso) - 1 * HOUR).toISOString() }, DEFAULT_FRESHNESS_CONTRACT, nowIso);
  assert.equal(state, "FRESH");
}

// AGING: além de 12h, dentro de 48h.
{
  const state = classifyFreshness({ receivedAt: new Date(Date.parse(nowIso) - 20 * HOUR).toISOString() }, DEFAULT_FRESHNESS_CONTRACT, nowIso);
  assert.equal(state, "AGING");
}

// STALE: além de 48h, dentro do TTL (7d).
{
  const state = classifyFreshness({ observedAt: new Date(Date.parse(nowIso) - 3 * 24 * HOUR).toISOString() }, DEFAULT_FRESHNESS_CONTRACT, nowIso);
  assert.equal(state, "STALE");
}

// EXPIRED: além do TTL.
{
  const state = classifyFreshness({ processedAt: new Date(Date.parse(nowIso) - 10 * 24 * HOUR).toISOString() }, DEFAULT_FRESHNESS_CONTRACT, nowIso);
  assert.equal(state, "EXPIRED");
}

// Sem NENHUMA evidência de tempo => EXPIRED (fail-closed, nunca disputa oferta).
{
  const state = classifyFreshness({}, DEFAULT_FRESHNESS_CONTRACT, nowIso);
  assert.equal(state, "EXPIRED");
}

// Preferência de referência: sourceUpdatedAt > observedAt > processedAt > receivedAt > lastSeenAt.
{
  const state = classifyFreshness(
    {
      sourceUpdatedAt: new Date(Date.parse(nowIso) - 1 * HOUR).toISOString(),
      lastSeenAt: new Date(Date.parse(nowIso) - 10 * 24 * HOUR).toISOString(),
    },
    DEFAULT_FRESHNESS_CONTRACT,
    nowIso,
  );
  assert.equal(state, "FRESH", "sourceUpdatedAt (recente) prevalece sobre lastSeenAt (antigo)");
}

// canCompeteForBestOffer.
{
  assert.equal(canCompeteForBestOffer("FRESH"), true);
  assert.equal(canCompeteForBestOffer("AGING"), true);
  assert.equal(canCompeteForBestOffer("STALE"), false, "STALE nunca disputa melhor oferta");
  assert.equal(canCompeteForBestOffer("EXPIRED"), false, "EXPIRED nunca disputa melhor oferta");
}

// deriveExpiresAt = lastSeenAt + ttl.
{
  const lastSeen = "2026-09-24T12:00:00.000Z";
  const expires = deriveExpiresAt(lastSeen);
  assert.equal(expires, new Date(Date.parse(lastSeen) + DEFAULT_FRESHNESS_CONTRACT.ttlMs).toISOString());
}

console.log("freshness.test.ts PASS");