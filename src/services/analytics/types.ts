export const ANALYTICS_EVENT_TYPES = [
  "SEARCH",
  "SEARCH_RESULT",
  "ZERO_RESULT",
  "PRODUCT_IMPRESSION",
  "PRODUCT_VIEW",
  "MARKETPLACE_CLICK",
  "FAVORITE_ADD",
  "FAVORITE_REMOVE",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export const ANALYTICS_DEVICE_TYPES = [
  "mobile",
  "desktop",
  "tablet",
  "unknown",
] as const;

export type AnalyticsDeviceType = (typeof ANALYTICS_DEVICE_TYPES)[number];

export const ANALYTICS_AGG_GRAINS = [
  "TOTAL",
  "QUERY",
  "PRODUCT",
  "MARKETPLACE",
  "SOURCE",
  "UTM",
  "DEVICE",
  "QUERY_PRODUCT",
] as const;

export type AnalyticsAggGrain = (typeof ANALYTICS_AGG_GRAINS)[number];

export const TRAFFIC_ORIGINS = [
  "Direct",
  "Google",
  "Instagram",
  "Facebook",
  "Outras",
] as const;

export type TrafficOrigin = (typeof TRAFFIC_ORIGINS)[number];

export type AnalyticsMetadata = Record<
  string,
  string | number | boolean | null | Array<string | number | boolean | null>
>;

export type AnalyticsEventInput = {
  eventType: string;
  sessionId: string;
  productId?: string | null;
  query?: string | null;
  marketplace?: string | null;
  position?: number | null;
  resultCount?: number | null;
  source?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  deviceType?: string | null;
  metadata?: unknown;
};

export type ValidatedAnalyticsEvent = {
  eventType: string;
  sessionId: string;
  productId: string | null;
  query: string | null;
  normalizedQuery: string | null;
  marketplace: string | null;
  position: number | null;
  resultCount: number | null;
  source: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  deviceType: AnalyticsDeviceType;
  metadata: AnalyticsMetadata | null;
};

export type ParsedUtmParams = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
};

export type TrendResult = {
  current: number;
  previous: number;
  pct: number | null;
  direction: "up" | "down" | "flat" | "new";
};

export type FunnelMetrics = {
  search: number;
  impression: number;
  view: number;
  click: number;
  impressionsPerSearch: number | null;
  impressionToView: number | null;
  viewToClick: number | null;
  clickThroughRate: number | null;
};

export type OpportunityScoreInput = {
  productId: string;
  searches: number;
  searchGrowthPct: number | null;
  impressions: number;
  views: number;
  clicks: number;
  favorites: number;
  ctr: number | null;
  marketplaceCount: number;
};

export type OpportunityScoreBreakdown = {
  score: number;
  parts: {
    searchVolume: number;
    searchGrowth: number;
    impressions: number;
    views: number;
    clicks: number;
    ctr: number;
    favorites: number;
    marketplaceCoverage: number;
  };
};
