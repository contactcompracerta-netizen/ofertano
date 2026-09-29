/**
 * CATALOG V1 — STATUS DE ROLLOUT POR MARKETPLACE (fonte única de verdade).
 *
 * POR QUE ESTE MÓDULO EXISTE
 *
 * "Quantos marketplaces estão no Catalog V1?" tem TRÊS respostas diferentes e
 * Historically elas foram confundidas numa só, o que produziu um número
 * inflado: dizer "5 marketplaces públicos" quando só 2 têm oferta publicada.
 *
 * As três contagens:
 *
 *   V1_INTEGRATED_MARKETPLACES
 *       Existe conector V1, config de public sync, teste de contrato e
 *       runtime default OFF. É integração de código. Não implica publicação.
 *
 *   WRITER_ENABLED_MARKETPLACES
 *       `PUBLIC_SYNC_MODE_*` resolve para um modo diferente de OFF. É
 *       permissão de escrita — ainda não é escrita.
 *
 *   MARKETPLACES_WITH_PUBLIC_OFFERS
 *       Existem ofertas DE FATO publicadas e ativas no banco. É o único número
 *       que representa valor para o usuário.
 *
 * O número público é o último. Contar "integrado" como "público" é
 * autoinflação: por construção ela nunca diminui quando uma fonte fica
 * bloqueada (Amazon e AliExpress: integrados, sem oferta).
 */
import { MARKETPLACE_REGISTRY_V1 } from "./marketplaceRegistry";
import {
  PUBLIC_SYNC_SUPPORTED_SOURCES,
  getEffectiveMode,
  type PublicSyncAllowlist,
} from "./publicSync/flags";

/** Marketplaces com conector V1 entregue. */
export function countV1IntegratedMarketplaces(
  allowlist: PublicSyncAllowlist = PUBLIC_SYNC_SUPPORTED_SOURCES,
): number {
  return Object.keys(allowlist).length;
}

/**
 * Marketplaces cujo writer está ligado AGORA.
 * Lê o ambiente real — não a allowlist estática.
 */
export function countWriterEnabledMarketplaces(
  env: Record<string, string | undefined> = process.env,
  allowlist: PublicSyncAllowlist = PUBLIC_SYNC_SUPPORTED_SOURCES,
): number {
  return Object.keys(allowlist).filter((id) => {
    if (env.CATALOG_V1_GLOBAL_CUTOVER !== "YES") {
      // Cutover global desligado trava TODOS os writers, inclusive legado.
      return false;
    }
    return getEffectiveMode(id, env).authorized;
  }).length;
}

/** Linha por marketplace, para relatório e para o admin. */
export interface RolloutRowV1 {
  marketplaceId: string;
  displayName: string;
  /** existe conector V1 (integrado). */
  v1Integrated: boolean;
  /** runtime mode != OFF. */
  writerEnabled: boolean;
  runtimeMode: string;
  /** legacy enum no Prisma, para cruzar com o banco. */
  legacyEnumValue: string;
}

/** Linhas de rollout derivadas de configuração apenas (sem tocar o banco). */
export function rolloutRows(
  env: Record<string, string | undefined> = process.env,
  allowlist: PublicSyncAllowlist = PUBLIC_SYNC_SUPPORTED_SOURCES,
): RolloutRowV1[] {
  const cutover = env.CATALOG_V1_GLOBAL_CUTOVER === "YES";

  return Object.keys(allowlist)
    .map((id): RolloutRowV1 => {
      const meta = MARKETPLACE_REGISTRY_V1.find((m) => m.marketplaceId === id);
      const mode = getEffectiveMode(id, env);
      return {
        marketplaceId: id,
        displayName: meta?.displayName ?? id,
        v1Integrated: true,
        writerEnabled: cutover && mode.authorized,
        runtimeMode: mode.runtimeMode,
        legacyEnumValue: meta?.legacyEnumValue ?? "",
      };
    })
    .sort((a, b) => a.marketplaceId.localeCompare(b.marketplaceId));
}

/**
 * Contagem pública autoritativa: quantos marketplaces têm oferta REALMENTE
 * publicada. A fonte é o banco, via `offersPorMarketplace`.
 */
export function countMarketplacesWithPublicOffers(
  offersPorMarketplace: Readonly<Record<string, number>>,
  /** Só conta ofertas que estão de fato visíveis ao público. */
  isPublic: (marketplace: string) => boolean = () => true,
): number {
  return Object.entries(offersPorMarketplace).filter(
    ([marketplace, n]) => n > 0 && isPublic(marketplace),
  ).length;
}
