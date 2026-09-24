/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW FLAGS TESTS.
 *
 * Fail-closed por construção: tudo OFF, allowlist vazia, maxWrites 0,
 * DRY_RUN default true. Verifica o parsing explícito (ex.: DRY_RUN=false).
 */
import assert from "node:assert/strict";
import {
  DEFAULT_SHADOW_FLAGS,
  isShadowActiveForMarketplace,
  maskShadowFlags,
  readShadowFlags,
  SHADOW_MAX_WRITES_LIMIT,
} from "./flags";

// --- Defaults fail-closed ------------------------------------------------
{
  const flags = readShadowFlags({});
  assert.equal(flags.enabled, false, "flag ausente => OFF");
  assert.deepEqual(flags.marketplaceIds, [], "allowlist vazia");
  assert.equal(flags.maxWrites, 0, "maxWrites default 0");
  assert.equal(flags.persistRaw, false);
  assert.equal(flags.persistHashes, false);
  assert.equal(flags.dryRun, true, "DRY_RUN default true (nenhuma escrita)");
}

// --- Allowlist ------------------------------------------------------------
{
  const flags = readShadowFlags({
    ARCHITECTURE_V1_SHADOW_ENABLED: "true",
    ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS:
      " mercado_livre , Amazon ,mercado_livre,",
  });
  assert.deepEqual(
    flags.marketplaceIds,
    ["mercado_livre", "amazon"],
    "allowlist normalizada (trim + lowercase + dedup)",
  );
  assert.equal(
    isShadowActiveForMarketplace(flags, "mercado_livre"),
    true,
  );
  assert.equal(
    isShadowActiveForMarketplace(flags, "shopee"),
    false,
    "fora da allowlist => inativo",
  );
}

// --- Flag OFF bloqueia mesmo com allowlist --------------------------------
{
  const flags = readShadowFlags({
    ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS: "mercado_livre",
  });
  assert.equal(flags.enabled, false);
  assert.equal(
    isShadowActiveForMarketplace(flags, "mercado_livre"),
    false,
    "enabled=false é fail-closed mesmo com allowlist preenchida",
  );
}

// --- maxWrites: clamp dentro dos limites canário --------------------------
{
  const flags = readShadowFlags({
    ARCHITECTURE_V1_SHADOW_MAX_WRITES: "500",
  });
  assert.equal(
    flags.maxWrites,
    SHADOW_MAX_WRITES_LIMIT,
    "maxWrites acima do limite é clampeado para 100",
  );
  const negative = readShadowFlags({
    ARCHITECTURE_V1_SHADOW_MAX_WRITES: "-3",
  });
  assert.equal(negative.maxWrites, 0, "maxWrites negativo => 0");
  const garbage = readShadowFlags({
    ARCHITECTURE_V1_SHADOW_MAX_WRITES: "abc",
  });
  assert.equal(garbage.maxWrites, 0, "maxWrites não numérico => 0");
}

// --- DRY_RUN explícito ------------------------------------------------------
{
  const explicitDry = readShadowFlags({
    ARCHITECTURE_V1_SHADOW_DRY_RUN: "true",
  });
  assert.equal(explicitDry.dryRun, true, "DRY_RUN=true => dry-run");

  const explicitReal = readShadowFlags({
    ARCHITECTURE_V1_SHADOW_DRY_RUN: "false",
  });
  assert.equal(
    explicitReal.dryRun,
    false,
    "DRY_RUN=false explicitamente => escrita real permitida (gate por persist/maxWrites)",
  );

  const zeroReal = readShadowFlags({
    ARCHITECTURE_V1_SHADOW_DRY_RUN: "0",
  });
  assert.equal(zeroReal.dryRun, false, "DRY_RUN=0 => escrita real");
}

// --- truthy booleans padrão ------------------------------------------------
{
  for (const value of ["1", "true", "yes", "TRUE", "Yes "]) {
    const flags = readShadowFlags({
      ARCHITECTURE_V1_SHADOW_ENABLED: value,
    });
    assert.equal(flags.enabled, true, `enabled deve ser true para "${value}"`);
  }
  for (const value of ["0", "false", "no", "", undefined]) {
    const flags = readShadowFlags({
      ARCHITECTURE_V1_SHADOW_ENABLED: value,
    });
    assert.equal(flags.enabled, false, `enabled deve ser false para "${value}"`);
  }
}

// --- mask nunca expõe nada além do enablement/limites -----------------------
{
  const flags = DEFAULT_SHADOW_FLAGS;
  const masked = maskShadowFlags(flags);
  assert.deepEqual(masked, flags, "máscara preserva shape (sem secrets)");
}

console.log("shadow/flags.test.ts PASS");