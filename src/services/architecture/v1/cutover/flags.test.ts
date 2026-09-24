/**
 * CATALOG_ARCHITECTURE_V1 — CUTOVER FLAGS TESTS (FASE C).
 *
 * Flags fail-closed: default OFF/vazio, fallback legado default ON,
 * MAX_WRITES clampeado na progressão, WRITE_BUDGET_SCOPE obrigatório
 * PROCESS_LOCAL, e cutover global sempre negado.
 */
import assert from "node:assert/strict";
import {
  CUTOVER_MAX_WRITES_LIMIT,
  DEFAULT_AUTHORITATIVE_FLAGS,
  applyConfigOnlyRollback,
  isGlobalCutoverRequested,
  readAuthoritativeFlags,
} from "./flags";

async function main(): Promise<void> {
  // --- Defaults fail-closed ------------------------------------------------------
  {
    const flags = readAuthoritativeFlags({});
    assert.equal(flags.enabled, false, "enabled default OFF");
    assert.deepEqual(flags.marketplaceIds, [], "marketplace ids default vazio");
    assert.equal(flags.legacyFallbackEnabled, true, "fallback legado default ON");
    assert.equal(flags.maxWrites, 0, "maxWrites default 0");
    assert.equal(flags.writeBudgetScope, "PROCESS_LOCAL");
    assert.deepEqual(flags, DEFAULT_AUTHORITATIVE_FLAGS);
  }

  // --- Habilitado + allowlist + orçamento ----------------------------------------
  {
    const flags = readAuthoritativeFlags({
      ARCHITECTURE_V1_AUTHORITATIVE_ENABLED: "1",
      ARCHITECTURE_V1_AUTHORITATIVE_MARKETPLACE_IDS:
        " mercado_livre, AMAZON ,mercado_livre ",
      ARCHITECTURE_V1_CUTOVER_MAX_WRITES: "5",
      ARCHITECTURE_V1_LEGACY_FALLBACK_ENABLED: "ON",
      WRITE_BUDGET_SCOPE: "PROCESS_LOCAL",
    } as Record<string, string>);
    assert.equal(flags.enabled, true);
    assert.deepEqual(
      flags.marketplaceIds,
      ["mercado_livre", "amazon"],
      "normaliza + deduplica lowercase",
    );
    assert.equal(flags.maxWrites, 5);
  }

  // --- maxWrites: clampeado e >0 exigido ------------------------------------------
  {
    const flags = readAuthoritativeFlags({
      ARCHITECTURE_V1_CUTOVER_MAX_WRITES: "99999",
    } as Record<string, string>);
    assert.equal(flags.maxWrites, CUTOVER_MAX_WRITES_LIMIT, "clamp no limite");
  }
  {
    const flags = readAuthoritativeFlags({
      ARCHITECTURE_V1_CUTOVER_MAX_WRITES: "-3",
    } as Record<string, string>);
    assert.equal(flags.maxWrites, 0, "clamp para 0 (fail-closed)");
  }
  {
    const flags = readAuthoritativeFlags({
      ARCHITECTURE_V1_CUTOVER_MAX_WRITES: "abc",
    } as Record<string, string>);
    assert.equal(flags.maxWrites, 0, "valor inválido => 0 (fail-closed)");
  }

  // --- WRITE_BUDGET_SCOPE: só PROCESS_LOCAL ---------------------------------------
  {
    const flags = readAuthoritativeFlags({
      WRITE_BUDGET_SCOPE: "SHARED",
    } as Record<string, string>);
    assert.equal(
      flags.writeBudgetScope,
      "PROCESS_LOCAL",
      "escopo não-PROCESS_LOCAL é negado (fail-closed)",
    );
  }

  // --- Cutover global: sempre proibido --------------------------------------------
  {
    assert.equal(isGlobalCutoverRequested({}), false);
    assert.equal(
      isGlobalCutoverRequested({ CATALOG_V1_GLOBAL_CUTOVER: "NO" }),
      false,
    );
    assert.equal(
      isGlobalCutoverRequested({ CATALOG_V1_GLOBAL_CUTOVER: "YES" }),
      true,
      "alguém tentou ligar global => detectado para negar",
    );
  }

  // --- Rollback config-only (FASE P) ----------------------------------------------
  {
    const rollback = applyConfigOnlyRollback("PUBLICATION_VIOLATION");
    assert.equal(rollback.reason, "PUBLICATION_VIOLATION");
    assert.equal(rollback.flags.enabled, false, "flags voltam para OFF");
    assert.deepEqual(rollback.flags.marketplaceIds, []);
    assert.equal(rollback.flags.maxWrites, 0);
    assert.equal(
      rollback.flags.legacyFallbackEnabled,
      true,
      "rollback preserva fallback legado (FASE W: não remove)",
    );
  }

  console.log("cutover/flags.test.ts PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});