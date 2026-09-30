import type { Prisma } from "@prisma/client";

import { isValidMercadoLivreListingIdentity } from "@/services/mercadoLivre/listingIdentity";

/*
 * FASE J — peso de publicação por fonte (ver architecture/v1/publication/shadowWeight).
 * O import é seguro: shadowWeight só depende de módulos folha (registry/flags),
 * então não há ciclo com este arquivo.
 */
import {
  countPublicMarketplacesWithWeight,
  filterPublicOffers,
  toCanonicalMarketplaceId,
} from "@/services/architecture/v1/publication/shadowWeight";

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
  /*
   * LISTING-FIRST: em MERCADO_LIVRE, `externalId` (ITEM_ID do anúncio) e
   * `sourceUrl` (URL que comprova aquele ITEM_ID) são obrigatórios para a
   * oferta ser pública. Opcional no tipo porque as outras plataformas não têm
   * essa exigência — quando AUSENTES num snapshot ML, a oferta é tratada como
   * NÃO publicável (fail-closed): sem identidade provada não há CTA.
   */
  externalId?: string | null;
  sourceUrl?: string | null;
};

/*
 * LISTING-FIRST: rota de catálogo do Mercado Livre (`/p/...`, `/up/...`).
 *
 * Ela abre uma página que agrega N anúncios: não há vendedor nem preço da
 * oferta, e o anúncio em destaque muda conforme estoque. Publicar um CTA
 * para lá é um link de oferta ERRADO — e o usuário não tem como perceber,
 * porque o site abriu e mostrou "um" produto.
 */
const ML_CATALOG_URL_SQL = { contains: "/p/", mode: "insensitive" as const };
const ML_USER_PRODUCT_URL_SQL = {
  contains: "/up/",
  mode: "insensitive" as const,
};

/** Oferta ML que não é um anúncio comprovado não é publicável. */
export function isPublicavelOfertaMercadoLivre(
  offer: Pick<PublicOfferLike, "externalId" | "sourceUrl">,
): boolean {
  return isValidMercadoLivreListingIdentity({
    externalId: offer.externalId,
    listingItemId: offer.externalId,
    sourceUrl: offer.sourceUrl,
    origin: "listing",
  });
}

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

  if (!isOfertaPublicavelNoMarketplace(offer)) {
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

/**
 * Regra de mercado (não de flag). Separada de `isUsablePublicOffer` para que
 * filtros de marketplace que NÃO dependem de `price`/`matchStatus` (ex.:
 * "mostrar a grade de lojas" da página de produto) compartilhem exatamente a
 * mesma política.
 */
export function isOfertaPublicavelNoMarketplace(
  offer: Pick<PublicOfferLike, "marketplace" | "externalId" | "sourceUrl">,
): boolean {
  if (String(offer.marketplace) !== "MERCADO_LIVRE") {
    return true;
  }

  return isPublicavelOfertaMercadoLivre(offer);
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
      /*
       * FASE P — identidade CANONICA, nao grafia crua. O banco persiste o
       * enum em MAIUSCULAS ("SHOPEE") e a shadow allowlist usa o
       * marketplaceId canonico ("shopee"). Contar pela grafia permitia que a
       * mesma fonte contasse duas vezes, e que uma fonte SHADOW passasse
       * pelo filtro. A canonicalizacao vive em shadowWeight (o unico ponto
       * onde shadow e publico se separam); aqui so aggregator com ela.
       */
      .map((offer) => toCanonicalMarketplaceId(offer.marketplace))
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
 * FASE P — gate PONDERADO SEM VALIDADE DE OFERTA.
 *
 * `hasPublicMultiStore` é o gate de visibilidade de um PRODUTO PERSISTIDO, e
 * por isso exige ofertas válidas (ativa/EXACT/disponível/preço). A busca
 * pública, porém, também decide visibilidade sobre candidatos de DISCOVERY
 * (clusters do motor Multi Loja V2), cujo tipo `CanonicalOffer` não carrega
 * `available`/`status`/`matchStatus`. Aplicar `hasPublicMultiStore` lá seria
 * fail-closed por acidente — TODO cluster seria considerado sem oferta válida.
 *
 * Esta função é a MESMA política (peso de shadow + o mesmo mínimo), exposta
 * para essa forma de entrada. Não é uma implementação paralela: delega aos
 * mesmos dois símbolos, e o mínimo é a MESMA constante. O que muda é apenas
 * qual requisito a forma de entrada consegue expressar — nunca o peso.
 */
export function meetsPublicMultiStoreMarketplaceCount(
  offers: Array<{ marketplace: string }>,
): boolean {
  return (
    countPublicMarketplacesWithWeight(offers) >=
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
            // LISTING-FIRST: oferta ML de catálogo não conta como oferta
            // válida. Filtro no banco (não só em memória) porque este `where`
            // é o que decide se o produto aparece na Home/sitemap.
            NOT: {
              marketplace: "MERCADO_LIVRE",
              OR: [
                { sourceUrl: ML_CATALOG_URL_SQL },
                { sourceUrl: ML_USER_PRODUCT_URL_SQL },
              ],
            },
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
    // LISTING-FIRST: sem estes dois campos a identidade de anúncio ML não
    // pode ser avaliada em memória e a oferta seria tratada como publicável
    // por falta de informação (fail-open).
    externalId: true,
    sourceUrl: true,
  },
} as const;
