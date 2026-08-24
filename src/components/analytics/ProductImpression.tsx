"use client";

import { useContext, useEffect, useRef, type ReactNode } from "react";

import {
  IMPRESSION_VISIBILITY_THRESHOLD,
  isImpressionVisible,
  uniqueMarketplaces,
} from "@/lib/analytics/impression";
import { ListingOccurrenceContext } from "@/components/analytics/AnalyticsListingScope";
import {
  ensureListingOccurrence,
  trackAnalyticsEvent,
} from "@/lib/analytics/tracker";

type ProductImpressionProps = {
  productId: string;
  position?: number | null;
  query?: string | null;
  marketplace?: string | null;
  marketplaces?: string[] | null;
  surface?: string;
  children: ReactNode;
  className?: string;
};

export default function ProductImpression({
  productId,
  position,
  query,
  marketplace,
  marketplaces,
  surface = "list",
  children,
  className,
}: ProductImpressionProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const sentOccurrenceRef = useRef<string | null>(null);
  const scopedOccurrenceId = useContext(ListingOccurrenceContext);
  const marketplaceKey = uniqueMarketplaces([
    marketplace,
    ...(marketplaces ?? []),
  ]).join("|");

  useEffect(() => {
    const occurrenceId =
      scopedOccurrenceId || ensureListingOccurrence(surface, query ?? "");
    const node = ref.current;

    if (!occurrenceId || !node || typeof IntersectionObserver === "undefined") {
      return;
    }

    if (sentOccurrenceRef.current === occurrenceId) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (
          !isImpressionVisible(entry) ||
          sentOccurrenceRef.current === occurrenceId
        ) {
          return;
        }

        sentOccurrenceRef.current = occurrenceId;
        observer.disconnect();

        const attributedMarketplaces = uniqueMarketplaces([
          marketplace,
          ...(marketplaces ?? []),
        ]);

        trackAnalyticsEvent({
          eventType: "PRODUCT_IMPRESSION",
          productId,
          position: position ?? null,
          query: query || null,
          metadata: {
            surface,
            occurrenceId,
            ...(attributedMarketplaces.length > 0
              ? { marketplaces: attributedMarketplaces }
              : {}),
          },
        });
      },
      {
        threshold: IMPRESSION_VISIBILITY_THRESHOLD,
        rootMargin: "0px 0px -8% 0px",
      },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [
    productId,
    position,
    query,
    marketplace,
    marketplaceKey,
    surface,
    scopedOccurrenceId,
  ]);

  return (
    <div ref={ref} className={className ?? "h-full"}>
      {children}
    </div>
  );
}
