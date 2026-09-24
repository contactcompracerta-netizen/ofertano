/**
 * CATALOG_ARCHITECTURE_V1 — MULTI-MARKETPLACE CONTRACT TEST (FASE P/Q).
 *
 * MULTI_MARKETPLACE_CONTRACT_TESTS / FAKE_CONNECTOR_A/B:
 * Dois conectores fictícios (A rico, B mínimo) passam pelo MESMO fluxo
 * (coleta -> contrato normalizado -> pipeline -> projeção -> publicação)
 * SEM alterar o núcleo. Prove a operação 2..N marketplaces no pipeline V1.
 */
import assert from "node:assert/strict";
import { FakeMarketplaceConnectorA, FakeMarketplaceConnectorB } from "./fakeConnectors";
import { buildFakeListing } from "./fakeConnectors";
import { requireCapability, UnsupportedCapabilityError } from "../types/connector";
import type { CollectedListingBatch } from "../types/connector";
import { processNormalizedListing } from "../ingestion/pipeline";
import { InMemoryRawListingRepository } from "./inMemoryRepositories";
import { CatalogMetrics } from "../observability/metrics";
import { computeCatalogHash, computeOfferHash } from "../hashing";
import { projectCatalogEntry, groupProjectedEntries } from "../catalogProjection";
import { evaluatePublicationEligibility } from "../publication/publicationEligibility";

async function main() {
  const connectorA = new FakeMarketplaceConnectorA();
  const connectorB = new FakeMarketplaceConnectorB();

  // --- Capacidades distintas (A rico, B mínimo) -------------------------------
  assert.equal(connectorA.capabilities.gtin, true);
  assert.equal(connectorA.capabilities.variants, true);
  assert.equal(connectorA.capabilities.pixPrice, true);
  assert.equal(connectorB.capabilities.gtin, false);
  assert.equal(connectorB.capabilities.variants, false);
  assert.equal(connectorB.capabilities.stock, false);

  // Capacidade não declarada => UnsupportedCapabilityError (fail-closed).
  assert.throws(() => requireCapability(connectorB, "gtin"), UnsupportedCapabilityError);

  // --- Coleta FULL SNAPSHOT com paginação --------------------------------------
  {
    let cursor: string | null = null;
    let total = 0;
    let snapshotComplete = false;
    for (;;) {
      const batch: CollectedListingBatch = await connectorA.collect(cursor);
      total += batch.items.length;
      cursor = batch.nextCursor;
      snapshotComplete = batch.snapshotComplete;
      if (!cursor) break;
    }
    assert.equal(total, 3, "connector A snapshot com 3 listings paginado");
    assert.equal(snapshotComplete, true, "última página marca snapshotComplete");
  }

  // --- Pipeline: os dois conectores ingerem sem tocar no núcleo ----------------
  const repository = new InMemoryRawListingRepository();
  const metrics = new CatalogMetrics();
  const ctxA = { repository, metrics };

  for (const connector of [connectorA, connectorB]) {
    let cursor: string | null = null;
    do {
      const batch: CollectedListingBatch = await connector.collect(cursor);
      for (const listing of batch.items) {
        await processNormalizedListing(ctxA, {
          listing,
          rawPayload: listing,
        });
      }
      cursor = batch.nextCursor;
    } while (cursor);
  }

  const recordsA = repository.allRecords().filter((r) => r.key.marketplaceId === "MARKET_A");
  const recordsB = repository.allRecords().filter((r) => r.key.marketplaceId === "MARKET_B");
  assert.equal(recordsA.length, 3);
  assert.equal(recordsB.length, 2);

  // --- Idempotência: segunda coleta => NOOP -------------------------------------
  {
    const before = repository.allRecords().length;
    const batch = await connectorA.collect(null);
    for (const listing of batch.items) {
      await processNormalizedListing(ctxA, { listing, rawPayload: listing });
    }
    assert.equal(repository.allRecords().length, before, "recoleta idêntica NÃO duplica listings");
    assert.equal(metrics.total("duplicate_prevented_total") >= 1, true, "duplicatas prevenidas contadas");
  }

  // --- Projeção multiloja: Nova X de A + B no mesmo grupo -----------------------
  {
    const entries: ReturnType<typeof projectCatalogEntry>[] = [];
    for (const record of recordsA.concat(recordsB)) {
      const listing = buildFakeListing({
        marketplaceId: record.key.marketplaceId,
        externalListingId: record.key.externalListingId,
        identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
        catalog: { title: "Smartphone Nova X", category: "Celulares" },
        variant: { color: "Preto", storage: "256GB" },
        commerce: { price: 1999.9 },
      });
      entries.push(
        projectCatalogEntry(listing, computeCatalogHash(listing), computeOfferHash(listing)),
      );
    }
    const groups = groupProjectedEntries(entries);
    assert.ok(groups.length > 0, "pelo menos um grupo de catálogo");
    const novaX = groups.find((g) => g.catalogKey.includes("nova")) ?? groups[0];
    assert.equal(
      new Set(novaX.offers.map((o) => o.marketplaceId)).size >= 2,
      true,
      "grupo multiloja com ofertas de marketplaces distintos",
    );

    // --- Publicação: o grupo multiloja é publishable ----------------------------
    const offers = novaX.offers.map((o) => ({
      marketplace: o.marketplaceId,
      active: true,
      available: true,
      status: "ACTIVE",
      matchStatus: "EXACT" as const,
      price: o.price,
    }));
    const verdict = evaluatePublicationEligibility({ autoCreated: true, offers });
    assert.equal(verdict.eligible, true, "Nova X com ofertas em 2 marketplaces => publicável");
    assert.equal(verdict.evidence.publicMarketplaceCount, 2);
  }

  console.log("multiMarketplaceContract.test.ts PASS");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});