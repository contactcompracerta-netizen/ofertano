/**
 * CATALOG_ARCHITECTURE_V1 — SINGLE-WRITE OWNERSHIP TESTS (FASE D/FASE G).
 *
 *  - V1 success => legado NUNCA escreve.
 *  - Falha pré-commit fallback-eligible (DB_TRANSIENT/UNEXPECTED) + modo
 *    permite fallback + fallback habilitado => legado assume (1 write).
 *  - IDENTITY_REJECT / POLICY_NOT_READY => SEM fallback.
 *  - Modo V1_PRIMARY (sem fallback) => SEM fallback mesmo em transient.
 *  - Fallback desabilitado => SEM fallback.
 */
import assert from "node:assert/strict";
import {
  resetCutoverMetrics,
  getCutoverMetrics,
} from "./metrics";
import { runWithSingleWriteOwnership } from "./ownership";

async function main(): Promise<void> {
  const metrics = getCutoverMetrics();

  // --- V1 success => legado NUNCA escreve -------------------------------------------
  {
    resetCutoverMetrics();
    let legacyCalls = 0;
    const outcome = await runWithSingleWriteOwnership({
      marketplaceId: "mercado_livre",
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      fallbackEnabled: true,
      metrics,
      v1Write: async () => ({ productId: "prod-1" }),
      legacyWrite: async () => {
        legacyCalls += 1;
        return { productId: "prod-legacy" };
      },
      classify: () => "DB_TRANSIENT",
    });
    assert.equal(outcome.kind, "V1_COMMITTED");
    assert.equal((outcome as { productId: string | null }).productId, "prod-1");
    assert.equal(legacyCalls, 0, "V1 commitou => legado não escreve");
    const s = metrics.snapshot().byMarketplace["mercado_livre"];
    assert.equal(s.v1_authoritative_attempt_total, 1);
    assert.equal(s.v1_authoritative_success_total, 1);
    assert.equal(s.v1_authoritative_failure_total, 0);
    assert.equal(s.legacy_fallback_total, 0);
  }

  // --- DB_TRANSIENT pré-commit => fallback legado assume (1 write) -------------------
  {
    resetCutoverMetrics();
    let legacyCalls = 0;
    const outcome = await runWithSingleWriteOwnership({
      marketplaceId: "mercado_livre",
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      fallbackEnabled: true,
      metrics,
      v1Write: async () => {
        throw new Error("P1001 connection lost");
      },
      legacyWrite: async () => {
        legacyCalls += 1;
        return { productId: "prod-legacy" };
      },
      classify: (error) => {
        // Especifica a classificação real via classifier importado adiante;
        // aqui apenas validamos o fluxo.
        return error instanceof Error && error.message.includes("P1001")
          ? "DB_TRANSIENT"
          : "UNEXPECTED_V1_FAILURE";
      },
    });
    assert.equal(outcome.kind, "LEGACY_FALLBACK_COMMITTED");
    assert.equal(legacyCalls, 1, "fallback => exatamente 1 write legado");
    const s = metrics.snapshot().byMarketplace["mercado_livre"];
    assert.equal(s.v1_authoritative_attempt_total, 1);
    assert.equal(s.v1_authoritative_failure_total, 1);
    assert.equal(s.legacy_fallback_total, 1);
    assert.equal(s.legacy_fallback_success_total, 1);
  }

  // --- IDENTITY_REJECT => SEM fallback ------------------------------------------------
  {
    resetCutoverMetrics();
    let legacyCalls = 0;
    const outcome = await runWithSingleWriteOwnership({
      marketplaceId: "mercado_livre",
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      fallbackEnabled: true,
      metrics,
      v1Write: async () => {
        throw new Error("IDENTITY_REJECT:matchStatus REJECTED");
      },
      legacyWrite: async () => {
        legacyCalls += 1;
        return { productId: "prod-legacy" };
      },
      classify: (error) =>
        error instanceof Error && error.message.includes("IDENTITY_REJECT")
          ? "IDENTITY_REJECT"
          : "UNEXPECTED_V1_FAILURE",
    });
    assert.equal(outcome.kind, "NO_WRITE");
    assert.equal(legacyCalls, 0, "identity reject => sem fallback");
    const s = metrics.snapshot().byMarketplace["mercado_livre"];
    assert.equal(s.legacy_fallback_total, 0, "sem fallback registrado");
  }

  // --- POLICY_NOT_READY => SEM fallback ------------------------------------------------
  {
    resetCutoverMetrics();
    let legacyCalls = 0;
    const outcome = await runWithSingleWriteOwnership({
      marketplaceId: "mercado_livre",
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      fallbackEnabled: true,
      metrics,
      v1Write: async () => {
        throw new Error("NON_RETRYABLE|POLICY_NOT_READY:publication policy");
      },
      legacyWrite: async () => {
        legacyCalls += 1;
        return { productId: "prod-legacy" };
      },
      classify: () => "POLICY_NOT_READY",
    });
    assert.equal(outcome.kind, "NO_WRITE");
    assert.equal(legacyCalls, 0, "policy block => sem fallback");
    assert.ok((outcome as { reason: string }).reason.includes("POLICY_NOT_READY"));
  }

  // --- V1_PRIMARY (sem fallback) => SEM fallback mesmo em transient ---------------------
  {
    resetCutoverMetrics();
    let legacyCalls = 0;
    const outcome = await runWithSingleWriteOwnership({
      marketplaceId: "mercado_livre",
      mode: "V1_PRIMARY",
      fallbackEnabled: true,
      metrics,
      v1Write: async () => {
        throw new Error("P1008 operation timed out");
      },
      legacyWrite: async () => {
        legacyCalls += 1;
        return { productId: "prod-legacy" };
      },
      classify: () => "DB_TRANSIENT",
    });
    assert.equal(outcome.kind, "NO_WRITE");
    assert.equal(legacyCalls, 0, "V1_PRIMARY => sem fallback");
  }

  // --- Fallback desabilitado => SEM fallback ---------------------------------------------
  {
    resetCutoverMetrics();
    let legacyCalls = 0;
    const outcome = await runWithSingleWriteOwnership({
      marketplaceId: "mercado_livre",
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      fallbackEnabled: false,
      metrics,
      v1Write: async () => {
        throw new Error("P1001 connection lost");
      },
      legacyWrite: async () => {
        legacyCalls += 1;
        return { productId: "prod-legacy" };
      },
      classify: () => "DB_TRANSIENT",
    });
    assert.equal(outcome.kind, "NO_WRITE");
    assert.equal(legacyCalls, 0, "fallback off => não assume");
  }

  // --- Modo não-autoritativo => NO_WRITE ------------------------------------------------
  {
    resetCutoverMetrics();
    const outcome = await runWithSingleWriteOwnership({
      marketplaceId: "mercado_livre",
      mode: "LEGACY_ONLY",
      fallbackEnabled: true,
      metrics,
      v1Write: async () => ({ productId: "prod-1" }),
      legacyWrite: async () => ({ productId: "prod-legacy" }),
      classify: () => "UNEXPECTED_V1_FAILURE",
    });
    assert.equal(outcome.kind, "NO_WRITE");
  }

  console.log("cutover/ownership.test.ts PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});