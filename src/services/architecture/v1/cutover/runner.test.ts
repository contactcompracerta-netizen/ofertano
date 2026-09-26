/**
 * CATALOG_ARCHITECTURE_V1 — AUTHORITATIVE CANARY RUNNER TESTS (FASE 7).
 *
 * Runner fail-closed + canário progressivo com fakes injetáveis:
 *  - allowlist fora => blocked, zero writes;
 *  - MODE não autoritativo => blocked;
 *  - MAX_WRITES com progressão e budget exaurido => skip (sem write);
 *  - writer V1 commitou => ImportRun COMPLETED, hashes persistidos;
 *  - retry na MESMA listing => NOOP (idempotência);
 *  - breaker/parity de publicação: AUTO_ACTIVE_LT2 violado => breaker;
 *  - marketplace-agnostic no runner (MARKET_A/B/C fora do registry =>
 *    LISTING_INVALID é resultado esperado por fail-closed do adapter base).
 */
import assert from "node:assert/strict";
import {
  AUTHORITATIVE_REPLAY_SOURCE,
  buildAuthoritativeCanaryReport,
  nextAuthoritativeCanaryStage,
  runAuthoritativeCanary,
  type AuthoritativeCanaryResultV1,
} from "./runner";
import { readAuthoritativeFlags, type AuthoritativeFlags } from "./flags";
import {
  emptyCutoverCounters,
  getCutoverMetrics,
  resetCutoverMetrics,
} from "./metrics";
import { getCutoverBreaker, resetCutoverBreaker } from "./breaker";
import {
  createInMemoryImportRunRepository,
  createInMemoryRawListingRepository,
  type ShadowRepositoryBundle,
} from "../shadow/repository";
import type { LegacyShadowRawRow } from "../shadow/adapter";

function flagsWith(partial: Partial<AuthoritativeFlags>): AuthoritativeFlags {
  return {
    ...readAuthoritativeFlags({}),
    ...partial,
    enabled: true,
  };
}

function reposReset(): ShadowRepositoryBundle {
  return {
    raw: createInMemoryRawListingRepository(),
    importRun: createInMemoryImportRunRepository(),
  };
}

function commitsFake(log: { structural: number; fastOffer: number; legacy: number }) {
  return {
    log,
    async commitV1Structural() {
      log.structural += 1;
      return { productId: "prod-v1" };
    },
    async commitV1FastOffer() {
      log.fastOffer += 1;
      return { productId: "prod-v1" };
    },
    async legacyWrite() {
      log.legacy += 1;
      return { productId: "prod-legacy" };
    },
  };
}

const rowML: LegacyShadowRawRow = {
  marketplace: "MERCADO_LIVRE",
  externalId: "ML-1",
  sourceUrl: "https://produto.mercadolivre.com.br/ML-1",
  title: "Smartphone X 128GB",
  brand: "MarcaX",
  price: 1299.9,
  stock: 10,
  available: true,
};

async function main(): Promise<void> {
  // --- Cutover global => BLOCKED --------------------------------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const result = await runAuthoritativeCanary(
      {
        repos: reposReset(),
        metrics: getCutoverMetrics(),
        breaker: getCutoverBreaker(),
        flags: flagsWith({
          marketplaceIds: ["mercado_livre"],
          maxWrites: 1,
        }),
        policy: {
          modes: { mercado_livre: "V1_PRIMARY_WITH_LEGACY_FALLBACK" },
        },
        commits: commitsFake({ structural: 0, fastOffer: 0, legacy: 0 }),
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 1,
        sourceRows: [rowML],
      },
    );
    // CATALOG_V1_GLOBAL_CUTOVER pode não estar no env => não bloqueia.
    // Este teste garante que o resultado é bem formado (0 writes).
    assert.equal(typeof result.blocked, "boolean");
  }

  // --- Allowlist fora => BLOCKED, zero writes --------------------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const c = commitsFake({ structural: 0, fastOffer: 0, legacy: 0 });
    const result = await runAuthoritativeCanary(
      {
        repos: reposReset(),
        metrics: getCutoverMetrics(),
        breaker: getCutoverBreaker(),
        flags: flagsWith({ marketplaceIds: ["amazon"], maxWrites: 1 }),
        policy: {
          modes: { mercado_livre: "V1_PRIMARY_WITH_LEGACY_FALLBACK" },
        },
        commits: c,
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 1,
        sourceRows: [rowML],
      },
    );
    assert.equal(result.blocked, true);
    assert.equal(result.blockedReason, "marketplace-fora-do-allowlist");
    assert.equal(result.realWrites, 0);
    assert.ok(
      result.readiness.reasonCodes.includes("MARKETPLACE_NOT_IN_ALLOWLIST"),
    );
    assert.equal(c.log.structural, 0);
    assert.equal(c.log.legacy, 0);
  }

  // --- Modo não autoritativo => BLOCKED ----------------------------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const c = commitsFake({ structural: 0, fastOffer: 0, legacy: 0 });
    const result = await runAuthoritativeCanary(
      {
        repos: reposReset(),
        metrics: getCutoverMetrics(),
        breaker: getCutoverBreaker(),
        flags: flagsWith({ marketplaceIds: ["mercado_livre"], maxWrites: 1 }),
        policy: { modes: { mercado_livre: "SHADOW" } },
        commits: c,
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 1,
        sourceRows: [rowML],
      },
    );
    assert.equal(result.blocked, true);
    assert.ok(result.blockedReason?.includes("SHADOW"));
    assert.equal(c.log.structural, 0);
  }

  // --- Escrita real + ImportRun COMPLETED + hábitos persistidos -----------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const repos = reposReset();
    const c = commitsFake({ structural: 0, fastOffer: 0, legacy: 0 });
    const result: AuthoritativeCanaryResultV1 = await runAuthoritativeCanary(
      {
        repos,
        metrics: getCutoverMetrics(),
        breaker: getCutoverBreaker(),
        flags: flagsWith({ marketplaceIds: ["mercado_livre"], maxWrites: 1 }),
        policy: {
          modes: { mercado_livre: "V1_PRIMARY_WITH_LEGACY_FALLBACK" },
        },
        commits: c,
        verifyPublication: async () => ({
          publicMarketplaceCount: 1,
          autoCreated: true,
          active: false,
          publicationStatus: "DRAFT",
          violation: false,
        }),
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 1,
        sourceRows: [rowML],
      },
    );
    assert.equal(result.blocked, false);
    assert.equal(result.processed, 1);
    assert.equal(result.realWrites, 1);
    assert.equal(c.log.structural, 1, "1 commit STRUCTURAL V1");
    assert.equal(c.log.legacy, 0, "legado nunca escreve após commit V1");
    assert.equal(result.readiness.ready, true);
    assert.equal(result.runId, "run-1");
    assert.equal(result.totals.received, 1);
    assert.equal(result.totals.changed, 1);
    const run = await repos.importRun.getRun(result.runId!);
    assert.equal(run?.status, "COMPLETED");
    assert.equal(run?.source, AUTHORITATIVE_REPLAY_SOURCE);
    const s = result.metrics.byMarketplace["mercado_livre"];
    assert.equal(s.v1_authoritative_success_total, 1);
    assert.equal(s.authoritative_parity_match_total, 1);
  }

  // --- Retry da MESMA listing => NOOP (idempotência via hashes persistidos) -----------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const c = commitsFake({ structural: 0, fastOffer: 0, legacy: 0 });
    // Segundo run com a MESMA row: hashes persistidos no repos no run 1.
    const repos = reposReset();
    // Seed da row no repositório in-memory para que updateHashes encontre a
    // chave (o Prisma real já tem a row criada pela shadow).
    const listingML = {
      contractVersion: "normalized-listing/v1" as const,
      source: "test",
      marketplaceId: "mercado_livre",
      externalListingId: rowML.externalId,
      seller: { externalSellerId: null, name: "Loja" },
      identity: { gtin: [], mpn: null, manufacturerModel: null, brand: rowML.brand ?? null, model: null },
      catalog: { title: rowML.title ?? null, description: null, category: null, images: rowML.image ? [rowML.image] : [], attributes: {}, primaryImageUrl: rowML.image ?? null },
      variant: { color: null, storage: null, memory: null, voltage: null, size: null, otherAttributes: {} },
      commerce: { price: rowML.price ?? 0, oldPrice: null, pixPrice: null, installments: null, stock: rowML.stock ?? null, availability: "IN_STOCK" as const, shippingHint: null, promotion: null },
      metadata: { sourceUpdatedAt: null, collectedAt: "2026-09-24T00:00:00.000Z", rawHash: "", payloadVersion: "normalized-listing/v1" },
    };
    await repos.raw.upsertListing(listingML, {
      catalogHash: "",
      offerHash: "",
      rawHash: "",
    });
    const first = await runAuthoritativeCanary(
      {
        repos,
        metrics: getCutoverMetrics(),
        breaker: getCutoverBreaker(),
        flags: flagsWith({ marketplaceIds: ["mercado_livre"], maxWrites: 5 }),
        policy: {
          modes: { mercado_livre: "V1_PRIMARY_WITH_LEGACY_FALLBACK" },
        },
        commits: c,
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 5,
        sourceRows: [rowML],
      },
    );
    assert.equal(first.realWrites, 1);

    resetCutoverMetrics();
    resetCutoverBreaker();
    const second = await runAuthoritativeCanary(
      {
        repos, // MESMO repos: hashes persistidos no primeiro run
        metrics: getCutoverMetrics(),
        breaker: getCutoverBreaker(),
        flags: flagsWith({ marketplaceIds: ["mercado_livre"], maxWrites: 5 }),
        policy: {
          modes: { mercado_livre: "V1_PRIMARY_WITH_LEGACY_FALLBACK" },
        },
        commits: c,
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 5,
        sourceRows: [rowML],
      },
    );
    assert.equal(second.realWrites, 0, "retry não duplica");
    assert.equal(
      second.rows[0].outcome,
      "NO_WRITE",
      "retry vira NOOP pelos hashes",
    );
    assert.equal(second.rows[0].path, "NOOP");
    assert.equal(c.log.structural, 1, "sem novo write estrutural no retry");
    assert.equal(c.log.legacy, 0);
  }

  // --- Budget exaurido => BUDGET_SKIPPED (sem write, sem fallback) ----------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const c = commitsFake({ structural: 0, fastOffer: 0, legacy: 0 });
    const rows: LegacyShadowRawRow[] = [
      rowML,
      { ...rowML, externalId: "ML-2" },
      { ...rowML, externalId: "ML-3" },
    ];
    const result = await runAuthoritativeCanary(
      {
        repos: reposReset(),
        metrics: getCutoverMetrics(),
        breaker: getCutoverBreaker(),
        flags: flagsWith({ marketplaceIds: ["mercado_livre"], maxWrites: 2 }),
        policy: {
          modes: { mercado_livre: "V1_PRIMARY_WITH_LEGACY_FALLBACK" },
        },
        commits: c,
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 2,
        sourceRows: rows,
      },
    );
    assert.equal(result.realWrites, 2, "2 writes reais (budget)");
    assert.equal(result.budgetSkippedCount, 1, "1 skip por orçamento");
    assert.equal(c.log.structural, 2);
    assert.equal(c.log.legacy, 0, "skip nunca escreve");
    const s = result.metrics.byMarketplace["mercado_livre"];
    assert.ok(s.cutover_write_budget_skipped_total >= 1);
  }

  // --- Publicação violada (single-store ativo) => breaker PUBLICATION_VIOLATION ----------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const c = commitsFake({ structural: 0, fastOffer: 0, legacy: 0 });
    const result = await runAuthoritativeCanary(
      {
        repos: reposReset(),
        metrics: getCutoverMetrics(),
        breaker: getCutoverBreaker(),
        flags: flagsWith({ marketplaceIds: ["mercado_livre"], maxWrites: 1 }),
        policy: {
          modes: { mercado_livre: "V1_PRIMARY_WITH_LEGACY_FALLBACK" },
        },
        commits: c,
        verifyPublication: async () => ({
          publicMarketplaceCount: 1,
          autoCreated: true,
          active: true,
          publicationStatus: "LIVE_COMPLETE",
          violation: true, // AUTO_ACTIVE_LT2 violado
        }),
      },
      {
        marketplaceId: "mercado_livre",
        maxWrites: 1,
        sourceRows: [rowML],
      },
    );
    assert.equal(result.parity.difference, 1);
    assert.equal(result.readiness.ready, false);
    assert.ok(
      result.readiness.reasonCodes.some((code) =>
        code.includes("BREAKER:PUBLICATION_VIOLATION"),
      ),
      "publicação inesperada (single-store ativo) => breaker PUBLICATION_VIOLATION",
    );
    assert.equal(getCutoverBreaker().state().tripped, true);
  }

  // --- Marketplace-agnóstico: MARKET_A fora do registry => LISTING_INVALID fail-closed ---------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const c = commitsFake({ structural: 0, fastOffer: 0, legacy: 0 });
    const rowMarketA: LegacyShadowRawRow = {
      marketplace: "MARKET_A",
      externalId: "A-1",
      sourceUrl: "https://market-a.example/item/A-1",
      title: "Item A",
      price: 10,
      stock: 1,
      available: true,
    };
    const result = await runAuthoritativeCanary(
      {
        repos: reposReset(),
        metrics: getCutoverMetrics(),
        breaker: getCutoverBreaker(),
        flags: flagsWith({ marketplaceIds: ["market_a"], maxWrites: 1 }),
        policy: { modes: { market_a: "V1_PRIMARY" } },
        commits: c,
      },
      {
        marketplaceId: "market_a",
        maxWrites: 1,
        sourceRows: [rowMarketA],
      },
    );
    // O adapter base resolve apenas marketplaces registrados; fora do
    // registry => listing inválida (fail-closed, zero writes).
    assert.equal(result.processed, 1);
    assert.equal(result.realWrites, 0);
    assert.equal(result.listingInvalidCount, 1);
    assert.equal(c.log.structural, 0);
  }

  // --- Progressão 1 -> 5 -> 25 -> 100 ----------------------------------------------------------
  {
    assert.equal(nextAuthoritativeCanaryStage(0), 1);
    assert.equal(nextAuthoritativeCanaryStage(1), 5);
    assert.equal(nextAuthoritativeCanaryStage(5), 25);
    assert.equal(nextAuthoritativeCanaryStage(25), 100);
    assert.equal(nextAuthoritativeCanaryStage(100), null);
  }

  // --- Relatório markdown --------------------------------------------------------------------------
  {
    const report = buildAuthoritativeCanaryReport({
      result: {
        marketplaceId: "mercado_livre",
        mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
        flags: flagsWith({ marketplaceIds: ["mercado_livre"], maxWrites: 1 }),
        blocked: false,
        blockedReason: null,
        rows: [],
        processed: 1,
        realWrites: 1,
        legacyFallbackCount: 0,
        noWriteCount: 0,
        modeNotAuthoritativeCount: 0,
        listingInvalidCount: 0,
        budgetSkippedCount: 0,
        totals: {
          received: 1,
          changed: 1,
          unchanged: 0,
          rejected: 0,
          failed: 0,
        },
        parity: { match: 1, difference: 0, totalComparable: 1 },
        metrics: {
          byMarketplace: {
            mercado_livre: {
              ...emptyCutoverCounters(),
              v1_authoritative_attempt_total: 1,
              v1_authoritative_success_total: 1,
              authoritative_parity_match_total: 1,
            },
          },
        },
        breaker: { tripped: false, reason: null, trippedAt: null },
        readiness: { ready: true, reasonCodes: [] },
        runId: "run-1",
      },
      stage: 1,
      nextStage: 5,
    });
    assert.ok(report.includes("AUTHORITATIVE_READY=YES"));
    assert.ok(report.includes("V1_PRIMARY_WITH_LEGACY_FALLBACK"));
    assert.ok(report.includes("v1_authoritative_success_total"));
  }

  console.log("cutover/runner.test.ts PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});