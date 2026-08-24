"use client";

import { useEffect } from "react";

import {
  beginListingOccurrence,
  rememberAnalyticsQuery,
  trackAnalyticsEvent,
} from "@/lib/analytics/tracker";

type SearchAnalyticsProps = {
  query: string;
  resultCount: number;
  durationMs?: number;
  searchSource?: string;
  productIds?: string[];
};

export default function SearchAnalytics({
  query,
  resultCount,
  durationMs,
  searchSource,
  productIds = [],
}: SearchAnalyticsProps) {
  useEffect(() => {
    const termo = query.replace(/\s+/g, " ").trim();

    if (termo.length < 1) {
      return;
    }

    rememberAnalyticsQuery(termo);
    beginListingOccurrence("search", termo);

    const relatedIds = productIds.slice(0, 12);
    const metadata = {
      ...(typeof durationMs === "number" ? { durationMs } : {}),
      ...(searchSource ? { searchSource } : {}),
      ...(relatedIds.length > 0 ? { productIds: relatedIds } : {}),
      surface: "search",
    };

    trackAnalyticsEvent({
      eventType: "SEARCH",
      query: termo,
      resultCount,
      metadata,
    });

    if (resultCount > 0) {
      trackAnalyticsEvent({
        eventType: "SEARCH_RESULT",
        query: termo,
        resultCount,
        metadata,
      });
      return;
    }

    trackAnalyticsEvent({
      eventType: "ZERO_RESULT",
      query: termo,
      resultCount: 0,
      metadata,
    });
  }, [query, resultCount, durationMs, searchSource, productIds.join("|")]);

  return null;
}
