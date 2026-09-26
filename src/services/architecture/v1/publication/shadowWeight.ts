/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW PUBLICATION WEIGHT (FASE 8 / FASE J).
 *
 * REGRA CRITICA DA MISSAO:
 *   Enquanto um marketplace esta SHADOW, suas ofertas NAO contam para
 *   publicMarketplaceCount e NAO podem transformar
 *       1 marketplace publico  ->  2 marketplaces publicos.
 *
 *   Mercado Livre publico + Shopee SHADOW  =>  continua 1 marketplace publico.
 *
 * Implementacao SEM nome de marketplace no core: o status vem de uma FONTE DE
 * VERDADE (a allowlist da shadow, lida do ambiente), nunca de um `if` por nome.
 * Adicionar um marketplace novo nao muda este arquivo.
 *
 * Este e o unico ponto onde "shadow" e "publico" se separam. O gate central de
 * publicacao (publicationEligibility) e a visibilidade publica
 * (multiStoreVisibility) consomem estas funcoes; assim um vazamento seria
 * impossivel de introduzir em outro lugar por accidento.
 */

import { readShadowFlags, type ShadowFlags } from "../shadow/flags";

/**
 * Peso de publicacao por marketplace. Somente valores aqui:
 *   0 = SHADOW (nao publica, nao conta)
 *   1 = PUBLIC (conta normalmente)
 */
export type PublicationWeight = 0 | 1;

/** Peso de uma fonte SHADOW. Por definicao, zero. */
export const SHADOW_PUBLICATION_WEIGHT: PublicationWeight = 0;

/** Peso de uma fonte publica. */
export const PUBLIC_PUBLICATION_WEIGHT: PublicationWeight = 1;

/**
 * Uma fonte esta em SHADOW quando a shadow esta habilitada e o marketplace
 * esta na allowlist. Fail-closed no sentido inverso: shadow desabilitada
 * (ou marketplace fora da allowlist) => a fonte nao e tratada como shadow.
 *
 * Nao ha default permissivo: um marketplace desconhecido do registry NUNCA e
 * considerado shadow por acidente, e NUNCA ganha peso publico por accidente —
 * o registry continua sendo a unica fonte de identidade.
 */
export function isShadowMarketplace(
  marketplaceId: string,
  flags: ShadowFlags = readShadowFlags(),
): boolean {
  if (!flags.enabled) return false;
  return flags.marketplaceIds.includes(marketplaceId);
}

/**
 * Peso de publicacao do marketplace.
 *
 * - SHADOW na allowlist => 0 (regra critica da missao).
 * - Qualquer outra fonte => 1 (comportamento legado).
 *
 * IMPORTANTE — por que marketplace DESCONHECIDO tem peso 1:
 * a extensibilidade da Architecture V1 (FASE E/X) e parte do contrato de
 * catalogo: um marketplaceId dinamico, ainda fora do registry e do enum
 * legado, PRECISA fluir pelo pipeline sem alteracao no core. Se
 * "desconhecido" significasse "nao publica", adicionar o marketplace no 3
 * exigiria mexer no nucleo — exatamente o que a missao proibe.
 *
 * Entao shadow NAO e inferido: e uma decisao operacional EXPLICITA
 * (allowlist). Fonte fora da allowlist mantem o peso legado. O preco e que
 * shadow nao pode ser "esquecida": e por isso que a allowlist e a unica
 * fonte de verdade e o readiness exige `SHADOW_SOURCE_IS_SHADOW=true`.
 */
export function publicationWeightFor(
  marketplaceId: string,
  flags: ShadowFlags = readShadowFlags(),
): PublicationWeight {
  if (isShadowMarketplace(marketplaceId, flags)) {
    return SHADOW_PUBLICATION_WEIGHT;
  }
  return PUBLIC_PUBLICATION_WEIGHT;
}

/** true quando o marketplace pode contribuir para publicMarketplaceCount. */
export function contributesToPublicMarketplaceCount(
  marketplaceId: string,
  flags: ShadowFlags = readShadowFlags(),
): boolean {
  return publicationWeightFor(marketplaceId, flags) === PUBLIC_PUBLICATION_WEIGHT;
}

/**
 * Filtra ofertas removendo as que vem de fontes SHADOW.
 * E o filtro canonico: toda contagem publica deve passar por aqui.
 */
export function filterPublicOffers<T extends { marketplace: string }>(
  offers: T[],
  flags: ShadowFlags = readShadowFlags(),
): T[] {
  return offers.filter(
    (offer) => contributesToPublicMarketplaceCount(offer.marketplace, flags),
  );
}

/**
 * Conta marketplaces DISTINTOS que realmente pesam na publicacao.
 *
 * `countDistinctPublicMarketplaces` (o helper legado) conta a oferta; esta
 * funcao conta o marketplace e ainda aplica o peso. Usar as duas em conjunto
 * garante que a regra da missao valha em qualquer ponto publico.
 */
export function countPublicMarketplacesWithWeight(
  offers: Array<{ marketplace: string }>,
  flags: ShadowFlags = readShadowFlags(),
): number {
  return new Set(
    filterPublicOffers(offers, flags)
      .map((offer) => offer.marketplace.trim())
      .filter(Boolean),
  ).size;
}

/**
 * FASE Z — readiness do segundo marketplace.
 *
 * Shadow nao pode ser "esquecida": como o peso de uma fonte fora da allowlist
 * e o peso legado (necessario para a extensibilidade), a garantia de que a
 * segunda fonte NAO publica vem de ela estar EXPLICITAMENTE na allowlist.
 * Este helper torna essa precondicao verificavel em vez de presumida.
 */
export function assertSecondMarketplaceIsShadow(
  marketplaceId: string,
  flags: ShadowFlags = readShadowFlags(),
): void {
  if (!isShadowMarketplace(marketplaceId, flags)) {
    throw new Error(
      `marketplace "${marketplaceId}" nao esta na allowlist da shadow. ` +
        "Sem isso, a fonte teria peso de publicacao e poderia publicar.",
    );
  }
}
