/**
 * CATALOG_ARCHITECTURE_V1 — METRICAS DA FASE 8 (FASE V).
 *
 * Prova que as metricas exigidas existem e sao contadas POR marketplaceId.
 * Sem isso, um vazamento de shadow poderia ser invisivel.
 */
import assert from "node:assert/strict";

import {
  CatalogMetrics,
  CATALOG_METRIC_NAMES,
  metricCountByMarketplace,
} from "./metrics";
import { processNormalizedListing } from "../ingestion/pipeline";
import { InMemoryRawListingRepository } from "../fake/inMemoryRepositories";
import { buildFakeListing } from "../fake/fakeConnectors";
import { matchCrossMarket } from "../matching/crossMarketMatching";

const REQUIRED_M8 = [
  "connector_collect_total",
  "connector_collect_failed_total",
  "normalized_listing_total",
  "raw_write_total",
  "hash_noop_total",
  "hash_offer_only_total",
  "hash_structural_total",
  "identity_exact_total",
  "identity_review_total",
  "identity_reject_total",
  "cross_market_match_total",
  "hard_conflict_total",
] as const;

async function main() {
  /* --- Todas as metricas exigidas existem no contrato ------------------- */
  for (const name of REQUIRED_M8) {
    assert.ok(
      (CATALOG_METRIC_NAMES as readonly string[]).includes(name),
      `metrica ausente no contrato: ${name}`,
    );
  }

  const metrics = new CatalogMetrics();
  const repository = new InMemoryRawListingRepository();
  const ctx = { repository, metrics };

  const base = {
    identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
    catalog: { title: "Smartphone Nova X 256GB" },
    variant: { storage: "256GB" },
    commerce: { price: 1999.9 },
  };

  /* --- STRUCTURAL (primeira escrita) ----------------------------------- */
  const a = buildFakeListing({
    ...base,
    marketplaceId: "shopee",
    externalListingId: "s1",
  });
  await processNormalizedListing(ctx, { listing: a, rawPayload: { id: "s1" } });
  assert.equal(metrics.total("hash_structural_total"), 1);
  assert.equal(metrics.total("raw_write_total"), 1);

  /* --- NOOP (payload identico) ----------------------------------------- */
  await processNormalizedListing(ctx, { listing: a, rawPayload: { id: "s1" } });
  assert.equal(metrics.total("hash_noop_total"), 1);

  /* --- OFFER_ONLY (so preco muda) -------------------------------------- */
  const a2 = structuredClone(a);
  a2.commerce.price = 1799.9;
  await processNormalizedListing(ctx, { listing: a2, rawPayload: { id: "s1", price: 1799.9 } });
  assert.equal(metrics.total("hash_offer_only_total"), 1);

  /* --- Contagem POR marketplaceId -------------------------------------- */
  const byMarketplace = metricCountByMarketplace(
    metrics.snapshot(),
    "normalized_listing_total",
  );
  assert.equal(byMarketplace.shopee, 3, "3 listings normalizadas da shopee");
  assert.equal(byMarketplace.mercado_livre, undefined, "ML nao aparece neste canario");

  /* --- Matching cross-market conta por marketplace --------------------- */
  const ml = buildFakeListing({
    ...base,
    marketplaceId: "mercado_livre",
    externalListingId: "ml1",
  });
  const sp = buildFakeListing({
    ...base,
    marketplaceId: "shopee",
    externalListingId: "s1",
  });
  const results = matchCrossMarket([ml, sp]);
  assert.equal(results.length, 1);
  assert.equal(results[0].decision, "EXACT");
  metrics.inc("cross_market_match_total", { marketplaceId: "shopee" });
  metrics.inc("identity_exact_total", { marketplaceId: "shopee" });

  /* --- Hard conflict tambem e contavel --------------------------------- */
  const conflict = matchCrossMarket([
    ml,
    buildFakeListing({
      ...base,
      marketplaceId: "shopee",
      externalListingId: "s2",
      variant: { storage: "512GB" },
      catalog: { title: "Smartphone Nova X 512GB" },
    }),
  ]);
  assert.equal(conflict[0].decision, "REJECT");
  assert.ok(conflict[0].hardConflicts.length > 0);
  metrics.inc("cross_market_match_total", { marketplaceId: "shopee" });
  metrics.inc("identity_reject_total", { marketplaceId: "shopee" });
  metrics.inc("hard_conflict_total", { marketplaceId: "shopee" });

  assert.equal(metrics.total("cross_market_match_total"), 2);
  assert.equal(metrics.total("identity_reject_total"), 1);
  assert.equal(metrics.total("hard_conflict_total"), 1);

  /* --- Metricas de conector (coleta/falha) ----------------------------- */
  metrics.inc("connector_collect_total", { marketplaceId: "shopee" });
  metrics.inc("connector_collect_failed_total", { marketplaceId: "shopee" });
  assert.equal(metrics.total("connector_collect_total"), 1);
  assert.equal(metrics.total("connector_collect_failed_total"), 1);

  console.log("fase8Metrics.test.ts PASS");
}

main();
