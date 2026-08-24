import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

import {
  computeCtr,
  computeFunnel,
  computeOpportunityScore,
  computeTrend,
  enumerateDateKeys,
  previousPeriodRange,
  trendPctForOpportunityScore,
} from "./metrics";
import type { OpportunityScoreInput, TrendResult } from "./types";

const TABLE_LIMIT = 50;

type CountRow = {
  eventType: string;
  eventCount: bigint | number;
  resultCountSum: bigint | number;
};

type QueryRow = {
  query: string;
  searches: bigint | number;
  resultSum: bigint | number;
  zeros: bigint | number;
  impressions: bigint | number;
  views: bigint | number;
  clicks: bigint | number;
  lastEventAt: Date | null;
};

type ProductRow = {
  productId: string;
  impressions: bigint | number;
  views: bigint | number;
  clicks: bigint | number;
  favorites: bigint | number;
};

type MarketplaceRow = {
  marketplace: string;
  impressions: bigint | number;
  clicks: bigint | number;
};

type DimCountRow = {
  key: string;
  searches: bigint | number;
  impressions: bigint | number;
  views: bigint | number;
  clicks: bigint | number;
};

type SessionDimRow = {
  key: string | null;
  sessions: bigint | number;
};

type UtmRow = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  sessions: bigint | number;
  searches: bigint | number;
  impressions: bigint | number;
  views: bigint | number;
  clicks: bigint | number;
};

type SeriesRow = {
  day: Date;
  eventType: string;
  eventCount: bigint | number;
};

type RelatedSearchRow = {
  productId: string;
  query: string;
  weight: bigint | number;
};

type MarketplaceOfferRow = {
  productId: string;
  marketplace: string;
};

function num(value: bigint | number | null | undefined): number {
  if (value == null) {
    return 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  return Number.isFinite(value) ? Number(value) : 0;
}

function mapCounts(rows: CountRow[]): Record<string, { count: number; resultSum: number }> {
  const mapped: Record<string, { count: number; resultSum: number }> = {};

  for (const row of rows) {
    mapped[row.eventType] = {
      count: num(row.eventCount),
      resultSum: num(row.resultCountSum),
    };
  }

  return mapped;
}

function countOf(
  counts: Record<string, { count: number; resultSum: number }>,
  eventType: string,
): number {
  return counts[eventType]?.count ?? 0;
}

export type IntelligenceSort =
  | "searches"
  | "avgResults"
  | "zeros"
  | "views"
  | "clicks"
  | "ctr"
  | "trend"
  | "impressions"
  | "score";

export type IntelligenceDashboard = {
  period: { from: string; to: string };
  overview: {
    sessions: number;
    searches: number;
    impressions: number;
    views: number;
    clicks: number;
    zeroResults: number;
    ctr: number | null;
    impressionToViewCtr: number | null;
    trends: {
      sessions: TrendResult;
      searches: TrendResult;
      views: TrendResult;
      clicks: TrendResult;
      zeroResults: TrendResult;
    };
  };
  funnel: ReturnType<typeof computeFunnel>;
  series: Array<{
    day: string;
    searches: number;
    views: number;
    clicks: number;
  }>;
  searches: Array<{
    query: string;
    searches: number;
    avgResults: number | null;
    zeros: number;
    impressions: number;
    views: number;
    clicks: number;
    ctr: number | null;
    trend: TrendResult;
  }>;
  zeroResults: Array<{
    query: string;
    searches: number;
    lastEventAt: string | null;
    trend: TrendResult;
  }>;
  products: {
    mostViewed: IntelligenceProductRow[];
    mostClicked: IntelligenceProductRow[];
    bestCtr: IntelligenceProductRow[];
    growing: IntelligenceProductRow[];
    opportunities: IntelligenceProductRow[];
  };
  marketplaces: Array<{
    marketplace: string;
    impressions: number;
    clicks: number;
    ctr: number | null;
    clickShare: number | null;
  }>;
  origins: Array<{
    source: string;
    sessions: number;
    searches: number;
    impressions: number;
    views: number;
    clicks: number;
    ctr: number | null;
  }>;
  utms: Array<{
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    sessions: number;
    searches: number;
    impressions: number;
    views: number;
    clicks: number;
    ctr: number | null;
  }>;
  devices: Array<{
    deviceType: string;
    sessions: number;
    impressions: number;
    views: number;
    clicks: number;
    ctr: number | null;
  }>;
};

export type IntelligenceProductRow = {
  productId: string;
  name: string;
  image: string | null;
  impressions: number;
  views: number;
  clicks: number;
  ctr: number | null;
  favorites: number;
  relatedSearchCount: number;
  marketplaces: string[];
  relatedQueries: string[];
  trend: TrendResult;
  opportunityScore: number | null;
};

function searchOrderBy(sort: IntelligenceSort): Prisma.Sql {
  switch (sort) {
    case "avgResults":
      return Prisma.raw(`"avgResults" DESC NULLS LAST, searches DESC`);
    case "zeros":
      return Prisma.raw(`zeros DESC, searches DESC`);
    case "views":
      return Prisma.raw(`views DESC, searches DESC`);
    case "clicks":
      return Prisma.raw(`clicks DESC, searches DESC`);
    case "ctr":
      return Prisma.raw(`"ctr" DESC NULLS LAST, searches DESC`);
    default:
      return Prisma.raw(`searches DESC, views DESC`);
  }
}

export async function loadIntelligenceDashboard(input: {
  from: Date;
  to: Date;
  searchSort?: IntelligenceSort;
}): Promise<IntelligenceDashboard> {
  const from = input.from;
  const to = input.to;
  const previous = previousPeriodRange(from, to);
  const searchSort = input.searchSort ?? "searches";

  const [
    totals,
    previousTotals,
    sessions,
    previousSessions,
    seriesRows,
    searchRows,
    previousSearchRows,
    zeroRows,
    previousZeroRows,
    productRows,
    previousProductRows,
    marketplaceRows,
    originEventRows,
    originSessionRows,
    deviceEventRows,
    deviceSessionRows,
    utmRows,
  ] = await Promise.all([
    prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT "eventType",
             SUM("eventCount") AS "eventCount",
             SUM("resultCountSum") AS "resultCountSum"
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${from} AND "day" < ${to} AND "grain" = 'TOTAL'
      GROUP BY "eventType"
    `),
    prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT "eventType",
             SUM("eventCount") AS "eventCount",
             SUM("resultCountSum") AS "resultCountSum"
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${previous.from} AND "day" < ${previous.to} AND "grain" = 'TOTAL'
      GROUP BY "eventType"
    `),
    prisma.analyticsSessionDay.count({
      where: { day: { gte: from, lt: to } },
    }),
    prisma.analyticsSessionDay.count({
      where: { day: { gte: previous.from, lt: previous.to } },
    }),
    prisma.$queryRaw<SeriesRow[]>(Prisma.sql`
      SELECT "day", "eventType", SUM("eventCount") AS "eventCount"
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${from}
        AND "day" < ${to}
        AND "grain" = 'TOTAL'
        AND "eventType" IN ('SEARCH', 'PRODUCT_VIEW', 'MARKETPLACE_CLICK')
      GROUP BY "day", "eventType"
      ORDER BY "day" ASC
    `),
    prisma.$queryRaw<QueryRow[]>(Prisma.sql`
      SELECT "query",
             SUM(CASE WHEN "eventType" = 'SEARCH' THEN "eventCount" ELSE 0 END) AS searches,
             SUM(CASE WHEN "eventType" = 'SEARCH' THEN "resultCountSum" ELSE 0 END) AS "resultSum",
             SUM(CASE WHEN "eventType" = 'ZERO_RESULT' THEN "eventCount" ELSE 0 END) AS zeros,
             SUM(CASE WHEN "eventType" = 'PRODUCT_IMPRESSION' THEN "eventCount" ELSE 0 END) AS impressions,
             SUM(CASE WHEN "eventType" = 'PRODUCT_VIEW' THEN "eventCount" ELSE 0 END) AS views,
             SUM(CASE WHEN "eventType" = 'MARKETPLACE_CLICK' THEN "eventCount" ELSE 0 END) AS clicks,
             MAX("lastEventAt") AS "lastEventAt",
             CASE
               WHEN SUM(CASE WHEN "eventType" = 'SEARCH' THEN "eventCount" ELSE 0 END) > 0
               THEN SUM(CASE WHEN "eventType" = 'SEARCH' THEN "resultCountSum" ELSE 0 END)::double precision
                    / SUM(CASE WHEN "eventType" = 'SEARCH' THEN "eventCount" ELSE 0 END)
               ELSE NULL
             END AS "avgResults",
             CASE
               WHEN SUM(CASE WHEN "eventType" = 'PRODUCT_IMPRESSION' THEN "eventCount" ELSE 0 END) > 0
               THEN SUM(CASE WHEN "eventType" = 'MARKETPLACE_CLICK' THEN "eventCount" ELSE 0 END)::double precision
                    / SUM(CASE WHEN "eventType" = 'PRODUCT_IMPRESSION' THEN "eventCount" ELSE 0 END)
               ELSE NULL
             END AS "ctr"
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${from}
        AND "day" < ${to}
        AND "grain" = 'QUERY'
        AND "query" IS NOT NULL
      GROUP BY "query"
      ORDER BY ${searchOrderBy(searchSort)}
      LIMIT ${TABLE_LIMIT}
    `),
    prisma.$queryRaw<QueryRow[]>(Prisma.sql`
      SELECT "query",
             SUM(CASE WHEN "eventType" = 'SEARCH' THEN "eventCount" ELSE 0 END) AS searches,
             0 AS "resultSum",
             SUM(CASE WHEN "eventType" = 'ZERO_RESULT' THEN "eventCount" ELSE 0 END) AS zeros,
             SUM(CASE WHEN "eventType" = 'PRODUCT_IMPRESSION' THEN "eventCount" ELSE 0 END) AS impressions,
             SUM(CASE WHEN "eventType" = 'PRODUCT_VIEW' THEN "eventCount" ELSE 0 END) AS views,
             SUM(CASE WHEN "eventType" = 'MARKETPLACE_CLICK' THEN "eventCount" ELSE 0 END) AS clicks,
             NULL AS "lastEventAt"
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${previous.from}
        AND "day" < ${previous.to}
        AND "grain" = 'QUERY'
        AND "query" IS NOT NULL
      GROUP BY "query"
    `),
    prisma.$queryRaw<QueryRow[]>(Prisma.sql`
      SELECT "query",
             SUM("eventCount") AS searches,
             0 AS "resultSum",
             SUM("eventCount") AS zeros,
             0 AS impressions,
             0 AS views,
             0 AS clicks,
             MAX("lastEventAt") AS "lastEventAt"
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${from}
        AND "day" < ${to}
        AND "grain" = 'QUERY'
        AND "eventType" = 'ZERO_RESULT'
        AND "query" IS NOT NULL
      GROUP BY "query"
      ORDER BY searches DESC, "lastEventAt" DESC
      LIMIT ${TABLE_LIMIT}
    `),
    prisma.$queryRaw<QueryRow[]>(Prisma.sql`
      SELECT "query",
             SUM("eventCount") AS searches,
             0 AS "resultSum",
             SUM("eventCount") AS zeros,
             0 AS impressions,
             0 AS views,
             0 AS clicks,
             NULL AS "lastEventAt"
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${previous.from}
        AND "day" < ${previous.to}
        AND "grain" = 'QUERY'
        AND "eventType" = 'ZERO_RESULT'
        AND "query" IS NOT NULL
      GROUP BY "query"
    `),
    prisma.$queryRaw<ProductRow[]>(Prisma.sql`
      SELECT "productId",
             SUM(CASE WHEN "eventType" = 'PRODUCT_IMPRESSION' THEN "eventCount" ELSE 0 END) AS impressions,
             SUM(CASE WHEN "eventType" = 'PRODUCT_VIEW' THEN "eventCount" ELSE 0 END) AS views,
             SUM(CASE WHEN "eventType" = 'MARKETPLACE_CLICK' THEN "eventCount" ELSE 0 END) AS clicks,
             SUM(CASE WHEN "eventType" = 'FAVORITE_ADD' THEN "eventCount" ELSE 0 END) AS favorites
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${from}
        AND "day" < ${to}
        AND "grain" = 'PRODUCT'
        AND "productId" IS NOT NULL
      GROUP BY "productId"
    `),
    prisma.$queryRaw<ProductRow[]>(Prisma.sql`
      SELECT "productId",
             SUM(CASE WHEN "eventType" = 'PRODUCT_IMPRESSION' THEN "eventCount" ELSE 0 END) AS impressions,
             SUM(CASE WHEN "eventType" = 'PRODUCT_VIEW' THEN "eventCount" ELSE 0 END) AS views,
             SUM(CASE WHEN "eventType" = 'MARKETPLACE_CLICK' THEN "eventCount" ELSE 0 END) AS clicks,
             SUM(CASE WHEN "eventType" = 'FAVORITE_ADD' THEN "eventCount" ELSE 0 END) AS favorites
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${previous.from}
        AND "day" < ${previous.to}
        AND "grain" = 'PRODUCT'
        AND "productId" IS NOT NULL
      GROUP BY "productId"
    `),
    prisma.$queryRaw<MarketplaceRow[]>(Prisma.sql`
      SELECT "marketplace",
             SUM(CASE WHEN "eventType" = 'PRODUCT_IMPRESSION' THEN "eventCount" ELSE 0 END) AS impressions,
             SUM(CASE WHEN "eventType" = 'MARKETPLACE_CLICK' THEN "eventCount" ELSE 0 END) AS clicks
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${from}
        AND "day" < ${to}
        AND "grain" = 'MARKETPLACE'
        AND "marketplace" IS NOT NULL
      GROUP BY "marketplace"
      ORDER BY clicks DESC, impressions DESC
    `),
    prisma.$queryRaw<DimCountRow[]>(Prisma.sql`
      SELECT "source" AS key,
             SUM(CASE WHEN "eventType" = 'SEARCH' THEN "eventCount" ELSE 0 END) AS searches,
             SUM(CASE WHEN "eventType" = 'PRODUCT_IMPRESSION' THEN "eventCount" ELSE 0 END) AS impressions,
             SUM(CASE WHEN "eventType" = 'PRODUCT_VIEW' THEN "eventCount" ELSE 0 END) AS views,
             SUM(CASE WHEN "eventType" = 'MARKETPLACE_CLICK' THEN "eventCount" ELSE 0 END) AS clicks
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${from}
        AND "day" < ${to}
        AND "grain" = 'SOURCE'
        AND "source" IS NOT NULL
      GROUP BY "source"
    `),
    prisma.$queryRaw<SessionDimRow[]>(Prisma.sql`
      SELECT "source" AS key, COUNT(*) AS sessions
      FROM "AnalyticsSessionDay"
      WHERE "day" >= ${from} AND "day" < ${to}
      GROUP BY "source"
    `),
    prisma.$queryRaw<DimCountRow[]>(Prisma.sql`
      SELECT "deviceType" AS key,
             SUM(CASE WHEN "eventType" = 'SEARCH' THEN "eventCount" ELSE 0 END) AS searches,
             SUM(CASE WHEN "eventType" = 'PRODUCT_IMPRESSION' THEN "eventCount" ELSE 0 END) AS impressions,
             SUM(CASE WHEN "eventType" = 'PRODUCT_VIEW' THEN "eventCount" ELSE 0 END) AS views,
             SUM(CASE WHEN "eventType" = 'MARKETPLACE_CLICK' THEN "eventCount" ELSE 0 END) AS clicks
      FROM "AnalyticsDailyAgg"
      WHERE "day" >= ${from}
        AND "day" < ${to}
        AND "grain" = 'DEVICE'
        AND "deviceType" IS NOT NULL
      GROUP BY "deviceType"
    `),
    prisma.$queryRaw<SessionDimRow[]>(Prisma.sql`
      SELECT "deviceType" AS key, COUNT(*) AS sessions
      FROM "AnalyticsSessionDay"
      WHERE "day" >= ${from} AND "day" < ${to}
      GROUP BY "deviceType"
    `),
    prisma.$queryRaw<UtmRow[]>(Prisma.sql`
      SELECT a."utmSource",
             a."utmMedium",
             a."utmCampaign",
             COALESCE(s.sessions, 0) AS sessions,
             a.searches,
             a.impressions,
             a.views,
             a.clicks
      FROM (
        SELECT "utmSource",
               "utmMedium",
               "utmCampaign",
               SUM(CASE WHEN "eventType" = 'SEARCH' THEN "eventCount" ELSE 0 END) AS searches,
               SUM(CASE WHEN "eventType" = 'PRODUCT_IMPRESSION' THEN "eventCount" ELSE 0 END) AS impressions,
               SUM(CASE WHEN "eventType" = 'PRODUCT_VIEW' THEN "eventCount" ELSE 0 END) AS views,
               SUM(CASE WHEN "eventType" = 'MARKETPLACE_CLICK' THEN "eventCount" ELSE 0 END) AS clicks
        FROM "AnalyticsDailyAgg"
        WHERE "day" >= ${from}
          AND "day" < ${to}
          AND "grain" = 'UTM'
        GROUP BY "utmSource", "utmMedium", "utmCampaign"
      ) a
      LEFT JOIN (
        SELECT "utmSource", "utmMedium", "utmCampaign", COUNT(*) AS sessions
        FROM "AnalyticsSessionDay"
        WHERE "day" >= ${from} AND "day" < ${to}
        GROUP BY "utmSource", "utmMedium", "utmCampaign"
      ) s
        ON a."utmSource" IS NOT DISTINCT FROM s."utmSource"
       AND a."utmMedium" IS NOT DISTINCT FROM s."utmMedium"
       AND a."utmCampaign" IS NOT DISTINCT FROM s."utmCampaign"
      ORDER BY a.clicks DESC, a.views DESC
      LIMIT ${TABLE_LIMIT}
    `),
  ]);

  const currentCounts = mapCounts(totals);
  const previousCounts = mapCounts(previousTotals);

  const searches = countOf(currentCounts, "SEARCH");
  const impressions = countOf(currentCounts, "PRODUCT_IMPRESSION");
  const views = countOf(currentCounts, "PRODUCT_VIEW");
  const clicks = countOf(currentCounts, "MARKETPLACE_CLICK");
  const zeroResults = countOf(currentCounts, "ZERO_RESULT");

  const prevSearches = countOf(previousCounts, "SEARCH");
  const prevViews = countOf(previousCounts, "PRODUCT_VIEW");
  const prevClicks = countOf(previousCounts, "MARKETPLACE_CLICK");
  const prevZeros = countOf(previousCounts, "ZERO_RESULT");

  const previousSearchMap = new Map(
    previousSearchRows.map((row) => [row.query, num(row.searches)]),
  );
  const previousZeroMap = new Map(
    previousZeroRows.map((row) => [row.query, num(row.searches)]),
  );
  const previousProductMap = new Map(
    previousProductRows.map((row) => [
      row.productId,
      {
        impressions: num(row.impressions),
        views: num(row.views),
        clicks: num(row.clicks),
      },
    ]),
  );

  const productIds = productRows.map((row) => row.productId);

  const [products, offerRows, relatedSearchRows, relatedSearchCounts, previousRelatedCounts] =
    productIds.length > 0
      ? await Promise.all([
          prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, image: true },
          }),
          prisma.$queryRaw<MarketplaceOfferRow[]>(Prisma.sql`
            SELECT "productId", "marketplace"
            FROM "MarketplaceOffer"
            WHERE "productId" IN (${Prisma.join(productIds)})
              AND "active" = true
              AND "matchStatus" = 'EXACT'
          `),
          prisma.$queryRaw<RelatedSearchRow[]>(Prisma.sql`
            SELECT "productId",
                   "query",
                   SUM("eventCount") AS weight
            FROM "AnalyticsDailyAgg"
            WHERE "day" >= ${from}
              AND "day" < ${to}
              AND "grain" = 'QUERY_PRODUCT'
              AND "productId" IN (${Prisma.join(productIds)})
              AND "query" IS NOT NULL
            GROUP BY "productId", "query"
          `),
          prisma.$queryRaw<ProductRow[]>(Prisma.sql`
            SELECT "productId",
                   SUM("eventCount") AS impressions,
                   0 AS views,
                   0 AS clicks,
                   0 AS favorites
            FROM "AnalyticsDailyAgg"
            WHERE "day" >= ${from}
              AND "day" < ${to}
              AND "grain" = 'QUERY_PRODUCT'
              AND "eventType" IN ('SEARCH', 'SEARCH_RESULT')
              AND "productId" IN (${Prisma.join(productIds)})
            GROUP BY "productId"
          `),
          prisma.$queryRaw<ProductRow[]>(Prisma.sql`
            SELECT "productId",
                   SUM("eventCount") AS impressions,
                   0 AS views,
                   0 AS clicks,
                   0 AS favorites
            FROM "AnalyticsDailyAgg"
            WHERE "day" >= ${previous.from}
              AND "day" < ${previous.to}
              AND "grain" = 'QUERY_PRODUCT'
              AND "eventType" IN ('SEARCH', 'SEARCH_RESULT')
              AND "productId" IN (${Prisma.join(productIds)})
            GROUP BY "productId"
          `),
        ])
      : [[], [], [], [], []];

  const productMeta = new Map(
    products.map((product) => [
      product.id,
      { name: product.name, image: product.image },
    ]),
  );

  const marketplacesByProduct = new Map<string, string[]>();

  for (const row of offerRows) {
    const current = marketplacesByProduct.get(row.productId) ?? [];
    if (!current.includes(row.marketplace)) {
      current.push(row.marketplace);
      marketplacesByProduct.set(row.productId, current);
    }
  }

  const relatedByProduct = new Map<string, Array<{ query: string; weight: number }>>();

  for (const row of relatedSearchRows) {
    const current = relatedByProduct.get(row.productId) ?? [];
    current.push({ query: row.query, weight: num(row.weight) });
    relatedByProduct.set(row.productId, current);
  }

  const relatedSearchCountByProduct = new Map(
    relatedSearchCounts.map((row) => [row.productId, num(row.impressions)]),
  );
  const previousRelatedSearchCountByProduct = new Map(
    previousRelatedCounts.map((row) => [row.productId, num(row.impressions)]),
  );

  const scoreInputs: OpportunityScoreInput[] = productRows.map((row) => {
    const viewsCount = num(row.views);
    const impressionsCount = num(row.impressions);
    const clicksCount = num(row.clicks);
    const relatedSearches = relatedSearchCountByProduct.get(row.productId) ?? 0;
    const previousRelatedSearches =
      previousRelatedSearchCountByProduct.get(row.productId) ?? 0;

    return {
      productId: row.productId,
      searches: relatedSearches,
      searchGrowthPct: trendPctForOpportunityScore(
        computeTrend(relatedSearches, previousRelatedSearches),
      ),
      impressions: impressionsCount,
      views: viewsCount,
      clicks: clicksCount,
      favorites: num(row.favorites),
      ctr: computeCtr(clicksCount, impressionsCount),
      marketplaceCount: marketplacesByProduct.get(row.productId)?.length ?? 0,
    };
  });

  const scoreByProduct = new Map<string, number>();

  for (const item of scoreInputs) {
    const scored = computeOpportunityScore(item, scoreInputs);
    scoreByProduct.set(item.productId, scored.score);
  }

  const toProductRow = (row: ProductRow): IntelligenceProductRow => {
    const viewsCount = num(row.views);
    const impressionsCount = num(row.impressions);
    const clicksCount = num(row.clicks);
    const previous = previousProductMap.get(row.productId);
    const related = (relatedByProduct.get(row.productId) ?? [])
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((item) => item.query);
    const meta = productMeta.get(row.productId);

    return {
      productId: row.productId,
      name: meta?.name ?? "Produto removido",
      image: meta?.image ?? null,
      impressions: impressionsCount,
      views: viewsCount,
      clicks: clicksCount,
      ctr: computeCtr(clicksCount, impressionsCount),
      favorites: num(row.favorites),
      relatedSearchCount: relatedSearchCountByProduct.get(row.productId) ?? 0,
      marketplaces: marketplacesByProduct.get(row.productId) ?? [],
      relatedQueries: related,
      trend: computeTrend(viewsCount, previous?.views ?? 0),
      opportunityScore: scoreByProduct.get(row.productId) ?? null,
    };
  };

  const productDetails = productRows.map(toProductRow);

  const mostViewed = [...productDetails]
    .sort((a, b) => b.views - a.views || b.clicks - a.clicks)
    .slice(0, 20);

  const mostClicked = [...productDetails]
    .sort((a, b) => b.clicks - a.clicks || b.views - a.views)
    .slice(0, 20);

  const bestCtr = [...productDetails]
    .filter((row) => row.impressions >= 5 && row.ctr != null)
    .sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0) || b.clicks - a.clicks)
    .slice(0, 20);

  const growing = [...productDetails]
    .filter((row) => row.views + row.clicks >= 3 && row.trend.direction === "up")
    .sort((a, b) => (b.trend.pct ?? 0) - (a.trend.pct ?? 0) || b.views - a.views)
    .slice(0, 20);

  const opportunities = [...productDetails]
    .filter((row) => (row.opportunityScore ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0) ||
        b.clicks - a.clicks,
    )
    .slice(0, 20);

  const totalMarketplaceClicks = marketplaceRows.reduce(
    (sum, row) => sum + num(row.clicks),
    0,
  );

  const originKeys = new Set([
    ...originEventRows.map((row) => row.key),
    ...originSessionRows.map((row) => row.key ?? "Direct"),
  ]);

  const origins = Array.from(originKeys)
    .map((source) => {
      const events = originEventRows.find((row) => row.key === source);
      const sessionRow = originSessionRows.find(
        (row) => (row.key ?? "Direct") === source,
      );
      const originImpressions = num(events?.impressions);
      const originViews = num(events?.views);
      const originClicks = num(events?.clicks);

      return {
        source: source || "Direct",
        sessions: num(sessionRow?.sessions),
        searches: num(events?.searches),
        impressions: originImpressions,
        views: originViews,
        clicks: originClicks,
        ctr: computeCtr(originClicks, originImpressions),
      };
    })
    .sort((a, b) => b.sessions - a.sessions || b.clicks - a.clicks);

  const deviceKeys = new Set([
    ...deviceEventRows.map((row) => row.key),
    ...deviceSessionRows.map((row) => row.key ?? "unknown"),
  ]);

  const devices = Array.from(deviceKeys)
    .map((deviceType) => {
      const events = deviceEventRows.find((row) => row.key === deviceType);
      const sessionRow = deviceSessionRows.find(
        (row) => (row.key ?? "unknown") === deviceType,
      );
      const deviceImpressions = num(events?.impressions);
      const deviceViews = num(events?.views);
      const deviceClicks = num(events?.clicks);

      return {
        deviceType: deviceType || "unknown",
        sessions: num(sessionRow?.sessions),
        impressions: deviceImpressions,
        views: deviceViews,
        clicks: deviceClicks,
        ctr: computeCtr(deviceClicks, deviceImpressions),
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

  const seriesMap = new Map<
    string,
    { searches: number; views: number; clicks: number }
  >();

  for (const key of enumerateDateKeys(from, to)) {
    seriesMap.set(key, { searches: 0, views: 0, clicks: 0 });
  }

  for (const row of seriesRows) {
    const key =
      row.day instanceof Date
        ? row.day.toISOString().slice(0, 10)
        : String(row.day).slice(0, 10);
    const current = seriesMap.get(key) ?? {
      searches: 0,
      views: 0,
      clicks: 0,
    };

    if (row.eventType === "SEARCH") {
      current.searches += num(row.eventCount);
    } else if (row.eventType === "PRODUCT_VIEW") {
      current.views += num(row.eventCount);
    } else if (row.eventType === "MARKETPLACE_CLICK") {
      current.clicks += num(row.eventCount);
    }

    seriesMap.set(key, current);
  }

  return {
    period: {
      from: from.toISOString().slice(0, 10),
      to: new Date(to.getTime() - 1).toISOString().slice(0, 10),
    },
    overview: {
      sessions,
      searches,
      impressions,
      views,
      clicks,
      zeroResults,
      ctr: computeCtr(clicks, impressions),
      impressionToViewCtr: computeCtr(views, impressions),
      trends: {
        sessions: computeTrend(sessions, previousSessions),
        searches: computeTrend(searches, prevSearches),
        views: computeTrend(views, prevViews),
        clicks: computeTrend(clicks, prevClicks),
        zeroResults: computeTrend(zeroResults, prevZeros),
      },
    },
    funnel: computeFunnel({
      search: searches,
      impression: impressions,
      view: views,
      click: clicks,
    }),
    series: Array.from(seriesMap.entries()).map(([day, values]) => ({
      day,
      ...values,
    })),
    searches: searchRows.map((row) => {
      const searchCount = num(row.searches);
      const impressionCount = num(row.impressions);
      const viewCount = num(row.views);
      const clickCount = num(row.clicks);
      const resultSum = num(row.resultSum);

      return {
        query: row.query,
        searches: searchCount,
        avgResults: searchCount > 0 ? resultSum / searchCount : null,
        zeros: num(row.zeros),
        impressions: impressionCount,
        views: viewCount,
        clicks: clickCount,
        ctr: computeCtr(clickCount, impressionCount),
        trend: computeTrend(searchCount, previousSearchMap.get(row.query) ?? 0),
      };
    }),
    zeroResults: zeroRows.map((row) => ({
      query: row.query,
      searches: num(row.searches),
      lastEventAt: row.lastEventAt ? new Date(row.lastEventAt).toISOString() : null,
      trend: computeTrend(num(row.searches), previousZeroMap.get(row.query) ?? 0),
    })),
    products: {
      mostViewed,
      mostClicked,
      bestCtr,
      growing,
      opportunities,
    },
    marketplaces: marketplaceRows.map((row) => {
      const impressionCount = num(row.impressions);
      const clickCount = num(row.clicks);

      return {
        marketplace: row.marketplace,
        impressions: impressionCount,
        clicks: clickCount,
        ctr: computeCtr(clickCount, impressionCount),
        clickShare:
          totalMarketplaceClicks > 0 ? clickCount / totalMarketplaceClicks : null,
      };
    }),
    origins,
    utms: utmRows.map((row) => {
      const utmImpressions = num(row.impressions);
      const utmViews = num(row.views);
      const utmClicks = num(row.clicks);

      return {
        utmSource: row.utmSource,
        utmMedium: row.utmMedium,
        utmCampaign: row.utmCampaign,
        sessions: num(row.sessions),
        searches: num(row.searches),
        impressions: utmImpressions,
        views: utmViews,
        clicks: utmClicks,
        ctr: computeCtr(utmClicks, utmImpressions),
      };
    }),
    devices,
  };
}
