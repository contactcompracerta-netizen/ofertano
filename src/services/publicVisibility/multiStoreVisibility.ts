import type { Prisma } from "@prisma/client";

/*
 * FASE J — peso de publicação por fonte (ver architecture/v1/publication/shadowWeight).
 * O import é seguro: shadowWeight só depende de módulos folha (registry/flags),
 * então não há ciclo com este arquivo.
 */
import { filterPublicOffers } from "@/services/architecture/v1/publication/shadowWeight";

/*
 * VISIBILIDADE PÚBLICA — MULTI LOJA REAL
 *
 * Regra única de visibilidade pública de produtos do Ofertano:
 * um produto só aparece publicamente quando possui ofertas válidas em
 * pelo menos DOIS marketplaces DISTINTOS.
 *
 * - 0 marketplaces válidos  -> oculto
 * - 1 marketplace válido    -> oculto
 * - 2+ marketplaces distintos -> visível
 *
 * Duas ofertas do MESMO marketplace não constituem Multi Loja.
 *
 * Este módulo é a abstração central. TODOS os pontos públicos devem
 * passar por aqui. Não espalhar `.length >= 2` em arquivos.
 */

/*
 * Mínimo de marketplaces DISTINTOS exigido para um produto ser
 * publicamente visível. É a MESMA noção usada pelo gate de publicação
 * automática (publicarProdutoComMultiloja / processImportQueue), para
 * que "publicado" e "visível" nunca divirjam.
 */
export const PUBLIC_MULTISTORE_MIN_MARKETPLACES = 2;

// Critério de oferta VÁLIDA, consistente com o comparador público
// (ver src/app/produto/[id]/page.tsx e a Home):
// ativa, EXACT, disponível, status comprável e preço válido.
export type PublicOfferLike = {
  marketplace: string;
  active?: boolean;
  available?: boolean;
  status?: string;
  matchStatus?: string;
  price?: number | null;
};

export function isUsablePublicOffer(offer: PublicOfferLike): boolean {
  if (offer.active === false) {
    return false;
  }

  if (
    offer.matchStatus !== undefined &&
    offer.matchStatus !== "EXACT"
  ) {
    return false;
  }

  return Boolean(
    offer.available &&
      offer.status !== "UNAVAILABLE" &&
      offer.status !== "ERROR" &&
      Number.isFinite(offer.price as number) &&
      (offer.price as number) > 0,
  );
}

// Conta marketplaces DISTINTOS entre as ofertas válidas.
export function countDistinctPublicMarketplaces(
  offers: PublicOfferLike[],
): number {
  return new Set(
    offers
      .filter(isUsablePublicOffer)
      .map((offer) => offer.marketplace.trim())
      .filter(Boolean),
  ).size;
}

/*
 * CATALOG_ARCHITECTURE_V1 — FASE J (peso de publicação por fonte).
 *
 * O funil público (Home, produto, sitemap, favoritos, categorias) é o
 * ÚNICO lugar que decide se um produto é multi-loja. Ele precisa respeitar o
 * peso de cada fonte: uma oferta de marketplace SHADOW não pode transformar
 * 1 marketplace público em 2.
 *
 * A regra é genérica e vem da CONFIGURAÇÃO (allowlist da shadow), nunca de
 * um `if marketplace === "..."`. Um marketplace novo entra ou sai da shadow
 * sem alterar este arquivo.
 */
function publicOffersOnly(
  offers: PublicOfferLike[],
): PublicOfferLike[] {
  return filterPublicOffers(offers);
}

// Conta marketplaces DISTINTOS que PESAM na publicação pública (FASE J).
// Fonte SHADOW é excluída da contagem, mas a oferta em si continua válida.
export function countPublicMarketplaces(
  offers: PublicOfferLike[],
): number {
  return new Set(
    publicOffersOnly(offers)
      .filter(isUsablePublicOffer)
      .map((offer) => offer.marketplace.trim())
      .filter(Boolean),
  ).size;
}

// Aceita um Product com `offers` já carregado ou uma lista crua de ofertas.
export function hasPublicMultiStore(
  offers: PublicOfferLike[] | {
    offers?: PublicOfferLike[];
  },
): boolean {
  const lista = Array.isArray(offers) ? offers : (offers.offers ?? []);
  return (
    countPublicMarketplaces(lista) >=
    PUBLIC_MULTISTORE_MIN_MARKETPLACES
  );
}

/*
 * GUARDA CENTRAL DE ATIVAÇÃO (FASE E)
 *
 * Todo caminho de escrita que possa terminar com Product.active=true
 * passa por sincronizarMelhorOfertaDoProduto, que consulta esta função.
 *
 * - Fluxo MANUAL (autoCreated=false): liberado (comportamento legado).
 * - Fluxo AUTO-CRIADO: só pode sair de DRAFT com Multi Loja pública.
 *
 * A decisão é PURA (sem I/O) e usa o MESMO predicado da página pública;
 * "publicado no banco" nunca pode divergir de "visível publicamente".
 */
export function permitirAtivacaoProdutoAutoCriado(
  autoCreated: boolean,
  offers: PublicOfferLike[] | {
    offers?: PublicOfferLike[];
  },
): boolean {
  if (autoCreated !== true) {
    return true;
  }

  return hasPublicMultiStore(offers);
}

// Para ofertas já validadas upstream (ex.: clusters do matcher Multi Loja V2),
// conta apenas marketplaces DISTINTOS não vazios, sem revalidar cada oferta.
export function countDistinctNonEmptyMarketplaces(
  offers: Array<{ marketplace: string }>,
): number {
  return new Set(
    offers
      .map((offer) => offer.marketplace.trim())
      .filter(Boolean),
  ).size;
}

// Filtro Prisma que reduz as linhas no próprio banco: exige ao menos uma
// oferta válida. A checagem final de "2 marketplaces distintos" fica em
// memória via hasPublicMultiStore para não haver falso negativo do banco.
export function multiStorePublicWhere(): Prisma.ProductWhereInput {
  return {
    AND: [
      {
        offers: {
          some: {
            active: true,
            matchStatus: "EXACT",
            available: true,
            status: { notIn: ["UNAVAILABLE", "ERROR"] },
            price: { gt: 0 },
          },
        },
      },
    ],
  };
}

// Select padrão das ofertas para as "grades" públicas (Home, ofertas,
// categorias, recomendados, favoritos). Inclui os campos necessários para
// hasPublicMultiStore avaliar a validade de cada oferta.
export const PUBLIC_OFFER_SELECT = {
  select: {
    marketplace: true,
    available: true,
    status: true,
    price: true,
  },
} as const;
