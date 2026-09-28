/**
 * CATALOG_ARCHITECTURE_V1 — PUBLIC SYNC WRITER FLAGS (FASE 9.30).
 *
 * O writer público de marketplace é fail-closed por default e NÃO é
 * liberado por allowlist ampla. Cada marketplace é autorizado
 * explicitamente e com um MODO declarado.
 *
 * MODOS:
 *   OFF         — nunca escreve. Default.
 *   V1_PRIMARY  — escreve pelo caminho canônico V1 (upsert de
 *                 MarketplaceOffer + sincronização de publication gate).
 *
 * Existe `OFF` e `V1_PRIMARY` porque um conector API novo não tem
 * necessidade de fallback legado: o V1 é o caminho primário e suficiente.
 * A porta `OFF` existe para rollback instantâneo de configuração (FASE 9.38)
 * sem tocar em dado nenhum.
 *
 * A allowlist é AUTHORITATIVA e explícita: adicionar uma fonte nova é um
 * ato deliberado, não um efeito colateral. Mercado Livre já é público pelo
 * caminho legado e por isso NÃO aparece aqui — ele não é escrito por este
 * runner, e sua preservação é responsabilidade do caminho existente.
 */

export const PUBLIC_SYNC_WRITER_MODES = ["OFF", "V1_PRIMARY"] as const;
export type PublicSyncWriterMode = (typeof PUBLIC_SYNC_WRITER_MODES)[number];

export type PublicSyncAllowlist = Readonly<
  Record<string, Readonly<{ mode: PublicSyncWriterMode }>>
>;

/**
 * Allowlist AUTORITATIVA de escrita pública. Somente marketplaces
 * explicitamente autorizados aparecem aqui.
 */
export const PUBLIC_SYNC_AUTHORITATIVE_ALLOWLIST: PublicSyncAllowlist = {
  shopee: { mode: "V1_PRIMARY" },
};

export type PublicSyncAuthorization =
  | { authorized: true; mode: "V1_PRIMARY" }
  | { authorized: false; reason: "MARKETPLACE_NOT_IN_ALLOWLIST" | "MODE_OFF" };

/**
 * Decide se um marketplace pode escrever oferta pública.
 *
 * NUNCA deduce permissão a partir de shadow, de publicationWeight ou da
 * existência do conector. Shadow e escrever são eixos independentes:
 * durante os canários a Shopee pode estar SHADOW (peso 0 na leitura pública)
 * e mesmo assim gravar oferta EXACT para observação.
 */
export function authorizePublicSync(
  marketplaceId: string,
  allowlist: PublicSyncAllowlist = PUBLIC_SYNC_AUTHORITATIVE_ALLOWLIST,
): PublicSyncAuthorization {
  const entry = allowlist[marketplaceId];
  if (entry === undefined) {
    return { authorized: false, reason: "MARKETPLACE_NOT_IN_ALLOWLIST" };
  }
  if (entry.mode === "OFF") {
    return { authorized: false, reason: "MODE_OFF" };
  }
  return { authorized: true, mode: entry.mode };
}

/** true quando o marketplace pode escrever oferta pública. */
export function isPublicSyncAuthorized(
  marketplaceId: string,
  allowlist?: PublicSyncAllowlist,
): boolean {
  return authorizePublicSync(marketplaceId, allowlist).authorized;
}

/**
 * Allowlist de marketplaces cujo SYNC AUTOMÁTICO pode ser disparado por
 * endpoint/cron (FASE 9.22). Deliberadamente mais estreita que a de escrita:
 * expor "disparar coleta de qualquer marketplace da internet" seria um
 * amplificador de custo e um vetor de coleta arbitrária.
 */
export const PUBLIC_SYNC_CRON_ALLOWLIST: ReadonlySet<string> = new Set([
  "shopee",
]);

/** true quando o cron pode disparar sync deste marketplace. */
export function isCronSyncAllowed(marketplaceId: string): boolean {
  return PUBLIC_SYNC_CRON_ALLOWLIST.has(marketplaceId);
}
