/**
 * CATALOG_ARCHITECTURE_V1 — PIPELINE TESTS (puro-lógica, fora de npm test).
 *
 * FAST_OFFER_PATH / SOURCE_LISTING_IDEMPOTENCY / CATALOG_HASH / OFFER_HASH:
 *  - primeira observação => STRUCTURAL (created);
 *  - payload idêntico    => NOOP (idempotência, duplicate_prevented);
 *  - só preço mudou       => OFFER_ONLY (FAST OFFER PATH, sem TCC estrutural);
 *  - título/GTIN mudou    => STRUCTURAL.
 *  - validação rejeita payloads inválidos (reason codes estáveis).
 */
import assert from "node:assert/strict";
import { processNormalizedListing, validateNormalizedListing } from "./pipeline";
import { InMemoryRawListingRepository } from "../fake/inMemoryRepositories";
import { CatalogMetrics } from "../observability/metrics";
import { buildFakeListing } from "../fake/fakeConnectors";

async function main() {
  const repository = new InMemoryRawListingRepository();

  function ctx(overrides: { onStructural?: () => Promise<void>; onOfferOnly?: () => Promise<void> } = {}) {
    const metrics = new CatalogMetrics();
    return {
      repository,
      metrics,
      onStructural: overrides.onStructural,
      onOfferOnly: overrides.onOfferOnly,
    };
  }

  // --- STRUCTURAL na primeira observação ---------------------------------------
  {
    const first = buildFakeListing({
      marketplaceId: "MARKET_A",
      externalListingId: "a1",
      identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
      catalog: { title: "Smartphone Nova X 256GB Preto", category: "Celulares" },
      variant: { color: "Preto", storage: "256GB" },
      commerce: { price: 1999.9, stock: 42 },
    });
    const result = await processNormalizedListing(ctx(), { listing: first, rawPayload: { id: "a1" } });
    assert.equal(result.path, "STRUCTURAL", "primeira observação => STRUCTURAL");
    assert.equal(result.created, true, "primeira observação cria a listing");
    assert.equal(result.accepted, true);
    assert.equal(result.previousCatalogHash, null);
  }

  // --- NOOP idempotente ---------------------------------------------------------
  {
    const again = buildFakeListing({
      marketplaceId: "MARKET_A",
      externalListingId: "a1",
      identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
      catalog: { title: "Smartphone Nova X 256GB Preto", category: "Celulares" },
      variant: { color: "Preto", storage: "256GB" },
      commerce: { price: 1999.9, stock: 42 },
    });
    const c = ctx();
    const result = await processNormalizedListing(c, { listing: again, rawPayload: { id: "a1" } });
    assert.equal(result.path, "NOOP", "payload idêntico => NOOP");
    assert.equal(result.created, false, "NÃO cria uma segunda listing (idempotência de chave)");
    assert.equal(c.metrics.total("duplicate_prevented_total"), 1);
    assert.equal(c.metrics.total("ingestion_noop_total"), 1);
  }

  // --- FAST OFFER PATH (só preço muda) ------------------------------------------
  {
    let offerHookCalls = 0;
    let structuralHookCalls = 0;
    const cheaper = buildFakeListing({
      marketplaceId: "MARKET_A",
      externalListingId: "a1",
      identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
      catalog: { title: "Smartphone Nova X 256GB Preto", category: "Celulares" },
      variant: { color: "Preto", storage: "256GB" },
      commerce: { price: 1799.9, stock: 42 },
    });
    const c = ctx({
      onOfferOnly: async () => { offerHookCalls += 1; },
      onStructural: async () => { structuralHookCalls += 1; },
    });
    const result = await processNormalizedListing(c, { listing: cheaper, rawPayload: { id: "a1" } });
    assert.equal(result.path, "OFFER_ONLY", "mudança só de oferta => FAST OFFER PATH");
    assert.ok(result.previousOfferHash, "há um offerHash anterior conhecido");
    assert.equal(offerHookCalls, 1, "hook comercial invocado no FAST OFFER PATH");
    assert.equal(structuralHookCalls, 0, "hook estrutural NÃO invocado no FAST OFFER PATH");
    assert.equal(c.metrics.total("offer_hash_changed_total"), 1);
    assert.equal(c.metrics.total("catalog_hash_changed_total"), 0, "NÃO conta como mudança estrutural");
  }

  // --- STRUCTURAL quando título muda --------------------------------------------
  {
    let structuralHookCalls = 0;
    const retitled = buildFakeListing({
      marketplaceId: "MARKET_A",
      externalListingId: "a1",
      identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
      catalog: { title: "Smartphone Nova X PRO 256GB Preto", category: "Celulares" },
      variant: { color: "Preto", storage: "256GB" },
      commerce: { price: 1799.9, stock: 42 },
    });
    const c = ctx({ onStructural: async () => { structuralHookCalls += 1; } });
    const result = await processNormalizedListing(c, { listing: retitled, rawPayload: { id: "a1" } });
    assert.equal(result.path, "STRUCTURAL", "mudança estrutural => CATALOG/COLLECTION PATH");
    assert.equal(structuralHookCalls, 1);
    assert.equal(c.metrics.total("catalog_hash_changed_total"), 1);
  }

  // --- vendedor NÃO identifica a listing (FASE F) --------------------------------
  {
    // Mesma chave (marketplaceId, externalListingId) com vendedor diferente
    // deve continuar sendo a MESMA listing (idempotência de identidade).
    const before = await repository.findListing({ marketplaceId: "MARKET_A", externalListingId: "a1" });
    assert.ok(before, "listing a1 existe");

    const relisted = buildFakeListing({
      marketplaceId: "MARKET_A",
      externalListingId: "a1",
      seller: { externalSellerId: "s-diferente", name: "Outra Loja" },
      identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
      catalog: { title: "Smartphone Nova X PRO 256GB Preto", category: "Celulares" },
      variant: { color: "Preto", storage: "256GB" },
      commerce: { price: 1799.9, stock: 42 },
    });
    const result = await processNormalizedListing(ctx(), { listing: relisted, rawPayload: { id: "a1" } });
    assert.equal(result.created, false, "troca de vendedor NÃO cria nova listing");
    const after = await repository.findListing({ marketplaceId: "MARKET_A", externalListingId: "a1" });
    assert.deepEqual(
      { marketplaceId: after?.key.marketplaceId, externalListingId: after?.key.externalListingId },
      { marketplaceId: "MARKET_A", externalListingId: "a1" },
      "chave de identidade permanece (marketplaceId, externalListingId)",
    );
  }

  // --- validação ----------------------------------------------------------------
  {
    const invalid = buildFakeListing({
      marketplaceId: "",
      externalListingId: "",
      catalog: { title: null, category: null },
      commerce: { price: 0 },
    });
    const v = validateNormalizedListing(invalid);
    assert.equal(v.ok, false);
    for (const code of ["MISSING_MARKETPLACE_ID", "MISSING_EXTERNAL_LISTING_ID", "INVALID_PRICE", "MISSING_CATALOG_SIGNAL"]) {
      assert.ok(v.reasonCodes.includes(code), `esperado reasonCode ${code}`);
    }
  }

  // --- métricas por marketplaceId (W) --------------------------------------------
  {
    const m = new CatalogMetrics();
    const repo2 = new InMemoryRawListingRepository();
    await processNormalizedListing(
      { repository: repo2, metrics: m },
      {
        listing: buildFakeListing({ marketplaceId: "MARKET_A", externalListingId: "m-a-1", commerce: { price: 50 } }),
        rawPayload: {},
      },
    );
    await processNormalizedListing(
      { repository: repo2, metrics: m },
      {
        listing: buildFakeListing({ marketplaceId: "MARKET_B", externalListingId: "m-b-1", commerce: { price: 60 } }),
        rawPayload: {},
      },
    );
    const snap = m.snapshot();
    const received = snap.filter((s) => s.metric === "ingestion_received_total");
    assert.equal(received.filter((s) => s.marketplaceId === "MARKET_A")[0].value, 1);
    assert.equal(received.filter((s) => s.marketplaceId === "MARKET_B")[0].value, 1);
  }

  console.log("pipeline.test.ts PASS");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});