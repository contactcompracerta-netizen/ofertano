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
import { resolveMarketplaceIdFromLegacyEnum } from "../marketplaceRegistry";

/**
 * Peso de publicacao por marketplace. Somente valores aqui:
 *   0 = SHADOW (nao publica, nao conta)
 *   1 = PUBLIC (conta normalmente)
 */
export type PublicationWeight = 0 | 1;

/**
 * FASE P (FASE G/H) — IDENTIDADE DE MARKETPLACE NO LIMIAR SHADOW/PUBLICO.
 *
 * A allowlist da shadow e a CONFIGURACAO, e ela contem marketplaceId
 * CANONICO (lowercase_snake: "shopee"). O schema, por outro lado, persiste
 * `MarketplaceOffer.marketplace` como enum Prisma, e o Prisma devolve a CHAVE
 * do enum em MAIUSCULAS ("SHOPEE").
 *
 * Sem canonicalizar, `"SHOPEE" !== "shopee"`, a allowlist nunca casa, e
 * `publicationWeightFor` devolve 1 para uma fonte que esta EM SHADOW. O
 * resultado medido em producao (2026-09-27) foi o pior possivel: o
 * `filterPublicOffers` nao filtrava NADA, e um produto auto-criado com
 * MERCADO_LIVRE + SHOPEE (peso real = 1) era considerado multi-loja publico
 * em Home, /ofertas, busca, favoritos, /produto/[id], /sitemap.xml,
 * /o/[codigo] e /api/products/[id]/live-offers. A shadow estava documentada
 * como ativa e, ao mesmo tempo, era inoperante no funil publico.
 *
 * A canonicalizacao fica AQUI, neste arquivo, porque este e por contrato o
 * UNICO ponto onde "shadow" e "publico" se separam. Corrigir aqui corrige
 * todas as superficies de uma vez; corrigir em cada superficie criaria
 * implementacoes paralelas justamente onde o arquivo proibe.
 *
 * Sentido inverso preservado: uma fonte fora do registry NAO ganha peso
 * publico por acidente — cai no proprio texto normalizado, que so casa com a
 * allowlist se a configuracao escrita for identica. A extensibilidade
 * (marketplace novo, marketplaceId dinamico) continua funcionando.
 */
export function toCanonicalMarketplaceId(marketplace: string): string {
  const raw = marketplace?.trim() ?? "";
  return (
    resolveMarketplaceIdFromLegacyEnum(raw) ?? raw.toLowerCase()
  );
}

/**
 * A allowlist tambem e CONFIGURACAO escrita a mao, entao os dois lados da
 * comparacao precisam estar na mesma escala. Sem canonicalizar o lado da
 * allowlist, uma entrada escrita em outra grafia ("MARKET_A") deixaria de casar
 * com a consulta e a sombra passaria a pesar 1 — que e o mesmo vazamento, com
 * outra origem: a configuracao. Por isso a canonicalizacao e SIMETRICA, e nao
 * so do lado da consulta. A lista e minuscula (0-3 entradas), mas a comparacao
 * acontece por oferta em caminhos quentes, entao o resultado e memoizado por
 * array de allowlist (identidade estavel enquanto as flags vivem).
 */
const canonicalAllowlistCache = new WeakMap<
  readonly string[],
  ReadonlySet<string>
>();

function canonicalAllowlist(marketplaceIds: readonly string[]): ReadonlySet<string> {
  const cached = canonicalAllowlistCache.get(marketplaceIds);

  if (cached) {
    return cached;
  }

  const computed = new Set(
    marketplaceIds.map((id) => toCanonicalMarketplaceId(id)),
  );
  canonicalAllowlistCache.set(marketplaceIds, computed);

  return computed;
}

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
  // FASE P: a allowlist e canonica (lowercase_snake); a entrada pode vir do
  // enum do banco (MAIUSCULAS). Sem canonicalizar os DOIS lados, a sombra
  // nunca casaria e a fonte em shadow publicaria com peso 1.
  return canonicalAllowlist(flags.marketplaceIds).has(
    toCanonicalMarketplaceId(marketplaceId),
  );
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

/*
 * FASE P — o filtro canonico de shadow devolve as ofertas com o
 * marketplaceId CANONICO, para que qualquer contagem a jusante agrupe por
 * identidade e nao pela forma de grafia. Sem isto, "SHOPEE" e "shopee"
 * virariam o mesmo grupo para uns consumidores e grupos distintos para outros.
 */
export function toPublicOfferMarketplaceIds(
  offers: Array<{ marketplace: string }>,
  flags: ShadowFlags = readShadowFlags(),
): string[] {
  return filterPublicOffers(offers, flags).map((offer) =>
    toCanonicalMarketplaceId(offer.marketplace),
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
      // FASE P: agrupa por identidade canonica, nao por grafia. "SHOPEE" e
      // "shopee" sao a MESMA fonte e nao podem contar como duas.
      .map((offer) => toCanonicalMarketplaceId(offer.marketplace))
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
