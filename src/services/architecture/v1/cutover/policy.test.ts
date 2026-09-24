/**
 * CATALOG_ARCHITECTURE_V1 — CUTOVER WRITER MODE POLICY TESTS (FASE B).
 *
 * Modos por marketplaceId (config-driven), marketplace-agnostic
 * (MARKET_A / MARKET_B / MARKET_C), config ausente => LEGACY_ONLY,
 * modo inválido ignorado, cutover global nunca representado.
 */
import assert from "node:assert/strict";
import {
  DEFAULT_WRITER_MODE,
  allowsLegacyFallback,
  describeWriterMode,
  isV1AuthoritativeMode,
  readCatalogWriterPolicy,
  resolveCatalogWriterMode,
} from "./policy";

async function main(): Promise<void> {
  // --- Empty policy => LEGACY_ONLY (fail-closed) -----------------------------------
  {
    const policy = readCatalogWriterPolicy({});
    assert.deepEqual(policy.modes, {});
    for (const marketplaceId of ["mercado_livre", "amazon", "market_a"]) {
      assert.equal(
        resolveCatalogWriterMode(policy, marketplaceId),
        DEFAULT_WRITER_MODE,
        "config ausente => LEGACY_ONLY",
      );
      assert.equal(resolveCatalogWriterMode(policy, marketplaceId), "LEGACY_ONLY");
    }
  }

  // --- Config-driven por marketplace (marketplaceId canônico) ----------------------
  {
    const policy = readCatalogWriterPolicy({
      CATALOG_V1_WRITER_MODE_MERCADO_LIVRE: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      CATALOG_V1_WRITER_MODE_AMAZON: "SHADOW",
      CATALOG_V1_WRITER_MODE_MARKET_C: "V1_PRIMARY",
    } as Record<string, string>);
    assert.equal(
      resolveCatalogWriterMode(policy, "mercado_livre"),
      "V1_PRIMARY_WITH_LEGACY_FALLBACK",
    );
    assert.equal(resolveCatalogWriterMode(policy, "amazon"), "SHADOW");
    assert.equal(resolveCatalogWriterMode(policy, "market_c"), "V1_PRIMARY");
    assert.equal(
      resolveCatalogWriterMode(policy, "market_b"),
      "LEGACY_ONLY",
      "market B sem config => LEGACY_ONLY",
    );
  }

  // --- Marketplace-agnostic: MARKET_A/MARKET_B/MARKET_C nunca hardcoded ------------
  {
    const policy = readCatalogWriterPolicy({
      CATALOG_V1_WRITER_MODE_MARKET_A: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      CATALOG_V1_WRITER_MODE_MARKET_B: "V1_PRIMARY",
    } as Record<string, string>);
    assert.equal(
      resolveCatalogWriterMode(policy, "market_a"),
      "V1_PRIMARY_WITH_LEGACY_FALLBACK",
    );
    assert.equal(resolveCatalogWriterMode(policy, "market_b"), "V1_PRIMARY");
    assert.equal(resolveCatalogWriterMode(policy, "market_c"), "LEGACY_ONLY");
  }

  // --- Modo inválido ignorado => LEGACY_ONLY ---------------------------------------
  {
    const policy = readCatalogWriterPolicy({
      CATALOG_V1_WRITER_MODE_MERCADO_LIVRE: "V1_GLOBAL_AUTHORITATIVE",
    } as Record<string, string>);
    assert.deepEqual(policy.modes, {}, "modo inválido nunca entra no policy");
    assert.equal(resolveCatalogWriterMode(policy, "mercado_livre"), "LEGACY_ONLY");
  }

  // --- isV1AuthoritativeMode / allowsLegacyFallback --------------------------------
  {
    assert.equal(isV1AuthoritativeMode("V1_PRIMARY"), true);
    assert.equal(isV1AuthoritativeMode("V1_PRIMARY_WITH_LEGACY_FALLBACK"), true);
    assert.equal(isV1AuthoritativeMode("SHADOW"), false);
    assert.equal(isV1AuthoritativeMode("LEGACY_ONLY"), false);
    assert.equal(allowsLegacyFallback("V1_PRIMARY_WITH_LEGACY_FALLBACK"), true);
    assert.equal(allowsLegacyFallback("V1_PRIMARY"), false);
    assert.equal(allowsLegacyFallback("LEGACY_ONLY"), false);
    assert.ok(describeWriterMode("V1_PRIMARY_WITH_LEGACY_FALLBACK").includes("fallback"));
    assert.ok(describeWriterMode("LEGACY_ONLY").includes("legacy-only"));
  }

  console.log("cutover/policy.test.ts PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});