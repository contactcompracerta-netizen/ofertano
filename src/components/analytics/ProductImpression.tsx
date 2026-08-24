"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { trackAnalyticsEvent } from "@/lib/analytics/tracker";

type ProductImpressionProps = {
  productId: string;
  position?: number | null;
  query?: string | null;
  marketplace?: string | null;
  surface?: string;
  children: ReactNode;
  className?: string;
};

export default function ProductImpression({
  productId,
  position,
  query,
  marketplace,
  surface = "list",
  children,
  className,
}: ProductImpressionProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    const node = ref.current;

    if (!node || sent.current || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (!entry?.isIntersecting || sent.current) {
          return;
        }

        sent.current = true;
        observer.disconnect();

        trackAnalyticsEvent({
          eventType: "PRODUCT_IMPRESSION",
          productId,
          position: position ?? null,
          query: query || null,
          marketplace: marketplace || null,
          metadata: {
            surface,
          },
        });
      },
      {
        threshold: 0.45,
        rootMargin: "0px 0px -8% 0px",
      },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [productId, position, query, marketplace, surface]);

  return (
    <div ref={ref} className={className ?? "h-full"}>
      {children}
    </div>
  );
}
