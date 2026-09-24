/**
 * CATALOG_ARCHITECTURE_V1 — CUTOVER AUTHORITATIVE FLAGS (FASE C).
 *
 * Flags fail-closed do cutover progressivo V1 -> writer autoritativo.
 *
 * Invariante: TODA flag tem default OFF/zero. Sem flag explícita, o
 * mercado fica LEGACY_ONLY e NENHUM write é emitido pelo V1.
 *
 * Envs:
 *   ARCHITECTURE_V1_AUTHORITATIVE_ENABLED             (default 0)
 *   ARCHITECTURE_V1_AUTHORITATIVE_MARKETPLACE_IDS     (default vazio)
 *   ARCHITECTURE_V1_LEGACY_FALLBACK_ENABLED           (default ON)
 *   ARCHITECTURE_V1_CUTOVER_MAX_WRITES                (default 0)
 *   WRITE_BUDGET_SCOPE                                (PROCESS_LOCAL)
 *   CATALOG_V1_GLOBAL_CUTOVER                         (default NO)
 */

export const CUTOVER_DEFAULT_MAX_WRITES = 0;
export const CUTOVER_MAX_WRITES_LIMIT = 100;
export const CUTOVER_MAX_WRITES_PROGRESSION = [1, 5, 25, 100] as const;

export type WriteBudgetScope = "PROCESS_LOCAL";

export type AuthoritativeFlags = {
  enabled: boolean;
  marketplaceIds: string[];
  legacyFallbackEnabled: boolean;
  maxWrites: number;
  writeBudgetScope: WriteBudgetScope;
};

export const DEFAULT_AUTHORITATIVE_FLAGS: AuthoritativeFlags = {
  enabled: false,
  marketplaceIds: [],
  legacyFallbackEnabled: true,
  maxWrites: CUTOVER_DEFAULT_MAX_WRITES,
  writeBudgetScope: "PROCESS_LOCAL",
};

function truthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
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

function clampMaxWrites(value: string | undefined): number {
  const raw = value?.trim() ?? "";
  if (raw === "") {
    return CUTOVER_DEFAULT_MAX_WRITES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return CUTOVER_DEFAULT_MAX_WRITES;
  }
  return Math.min(Math.max(parsed, 0), CUTOVER_MAX_WRITES_LIMIT);
}

function resolveWriteBudgetScope(
  value: string | undefined,
): WriteBudgetScope {
  const normalized = value?.trim().toUpperCase();
  /*
   * Fail-closed: qualquer escopo que NÃO seja PROCESS_LOCAL é negado.
   * O cutover progressivo proíbe orçamentos compartilhados/globais
   * (não existe orçamento de escrita entre processos no V1).
   */
  if (normalized !== "PROCESS_LOCAL") {
    return "PROCESS_LOCAL";
  }
  return "PROCESS_LOCAL";
}

/** Lê as flags do cutover. Sempre fail-closed. */
export function readAuthoritativeFlags(
  env: Record<string, string | undefined> = process.env,
): AuthoritativeFlags {
  return {
    enabled: truthy(env.ARCHITECTURE_V1_AUTHORITATIVE_ENABLED),
    marketplaceIds: parseMarketplaceIds(
      env.ARCHITECTURE_V1_AUTHORITATIVE_MARKETPLACE_IDS,
    ),
    legacyFallbackEnabled: truthy(
      env.ARCHITECTURE_V1_LEGACY_FALLBACK_ENABLED ?? "1",
    ),
    maxWrites: clampMaxWrites(env.ARCHITECTURE_V1_CUTOVER_MAX_WRITES),
    writeBudgetScope: resolveWriteBudgetScope(env.WRITE_BUDGET_SCOPE),
  };
}

/**
 * Cutover global é PROIBIDO. Se alguém tentar ligar
 * CATALOG_V1_GLOBAL_CUTOVER=YES, a política deve falhar fechada
 * (NUNCA ativar todos os marketplaces de uma vez).
 */
export function isGlobalCutoverRequested(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return truthy(env.CATALOG_V1_GLOBAL_CUTOVER);
}

/**
 * Rollback CONFIG-ONLY (FASE P): desliga as flags autoritativas e
 * mantém o motivo registrado para observabilidade. Nenhum dado é
 * alterado; a próxima resolução de modo volta para LEGACY_ONLY.
 */
export function applyConfigOnlyRollback(
  reason: string,
): { flags: AuthoritativeFlags; reason: string } {
  return {
    flags: {
      ...DEFAULT_AUTHORITATIVE_FLAGS,
      legacyFallbackEnabled: true,
    },
    reason,
  };
}