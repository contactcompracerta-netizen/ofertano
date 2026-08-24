import type { AnalyticsAggGrain, ValidatedAnalyticsEvent } from "./types";

export type RollupWrite = {
  grain: AnalyticsAggGrain;
  dimensionKey: string;
  query: string | null;
  productId: string | null;
  marketplace: string | null;
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  deviceType: string | null;
  resultCount: number;
};

function baseWrite(
  event: ValidatedAnalyticsEvent,
  grain: AnalyticsAggGrain,
  dimensionKey: string,
  extras: Partial<RollupWrite> = {},
): RollupWrite {
  return {
    grain,
    dimensionKey,
    query: extras.query ?? null,
    productId: extras.productId ?? null,
    marketplace: extras.marketplace ?? null,
    source: extras.source ?? null,
    utmSource: extras.utmSource ?? null,
    utmMedium: extras.utmMedium ?? null,
    utmCampaign: extras.utmCampaign ?? null,
    deviceType: extras.deviceType ?? null,
    resultCount: event.resultCount ?? 0,
  };
}

export function buildRollupWrites(
  event: ValidatedAnalyticsEvent,
): RollupWrite[] {
  const writes: RollupWrite[] = [
    baseWrite(event, "TOTAL", "*"),
  ];

  if (event.normalizedQuery) {
    writes.push(
      baseWrite(event, "QUERY", event.normalizedQuery, {
        query: event.normalizedQuery,
      }),
    );
  }

  if (event.productId) {
    writes.push(
      baseWrite(event, "PRODUCT", event.productId, {
        productId: event.productId,
      }),
    );
  }

  if (event.marketplace) {
    writes.push(
      baseWrite(event, "MARKETPLACE", event.marketplace, {
        marketplace: event.marketplace,
      }),
    );
  }

  if (event.eventType === "PRODUCT_IMPRESSION") {
    for (const marketplace of marketplacesFromMetadata(event)) {
      if (marketplace === event.marketplace) {
        continue;
      }

      writes.push(
        baseWrite(event, "MARKETPLACE", marketplace, {
          marketplace,
        }),
      );
    }
  }

  if (event.source) {
    writes.push(
      baseWrite(event, "SOURCE", event.source, {
        source: event.source,
      }),
    );
  }

  if (event.utmSource || event.utmMedium || event.utmCampaign) {
    const key = [
      event.utmSource ?? "",
      event.utmMedium ?? "",
      event.utmCampaign ?? "",
    ].join("|");

    writes.push(
      baseWrite(event, "UTM", key, {
        utmSource: event.utmSource,
        utmMedium: event.utmMedium,
        utmCampaign: event.utmCampaign,
      }),
    );
  }

  writes.push(
    baseWrite(event, "DEVICE", event.deviceType, {
      deviceType: event.deviceType,
    }),
  );

  if (event.normalizedQuery && event.productId) {
    writes.push(
      baseWrite(
        event,
        "QUERY_PRODUCT",
        `${event.normalizedQuery}|${event.productId}`,
        {
          query: event.normalizedQuery,
          productId: event.productId,
        },
      ),
    );
  }

  const relatedIds = relatedProductIdsFromMetadata(event);

  for (const productId of relatedIds) {
    if (productId === event.productId) {
      continue;
    }

    writes.push(
      baseWrite(
        event,
        "QUERY_PRODUCT",
        `${event.normalizedQuery ?? ""}|${productId}`,
        {
          query: event.normalizedQuery,
          productId,
        },
      ),
    );
  }

  return writes;
}

export function relatedProductIdsFromMetadata(
  event: ValidatedAnalyticsEvent,
): string[] {
  if (!event.normalizedQuery || !event.metadata) {
    return [];
  }

  const raw = event.metadata.productIds;

  if (!Array.isArray(raw)) {
    return [];
  }

  const ids = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 80);

  return Array.from(new Set(ids)).slice(0, 12);
}

function marketplacesFromMetadata(
  event: ValidatedAnalyticsEvent,
): string[] {
  if (!event.metadata) {
    return [];
  }

  const raw = event.metadata.marketplaces;

  if (!Array.isArray(raw)) {
    return [];
  }

  const names = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 40);

  return Array.from(new Set(names)).slice(0, 8);
}
