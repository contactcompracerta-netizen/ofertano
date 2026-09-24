/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW FLAGS (FASE 5 — SHADOW REAL CONTROLADO).
 *
 * Fail-closed por construção:
 *  - Nada entra sem `ARCHITECTURE_V1_SHADOW_ENABLED=true`.
 *  - Allowlist vazia (`_MARKETPLACE_IDS`) = nenhum marketplace processado.
 *  - `maxWrites` default 0 (nenhuma escrita real); canário progressivo
 *    1 -> 5 -> 25 -> 100 por execução controlada.
 *  - `dryRun` default true: a shadow NUNCA escreve sem flag explícita.
 *
 * A shadow JAMAIS publica produto, não altera Product/MarketplaceOffer e
 * não desliga o caminho legado. Ela observa, reprocessa e mede paridade.
 */

export const SHADOW_MAX_WRITES_PROGRESSION = [1, 5, 25, 100] as const;
export const SHADOW_MAX_WRITES_LIMIT = 100;
export const SHADOW_DEFAULT_MAX_WRITES = 0;

export type ShadowFlags = {
  /** Interruptor global da shadow (fail-closed). */
  enabled: boolean;
  /** Allowlist de marketplaceIds canônicos (lowercase_snake). Vazio = nada entra. */
  marketplaceIds: string[];
  /** Teto de escritas REAIS (RAW/hashes) por execução. 0 = nenhuma. */
  maxWrites: number;
  /** Persiste o payload bruto (aditivo; nunca sobrescreve payload legado). */
  persistRaw: boolean;
  /** Persiste catalogHash/offerHash calculados no fluxo real. */
  persistHashes: boolean;
  /** DRY-RUN: processa e mede sem nenhuma escrita. Default true. */
  dryRun: boolean;
};

export const DEFAULT_SHADOW_FLAGS: ShadowFlags = {
  enabled: false,
  marketplaceIds: [],
  maxWrites: SHADOW_DEFAULT_MAX_WRITES,
  persistRaw: false,
  persistHashes: false,
  dryRun: true,
};

function truthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function clampMaxWrites(value: string | undefined): number {
  const raw = value?.trim() ?? "";
  if (raw === "") {
    return SHADOW_DEFAULT_MAX_WRITES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return SHADOW_DEFAULT_MAX_WRITES;
  }
  return Math.min(Math.max(parsed, 0), SHADOW_MAX_WRITES_LIMIT);
}

function parseMarketplaceIds(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/** Lê as flags da shadow do ambiente. Sempre fail-closed. */
export function readShadowFlags(
  env: Record<string, string | undefined> = process.env,
): ShadowFlags {
  return {
    enabled: truthy(env.ARCHITECTURE_V1_SHADOW_ENABLED),
    marketplaceIds: parseMarketplaceIds(
      env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS,
    ),
    maxWrites: clampMaxWrites(env.ARCHITECTURE_V1_SHADOW_MAX_WRITES),
    persistRaw: truthy(env.ARCHITECTURE_V1_SHADOW_PERSIST_RAW),
    persistHashes: truthy(env.ARCHITECTURE_V1_SHADOW_PERSIST_HASHES),
    /*
     * DRY-RUN default true (fail-closed: nenhuma escrita sem flag explícita).
     * Valor ausente/vazio => true. "false"/"0"/"no" explicitamente => escrita
     * real permitida (ainda gated por persistRaw/persistHashes/maxWrites).
     */
    dryRun: env.ARCHITECTURE_V1_SHADOW_DRY_RUN == null ||
      env.ARCHITECTURE_V1_SHADOW_DRY_RUN.trim() === ""
      ? true
      : truthy(env.ARCHITECTURE_V1_SHADOW_DRY_RUN),
  };
}

/**
 * A shadow está ativa para um marketplace específico?
 * Fail-closed: flag OFF ou marketplace fora da allowlist => false.
 */
export function isShadowActiveForMarketplace(
  flags: ShadowFlags,
  marketplaceId: string,
): boolean {
  if (!flags.enabled) {
    return false;
  }
  return flags.marketplaceIds.includes(marketplaceId);
}

/**
 * Máscara segura das flags para relatórios/logs (nunca expõe o ambiente).
 * Apenas o enablement, a allowlist e limites — sem valores secretos.
 */
export function maskShadowFlags(flags: ShadowFlags) {
  return {
    enabled: flags.enabled,
    marketplaceIds: flags.marketplaceIds,
    maxWrites: flags.maxWrites,
    persistRaw: flags.persistRaw,
    persistHashes: flags.persistHashes,
    dryRun: flags.dryRun,
  };
}