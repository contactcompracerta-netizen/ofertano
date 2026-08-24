"use client";

import type { AnchorHTMLAttributes, MouseEvent, PointerEvent, ReactNode } from "react";

import {
  getRememberedAnalyticsQuery,
  trackAnalyticsEvent,
} from "@/lib/analytics/tracker";

type MarketplaceClickAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  productId: string;
  marketplace: string;
  position?: number | null;
  price?: number | null;
  children: ReactNode;
};

export default function MarketplaceClickAnchor({
  productId,
  marketplace,
  position,
  price,
  children,
  onClick,
  onPointerDown,
  ...props
}: MarketplaceClickAnchorProps) {
  function trackClick() {
    trackAnalyticsEvent(
      {
        eventType: "MARKETPLACE_CLICK",
        productId,
        marketplace,
        position: position ?? null,
        query: getRememberedAnalyticsQuery(),
        metadata: {
          surface: "product",
          ...(typeof price === "number" ? { price } : {}),
        },
      },
      { immediate: true },
    );
  }

  function handlePointerDown(event: PointerEvent<HTMLAnchorElement>) {
    trackClick();
    onPointerDown?.(event);
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    trackClick();
    onClick?.(event);
  }

  return (
    <a
      {...props}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
