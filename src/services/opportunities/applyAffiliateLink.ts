import type { OpportunityStatus, PrismaClient } from "@prisma/client";

import { validateOfficialMercadoLivreAffiliateLink } from "@/lib/affiliates/validateAdminAffiliateLink";
import {
  opportunityAlteraOutroProduct,
  type ExactOfferSnapshot,
  type OpportunitySnapshot,
} from "@/services/opportunities/lowestPriceAffiliateOpportunity";

export type ApplyAffiliateLinkInput = {
  affiliateLink: string;
  opportunityId?: string;
  offerId?: string;
};

export type ApplyAffiliateLinkResult =
  | {
      ok: true;
      offerId: string;
      opportunityId: string | null;
      productId: string;
      otherOfferIdsUnchanged: string[];
    }
  | {
      ok: false;
      code:
        | "INVALID_AFFILIATE_LINK"
        | "OPPORTUNITY_NOT_FOUND"
        | "OFFER_NOT_FOUND"
        | "PRODUCT_MISMATCH"
        | "EXTERNAL_ID_MISMATCH"
        | "NOT_MERCADO_LIVRE";
      error: string;
    };

export type ApplyAffiliateLinkStore = {
  findOpportunityById(id: string): Promise<OpportunitySnapshot | null>;
  findOfferById(id: string): Promise<ExactOfferSnapshot | null>;
  findMercadoLivreOfferForProduct(
    productId: string,
  ): Promise<ExactOfferSnapshot | null>;
  listOfferIdsForProduct(productId: string): Promise<string[]>;
  activateOfferAffiliate(
    offer: ExactOfferSnapshot,
    affiliateLink: string,
  ): Promise<void>;
  resolveOpportunitiesForOffer(
    offer: ExactOfferSnapshot,
    affiliateLink: string,
    preferredOpportunityId?: string | null,
  ): Promise<string | null>;
};

type PrismaLike = Pick<PrismaClient, "marketplaceOffer" | "productOpportunity">;

function toOffer(row: {
  id: string;
  productId: string;
  marketplace: string;
  externalId: string | null;
  sourceUrl: string | null;
  affiliateLink: string | null;
  title: string | null;
  image: string | null;
  price: number;
  oldPrice: number | null;
  matchStatus: string;
  status: string;
  available: boolean;
  active: boolean;
}): ExactOfferSnapshot {
  return {
    id: row.id,
    productId: row.productId,
    marketplace: String(row.marketplace),
    externalId: row.externalId,
    sourceUrl: row.sourceUrl,
    affiliateLink: row.affiliateLink,
    title: row.title,
    image: row.image,
    price: row.price,
    oldPrice: row.oldPrice,
    matchStatus: String(row.matchStatus),
    status: String(row.status),
    available: row.available,
    active: row.active,
  };
}

function toOpportunity(row: {
  id: string;
  productId: string | null;
  marketplace: string;
  externalId: string;
  sourceUrl: string;
  status: OpportunityStatus | string;
  affiliateLink: string | null;
  matchStatus: string | null;
}): OpportunitySnapshot {
  return {
    id: row.id,
    productId: row.productId,
    marketplace: String(row.marketplace),
    externalId: row.externalId,
    sourceUrl: row.sourceUrl,
    status: row.status,
    affiliateLink: row.affiliateLink,
    matchStatus: row.matchStatus,
  };
}

export function offerPertenceAOportunidade(
  opportunity: OpportunitySnapshot,
  offer: ExactOfferSnapshot,
): { ok: true } | { ok: false; code: "PRODUCT_MISMATCH" | "EXTERNAL_ID_MISMATCH" | "NOT_MERCADO_LIVRE" } {
  if (String(offer.marketplace) !== "MERCADO_LIVRE") {
    return { ok: false, code: "NOT_MERCADO_LIVRE" };
  }

  if (String(opportunity.marketplace) !== "MERCADO_LIVRE") {
    return { ok: false, code: "NOT_MERCADO_LIVRE" };
  }

  if (opportunityAlteraOutroProduct(opportunity, offer)) {
    return { ok: false, code: "PRODUCT_MISMATCH" };
  }

  const opportunityExternalId = opportunity.externalId.trim();
  const offerExternalId = offer.externalId?.trim() || "";

  if (
    opportunityExternalId &&
    offerExternalId &&
    opportunityExternalId !== offerExternalId
  ) {
    return { ok: false, code: "EXTERNAL_ID_MISMATCH" };
  }

  return { ok: true };
}

export function createPrismaApplyAffiliateLinkStore(
  client: PrismaLike,
): ApplyAffiliateLinkStore {
  return {
    async findOpportunityById(id) {
      const row = await client.productOpportunity.findUnique({
        where: { id },
        select: {
          id: true,
          productId: true,
          marketplace: true,
          externalId: true,
          sourceUrl: true,
          status: true,
          affiliateLink: true,
          matchStatus: true,
        },
      });

      return row ? toOpportunity(row) : null;
    },

    async findOfferById(id) {
      const row = await client.marketplaceOffer.findUnique({
        where: { id },
        select: {
          id: true,
          productId: true,
          marketplace: true,
          externalId: true,
          sourceUrl: true,
          affiliateLink: true,
          title: true,
          image: true,
          price: true,
          oldPrice: true,
          matchStatus: true,
          status: true,
          available: true,
          active: true,
        },
      });

      return row ? toOffer(row) : null;
    },

    async findMercadoLivreOfferForProduct(productId) {
      const row = await client.marketplaceOffer.findUnique({
        where: {
          productId_marketplace: {
            productId,
            marketplace: "MERCADO_LIVRE",
          },
        },
        select: {
          id: true,
          productId: true,
          marketplace: true,
          externalId: true,
          sourceUrl: true,
          affiliateLink: true,
          title: true,
          image: true,
          price: true,
          oldPrice: true,
          matchStatus: true,
          status: true,
          available: true,
          active: true,
        },
      });

      return row ? toOffer(row) : null;
    },

    async listOfferIdsForProduct(productId) {
      const rows = await client.marketplaceOffer.findMany({
        where: { productId },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },

    async activateOfferAffiliate(offer, affiliateLink) {
      const validatedAt = new Date();

      await client.marketplaceOffer.updateMany({
        where: {
          id: offer.id,
          productId: offer.productId,
          marketplace: "MERCADO_LIVRE",
        },
        data: {
          affiliateLink,
          status: "ACTIVE",
          active: true,
          available: true,
          reviewReason: null,
          errorMessage: null,
          affiliateValidatedAt: validatedAt,
          reviewedAt: validatedAt,
        },
      });
    },

    async resolveOpportunitiesForOffer(
      offer,
      affiliateLink,
      preferredOpportunityId,
    ) {
      const now = new Date();
      const externalId = offer.externalId?.trim() || "";

      await client.productOpportunity.updateMany({
        where: {
          marketplace: "MERCADO_LIVRE",
          productId: offer.productId,
          ...(externalId ? { externalId } : {}),
          status: {
            in: ["WAITING_AFFILIATE", "READY_TO_QUEUE", "ERROR", "QUEUED"],
          },
        },
        data: {
          affiliateLink,
          status: "PUBLISHED",
          publishedAt: now,
          errorMessage: null,
          reviewReason: null,
        },
      });

      if (preferredOpportunityId) {
        await client.productOpportunity.updateMany({
          where: {
            id: preferredOpportunityId,
            productId: offer.productId,
            marketplace: "MERCADO_LIVRE",
          },
          data: {
            affiliateLink,
            status: "PUBLISHED",
            publishedAt: now,
            errorMessage: null,
            reviewReason: null,
          },
        });
        return preferredOpportunityId;
      }

      const resolved = await client.productOpportunity.findMany({
        where: {
          marketplace: "MERCADO_LIVRE",
          productId: offer.productId,
          ...(externalId ? { externalId } : {}),
          status: "PUBLISHED",
        },
        select: { id: true },
        take: 1,
      });

      return resolved[0]?.id ?? null;
    },
  };
}

export async function applyConfirmedAffiliateLinkToOwnedOffer(
  input: ApplyAffiliateLinkInput,
  store: ApplyAffiliateLinkStore,
): Promise<ApplyAffiliateLinkResult> {
  const affiliateLink = validateOfficialMercadoLivreAffiliateLink(
    input.affiliateLink,
  );

  if (!affiliateLink) {
    return {
      ok: false,
      code: "INVALID_AFFILIATE_LINK",
      error: "Informe um link de afiliado confirmado do Mercado Livre.",
    };
  }

  let opportunity: OpportunitySnapshot | null = null;
  let offer: ExactOfferSnapshot | null = null;

  if (input.opportunityId?.trim()) {
    opportunity = await store.findOpportunityById(input.opportunityId.trim());
    if (!opportunity) {
      return {
        ok: false,
        code: "OPPORTUNITY_NOT_FOUND",
        error: "Oportunidade não encontrada.",
      };
    }

    if (!opportunity.productId?.trim()) {
      return {
        ok: false,
        code: "OFFER_NOT_FOUND",
        error: "A oportunidade ainda não está vinculada a um Product.",
      };
    }

    offer = await store.findMercadoLivreOfferForProduct(
      opportunity.productId,
    );
  }

  if (input.offerId?.trim()) {
    const byId = await store.findOfferById(input.offerId.trim());
    if (!byId) {
      return {
        ok: false,
        code: "OFFER_NOT_FOUND",
        error: "Oferta não encontrada.",
      };
    }
    offer = byId;
  }

  if (!offer) {
    return {
      ok: false,
      code: "OFFER_NOT_FOUND",
      error: "MarketplaceOffer do Mercado Livre não encontrada.",
    };
  }

  if (opportunity) {
    const ownership = offerPertenceAOportunidade(opportunity, offer);
    if (!ownership.ok) {
      return {
        ok: false,
        code: ownership.code,
        error:
          ownership.code === "PRODUCT_MISMATCH"
            ? "A oportunidade não pode alterar a oferta de outro Product."
            : ownership.code === "EXTERNAL_ID_MISMATCH"
              ? "A oportunidade não corresponde à MarketplaceOffer deste Product."
              : "Esta operação aceita somente ofertas do Mercado Livre.",
      };
    }
  }

  const offerIds = await store.listOfferIdsForProduct(offer.productId);
  await store.activateOfferAffiliate(offer, affiliateLink);
  const opportunityId = await store.resolveOpportunitiesForOffer(
    offer,
    affiliateLink,
    opportunity?.id ?? input.opportunityId?.trim() ?? null,
  );

  return {
    ok: true,
    offerId: offer.id,
    opportunityId,
    productId: offer.productId,
    otherOfferIdsUnchanged: offerIds.filter((id) => id !== offer.id),
  };
}

export async function applyConfirmedAffiliateLinkWithProductSync(
  input: ApplyAffiliateLinkInput,
): Promise<ApplyAffiliateLinkResult> {
  const prisma = (await import("@/lib/prisma")).default;
  const { sincronizarMelhorOfertaDoProduto } = await import(
    "@/services/database/saveProduct"
  );
  const result = await applyConfirmedAffiliateLinkToOwnedOffer(
    input,
    createPrismaApplyAffiliateLinkStore(prisma),
  );

  if (result.ok) {
    await prisma.$transaction(async (tx) => {
      await sincronizarMelhorOfertaDoProduto(tx, result.productId);
    });
  }

  return result;
}
