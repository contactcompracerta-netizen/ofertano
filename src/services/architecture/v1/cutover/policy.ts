/**
 * CATALOG_ARCHITECTURE_V1 — CATALOG WRITER MODE POLICY (FASE B).
 *
 * Define o modo de escrita do catálogo POR MARKETPLACE:
 *
 *   SHADOW                          — observa, nunca escreve catálogo.
 *   V1_PRIMARY_WITH_LEGACY_FALLBACK — V1 é o writer primário; em falha
 *                                     pré-commit transient pode cair
 *                                     para o writer legado (1 write).
 *   V1_PRIMARY                      — V1 é o writer único; sem fallback.
 *   LEGACY_ONLY                     — escritor legado comanda (default).
 *
 * Regras:
 *   - A resolução é SEMPRE config-driven (registry por marketplaceId).
 *   - NUNCA hardcodar `marketplace === "mercado_livre"` aqui: o core
 *     é agnóstico; nomes só existem em configuração.
 *   - Config ausente => LEGACY_ONLY (fail-closed).
 *   - Cutover GLOBAL é proibido (CATALOG_V1_GLOBAL_CUTOVER=NO).
 */

export type CatalogWriterMode =
  | "SHADOW"
  | "V1_PRIMARY_WITH_LEGACY_FALLBACK"
  | "V1_PRIMARY"
  | "LEGACY_ONLY";

export const CATALOG_WRITER_MODES: readonly CatalogWriterMode[] = [
  "SHADOW",
  "V1_PRIMARY_WITH_LEGACY_FALLBACK",
  "V1_PRIMARY",
  "LEGACY_ONLY",
];

export const DEFAULT_WRITER_MODE: CatalogWriterMode = "LEGACY_ONLY";

export type CatalogWriterPolicy = {
  /** Registry de modos keyed por marketplaceId. */
  modes: Readonly<Record<string, CatalogWriterMode>>;
};

export const DEFAULT_CATALOG_WRITER_POLICY: CatalogWriterPolicy = {
  modes: {},
};

function parseWriterMode(value: string | undefined): CatalogWriterMode | null {
  const normalized = value?.trim().toUpperCase() as CatalogWriterMode;
  if (CATALOG_WRITER_MODES.includes(normalized)) {
    return normalized;
  }
  return null;
}

/**
 * Constrói a política a partir de env vars.
 *
 * Formato suportado (config-driven, agnóstico):
 *   CATALOG_V1_WRITER_MODE_<MARKETPLACE_ID_UPPER>=V1_PRIMARY_WITH_LEGACY_FALLBACK
 * Ex.: CATALOG_V1_WRITER_MODE_MERCADO_LIVRE=V1_PRIMARY_WITH_LEGACY_FALLBACK
 *
 * Qualquer modo inválido é ignorado (fail-closed => LEGACY_ONLY para aquele
 * marketplace). Nunca há fallback implícito para V1 em marketplace sem
 * configuração.
 */
export function readCatalogWriterPolicy(
  env: Record<string, string | undefined> = process.env,
): CatalogWriterPolicy {
  const modes: Record<string, CatalogWriterMode> = {};
  for (const [key, value] of Object.entries(env)) {
    const prefix = "CATALOG_V1_WRITER_MODE_";
    if (!key.startsWith(prefix)) {
      continue;
    }
    const marketplaceId = key
      .slice(prefix.length)
      .trim()
      .toLowerCase();
    const mode = parseWriterMode(value);
    if (marketplaceId && mode) {
      modes[marketplaceId] = mode;
    }
  }
  return { modes };
}

/**
 * Resolve o modo de escrita para um marketplaceId.
 *
 * Fail-closed: marketplace sem configuração => LEGACY_ONLY. Cutover global
 * (flag CATALOG_V1_GLOBAL_CUTOVER=YES) é negado pelo chamador; aqui a
 * política NUNCA representa global cutover.
 */
export function resolveCatalogWriterMode(
  policy: CatalogWriterPolicy,
  marketplaceId: string,
): CatalogWriterMode {
  return policy.modes[marketplaceId] ?? DEFAULT_WRITER_MODE;
}

export function isV1AuthoritativeMode(mode: CatalogWriterMode): boolean {
  return (
    mode === "V1_PRIMARY" || mode === "V1_PRIMARY_WITH_LEGACY_FALLBACK"
  );
}

export function allowsLegacyFallback(mode: CatalogWriterMode): boolean {
  return mode === "V1_PRIMARY_WITH_LEGACY_FALLBACK";
}

export function describeWriterMode(mode: CatalogWriterMode): string {
  switch (mode) {
    case "SHADOW":
      return "shadow (observa; nunca escreve catálogo)";
    case "V1_PRIMARY_WITH_LEGACY_FALLBACK":
      return "v1-primary + fallback controlado p/ legado";
    case "V1_PRIMARY":
      return "v1-primary (sem fallback)";
    case "LEGACY_ONLY":
      return "legacy-only (writer legado autoritativo)";
  }
}