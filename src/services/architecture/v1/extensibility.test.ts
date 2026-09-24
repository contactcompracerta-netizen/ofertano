/**
 * CATALOG_ARCHITECTURE_V1 — EXTENSIBILITY CONTRACT TEST (FASE E/X).
 *
 * MARKETPLACE_HARDCODE_CORE=NO:
 * O núcleo do catálogo NÃO conhece nomes de marketplace. Um marketplace
 * NOVO (marketplaceId string dinâmico, fora do enum Prisma legado) entra
 * no pipeline SEM nenhuma alteração no núcleo.
 */
import assert from "node:assert/strict";
import {
  MARKETPLACE_REGISTRY_V1,
  getMarketplaceConfig,
  resolveDisplayName,
  resolveLegacyEnumValue,
  resolveMarketplaceIdFromLegacyEnum,
  isMarketplaceKnown,
  countRegisteredMarketplaces,
} from "./marketplaceRegistry";
import { processNormalizedListing } from "./ingestion/pipeline";
import { InMemoryRawListingRepository } from "./fake/inMemoryRepositories";
import { CatalogMetrics } from "./observability/metrics";
import { buildFakeListing } from "./fake/fakeConnectors";
import { computeCatalogHash } from "./hashing";
import { projectCatalogEntry } from "./catalogProjection";

async function main() {
  // --- Núcleo NÃO depende do enum; registry resolve para enum legado -------------
  assert.ok(countRegisteredMarketplaces() >= 9, "registry cobre os 9 marketplaces legados");
  for (const config of MARKETPLACE_REGISTRY_V1) {
    assert.equal(getMarketplaceConfig(config.marketplaceId)?.marketplaceId, config.marketplaceId);
    assert.equal(isMarketplaceKnown(config.marketplaceId), true);
  }
  assert.equal(resolveLegacyEnumValue("mercado_livre"), "MERCADO_LIVRE");
  assert.equal(resolveMarketplaceIdFromLegacyEnum("SHOPEE"), "shopee");
  assert.equal(resolveDisplayName("amazon"), "Amazon");
  // marketplaceId desconhecido (dinâmico) resolve para o próprio id — nunca hardcode.
  assert.equal(resolveDisplayName("supermercado_zzz"), "supermercado_zzz");

  // Marketplace NOVO (sem entrada no registry e sem enum) entra no pipeline.
  const NEW_MARKETPLACE_ID = "marketplace_novo_x";
  const repository = new InMemoryRawListingRepository();
  const metrics = new CatalogMetrics();

  const listing = buildFakeListing({
    marketplaceId: NEW_MARKETPLACE_ID,
    externalListingId: "x1",
    identity: { gtin: [], brand: "MarcaY", model: "ModeloZ" },
    catalog: { title: "Produto do marketplace novo", category: "Novidades" },
    commerce: { price: 149.9 },
  });
  listing.source = "connector-novo-x";
  listing.metadata.payloadVersion = "raw/v1";

  const result = await processNormalizedListing(
    { repository, metrics },
    { listing, rawPayload: { id: "x1" } },
  );
  assert.equal(result.path, "STRUCTURAL");
  assert.equal(result.accepted, true);

  const record = await repository.findListing({
    marketplaceId: NEW_MARKETPLACE_ID,
    externalListingId: "x1",
  });
  assert.ok(record, "listing do marketplace novo persistida no repositório");
  assert.equal(record?.key.marketplaceId, NEW_MARKETPLACE_ID);

  // Métricas são rotuladas pelo marketplaceId dinâmico (W).
  const received = metrics.snapshot().filter((s) => s.metric === "ingestion_received_total");
  assert.equal(received[0]?.marketplaceId, NEW_MARKETPLACE_ID);

  // Projeção usa o marketplaceId string sem tocar o núcleo (X).
  const entry = projectCatalogEntry(listing, computeCatalogHash(listing), "offer-hash");
  assert.equal(entry.offer.marketplaceId, NEW_MARKETPLACE_ID);
  assert.equal(entry.catalogKey.includes("marcay"), true);

  // Idempotência: segunda entrega idêntica => NOOP (SOURCE_LISTING_IDEMPOTENCY).
  const second = await processNormalizedListing(
    { repository, metrics },
    { listing, rawPayload: { id: "x1" } },
  );
  assert.equal(second.path, "NOOP");
  assert.equal(second.created, false);

  console.log("extensibility.test.ts PASS");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});