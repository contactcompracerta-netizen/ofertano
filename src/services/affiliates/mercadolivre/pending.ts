import type { PrismaClient } from "@prisma/client";

export type MercadoLivrePending = {
  offerId: string;
  productId: string;
  externalId: string | null;
  sourceUrl: string | null;
  opportunityId: string | null;
};

export type MercadoLivrePendingStore = {
  listPendingMercadoLivreOffers(limit: number): Promise<MercadoLivrePending[]>;
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

      const offersByProduct = new Map<string, typeof offers[number]>();
      for (const offer of offers) {
        if (!offersByProduct.has(offer.productId)) {
          offersByProduct.set(offer.productId, offer);
        }
      }

      return opportunities
        .map((opportunity) => {
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
