/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW REPLAY RUNNER TESTS.
 *
 * Canário: 1 marketplace, MAX_WRITES progressivo, paridade profunda com o
 * MESMO conjunto de ofertas (gate legado vs gate V1), readiness bloqueada
 * por V1_MORE_PERMISSIVE / PUBLICATION_UNEXPLAINED_MISMATCH.
 */
import assert from "node:assert/strict";
import {
  nextShadowCanaryStage,
  runShadowReplay,
} from "./runner";
import { readShadowFlags, type ShadowFlags } from "./flags";
import {
  getShadowMetrics,
  resetShadowMetrics,
} from "./metrics";
import {
  createInMemoryImportRunRepository,
  createInMemoryRawListingRepository,
  type ShadowRepositoryBundle,
} from "./repository";
import type { LegacyPublicationOutcome } from "./parityEngine";

const mercadoLivreRow = {
  marketplace: "MERCADO_LIVRE",
  externalId: "ML-1",
  sourceUrl: "https://produto.mercadolivre.com.br/ML-1",
  title: "Smartphone X 128GB",
  brand: "MarcaX",
  price: 1299.9,
  stock: 10,
  available: true,
  canonicalProductId: "prod-1",
};

function flagsWith(partial: Partial<ShadowFlags>): ShadowFlags {
  return {
    ...readShadowFlags({}),
    ...partial,
  };
}

function reposReset(): ShadowRepositoryBundle {
  return {
    raw: createInMemoryRawListingRepository(),
    importRun: createInMemoryImportRunRepository(),
  };
}

function offer(marketplace: string): {
  marketplace: string;
  active: boolean;
  available: boolean;
  status: string;
  matchStatus: string;
  price: number;
} {
  return {
    marketplace,
    active: true,
    available: true,
    status: "ACTIVE",
    matchStatus: "EXACT",
    price: 100,
  };
}

async function main(): Promise<void> {
  // --- Bloqueado sem allowlist ------------------------------------------------
  {
    resetShadowMetrics();
    const result = await runShadowReplay(
      {
        repos: reposReset(),
        metrics: getShadowMetrics(),
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 1,
        flags: flagsWith({
          enabled: true,
          marketplaceIds: ["amazon"],
          dryRun: false,
          persistHashes: true,
        }),
        sourceRows: [mercadoLivreRow],
      },
    );
    assert.equal(result.blocked, true);
    assert.equal(result.blockedReason, "marketplace-not-in-allowlist");
    assert.equal(result.realWrites, 0);
  }

  // --- Dry-run: processa, não escreve, readiness NO ----------------------------
  {
    resetShadowMetrics();
    const result = await runShadowReplay(
      {
        repos: reposReset(),
        metrics: getShadowMetrics(),
        readLegacyPublication: async () =>
          ({
            autoCreated: true,
            active: false,
            publicationStatus: "DRAFT",
            offers: [offer("MERCADO_LIVRE")],
          }) as LegacyPublicationOutcome,
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 1,
        flags: flagsWith({
          enabled: true,
          marketplaceIds: ["mercado_livre"],
          dryRun: true,
          persistHashes: true,
        }),
        sourceRows: [mercadoLivreRow],
      },
    );
    assert.equal(result.blocked, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.processed, 1);
    assert.equal(result.realWrites, 0, "dry-run não escreve");
    assert.equal(result.parity.total, 1, "paridade ainda é medida em dry-run");
    assert.equal(result.parity.match, 1);
    assert.equal(result.readiness.ready, false, "sem escrita real => NO");
    assert.ok(result.readiness.reasonCodes.includes("NO_REAL_SHADOW_WRITES"));
  }

  // --- Escrita real + paridade MATCH => CATALOG_V1_CUTOVER_READY=YES -----------
  {
    resetShadowMetrics();
    const repos = reposReset();
    const result = await runShadowReplay(
      {
        repos,
        metrics: getShadowMetrics(),
        readLegacyPublication: async () =>
          ({
            autoCreated: true,
            active: false,
            publicationStatus: "DRAFT",
            offers: [offer("MERCADO_LIVRE")],
          }) as LegacyPublicationOutcome,
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 1,
        flags: flagsWith({
          enabled: true,
          marketplaceIds: ["mercado_livre"],
          dryRun: false,
          persistHashes: true,
          persistRaw: false,
          maxWrites: 1,
        }),
        sourceRows: [mercadoLivreRow],
      },
    );
    assert.equal(result.processed, 1);
    assert.equal(result.realWrites, 1);
    assert.equal(result.parity.total, 1);
    assert.equal(result.parity.match, 1);
    assert.equal(result.parity.v1MorePermissiveThanLegacy, 0);
    assert.equal(result.parity.unexpectedMismatch, 0);
    assert.equal(result.readiness.ready, true, "pré-condições OK => YES");
    assert.equal(result.runId, "run-1", "ImportRun criado no replay");
    const run = await repos.importRun.getRun(result.runId!);
    assert.equal(run?.status, "COMPLETED");
    assert.equal(run?.itemsReceived, 1);
  }

  // --- V1_MORE_PERMISSIVE_THAN_LEGACY bloqueia readiness ------------------------
  {
    resetShadowMetrics();
    const result = await runShadowReplay(
      {
        repos: reposReset(),
        metrics: getShadowMetrics(),
        readLegacyPublication: async () =>
          ({
            autoCreated: true,
            active: false,
            publicationStatus: "DRAFT",
            offers: [offer("MERCADO_LIVRE"), offer("AMAZON")],
          }) as LegacyPublicationOutcome,
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 1,
        flags: flagsWith({
          enabled: true,
          marketplaceIds: ["mercado_livre"],
          dryRun: false,
          persistHashes: true,
          maxWrites: 1,
        }),
        sourceRows: [mercadoLivreRow],
      },
    );
    assert.equal(result.parity.v1MorePermissiveThanLegacy, 1);
    assert.equal(result.readiness.ready, false);
    assert.ok(result.readiness.reasonCodes.includes("V1_MORE_PERMISSIVE_THAN_LEGACY"));
  }

  // --- PUBLICATION_UNEXPLAINED_MISMATCH bloqueia readiness ----------------------
  {
    resetShadowMetrics();
    const result = await runShadowReplay(
      {
        repos: reposReset(),
        metrics: getShadowMetrics(),
        readLegacyPublication: async () =>
          ({
            autoCreated: true,
            active: true,
            publicationStatus: "LIVE_COMPLETE",
            offers: [offer("MERCADO_LIVRE")],
          }) as LegacyPublicationOutcome,
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 1,
        flags: flagsWith({
          enabled: true,
          marketplaceIds: ["mercado_livre"],
          dryRun: false,
          persistHashes: true,
          maxWrites: 1,
        }),
        sourceRows: [mercadoLivreRow],
      },
    );
    assert.equal(result.parity.unexpectedMismatch, 1);
    assert.equal(result.readiness.ready, false);
    assert.ok(result.readiness.reasonCodes.includes("PUBLICATION_UNEXPLAINED_MISMATCH_NOT_ZERO"));
  }

  // --- Manual DRAFT explicado não bloqueia ---------------------------------------
  {
    resetShadowMetrics();
    const result = await runShadowReplay(
      {
        repos: reposReset(),
        metrics: getShadowMetrics(),
        readLegacyPublication: async () =>
          ({
            autoCreated: false,
            active: false,
            publicationStatus: "DRAFT",
            offers: [offer("MERCADO_LIVRE")],
          }) as LegacyPublicationOutcome,
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 1,
        flags: flagsWith({
          enabled: true,
          marketplaceIds: ["mercado_livre"],
          dryRun: false,
          persistHashes: true,
          maxWrites: 1,
        }),
        sourceRows: [mercadoLivreRow],
      },
    );
    assert.equal(result.parity.v1MorePermissiveThanLegacy, 0, "manual DRAFT explicado");
    assert.equal(result.readiness.ready, true, "explicado não bloqueia");
  }

  // --- Progressão canário ---------------------------------------------------------
  {
    assert.equal(nextShadowCanaryStage(0), 1);
    assert.equal(nextShadowCanaryStage(1), 5);
    assert.equal(nextShadowCanaryStage(5), 25);
    assert.equal(nextShadowCanaryStage(25), 100);
    assert.equal(nextShadowCanaryStage(100), null);
  }

  console.log("shadow/runner.test.ts PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});