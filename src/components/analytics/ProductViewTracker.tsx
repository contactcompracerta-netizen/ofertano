"use client";

import { useEffect } from "react";

import {
  getRememberedAnalyticsQuery,
  trackAnalyticsEvent,
} from "@/lib/analytics/tracker";

type OfferImpression = {
  marketplace: string;
  position: number;
  price?: number | null;
};

type ProductViewTrackerProps = {
  productId: string;
  offers?: OfferImpression[];
};

export function buildProductViewAnalyticsEvent(input: {
  productId: string;
  query?: string | null;
  offers?: OfferImpression[];
}) {
  const offers = input.offers ?? [];
  const marketplaces = Array.from(
    new Set(offers.map((offer) => offer.marketplace).filter(Boolean)),
  );

  return {
    eventType: "PRODUCT_VIEW" as const,
    productId: input.productId,
    query: input.query ?? null,
    metadata: {
      surface: "product",
      offerCount: offers.length,
      marketplaces,
    },
  };
}

export default function ProductViewTracker({
  productId,
  offers = [],
}: ProductViewTrackerProps) {
  const offerKey = offers
    .map((offer) => `${offer.marketplace}:${offer.position}`)
    .join("|");

  useEffect(() => {
    const query = getRememberedAnalyticsQuery();

    trackAnalyticsEvent(
      buildProductViewAnalyticsEvent({
        productId,
        query,
        offers,
      }),
    );
  }, [productId, offerKey]);

  return null;
}
