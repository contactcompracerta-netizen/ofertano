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

export default function ProductViewTracker({
  productId,
  offers = [],
}: ProductViewTrackerProps) {
  useEffect(() => {
    const query = getRememberedAnalyticsQuery();
    const marketplaces = Array.from(
      new Set(offers.map((offer) => offer.marketplace).filter(Boolean)),
    );

    trackAnalyticsEvent({
      eventType: "PRODUCT_VIEW",
      productId,
      query,
      metadata: {
        surface: "product",
        offerCount: offers.length,
        marketplaces,
      },
    });

    offers.forEach((offer) => {
      trackAnalyticsEvent({
        eventType: "PRODUCT_IMPRESSION",
        productId,
        marketplace: offer.marketplace,
        position: offer.position,
        query,
        metadata: {
          surface: "product_offer",
          ...(typeof offer.price === "number" ? { price: offer.price } : {}),
        },
      });
    });
  }, [productId, offers]);

  return null;
}
