/**
 * CATALOG_ARCHITECTURE_V1 — RAW REPROCESS TESTS (FASE I, puro-lógica).
 *
 * RAW_REPROCESSABLE:
 *  - rawPayload preservado permite reprocessar no futuro;
 *  - payload idêntico => NOOP (idempotente);
 *  - payload com preço novo => OFFER_ONLY; com mudança estrutural => STRUCTURAL;
 *  - re-normalização que troca a identidade => REJECTED (REPROCESS_IDENTITY_MISMATCH);
 *  - conector de marketplace errado => falha (fail-closed);
 *  - raw ausente => REJECTED (MISSING_RAW_PAYLOAD).
 */
import assert from "node:assert/strict";
import { reprocessRawListing } from "./reprocess";
import { processNormalizedListing } from "./pipeline";
import {
  InMemoryRawListingRepository,
} from "../fake/inMemoryRepositories";
import { CatalogMetrics } from "../observability/metrics";
import { FakeMarketplaceConnectorA, FakeMarketplaceConnectorB, buildFakeListing } from "../fake/fakeConnectors";

async function main() {
  const metrics = new CatalogMetrics();
  const repository = new InMemoryRawListingRepository();
  const connectorA = new FakeMarketplaceConnectorA();

  const raw = {
    externalListingId: "a1",
    identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
    catalog: { title: "Smartphone Nova X 256GB Preto", category: "Celulares" },
    commerce: { price: 1999.9, stock: 42 },
  };

  // Primeira ingestão (STRUCTURAL).
  {
    const listing = connectorA.normalize(raw);
    const result = await processNormalizedListing(
      { repository, metrics },
      { listing, rawPayload: raw },
    );
    assert.equal(result.path, "STRUCTURAL");
  }

  const ctx = { repository, metrics, connector: connectorA };

  // Reprocessar payload idêntico => NOOP (idempotência).
  {
    const record = await repository.findListing({ marketplaceId: "MARKET_A", externalListingId: "a1" });
    assert.ok(record, "record existe após primeira ingestão");
    const result = await reprocessRawListing(ctx, record!, raw);
    assert.equal(result.reprocessed, true);
    assert.equal(result.path, "NOOP", "payload idêntico no reprocess => NOOP");
    const updated = await repository.findListing({ marketplaceId: "MARKET_A", externalListingId: "a1" });
    assert.equal(updated?.reprocessCount, 1, "reprocessCount incrementado");
  }

  // Reprocessar com preço novo => OFFER_ONLY.
  {
    const record = await repository.findListing({ marketplaceId: "MARKET_A", externalListingId: "a1" });
    const changedRaw = { ...raw, commerce: { price: 1599.9, stock: 42 } };
    const result = await reprocessRawListing(ctx, record!, changedRaw);
    assert.equal(result.path, "OFFER_ONLY", "preço novo no reprocess => FAST OFFER PATH");
  }

  // Reprocessar com título novo => STRUCTURAL.
  {
    const record = await repository.findListing({ marketplaceId: "MARKET_A", externalListingId: "a1" });
    const changedRaw = { ...raw, catalog: { title: "Smartphone Nova X ULTRA 256GB", category: "Celulares" } };
    const result = await reprocessRawListing(ctx, record!, changedRaw);
    assert.equal(result.path, "STRUCTURAL", "mudança estrutural no reprocess => COLLECTION PATH");
  }

  // Conector de outro marketplace => fail-closed.
  {
    const record = await repository.findListing({ marketplaceId: "MARKET_A", externalListingId: "a1" });
    await assert.rejects(
      () => reprocessRawListing({ repository, metrics, connector: new FakeMarketplaceConnectorB() }, record as never, raw),
      /não pode reprocessar/,
    );
  }

  // Raw ausente => REJECTED.
  {
    const record = await repository.findListing({ marketplaceId: "MARKET_A", externalListingId: "a1" });
    assert.ok(record);
    const result = await reprocessRawListing(ctx, record!, null);
    assert.equal(result.reprocessed, false);
    assert.equal(result.path, "REJECTED");
    assert.deepEqual(result.reasonCodes, ["MISSING_RAW_PAYLOAD"]);
  }

  // Re-normalização que troca a identidade => REJECTED.
  {
    const record = await repository.findListing({ marketplaceId: "MARKET_A", externalListingId: "a1" });
    assert.ok(record);
    const tampered = { ...raw, externalListingId: "a1-TAMPERED" };
    const result = await reprocessRawListing(ctx, record!, tampered);
    assert.equal(result.path, "REJECTED");
    assert.deepEqual(result.reasonCodes, ["REPROCESS_IDENTITY_MISMATCH"]);
  }

  // buildFakeListing continua saudável (imports usados).
  assert.ok(buildFakeListing({ marketplaceId: "MARKET_B", externalListingId: "b1", commerce: { price: 10 } }).commerce.price === 10);

  console.log("reprocess.test.ts PASS");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});