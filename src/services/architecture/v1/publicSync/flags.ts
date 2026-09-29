/**
 * CATALOG_ARCHITECTURE_V1 — PUBLIC SYNC WRITER FLAGS (FASE 9.30 / FASE 19 / FASE 10 RUNTIME GATE).
 *
 * O writer público de marketplace é fail-closed por default e NÃO é
 * liberado por allowlist ampla. Cada marketplace é autorizado
 * explicitamente e com um MODO declarado.
 *
 * MODOS:
 *   OFF                          — nunca escreve. Default.
 *   V1_PRIMARY                   — escreve pelo caminho canônico V1 (upsert de
 *                                  MarketplaceOffer + sincronização de publication gate).
 *   V1_PRIMARY_WITH_LEGACY_FALLBACK — V1 é owner primário; em erro elegível
 *                                  (pre-commit) o legado pode escrever.
 *                                  NUNCA dual-write no mesmo item.
 *
 * ARQUITETURA DE AUTORIZAÇÃO (FASE 10):
 *   1. STATIC SUPPORTED SOURCES: lista de marketplaces que TÊM conector V1
 *      e podem potencialmente usar o public sync. Isso é código estático.
 *   2. RUNTIME MODE: variável de ambiente por marketplace que DECLARA o modo
 *      de operação REAL. Default OFF para marketplaces novos; compatível com
 *      Shopee existente (default = modo estático se não houver env).
 *   3. AUTORIZAÇÃO FINAL: source supported AND runtime mode != OFF.
 *
 * Isso permite:
 *   - Deploy com código Magalu presente mas mode OFF (sem escrita acidental)
 *   - Canários progressivos via override de runtime
 *   - Rollback instantâneo só de config (mode = OFF)
 *   - Shopee continua operando sem mudança breaking
 */

export const PUBLIC_SYNC_WRITER_MODES = ["OFF", "V1_PRIMARY", "V1_PRIMARY_WITH_LEGACY_FALLBACK"] as const;
export type PublicSyncWriterMode = (typeof PUBLIC_SYNC_WRITER_MODES)[number];

export type PublicSyncAllowlist = Readonly<
  Record<string, Readonly<{ mode: PublicSyncWriterMode }>>
>;

/**
 * Lista estática de marketplaces SUPORTADOS pelo public sync V1.
 * Ter conector não é suficiente: precisa estar aqui para ser elegível a runtime mode.
 * Mercado Livre NÃO está aqui — usa writer legado.
 */
export const PUBLIC_SYNC_SUPPORTED_SOURCES: PublicSyncAllowlist = {
  shopee: { mode: "V1_PRIMARY" },
  magazine_luiza: { mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK" },
  amazon: { mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK" },
} as const;

/**
 * Resolve o modo de runtime para um marketplace a partir de variável de ambiente.
 *
 * Convenção: PUBLIC_SYNC_MODE_<MARKETPLACE_ID_UPPER_SNAKE>
 *   ex.: PUBLIC_SYNC_MODE_MAGAZINE_LUIZA, PUBLIC_SYNC_MODE_SHOPEE
 *
 * Regras:
 *   - Se env var presente e válida: usa ela (fail-closed: inválido = OFF)
 *   - Se env var AUSENTE:
 *       * Para marketplaces NOVOS (Magalu): default OFF
 *       * Para marketplaces LEGADOS já operando (Shopee): default = modo estático
 *         Isso preserva compatibilidade sem breaking change.
 */
function resolveRuntimeMode(
  marketplaceId: string,
  staticMode: PublicSyncWriterMode,
  env: Record<string, string | undefined> = process.env,
): PublicSyncWriterMode {
  const envKey = `PUBLIC_SYNC_MODE_${marketplaceId.toUpperCase()}`;
  const envValue = env[envKey]?.trim().toUpperCase();

  if (envValue !== undefined && envValue !== "") {
    // Env explícita presente: validar contra modos permitidos
    if (PUBLIC_SYNC_WRITER_MODES.includes(envValue as PublicSyncWriterMode)) {
      return envValue as PublicSyncWriterMode;
    }
    // Valor inválido -> fail-closed OFF
    return "OFF";
  }

  // Env ausente: default dependendo do marketplace
  // Magalu (novo) -> OFF; Shopee (legado) -> modo estático
  const isLegacyOperating = marketplaceId === "shopee";
  return isLegacyOperating ? staticMode : "OFF";
}

export type PublicSyncAuthorization =
  | { authorized: true; mode: "V1_PRIMARY" | "V1_PRIMARY_WITH_LEGACY_FALLBACK"; source: "STATIC" | "RUNTIME" }
  | { authorized: false; reason: "MARKETPLACE_NOT_IN_ALLOWLIST" | "MODE_OFF" | "RUNTIME_MODE_OFF" };

/**
 * Decide se um marketplace pode escrever oferta pública.
 *
 * Combina: source supported (estático) + runtime mode (ambiente).
 * Fail-closed em todos os níveis.
 *
 * Quando `allowlist` é omitido (usa default PUBLIC_SYNC_SUPPORTED_SOURCES):
 *   - Aplica runtime mode resolution via env vars
 *   - Magalu default OFF, Shopee default = static mode
 *
 * Quando `allowlist` é PASSADO EXPLICITAMENTE (teste/override):
 *   - Trata como override estático: usa o mode da allowlist diretamente
 *   - Não consulta env vars
 *   - Permite rollback instantâneo via allowlist override (ex.: mode: "OFF")
 */
export function authorizePublicSync(
  marketplaceId: string,
  allowlist: PublicSyncAllowlist = PUBLIC_SYNC_SUPPORTED_SOURCES,
  env: Record<string, string | undefined> = process.env,
): PublicSyncAuthorization {
  const staticEntry = allowlist[marketplaceId];
  if (staticEntry === undefined) {
    return { authorized: false, reason: "MARKETPLACE_NOT_IN_ALLOWLIST" };
  }

  // Detectar se está usando a allowlist default ou uma custom
  const isDefaultAllowlist = allowlist === PUBLIC_SYNC_SUPPORTED_SOURCES;

  let runtimeMode: PublicSyncWriterMode;
  if (isDefaultAllowlist) {
    // Default allowlist: aplica runtime mode resolution
    runtimeMode = resolveRuntimeMode(marketplaceId, staticEntry.mode, env);
  } else {
    // Allowlist custom (teste/override): usa modo estático diretamente
    runtimeMode = staticEntry.mode;
  }

  if (runtimeMode === "OFF") {
    return { authorized: false, reason: isDefaultAllowlist ? "RUNTIME_MODE_OFF" : "MODE_OFF" };
  }

  return { authorized: true, mode: runtimeMode, source: isDefaultAllowlist ? "RUNTIME" : "STATIC" };
}

/** true quando o marketplace pode escrever oferta pública. */
export function isPublicSyncAuthorized(
  marketplaceId: string,
  allowlist?: PublicSyncAllowlist,
  env?: Record<string, string | undefined>,
): boolean {
  return authorizePublicSync(marketplaceId, allowlist, env).authorized;
}

/**
 * Allowlist de marketplaces cujo SYNC AUTOMÁTICO pode ser disparado por
 * endpoint/cron (FASE 9.22). Deliberadamente mais estreita que a de escrita:
 * expor "disparar coleta de qualquer marketplace da internet" seria um
 * amplificador de custo e um vetor de coleta arbitrária.
 *
 * O cron PODE disparar mesmo com runtime mode OFF — o runner verificará
 * autorização de escrita e fará zero writes. Isso evita editar vercel.json
 * entre canários e produção.
 */
export const PUBLIC_SYNC_CRON_ALLOWLIST: ReadonlySet<string> = new Set([
  "shopee",
  "magazine_luiza",
  "amazon",
]);

/** true quando o cron pode disparar sync deste marketplace. */
export function isCronSyncAllowed(marketplaceId: string): boolean {
  return PUBLIC_SYNC_CRON_ALLOWLIST.has(marketplaceId);
}

/**
 * Helper para diagnóstico: retorna o modo efetivo (estático + runtime) sem expor segredos.
 */
export function getEffectiveMode(marketplaceId: string, env: Record<string, string | undefined> = process.env): {
  supported: boolean;
  staticMode: PublicSyncWriterMode | null;
  runtimeMode: PublicSyncWriterMode;
  authorized: boolean;
} {
  const staticEntry = PUBLIC_SYNC_SUPPORTED_SOURCES[marketplaceId];
  if (!staticEntry) {
    return { supported: false, staticMode: null, runtimeMode: "OFF", authorized: false };
  }
  const runtimeMode = resolveRuntimeMode(marketplaceId, staticEntry.mode, env);
  return {
    supported: true,
    staticMode: staticEntry.mode,
    runtimeMode,
    authorized: runtimeMode !== "OFF",
  };
}
