import prisma from "@/lib/prisma";

import {
  findSecondLowestOffer,
  isWaitingAffiliateStatus,
  marketplaceLabel,
  type ComparableOffer,
} from "./eligibility";

export type OpportunityInboxItem = {
  id: string;
  focusId: string;
  source: "opportunity" | "offer";
  opportunityId: string | null;
  offerId: string | null;
  productId: string | null;
  title: string;
  image: string | null;
  sourceUrl: string;
  mlPrice: number | null;
  secondPrice: number | null;
  secondMarketplace: string | null;
  savings: number | null;
  discoveredAt: string;
  status: string;
  affiliateLink: string | null;
};

function toComparable(offer: {
  id: string;
  marketplace: string;
  price: number;
  status: string;
  matchStatus: string;
  available: boolean;
  active: boolean;
  affiliateLink: string | null;
}): ComparableOffer {
  return { ...offer };
}

function savingsBetween(mlPrice: number, secondPrice: number | null) {
  if (secondPrice === null || secondPrice <= mlPrice) {
    return null;
  }

  return Number((secondPrice - mlPrice).toFixed(2));
}

export async function loadOpportunityInbox(): Promise<
  OpportunityInboxItem[]
> {
  const waitingOpportunities = await prisma.productOpportunity.findMany({
    where: {
      marketplace: "MERCADO_LIVRE",
      status: "WAITING_AFFILIATE",
    },
    orderBy: {
      discoveredAt: "desc",
    },
    take: 50,
    select: {
      id: true,
      productId: true,
      title: true,
      image: true,
      sourceUrl: true,
      price: true,
      affiliateLink: true,
      status: true,
      discoveredAt: true,
      externalId: true,
    },
  });

  const productIds = Array.from(
    new Set(
      waitingOpportunities
        .map((item) => item.productId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const siblingOffers =
    productIds.length > 0
      ? await prisma.marketplaceOffer.findMany({
          where: {
            productId: {
              in: productIds,
            },
          },
          select: {
            id: true,
            productId: true,
            marketplace: true,
            price: true,
            status: true,
            matchStatus: true,
            available: true,
            active: true,
            affiliateLink: true,
            externalId: true,
          },
        })
      : [];

  const siblingsByProduct = new Map<string, ComparableOffer[]>();
  const offersByProduct = new Map<string, typeof siblingOffers>();

  for (const offer of siblingOffers) {
    const current = siblingsByProduct.get(offer.productId) ?? [];
    current.push(toComparable(offer));
    siblingsByProduct.set(offer.productId, current);

    const rows = offersByProduct.get(offer.productId) ?? [];
    rows.push(offer);
    offersByProduct.set(offer.productId, rows);
  }

  const inbox: OpportunityInboxItem[] = waitingOpportunities.map(
    (opportunity) => {
      const comparable = opportunity.productId
        ? (siblingsByProduct.get(opportunity.productId) ?? [])
        : [];
      const rows = opportunity.productId
        ? (offersByProduct.get(opportunity.productId) ?? [])
        : [];

      const mlOffer =
        rows.find(
          (item) =>
            item.marketplace === "MERCADO_LIVRE" &&
            (!opportunity.externalId ||
              !item.externalId ||
              item.externalId === opportunity.externalId),
        ) ??
        rows.find((item) => item.marketplace === "MERCADO_LIVRE") ??
        null;

      const second = mlOffer
        ? findSecondLowestOffer(mlOffer.id, comparable)
        : findSecondLowestOffer("", comparable);

      const mlPrice = mlOffer?.price ?? opportunity.price;

      return {
        id: opportunity.id,
        focusId: opportunity.id,
        source: "opportunity" as const,
        opportunityId: opportunity.id,
        offerId: mlOffer?.id ?? null,
        productId: opportunity.productId,
        title: opportunity.title,
        image: opportunity.image,
        sourceUrl: opportunity.sourceUrl,
        mlPrice,
        secondPrice: second?.price ?? null,
        secondMarketplace: marketplaceLabel(second?.marketplace ?? null),
        savings:
          mlPrice === null
            ? null
            : savingsBetween(mlPrice, second?.price ?? null),
        discoveredAt: opportunity.discoveredAt.toISOString(),
        status: opportunity.status,
        affiliateLink: opportunity.affiliateLink,
      };
    },
  );

  return inbox.filter((item) => isWaitingAffiliateStatus(item.status));
}

export function enrichOpportunityComparison(
  opportunity: {
    id: string;
    productId: string | null;
    price: number | null;
  },
  siblingsByProduct: Map<string, ComparableOffer[]>,
) {
  if (!opportunity.productId) {
    return {
      secondPrice: null as number | null,
      secondMarketplace: null as string | null,
      savings: null as number | null,
    };
  }

  const comparable = siblingsByProduct.get(opportunity.productId) ?? [];
  const mlSibling = comparable.find(
    (item) => item.marketplace === "MERCADO_LIVRE",
  );
  const excludeId = mlSibling?.id ?? opportunity.id;
  const second = findSecondLowestOffer(excludeId, comparable);
  const mlPrice = mlSibling?.price ?? opportunity.price;

  return {
    secondPrice: second?.price ?? null,
    secondMarketplace: marketplaceLabel(second?.marketplace ?? null),
    savings:
      mlPrice === null
        ? null
        : savingsBetween(mlPrice, second?.price ?? null),
  };
}
