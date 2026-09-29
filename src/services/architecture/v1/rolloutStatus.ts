/**
 * CATALOG V1 — STATUS DE ROLLOUT POR MARKETPLACE (fonte única de verdade).
 *
 * POR QUE ESTE MÓDULO EXISTE
 *
 * "Quantos marketplaces estão no Catalog V1?" tem respostas diferentes e elas
 * foram confundidas numa só, o que produziu números inflados.
 *
 * O erro mais sutil que este módulo corrige: `CATALOG_V1_GLOBAL_CUTOVER` e
 * `PUBLIC_SYNC_MODE_<FUENTE>` são **mecanismos diferentes**, e somar o primeiro
 * ao segundo apaga o segundo. O cutover global é o interruptor que APAGA o
 * caminho legado; ele não é permissão do public sync. Foldar os dois fazia
 * Shopee reportar "writer OFF" mesmo com o public sync autorizado, porque o
 * cutover global (NO por decisão de produto) desligava os dois na mesma conta.
 *
 * As dimensões, e o que cada uma responde:
 *
 *   V1_INTEGRATED
 *       Existe conector V1, config, teste de contrato e default OFF.
 *       Integração de código. Não implica publicação.
 *
 *   PUBLIC_SYNC_WRITER_ENABLED
 *       `authorizePublicSync` resolve autorizado. Mecanismo FONTE-COMPARTILHADA,
 *       independente do cutover global.
 *
 *   LEGACY_WRITER_ENABLED
 *       Caminho legado ainda operante. É o ÚNICO que o cutover global desliga.
 *
 *   PUBLIC_OFFERS_COUNT
 *       Ofertas reais publicadas, lidas do banco. Único número que representa
 *       valor para o usuário.
 *
 *   PUBLICATION_ELIGIBLE
 *       Existe ao menos um writer ligado. Diz o que PODE publicar; não diz que
 *       publicou. Por isso é separado de PUBLIC_OFFERS_COUNT.
 *
 * Contar "integrado" como "público" é autoinflação: por construção nunca
 * diminui quando uma fonte fica bloqueada (Amazon e AliExpress: integrados,
 * sem oferta).
 */
import { MARKETPLACE_REGISTRY_V1 } from "./marketplaceRegistry";
import {
  PUBLIC_SYNC_SUPPORTED_SOURCES,
  authorizePublicSync,
  getEffectiveMode,
  type PublicSyncAllowlist,
} from "./publicSync/flags";

/**
 * Marketplaces que publicam pelo caminho LEGADO (fora do public sync).
 *
 * Mercado Livre é o caso real: as ofertas públicas em produção vêm do
 * importador legado, não do `runMarketplacePublicSync`. Sem esta lista, o
 * relatório diria que ML não tem writer quando é exatamente o oposto.
 */
export const LEGACY_PUBLIC_MARKETPLACES: ReadonlySet<string> = new Set([
  "mercado_livre",
]);

/** Marketplaces com conector V1 entregue. */
export function countV1IntegratedMarketplaces(
  allowlist: PublicSyncAllowlist = PUBLIC_SYNC_SUPPORTED_SOURCES,
): number {
  return Object.keys(allowlist).length;
}

/**
 * Marketplaces cujo public sync está autorizado AGORA.
 *
 * Deliberadamente NÃO consulta `CATALOG_V1_GLOBAL_CUTOVER`: o cutover global
 * governa o caminho legado, não o public sync. Dobrar os dois aqui é o que
 * produziu "writer OFF" para uma fonte cujo `PUBLIC_SYNC_MODE_*` está ligado.
 */
export function countPublicSyncWriterEnabled(
  env: Record<string, string | undefined> = process.env,
  allowlist: PublicSyncAllowlist = PUBLIC_SYNC_SUPPORTED_SOURCES,
): number {
  return Object.keys(allowlist).filter((id) =>
    authorizePublicSync(id, allowlist, env).authorized,
  ).length;
}

/** Caminho legado desligado? Só o cutover global o desliga. */
export function legacyWriterEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.CATALOG_V1_GLOBAL_CUTOVER !== "YES";
}

export function countLegacyWriterEnabled(
  env: Record<string, string | undefined> = process.env,
): number {
  if (!legacyWriterEnabled(env)) return 0;
  return LEGACY_PUBLIC_MARKETPLACES.size;
}

/** Linha por marketplace, para relatório e para o admin. */
export interface RolloutRowV1 {
  marketplaceId: string;
  displayName: string;
  /** existe conector V1 (integrado). */
  v1Integrated: boolean;
  /** modo efetivo do public sync, resolvido do ambiente. */
  publicSyncMode: string;
  /** public sync autorizado? (independe do cutover global) */
  publicSyncAuthorized: boolean;
  /** motivo da negação, quando houver. */
  publicSyncDeniedReason: string | null;
  /** caminho legado operante para este marketplace? */
  legacyWriter: boolean;
  /** algum writer ligado? é o que PODE publicar. */
  publicationEligible: boolean;
  /** ofertas reais publicadas (preenchido pelo chamador via banco). */
  publicOfferCount: number;
  /** rótulo derivado, sem inventar estado. */
  publicationStatus: string;
  /** legacy enum no Prisma, para cruzar com o banco. */
  legacyEnumValue: string;
}

/**
 * Linhas de rollout derivadas de configuração apenas (sem tocar o banco).
 * `publicOfferCount` entra como 0 e é preenchido pelo snapshot.
 */
export function rolloutRows(
  env: Record<string, string | undefined> = process.env,
  allowlist: PublicSyncAllowlist = PUBLIC_SYNC_SUPPORTED_SOURCES,
): RolloutRowV1[] {
  const legacyOn = legacyWriterEnabled(env);

  return Object.keys(allowlist)
    .map((id): RolloutRowV1 => {
      const meta = MARKETPLACE_REGISTRY_V1.find((m) => m.marketplaceId === id);
      const staticMode = allowlist[id]?.mode ?? "OFF";
      const auth = authorizePublicSync(id, allowlist, env);
      const legacyWriter = legacyOn && LEGACY_PUBLIC_MARKETPLACES.has(id);

      return {
        marketplaceId: id,
        displayName: meta?.displayName ?? id,
        v1Integrated: true,
        publicSyncMode: getEffectiveMode(id, env).runtimeMode,
        publicSyncAuthorized: auth.authorized,
        publicSyncDeniedReason: auth.authorized ? null : auth.reason,
        legacyWriter,
        publicationEligible: auth.authorized || legacyWriter,
        publicOfferCount: 0,
        publicationStatus: "UNKNOWN",
        legacyEnumValue: meta?.legacyEnumValue ?? "",
      };
    })
    .sort((a, b) => a.marketplaceId.localeCompare(b.marketplaceId));
}

/**
 * Rótulo de publicação. Quatro estados, e todos são necessários porque cada
 * um pede uma ação diferente.
 *
 * O caso que motivou o 4º estado: Magazine Luiza estava com o writer OFF e 3
 * ofertas públicas no ar. Rotular só "NO_WRITER" escondia que a fonte está
 * servindo catálogo estagnado, que não vai se atualizar sozinho — e é o
 * oposto do erro de inflar. "Pode publicar" e "está publicando" são eixos
 * diferentes e o rótulo precisa carregar os dois.
 */
export function classifyPublicationStatus(
  row: Pick<
    RolloutRowV1,
    "publicSyncAuthorized" | "legacyWriter" | "publicOfferCount"
  >,
): string {
  const temWriter = row.publicSyncAuthorized || row.legacyWriter;
  const temOferta = row.publicOfferCount > 0;

  if (temOferta && temWriter) return "PUBLISHED";
  // Servindo ao público sem writer ligado: conteúdo real, porém congelado.
  if (temOferta) return "PUBLISHED_NO_WRITER";
  // Writer ligado sem oferta: pode publicar, ainda não publicou.
  if (temWriter) return "WRITER_ON_ZERO_OFFERS";
  return "NO_WRITER";
}

/**
 * Contagem pública autoritativa: quantos marketplaces têm oferta REALMENTE
 * publicada. A fonte é o banco. Nunca derivada de configuração.
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
