/**
 * CATALOG_ARCHITECTURE_V1 — AUTHORITATIVE WRITER TESTS (FASE D/E/F/G/O).
 *
 * writer é orquestrador fail-closed com fakes injetáveis (sem DB):
 *  - V1 success => legado nunca escreve (single-write);
 *  - retry idempotente => NOOP pelos hashes atuais;
 *  - fallback só em falha pré-commit elegível;
 *  - breaker tripado => marketplace volta a LEGACY_ONLY;
 *  - orçamento esgotado => BUDGET_SKIPPED (fail-closed, sem write);
 *  - marketplace-agnostic (MARKET_A/B/C) e sem hardcode de nomes;
 *  - publish gate AUTO_ACTIVE_LT2 preservado (autoCreated => DRAFT single-store).
 */
import assert from "node:assert/strict";
import {
  processAuthoritativeListing,
  type AuthoritativeListingInput,
  type AuthoritativeWriterDeps,
} from "./writer";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import type { CatalogWriterMode, CatalogWriterPolicy } from "./policy";
import type { AuthoritativeFlags } from "./flags";
import { getCutoverMetrics, resetCutoverMetrics } from "./metrics";
import { getCutoverBreaker, resetCutoverBreaker } from "./breaker";

function listingFor(
  marketplaceId: string,
  externalId: string,
  overrides: Partial<NormalizedMarketplaceListingV1> = {},
): NormalizedMarketplaceListingV1 {
  return {
    contractVersion: "normalized-listing/v1",
    source: "test-connector",
    marketplaceId,
    externalListingId: externalId,
    seller: overrides.seller ?? { externalSellerId: null, name: "Loja Teste" },
    identity: {
      gtin: overrides.identity?.gtin ?? [],
      mpn: overrides.identity?.mpn ?? null,
      manufacturerModel: overrides.identity?.manufacturerModel ?? null,
      brand: overrides.identity?.brand ?? "MarcaTeste",
      model: overrides.identity?.model ?? null,
    },
    catalog: {
      title: overrides.catalog?.title ?? "Produto Teste",
      description: overrides.catalog?.description ?? null,
      category: overrides.catalog?.category ?? "Eletrônicos",
      images: overrides.catalog?.images ?? [],
      attributes: overrides.catalog?.attributes ?? {},
      primaryImageUrl: overrides.catalog?.primaryImageUrl ?? null,
    },
    variant: {
      color: overrides.variant?.color ?? null,
      storage: overrides.variant?.storage ?? null,
      memory: overrides.variant?.memory ?? null,
      voltage: overrides.variant?.voltage ?? null,
      size: overrides.variant?.size ?? null,
      otherAttributes: overrides.variant?.otherAttributes ?? {},
    },
    commerce: {
      price: overrides.commerce?.price ?? 99.9,
      oldPrice: overrides.commerce?.oldPrice ?? null,
      pixPrice: overrides.commerce?.pixPrice ?? null,
      installments: overrides.commerce?.installments ?? null,
      stock: overrides.commerce?.stock ?? 10,
      availability: overrides.commerce?.availability ?? "IN_STOCK",
      shippingHint: overrides.commerce?.shippingHint ?? null,
      promotion: overrides.commerce?.promotion ?? null,
    },
    metadata: {
      sourceUpdatedAt: overrides.metadata?.sourceUpdatedAt ?? null,
      collectedAt: overrides.metadata?.collectedAt ?? "2026-09-24T00:00:00.000Z",
      rawHash: overrides.metadata?.rawHash ?? "",
      payloadVersion: overrides.metadata?.payloadVersion ?? "normalized-listing/v1",
    },
  };
}

function rowFor(
  marketplaceEnum: string,
  externalId: string,
  overrides: Partial<AuthoritativeListingInput> = {},
): AuthoritativeListingInput {
  return {
    marketplace: marketplaceEnum,
    externalId,
    sourceUrl: `https://example.test/${marketplaceEnum}/${externalId}`,
    title: "Produto Teste",
    price: 99.9,
    stock: 10,
    available: true,
    ...overrides,
  };
}

function policyFor(modes: Record<string, CatalogWriterMode>): CatalogWriterPolicy {
  return { modes };
}

function flagsFor(overrides: Partial<AuthoritativeFlags> = {}): AuthoritativeFlags {
  return {
    enabled: true,
    marketplaceIds: ["mercado_livre", "market_a", "market_b", "market_c"],
    legacyFallbackEnabled: true,
    maxWrites: 10,
    writeBudgetScope: "PROCESS_LOCAL",
    ...overrides,
  };
}

type Fakes = {
  storedHashes: Map<string, { catalogHash: string | null; offerHash: string | null }>;
  v1StructuralCalls: number;
  v1FastOfferCalls: number;
  legacyCalls: number;
  persistCalls: number;
};

function makeDeps(overrides: {
  mode: CatalogWriterMode;
  flags?: AuthoritativeFlags;
  maxWrites?: number;
  consumed?: () => number;
  readRow?: AuthoritativeWriterDeps["readRow"];
  v1StructuralError?: unknown;
  v1FastOfferError?: unknown;
}): { deps: AuthoritativeWriterDeps; fakes: Fakes } {
  const fakes: Fakes = {
    storedHashes: new Map(),
    v1StructuralCalls: 0,
    v1FastOfferCalls: 0,
    legacyCalls: 0,
    persistCalls: 0,
  };
  const deps: AuthoritativeWriterDeps = {
    flags: overrides.flags ?? flagsFor(),
    policy: policyFor({
      mercado_livre: overrides.mode,
      market_a: overrides.mode,
      market_b: overrides.mode,
      market_c: overrides.mode,
    }),
    metrics: getCutoverMetrics(),
    breaker: getCutoverBreaker(),
    buildListing: (row) =>
      listingFor(row.marketplace.trim().toLowerCase(), row.externalId, {
        catalog: {
          title: row.title ?? null,
          description: null,
          category: null,
          images: [],
          attributes: {},
          primaryImageUrl: null,
        },
        commerce: {
          price:
            typeof row.price === "number" && Number.isFinite(row.price)
              ? row.price
              : 0,
          oldPrice: row.oldPrice ?? null,
          pixPrice: null,
          installments: null,
          stock: row.stock ?? null,
          availability: row.available ? ("IN_STOCK" as const) : ("UNAVAILABLE" as const),
          shippingHint: null,
          promotion: null,
        },
      }),
    readRow:
      overrides.readRow ??
      (async (marketplaceId, externalListingId) => {
        const stored = fakes.storedHashes.get(
          `${marketplaceId}:${externalListingId}`,
        );
        return stored
          ? { catalogHash: stored.catalogHash, offerHash: stored.offerHash }
          : null;
      }),
    persistHashes: async (marketplaceId, externalListingId, hashes) => {
      fakes.persistCalls += 1;
      fakes.storedHashes.set(`${marketplaceId}:${externalListingId}`, {
        catalogHash: hashes.catalogHash,
        offerHash: hashes.offerHash,
      });
    },
    commitV1Structural: async (ctx) => {
      fakes.v1StructuralCalls += 1;
      if (overrides.v1StructuralError) {
        throw overrides.v1StructuralError;
      }
      return { productId: `prod-${ctx.externalListingId}` };
    },
    commitV1FastOffer: async (ctx) => {
      fakes.v1FastOfferCalls += 1;
      if (overrides.v1FastOfferError) {
        throw overrides.v1FastOfferError;
      }
      return { productId: `prod-${ctx.externalListingId}` };
    },
    legacyWrite: async (ctx) => {
      fakes.legacyCalls += 1;
      return { productId: `legacy-${ctx.externalListingId}` };
    },
    maxWrites: overrides.maxWrites ?? 10,
    consumedWrites: overrides.consumed ?? (() => 0),
  };
  return { deps, fakes };
}

async function main(): Promise<void> {
  const metrics = getCutoverMetrics();

  // --- V1 success => V1_COMMITTED, legado NUNCA escreve ------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps, fakes } = makeDeps({
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
    });
    const result = await processAuthoritativeListing(
      deps,
      rowFor("MERCADO_LIVRE", "ML-1"),
    );
    assert.equal(result.outcome, "V1_COMMITTED");
    assert.equal(result.path, "STRUCTURAL");
    assert.equal(fakes.v1StructuralCalls, 1);
    assert.equal(fakes.legacyCalls, 0, "legado não escreve após commit V1");
    assert.equal(fakes.persistCalls, 1, "hashes persistidos pós-commit");
    const s = metrics.snapshot().byMarketplace["mercado_livre"];
    assert.equal(s.v1_authoritative_attempt_total, 1);
    assert.equal(s.v1_authoritative_success_total, 1);
    assert.equal(s.legacy_fallback_total, 0);
  }

  // --- Retry idempotente => NOOP ------------------------------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps } = makeDeps({
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
    });
    const first = await processAuthoritativeListing(
      deps,
      rowFor("MERCADO_LIVRE", "ML-1"),
    );
    assert.equal(first.outcome, "V1_COMMITTED");
    const retry = await processAuthoritativeListing(
      deps,
      rowFor("MERCADO_LIVRE", "ML-1"),
    );
    assert.equal(retry.outcome, "NO_WRITE");
    assert.equal(retry.path, "NOOP");
    assert.equal(retry.skippedReason, "idempotente-hashes-atuais");
  }

  // --- Falha pré-commit elegível => fallback legado (1 write) --------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps, fakes } = makeDeps({
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      v1StructuralError: new Error("P1001 connection lost"),
    });
    const result = await processAuthoritativeListing(
      deps,
      rowFor("MERCADO_LIVRE", "ML-1"),
    );
    assert.equal(result.outcome, "LEGACY_FALLBACK_COMMITTED");
    assert.equal(result.failureCode, "DB_TRANSIENT");
    assert.equal(fakes.legacyCalls, 1, "falha elegível => 1 write legado");
    const s = metrics.snapshot().byMarketplace["mercado_livre"];
    assert.equal(s.legacy_fallback_total, 1);
    assert.equal(s.legacy_fallback_success_total, 1);
  }

  // --- IDENTITY_REJECT => NO_WRITE, legado NUNCA escreve --------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps, fakes } = makeDeps({
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      v1StructuralError: new Error("IDENTITY_REJECT:matchStatus REJECTED"),
    });
    const result = await processAuthoritativeListing(
      deps,
      rowFor("MERCADO_LIVRE", "ML-1"),
    );
    assert.equal(result.outcome, "NO_WRITE");
    assert.equal(result.failureCode, "IDENTITY_REJECT");
    assert.equal(fakes.legacyCalls, 0, "identity reject => sem fallback");
    assert.equal(fakes.persistCalls, 0, "sem commit => sem hashes");
  }

  // --- POLICY_NOT_READY => NO_WRITE -----------------------------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps, fakes } = makeDeps({
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      v1StructuralError: new Error("NON_RETRYABLE|POLICY_NOT_READY:policy"),
    });
    const result = await processAuthoritativeListing(
      deps,
      rowFor("MERCADO_LIVRE", "ML-1"),
    );
    assert.equal(result.outcome, "NO_WRITE");
    assert.equal(result.failureCode, "POLICY_NOT_READY");
    assert.equal(fakes.legacyCalls, 0);
  }

  // --- Breaker tripado => MARKETPLACE VOLTA A LEGACY_ONLY --------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const breaker = getCutoverBreaker();
    breaker.trip("PUBLICATION_VIOLATION");
    const { deps, fakes } = makeDeps({
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
    });
    const result = await processAuthoritativeListing(
      deps,
      rowFor("MERCADO_LIVRE", "ML-1"),
    );
    assert.equal(result.outcome, "MODE_NOT_AUTHORITATIVE");
    assert.equal(result.mode, "LEGACY_ONLY", "breaker => LEGACY_ONLY");
    assert.ok(result.skippedReason?.includes("breaker-tripado"));
    assert.equal(fakes.v1StructuralCalls, 0);
    assert.equal(fakes.legacyCalls, 0);
  }

  // --- Orçamento esgotado => BUDGET_SKIPPED (sem write, sem fallback) ---------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps, fakes } = makeDeps({
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      consumed: () => 10,
      maxWrites: 10,
    });
    const result = await processAuthoritativeListing(
      deps,
      rowFor("MERCADO_LIVRE", "ML-1"),
    );
    assert.equal(result.outcome, "BUDGET_SKIPPED");
    assert.equal(result.skippedReason, "orcamento-writes-esgotado");
    assert.equal(fakes.v1StructuralCalls, 0);
    assert.equal(fakes.legacyCalls, 0);
    const s = metrics.snapshot().byMarketplace["mercado_livre"];
    assert.equal(s.cutover_write_budget_skipped_total, 1);
  }

  // --- OFFER_ONLY => fast path (sem heavy matching) ----------------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps, fakes } = makeDeps({
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
    });
    // Persiste hashes da MESMA listing com pHASH de catálogo atual => catalogHash igual.
    const deps2 = { ...deps };
    // Primeira passada commit STRUCTURAL e grava hashes.
    const first = await processAuthoritativeListing(
      deps2,
      rowFor("MERCADO_LIVRE", "ML-FAST", { price: 100 }),
    );
    assert.equal(first.outcome, "V1_COMMITTED");

    // Mesma listing mas preço diferente => catalogHash igual, offerHash muda => OFFER_ONLY.
    const result = await processAuthoritativeListing(
      deps2,
      rowFor("MERCADO_LIVRE", "ML-FAST", {
        price: 90,
        // mesma estrutura: somente preço muda
        title: "Produto Teste",
      }),
    );
    assert.equal(result.path, "OFFER_ONLY");
    assert.equal(result.outcome, "V1_COMMITTED");
    assert.equal(fakes.v1FastOfferCalls, 1, "fast path usado");
    assert.equal(fakes.v1StructuralCalls, 1, "sem nova escrita estrutural");
  }

  // --- Marketplace-agnostic: MARKET_A (nunca hardcode nomes) --------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps, fakes } = makeDeps({ mode: "V1_PRIMARY" });
    const result = await processAuthoritativeListing(
      deps,
      rowFor("MARKET_A", "A-1"),
    );
    assert.equal(result.marketplaceId, "market_a");
    assert.equal(result.outcome, "V1_COMMITTED");
    assert.equal(fakes.v1StructuralCalls, 1);
  }

  // --- Modo SHADOW => MODE_NOT_AUTHORITATIVE (fail-closed) -----------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps, fakes } = makeDeps({ mode: "SHADOW" });
    const result = await processAuthoritativeListing(
      deps,
      rowFor("MERCADO_LIVRE", "ML-1"),
    );
    assert.equal(result.outcome, "MODE_NOT_AUTHORITATIVE");
    assert.equal(result.mode, "SHADOW");
    assert.equal(fakes.v1StructuralCalls, 0);
    assert.equal(fakes.legacyCalls, 0);
  }

  // --- Flags OFF => fail-closed ----------------------------------------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps, fakes } = makeDeps({
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      flags: flagsFor({ enabled: false }),
    });
    const result = await processAuthoritativeListing(
      deps,
      rowFor("MERCADO_LIVRE", "ML-1"),
    );
    assert.equal(result.outcome, "MODE_NOT_AUTHORITATIVE");
    assert.equal(fakes.v1StructuralCalls, 0);
  }

  // --- Marketplace fora do allowlist => fail-closed ---------------------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps, fakes } = makeDeps({
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      flags: flagsFor({ marketplaceIds: ["mercado_livre"] }),
    });
    deps.policy = policyFor({
      mercado_livre: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      amazon: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
    });
    const result = await processAuthoritativeListing(
      deps,
      rowFor("AMAZON", "ASIN-1"),
    );
    assert.equal(result.outcome, "MODE_NOT_AUTHORITATIVE");
    assert.ok(result.skippedReason?.includes("allowlist"));
    assert.equal(fakes.v1StructuralCalls, 0);
  }

  // --- Listing inválida => LISTING_INVALID --------------------------------------------------------
  {
    resetCutoverMetrics();
    resetCutoverBreaker();
    const { deps, fakes } = makeDeps({ mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK" });
    deps.buildListing = () => null; // marketplace/resolução falhou => fail-closed
    const result = await processAuthoritativeListing(
      deps,
      rowFor("MERCADO_LIVRE", "ML-INVALID"),
    );
    assert.equal(result.outcome, "LISTING_INVALID");
    assert.equal(result.failureCode, "INVALID_DATA");
    assert.equal(result.skippedReason, "listing-invalida-ou-marketplace-desconhecido");
    assert.equal(fakes.v1StructuralCalls, 0, "listing inválida => sem escrita");
    assert.equal(fakes.legacyCalls, 0);
    assert.equal(fakes.persistCalls, 0);
  }

  console.log("cutover/writer.test.ts PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});