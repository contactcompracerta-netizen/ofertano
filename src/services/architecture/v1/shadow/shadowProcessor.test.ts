/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW PROCESSOR TESTS.
 *
 * Orquestração por listing com gating canário:
 *  - disabled => skipped, zero escrita;
 *  - marketplace fora da allowlist => skipped;
 *  - DRY-RUN => reprocessa em memória, zero escrita real;
 *  - escrita real (persistHashes) => RAW/hashes no repositório;
 *  - idempotência: segunda observação idêntica => NOOP;
 *  - falha do pipeline NUNCA propaga para o chamador (inerte).
 */
import assert from "node:assert/strict";
import { processShadowListing } from "./shadowProcessor";
import { readShadowFlags, type ShadowFlags } from "./flags";
import {
  resetShadowMetrics,
} from "./metrics";
import {
  createInMemoryImportRunRepository,
  createInMemoryRawListingRepository,
  type ShadowRepositoryBundle,
} from "./repository";

const baseInput = {
  marketplace: "MERCADO_LIVRE",
  externalId: "ML-1",
  sourceUrl: "https://produto.mercadolivre.com.br/ML-1",
  title: "Smartphone X 128GB",
  price: 1299.9,
  oldPrice: 1499.9,
  stock: 10,
  available: true,
  brand: "MarcaX",
  category: "Celulares",
  legacyOutcome: { autoCreated: true, active: false, publicationStatus: "DRAFT" },
  partialView: true,
} as const;

function flagsWith(partial: Partial<ShadowFlags>): ShadowFlags {
  return {
    ...readShadowFlags({}),
    ...partial,
  };
}

function realReposReset(): ShadowRepositoryBundle {
  return {
    raw: createInMemoryRawListingRepository(),
    importRun: createInMemoryImportRunRepository(),
  };
}

async function main(): Promise<void> {
  // --- Disabled => skipped, zero escrita ----------------------------------
  {
    resetShadowMetrics();
    const repos = realReposReset();
    const result = await processShadowListing(
      {
        flags: flagsWith({ enabled: false }),
        realRepos: repos,
      },
      { ...baseInput },
    );
    assert.equal(result.handled, false);
    assert.equal(result.skippedReason, "shadow-disabled");
    const metrics = resetShadowMetrics();
    assert.equal(metrics.skippedDisabled, 1);
    const rows = await repos.raw.listRawRows("mercado_livre", 10);
    assert.equal(rows.length, 0, "nenhuma escrita real");
  }

  // --- Marketplace fora da allowlist => skipped -----------------------------
  {
    resetShadowMetrics();
    const repos = realReposReset();
    const result = await processShadowListing(
      {
        flags: flagsWith({ enabled: true, marketplaceIds: ["amazon"] }),
        realRepos: repos,
      },
      { ...baseInput },
    );
    assert.equal(result.skippedReason, "marketplace-not-in-allowlist");
    assert.equal(resetShadowMetrics().skippedMarketplace, 1);
  }

  // --- DRY-RUN => reprocessa mas não escreve --------------------------------
  {
    resetShadowMetrics();
    const repos = realReposReset();
    const result = await processShadowListing(
      {
        flags: flagsWith({
          enabled: true,
          marketplaceIds: ["mercado_livre"],
          dryRun: true,
          persistHashes: true,
        }),
        realRepos: repos,
      },
      { ...baseInput },
    );
    assert.equal(result.dryRun, true);
    assert.equal(result.handled, true);
    assert.equal(result.wroteHashes, false, "dry-run não escreve hashes");
    assert.equal(result.wroteRaw, false);
    const metrics = resetShadowMetrics();
    assert.equal(metrics.skippedDryRun, 1);
    assert.equal(metrics.writeSuccess, 0);
    assert.equal(metrics.processed, 1, "dry-run processa pela pipeline V1");
    assert.equal(metrics.rawWrites, 0);
    assert.equal(metrics.hashWrites, 0);
    const rows = await repos.raw.listRawRows("mercado_livre", 10);
    assert.equal(rows.length, 0, "realRepos intocado em dry-run");
  }

  // --- Escrita real + idempotência -------------------------------------------
  {
    resetShadowMetrics();
    const repos = realReposReset();
    const flags = flagsWith({
      enabled: true,
      marketplaceIds: ["mercado_livre"],
      dryRun: false,
      persistHashes: true,
      persistRaw: false,
      maxWrites: 100,
    });

    const primeira = await processShadowListing(
      { flags, realRepos: repos },
      { ...baseInput },
    );
    assert.equal(primeira.handled, true);
    assert.equal(primeira.wroteHashes, true);
    assert.equal(primeira.path, "STRUCTURAL", "first-seen => STRUCTURAL");
    assert.equal(primeira.created, true);

    const segunda = await processShadowListing(
      { flags, realRepos: repos },
      { ...baseInput },
    );
    assert.equal(segunda.path, "NOOP", "observação idêntica => NOOP idempotente");
    assert.equal(segunda.created, false);

    const metrics = resetShadowMetrics();
    assert.equal(metrics.writeSuccess, 2, "duas escritas reais (hashes)");
    assert.equal(metrics.hashWrites, 2, "hash-only: cada escrita real persistiu hashes");
    assert.equal(metrics.rawWrites, 0, "hash-only: zero raw payload persistido");
    assert.equal(metrics.processed, 2, "duas listings processadas pela pipeline");
    assert.equal(metrics.parityMatch, 2, "paridade smoke: ambos não publicam");

    const rows = await repos.raw.listRawRows("mercado_livre", 10);
    assert.equal(rows.length, 1, "uma única chave persistida");
    assert.equal(rows[0].externalId, "ML-1");
  }

  // --- PersistRaw aditivo preserva legacy ------------------------------------
  {
    resetShadowMetrics();
    const repos = realReposReset();
    const flags = flagsWith({
      enabled: true,
      marketplaceIds: ["mercado_livre"],
      dryRun: false,
      persistRaw: true,
      persistHashes: false,
      maxWrites: 1,
    });
    const result = await processShadowListing(
      { flags, realRepos: repos },
      { ...baseInput },
    );
    assert.equal(result.wroteRaw, true);
    assert.equal(result.wroteHashes, false);

    const metricsRawOnly = resetShadowMetrics();
    assert.equal(metricsRawOnly.writeSuccess, 1, "raw-only: uma escrita real");
    assert.equal(metricsRawOnly.rawWrites, 1, "raw-only: raw payload persistido");
    assert.equal(metricsRawOnly.hashWrites, 0, "raw-only: zero hashes persistidos");
    assert.equal(metricsRawOnly.processed, 1);
  }

  // --- Raw + hashes simultâneos => UM upsert, contado uma vez ------------------
  {
    resetShadowMetrics();
    const repos = realReposReset();
    const flags = flagsWith({
      enabled: true,
      marketplaceIds: ["mercado_livre"],
      dryRun: false,
      persistRaw: true,
      persistHashes: true,
      maxWrites: 100,
    });
    const result = await processShadowListing(
      { flags, realRepos: repos },
      { ...baseInput },
    );
    assert.equal(result.wroteRaw, true);
    assert.equal(result.wroteHashes, true);
    const metrics = resetShadowMetrics();
    assert.equal(metrics.writeSuccess, 1, "um único upsert = uma escrita real");
    assert.equal(metrics.rawWrites, 1);
    assert.equal(metrics.hashWrites, 1);
    assert.equal(metrics.processed, 1);
    const rows = await repos.raw.listRawRows("mercado_livre", 10);
    assert.equal(rows.length, 1, "uma única linha persistida");
  }

  // --- Persist desligado (dry-run=false) => processa, zero escrita, sem skip ----
  {
    resetShadowMetrics();
    const repos = realReposReset();
    const flags = flagsWith({
      enabled: true,
      marketplaceIds: ["mercado_livre"],
      dryRun: false,
      persistRaw: false,
      persistHashes: false,
      maxWrites: 100,
    });
    const result = await processShadowListing(
      { flags, realRepos: repos },
      { ...baseInput },
    );
    assert.equal(result.handled, true);
    assert.equal(result.wroteRaw, false);
    assert.equal(result.wroteHashes, false);
    const metrics = resetShadowMetrics();
    assert.equal(metrics.writeSuccess, 0, "persist desligado => zero escrita");
    assert.equal(metrics.processed, 1, "ainda processa pela pipeline V1");
    assert.equal(metrics.skippedDryRun, 0);
    assert.equal(metrics.skippedMaxWrites, 0);
    const rows = await repos.raw.listRawRows("mercado_livre", 10);
    assert.equal(rows.length, 0, "realRepos intocado com persist off");
  }

  // --- Orçamento _MAX_WRITES exausto => skippedMaxWrites (fail-closed) --------
  {
    resetShadowMetrics();
    const repos = realReposReset();
    const flags = flagsWith({
      enabled: true,
      marketplaceIds: ["mercado_livre"],
      dryRun: false,
      persistHashes: true,
      maxWrites: 1,
    });

    const primeira = await processShadowListing(
      { flags, realRepos: repos },
      { ...baseInput },
    );
    assert.equal(primeira.wroteHashes, true);
    assert.equal(primeira.path, "STRUCTURAL", "first-seen usa o orçamento");

    const segunda = await processShadowListing(
      { flags, realRepos: repos },
      { ...baseInput },
    );
    assert.equal(segunda.wroteHashes, false, "orçamento exausto => zero escrita");
    assert.equal(segunda.created, true, "observação continua em memória (in-memory)");

    const metrics = resetShadowMetrics();
    assert.equal(metrics.writeSuccess, 1, "_MAX_WRITES=1 respeitado como teto real");
    assert.equal(metrics.skippedMaxWrites, 1, "exaustão contabilizada");
    assert.equal(metrics.processed, 2, "ambas observações processadas pela pipeline");
    assert.equal(metrics.hashWrites, 1, "só a primeira escrita persistiu hashes");
    assert.equal(metrics.rawWrites, 0);
    const byMarketplace = metrics.byMarketplace["mercado_livre"];
    assert.equal(byMarketplace.processed, 2, "contador por marketplace (processed)");
    assert.equal(byMarketplace.writeSuccess, 1, "contador por marketplace (write)");
    assert.equal(byMarketplace.hashWrites, 1, "contador por marketplace (hash)");
    assert.equal(byMarketplace.rawWrites, 0, "contador por marketplace (raw)");

    const rows = await repos.raw.listRawRows("mercado_livre", 10);
    assert.equal(rows.length, 1, "uma única linha persistida (teto de 1)");
  }

  // --- Listing inválida (preço <= 0) => skipped --------------------------------
  {
    resetShadowMetrics();
    const result = await processShadowListing(
      {
        flags: flagsWith({ enabled: true, marketplaceIds: ["mercado_livre"] }),
      },
      { ...baseInput, price: 0 },
    );
    assert.equal(result.skippedReason, "listing-invalid");
    assert.equal(resetShadowMetrics().skippedInvalid, 1);
  }

  // --- Paridade smoke: legado publicado + visão parcial => SKIP_PARTIAL_VIEW --
  {
    resetShadowMetrics();
    const result = await processShadowListing(
      {
        flags: flagsWith({ enabled: true, marketplaceIds: ["mercado_livre"] }),
      },
      {
        ...baseInput,
        legacyOutcome: { autoCreated: true, active: true, publicationStatus: "LIVE_COMPLETE" },
        partialView: true,
      },
    );
    assert.equal(result.parity?.code, "SKIP_PARTIAL_VIEW");
    assert.equal(result.parity?.unexpectedMismatch, false);
    const metrics = resetShadowMetrics();
    assert.equal(metrics.paritySkipPartialView, 1);
  }

  console.log("shadow/shadowProcessor.test.ts PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});