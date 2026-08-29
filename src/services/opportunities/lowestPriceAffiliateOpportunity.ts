import type {
  Marketplace,
  OpportunityStatus,
  PrismaClient,
  ProductMatchStatus,
} from "@prisma/client";

import {
  confirmarAffiliateLinkMercadoLivre,
  ehMarketplaceMercadoLivre,
} from "@/lib/affiliates/publicPurchase";

export const PUBLIC_SEARCH_MISSING_AFFILIATE_REASON =
  "PUBLIC_SEARCH_LOWEST_PRICE_MISSING_AFFILIATE";

export type ExactOfferSnapshot = {
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
};

export type OpportunitySnapshot = {
  id: string;
  productId: string | null;
  marketplace: string;
  externalId: string;
  sourceUrl: string;
  status: OpportunityStatus | string;
  affiliateLink: string | null;
  matchStatus: ProductMatchStatus | string | null;
};

export type LowestPriceAffiliateDecision =
  | {
      action: "SKIP";
      reason:
        | "NO_EXACT_OFFERS"
        | "ML_NOT_EXACT"
        | "ML_NOT_LOWEST"
        | "ML_HAS_AFFILIATE"
        | "ML_MISSING_EXTERNAL_ID";
    }
  | {
      action: "CREATE_PENDING";
      reason: "ML_LOWEST_WITHOUT_AFFILIATE";
      offer: ExactOfferSnapshot;
    }
  | {
      action: "REUSE_PENDING";
      reason: "PENDING_ALREADY_EXISTS";
      offer: ExactOfferSnapshot;
      opportunity: OpportunitySnapshot;
    }
  | {
      action: "SKIP";
      reason: "OPPORTUNITY_ALREADY_RESOLVED" | "OPPORTUNITY_DISMISSED";
      opportunity: OpportunitySnapshot;
      offer: ExactOfferSnapshot;
    };

const PRICE_TIE_EPSILON = 0.009;

const PENDING_STATUSES = new Set(["WAITING_AFFILIATE", "ERROR"]);
const RESOLVED_STATUSES = new Set([
  "READY_TO_QUEUE",
  "QUEUED",
  "PUBLISHED",
]);

export function ofertaExataParticipaDaComparacao(
  offer: ExactOfferSnapshot,
): boolean {
  if (!offer.active) {
    return false;
  }

  if (offer.matchStatus !== "EXACT") {
    return false;
  }

  if (!offer.available) {
    return false;
  }

  if (offer.status === "UNAVAILABLE" || offer.status === "ERROR") {
    return false;
  }

  return Number.isFinite(offer.price) && offer.price > 0;
}

export function affiliateLinkUtilizavelMercadoLivre(
  offer: Pick<ExactOfferSnapshot, "affiliateLink" | "sourceUrl">,
): string | null {
  return confirmarAffiliateLinkMercadoLivre(offer);
}

export function decidirOportunidadeAfiliadoMenorPreco(
  offers: ExactOfferSnapshot[],
  opportunities: OpportunitySnapshot[] = [],
): LowestPriceAffiliateDecision {
  const comparaveis = offers.filter(ofertaExataParticipaDaComparacao);

  if (comparaveis.length === 0) {
    return { action: "SKIP", reason: "NO_EXACT_OFFERS" };
  }

  const lowestPrice = Math.min(...comparaveis.map((offer) => offer.price));
  const mercadoLivre = comparaveis.find((offer) =>
    ehMarketplaceMercadoLivre(offer.marketplace),
  );

  if (!mercadoLivre) {
    return { action: "SKIP", reason: "ML_NOT_EXACT" };
  }

  if (mercadoLivre.price - lowestPrice > PRICE_TIE_EPSILON) {
    return { action: "SKIP", reason: "ML_NOT_LOWEST" };
  }

  if (affiliateLinkUtilizavelMercadoLivre(mercadoLivre)) {
    return { action: "SKIP", reason: "ML_HAS_AFFILIATE" };
  }

  if (!mercadoLivre.externalId?.trim()) {
    return { action: "SKIP", reason: "ML_MISSING_EXTERNAL_ID" };
  }

  const existing = escolherOportunidadeExistente(
    mercadoLivre,
    opportunities,
  );

  if (existing) {
    if (PENDING_STATUSES.has(String(existing.status))) {
      return {
        action: "REUSE_PENDING",
        reason: "PENDING_ALREADY_EXISTS",
        offer: mercadoLivre,
        opportunity: existing,
      };
    }

    if (String(existing.status) === "DISMISSED") {
      return {
        action: "SKIP",
        reason: "OPPORTUNITY_DISMISSED",
        opportunity: existing,
        offer: mercadoLivre,
      };
    }

    if (RESOLVED_STATUSES.has(String(existing.status))) {
      return {
        action: "SKIP",
        reason: "OPPORTUNITY_ALREADY_RESOLVED",
        opportunity: existing,
        offer: mercadoLivre,
      };
    }
  }

  return {
    action: "CREATE_PENDING",
    reason: "ML_LOWEST_WITHOUT_AFFILIATE",
    offer: mercadoLivre,
  };
}

export function escolherOportunidadeExistente(
  offer: ExactOfferSnapshot,
  opportunities: OpportunitySnapshot[],
): OpportunitySnapshot | null {
  const externalId = offer.externalId?.trim() || "";
  const sameListing = opportunities.find(
    (opportunity) =>
      ehMarketplaceMercadoLivre(opportunity.marketplace) &&
      opportunity.externalId === externalId,
  );

  if (sameListing) {
    if (
      sameListing.productId &&
      offer.productId &&
      sameListing.productId !== offer.productId
    ) {
      return null;
    }

    return sameListing;
  }

  const pendingSameProduct = opportunities.find(
    (opportunity) =>
      ehMarketplaceMercadoLivre(opportunity.marketplace) &&
      opportunity.productId === offer.productId &&
      PENDING_STATUSES.has(String(opportunity.status)),
  );

  return pendingSameProduct ?? null;
}

export function opportunityAlteraOutroProduct(
  opportunity: Pick<OpportunitySnapshot, "productId">,
  offer: Pick<ExactOfferSnapshot, "productId">,
): boolean {
  const opportunityProductId = opportunity.productId?.trim() || "";
  const offerProductId = offer.productId.trim();

  if (!opportunityProductId || !offerProductId) {
    return false;
  }

  return opportunityProductId !== offerProductId;
}

export type AffiliateOpportunityStore = {
  listExactOffers(productId: string): Promise<ExactOfferSnapshot[]>;
  listOpportunitiesForOffers(
    productId: string,
    offers: ExactOfferSnapshot[],
  ): Promise<OpportunitySnapshot[]>;
  createPendingOpportunity(
    offer: ExactOfferSnapshot,
  ): Promise<OpportunitySnapshot>;
  reusePendingOpportunity(
    opportunity: OpportunitySnapshot,
    offer: ExactOfferSnapshot,
  ): Promise<OpportunitySnapshot>;
  markOfferAwaitingAffiliate(offer: ExactOfferSnapshot): Promise<void>;
};

type PrismaLike = Pick<PrismaClient, "marketplaceOffer" | "productOpportunity">;

function toOfferSnapshot(row: {
  id: string;
  productId: string;
  marketplace: Marketplace | string;
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

function toOpportunitySnapshot(row: {
  id: string;
  productId: string | null;
  marketplace: Marketplace | string;
  externalId: string;
  sourceUrl: string;
  status: OpportunityStatus | string;
  affiliateLink: string | null;
  matchStatus: ProductMatchStatus | string | null;
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

export function createPrismaAffiliateOpportunityStore(
  client: PrismaLike,
): AffiliateOpportunityStore {
  return {
    async listExactOffers(productId) {
      const rows = await client.marketplaceOffer.findMany({
        where: {
          productId,
          active: true,
          matchStatus: "EXACT",
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

      return rows.map(toOfferSnapshot);
    },

    async listOpportunitiesForOffers(productId, offers) {
      const externalIds = offers
        .map((offer) => offer.externalId?.trim() || "")
        .filter(Boolean);

      const rows = await client.productOpportunity.findMany({
        where: {
          marketplace: "MERCADO_LIVRE",
          OR: [
            { productId },
            ...(externalIds.length > 0
              ? [{ externalId: { in: externalIds } }]
              : []),
          ],
        },
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

      return rows.map(toOpportunitySnapshot);
    },

    async createPendingOpportunity(offer) {
      const created = await client.productOpportunity.create({
        data: {
          marketplace: "MERCADO_LIVRE",
          externalId: offer.externalId!.trim(),
          sourceType: "SEARCH_RESULT",
          sourceUrl: offer.sourceUrl?.trim() || "",
          title: offer.title?.trim() || "Oferta Mercado Livre",
          image: offer.image,
          price: offer.price,
          oldPrice: offer.oldPrice,
          affiliateLink: null,
          status: "WAITING_AFFILIATE",
          matchStatus: "EXACT",
          reviewReason: PUBLIC_SEARCH_MISSING_AFFILIATE_REASON,
          productId: offer.productId,
        },
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

      return toOpportunitySnapshot(created);
    },

    async reusePendingOpportunity(opportunity, offer) {
      const updated = await client.productOpportunity.update({
        where: { id: opportunity.id },
        data: {
          productId: offer.productId,
          externalId: offer.externalId!.trim(),
          sourceUrl: offer.sourceUrl?.trim() || opportunity.sourceUrl,
          title: offer.title?.trim() || undefined,
          image: offer.image ?? undefined,
          price: offer.price,
          oldPrice: offer.oldPrice,
          affiliateLink: null,
          status: "WAITING_AFFILIATE",
          matchStatus: "EXACT",
          reviewReason: PUBLIC_SEARCH_MISSING_AFFILIATE_REASON,
          errorMessage: null,
        },
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

      return toOpportunitySnapshot(updated);
    },

    async markOfferAwaitingAffiliate(offer) {
      const sourceUrl = offer.sourceUrl?.trim() || "";
      const affiliateLink = offer.affiliateLink?.trim() || "";
      const copiedSource =
        Boolean(sourceUrl) &&
        Boolean(affiliateLink) &&
        affiliateLink === sourceUrl &&
        !affiliateLinkUtilizavelMercadoLivre(offer);

      await client.marketplaceOffer.updateMany({
        where: {
          id: offer.id,
          productId: offer.productId,
          marketplace: "MERCADO_LIVRE",
        },
        data: {
          status: "PENDING_AFFILIATE",
          ...(copiedSource || !affiliateLink
            ? { affiliateLink: null }
            : {}),
        },
      });
    },
  };
}

export type EnsureLowestPriceAffiliateResult = {
  decision: LowestPriceAffiliateDecision;
  opportunityId: string | null;
};

export async function ensureMercadoLivreLowestPriceAffiliateOpportunity(
  productId: string,
  store: AffiliateOpportunityStore,
): Promise<EnsureLowestPriceAffiliateResult> {
  const offers = await store.listExactOffers(productId);
  const opportunities = await store.listOpportunitiesForOffers(
    productId,
    offers,
  );
  const decision = decidirOportunidadeAfiliadoMenorPreco(
    offers,
    opportunities,
  );

  if (decision.action === "SKIP") {
    return { decision, opportunityId: null };
  }

  await store.markOfferAwaitingAffiliate(decision.offer);

  if (decision.action === "REUSE_PENDING") {
    const reused = await store.reusePendingOpportunity(
      decision.opportunity,
      decision.offer,
    );
    return { decision, opportunityId: reused.id };
  }

  try {
    const created = await store.createPendingOpportunity(decision.offer);
    return { decision, opportunityId: created.id };
  } catch (error) {
    const latest = await store.listOpportunitiesForOffers(productId, offers);
    const existing = escolherOportunidadeExistente(decision.offer, latest);

    if (existing && PENDING_STATUSES.has(String(existing.status))) {
      const reused = await store.reusePendingOpportunity(
        existing,
        decision.offer,
      );
      return {
        decision: {
          action: "REUSE_PENDING",
          reason: "PENDING_ALREADY_EXISTS",
          offer: decision.offer,
          opportunity: reused,
        },
        opportunityId: reused.id,
      };
    }

    throw error;
  }
}

export async function ensureMercadoLivreLowestPriceAffiliateOpportunitySafe(
  productId: string,
): Promise<void> {
  const id = productId.trim();
  if (!id) {
    return;
  }

  try {
    const prisma = (await import("@/lib/prisma")).default;
    const result = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
      id,
      createPrismaAffiliateOpportunityStore(prisma),
    );

    if (
      result.opportunityId &&
      (result.decision.action === "CREATE_PENDING" ||
        result.decision.action === "REUSE_PENDING")
    ) {
      const { notifyPendingAffiliateOpportunitySafe } = await import(
        "@/services/admin-push/notify"
      );
      notifyPendingAffiliateOpportunitySafe(result.opportunityId);
    }
  } catch (error) {
    console.error(
      "[AFFILIATE-REALTIME] Falha ao garantir Opportunity de menor preco ML:",
      error,
    );
  }
}
