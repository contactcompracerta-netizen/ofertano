import type { Prisma } from "@prisma/client";

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

// Aceita um Product com `offers` já carregado ou uma lista crua de ofertas.
export function hasPublicMultiStore(
  offers: PublicOfferLike[] | {
    offers?: PublicOfferLike[];
  },
): boolean {
  const lista = Array.isArray(offers) ? offers : (offers.offers ?? []);
  return countDistinctPublicMarketplaces(lista) >= 2;
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
