import type { PrismaClient } from "@prisma/client";

import { isValidMercadoLivreListingIdentity } from "@/services/mercadoLivre/listingIdentity";

export type MercadoLivrePending = {
  offerId: string;
  productId: string;
  externalId: string | null;
  sourceUrl: string | null;
  opportunityId: string | null;
};

export type MercadoLivrePendingStore = {
  listPendingMercadoLivreOffers(limit: number): Promise<MercadoLivrePending[]>;
  /** Conta pendências candidatas (mesmo filtro de listagem, sem limite). */
  countPending(): Promise<number>;
  findOfferById(offerId: string): Promise<{
    id: string;
    productId: string;
    marketplace: string;
    externalId: string | null;
    sourceUrl: string | null;
    affiliateLink: string | null;
  } | null>;
};

export type MercadoLivreApplyStore = {
  applyValidatedAffiliateLink(input: {
    offerId: string;
    opportunityId: string | null;
    affiliateUrl: string;
  }): Promise<void>;
};

type PrismaLike = Pick<PrismaClient, "productOpportunity" | "marketplaceOffer">;

/**
 * Busca oportunidades Mercado Livre que ainda aguardam link de afiliado
 * (status WAITING_AFFILIATE + affiliateLink vazio) e que já estão vinculadas
 * a um Product/Oferta. Retorna o agregado oferta+oportunidade.
 */
export async function listPendingMercadoLivreOffers(
  store: MercadoLivrePendingStore,
  limit: number,
): Promise<MercadoLivrePending[]> {
  return store.listPendingMercadoLivreOffers(limit);
}

export function createPrismaMercadoLivrePendingStore(
  client: PrismaLike,
): MercadoLivrePendingStore {
  return {
    async listPendingMercadoLivreOffers(limit) {
      const opportunities = await client.productOpportunity.findMany({
        where: {
          marketplace: "MERCADO_LIVRE",
          status: "WAITING_AFFILIATE",
          affiliateLink: null,
          productId: { not: null },
        },
        orderBy: { discoveredAt: "asc" },
        take: limit,
        select: {
          id: true,
          productId: true,
          externalId: true,
          sourceUrl: true,
        },
      });

      const productIds = opportunities
        .map((o) => o.productId)
        .filter((p): p is string => Boolean(p));

      const offers = await client.marketplaceOffer.findMany({
        where: {
          marketplace: "MERCADO_LIVRE",
          productId: { in: productIds },
          affiliateLink: null,
        },
        select: {
          id: true,
          productId: true,
          externalId: true,
          sourceUrl: true,
        },
      });

      /*
       * LISTING-FIRST: a pendência é por ANÚNCIO.
       *
       * Sem o filtro, uma oferta legada de catálogo entra na fila de
       * afiliados com um catalog_product_id como `externalId` e uma
       * sourceUrl `/p/...`; o Link Builder responde com o anúncio em destaque
       * no momento e o `affiliateLink` gravado aponta para o anúncio errado.
       *
       * O filtro NÃO apaga nada: a oferta continua no banco e no relatório de
       * legado, apenas não é reimportável como oferta comprável.
       */
      const offersAnuncio = offers.filter((offer) =>
        isValidMercadoLivreListingIdentity({
          externalId: offer.externalId,
          listingItemId: offer.externalId,
          sourceUrl: offer.sourceUrl,
          origin: "listing",
        }),
      );

      const offersByProduct = new Map<string, (typeof offersAnuncio)[number]>();
      for (const offer of offersAnuncio) {
        if (!offersByProduct.has(offer.productId)) {
          offersByProduct.set(offer.productId, offer);
        }
      }

      return opportunities
        .map((opportunity): MercadoLivrePending | null => {
          if (!opportunity.productId) return null;
          const offer = offersByProduct.get(opportunity.productId);
          if (!offer) return null;
          return {
            offerId: offer.id,
            productId: offer.productId,
            externalId: offer.externalId,
            sourceUrl: offer.sourceUrl ?? opportunity.sourceUrl,
            opportunityId: opportunity.id,
          };
        })
        .filter((p): p is MercadoLivrePending => Boolean(p));
    },

    async countPending() {
      /*
       * `countPending` é métrica de fila. Contar ofertas de catálogo como
       * "pendentes de afiliado" inflaria o número com itens que jamais serão
       * processados (o worker faz skip de catalog-only) e esconderia itens
       * reais. Mesma semântica de `listPendingMercadoLivreOffers`.
       */
      const opportunities = await client.productOpportunity.findMany({
        where: {
          marketplace: "MERCADO_LIVRE",
          status: "WAITING_AFFILIATE",
          affiliateLink: null,
          productId: { not: null },
        },
        select: { productId: true },
      });

      const productIds = [
        ...new Set(
          opportunities
            .map((o) => o.productId)
            .filter((p): p is string => Boolean(p)),
        ),
      ];

      if (productIds.length === 0) {
        return 0;
      }

      const offers = await client.marketplaceOffer.findMany({
        where: {
          marketplace: "MERCADO_LIVRE",
          productId: { in: productIds },
          affiliateLink: null,
        },
        select: {
          productId: true,
          externalId: true,
          sourceUrl: true,
        },
      });

      const pendingProducts = new Set(
        offers
          .filter((offer) =>
            isValidMercadoLivreListingIdentity({
              externalId: offer.externalId,
              listingItemId: offer.externalId,
              sourceUrl: offer.sourceUrl,
              origin: "listing",
            }),
          )
          .map((offer) => offer.productId),
      );

      return opportunities.filter(
        (o) => o.productId && pendingProducts.has(o.productId),
      ).length;
    },

    async findOfferById(offerId) {
      const row = await client.marketplaceOffer.findUnique({
        where: { id: offerId },
        select: {
          id: true,
          productId: true,
          marketplace: true,
          externalId: true,
          sourceUrl: true,
          affiliateLink: true,
        },
      });
      return row
        ? {
            id: row.id,
            productId: row.productId,
            marketplace: String(row.marketplace),
            externalId: row.externalId,
            sourceUrl: row.sourceUrl,
            affiliateLink: row.affiliateLink,
          }
        : null;
    },
  };
}
