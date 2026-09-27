/**
 * FASE P (FASE 9) — INVARIANTE DE PUBLICATION MEDIDO COMO A PRODUÇÃO MEDE.
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO CORRIGE
 * ============================================================================
 * `fase8-snapshot-readonly.ts` e `fase8-3b-real-canary.ts` respondiam
 * "AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES" com SQL cru:
 *
 *     COUNT(DISTINCT o.marketplace::text) < 2
 *
 * Esse predicado NÃO PESA a shadow. O gate real de publicação
 * (`publicationEligibility.evaluatePublicationEligibility`) usa
 * `countPublicMarketplacesWithWeight`, que dá peso 0 a uma fonte SHADOW.
 *
 * As duas coisas não são equivalentes. Com Shopee corretamente marcada como
 * shadow, um produto com ofertas MERCADO_LIVRE + SHOPEE vale 1 marketplace
 * público para o gate de produção, mas o SQL cru contava 2 e reportava
 * "violação = 0". O harness/mediação de Fase P media um invariante DIFERENTE
 * do invariante que ele dizia certificar, e por isso podia ficar verde sobre
 * um risco real.
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ
 * ============================================================================
 * Ele NÃO reimplementa a regra. Ele delega ao MESMO código de produção:
 *
 *   - `isUsablePublicOffer`               (src/services/publicVisibility)
 *   - `countPublicMarketplacesWithWeight` (publication/shadowWeight)
 *   - `PUBLIC_MULTISTORE_MIN_MARKETPLACES`(src/services/publicVisibility)
 *
 * Assim o script de medição e o gate de produção passam a derivar o número do
 * mesmo lugar. Se a política de peso mudar, os dois mudam juntos — que é o
 * ponto.
 *
 * ============================================================================
 * POR QUE AS DUAS MEDIDAS COEXISTEM
 * ============================================================================
 * O número sem peso é mantido e reportado porque ele é a métrica histórica e
 * a que a auditoria anterior usava. Ele é ROTULADO como
 * `..._UNWEIGHTED` para que ninguém mais o leia como o invariante de
 * produção. Removê-lo quebraria a comparação com as fases anteriores; por
 * isso ele vira diagnóstico explícito em vez de sumir.
 */

import {
  PUBLIC_MULTISTORE_MIN_MARKETPLACES,
  isUsablePublicOffer,
  type PublicOfferLike,
} from "../services/publicVisibility/multiStoreVisibility";
import { countPublicMarketplacesWithWeight } from "../services/architecture/v1/publication/shadowWeight";
import { readShadowFlags, type ShadowFlags } from "../services/architecture/v1/shadow/flags";
import { resolveMarketplaceIdFromLegacyEnum } from "../services/architecture/v1/marketplaceRegistry";

/** Oferta crua vinda do SELECT do script (enums do banco, não canonical ids). */
export type PublicOfferDbRow = PublicOfferLike & {
  productId: string;
  /** Valor do enum Prisma em `MarketplaceOffer.marketplace` (ex.: "SHOPEE"). */
  marketplace: string;
};

/**
 * Predicado SQL de oferta VÁLIDA, idêntico ao que os scripts já usavam e
 * equivalente a `isUsablePublicOffer`. Fica aqui em UM lugar só para que o
 * SELECT dos dois scripts não possa divergir.
 */
export const PUBLIC_OFFER_PREDICATE_SQL = `o.active = true
             AND o."matchStatus" = 'EXACT'
             AND o.available = true
             AND o.status NOT IN ('UNAVAILABLE','ERROR')
             AND o.price > 0`;

/**
 * Enum do banco -> marketplaceId canônico, que é o que a shadow allowlist
 * contém. Um enum fora do registry cai para o próprio texto em minúsculas:
 * Sources desconhecidas mantêm o peso legado por contrato (ver
 * `shadowWeight.publicationWeightFor`), então elas nunca somem da contagem.
 */
export function canonicalMarketplaceId(marketplaceEnum: string): string {
  return (
    resolveMarketplaceIdFromLegacyEnum(marketplaceEnum) ??
    marketplaceEnum.trim().toLowerCase()
  );
}

/**
 * Nº de marketplaces PÚBLICOS (com peso de shadow) de um conjunto de ofertas.
 * Esta é a mesma conta que `evaluatePublicationEligibility` faz.
 *
 * O enum do banco é canonicalizado ANTES de pesar. Sem isso, "SHOPEE" nunca
 * casaria com a allowlist "shopee" e a sombra não se aplicaria — que é
 * exatamente o tipo de divergência silenciosa que estes testes existem para
 * impedir.
 */
export function weightedPublicMarketplaceCount(
  offers: PublicOfferLike[],
  flags: ShadowFlags = readShadowFlags(),
): number {
  return countPublicMarketplacesWithWeight(
    offers.map((o) => ({ marketplace: canonicalMarketplaceId(o.marketplace) })),
    flags,
  );
}

/** Nº de marketplaces DISTINTOS SEM peso (o predicado histórico, em SQL). */
export function unweightedPublicMarketplaceCount(offers: PublicOfferLike[]): number {
  return new Set(
    offers.map((o) => canonicalMarketplaceId(o.marketplace)).filter(Boolean),
  ).size;
}

export type AutoActiveProduct = {
  productId: string;
  /** Todas as ofertas públicas (válidas) do produto, com enum do banco. */
  offers: PublicOfferDbRow[];
};

/**
 * Agrupa ofertas por produto e devolve os dois números de uma vez.
 *
 *   belowUnweighted: produtos autoCreated+active com < 2 marketplaces SEM peso
 *                    (= métrica histórica /_definida pela auditoria_)
 *   belowWeighted:   produtos autoCreated+active com < 2 marketplaces COM peso
 *                    (= o invariante que o gate de produção realmente aplica)
 *
 * Ambos usam `isUsablePublicOffer` para filtrar as ofertas, então nenhum dos
 * dois números pode divergir do gate por causa do filtro de validade.
 */
export function countAutoActiveBelowMin(
  products: AutoActiveProduct[],
  flags: ShadowFlags = readShadowFlags(),
  min: number = PUBLIC_MULTISTORE_MIN_MARKETPLACES,
): { belowUnweighted: number; belowWeighted: number; belowWeightedProductIds: string[] } {
  let belowUnweighted = 0;
  let belowWeighted = 0;
  const belowWeightedProductIds: string[] = [];

  for (const product of products) {
    const usable = product.offers.filter(isUsablePublicOffer);
    if (usable.length === 0) {
      // Sem oferta válida, o produto não é público por definição alguma das
      // duas contagens.
      belowUnweighted += 1;
      belowWeighted += 1;
      belowWeightedProductIds.push(product.productId);
      continue;
    }
    if (unweightedPublicMarketplaceCount(usable) < min) {
      belowUnweighted += 1;
    }
    if (weightedPublicMarketplaceCount(usable, flags) < min) {
      belowWeighted += 1;
      belowWeightedProductIds.push(product.productId);
    }
  }

  return { belowUnweighted, belowWeighted, belowWeightedProductIds };
}
