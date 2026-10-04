import prisma from "@/lib/prisma";
import {
  hasPublicMultiStore,
  multiStorePublicWhere,
  PUBLIC_OFFER_SELECT,
} from "@/services/publicVisibility/multiStoreVisibility";
import { buildOperationsMetrics, marketplaceLabel } from "./metrics";

const RECENT_RUN_LIMIT = 8;

export type OperationsRun = {
  id: string;
  source: string;
  mode: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  itemsFailed: number;
};

export type OperationsDashboard = {
  generatedAt: Date;
  status: "OK" | "UNKNOWN";
  metrics: ReturnType<typeof buildOperationsMetrics> | null;
  runs: OperationsRun[];
  jobsAvailable: boolean;
};

function safeRunSource(marketplaceId: string | null, source: string): string {
  const marketplace = marketplaceLabel(marketplaceId ?? "");
  if (marketplace !== "Outra fonte registrada") return marketplace;
  const knownSource = marketplaceLabel(source);
  return knownSource === "Outra fonte registrada"
    ? "Importação registrada"
    : knownSource;
}

function mapRun(run: {
  id: string;
  source: string;
  marketplaceId: string | null;
  mode: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  itemsFailed: number;
}): OperationsRun {
  return {
    id: run.id,
    source: safeRunSource(run.marketplaceId, run.source),
    mode: run.mode,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.finishedAt
      ? Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime())
      : null,
    itemsFailed: run.itemsFailed,
  };
}

export async function loadOperationsDashboard(): Promise<OperationsDashboard> {
  const generatedAt = new Date();

  try {
    const [
      productStates,
      offersByProduct,
      offersBySource,
      offersWithoutSourceUrl,
      incompleteOffers,
      publicCandidates,
      latestProductUpdate,
      latestPriceRecord,
      dueOfferChecks,
    ] = await Promise.all([
      prisma.product.groupBy({
        by: ["active", "publicationStatus"],
        _count: { _all: true },
      }),
      prisma.marketplaceOffer.groupBy({
        by: ["productId"],
        _count: { _all: true },
      }),
      prisma.marketplaceOffer.groupBy({
        by: ["marketplace", "active", "productId"],
        _count: { _all: true },
        _max: { updatedAt: true, lastCheckedAt: true },
      }),
      prisma.marketplaceOffer.count({
        where: { OR: [{ sourceUrl: null }, { sourceUrl: "" }] },
      }),
      prisma.marketplaceOffer.count({
        where: {
          OR: [
            { sourceUrl: null },
            { sourceUrl: "" },
            { title: null },
            { title: "" },
            { image: null },
            { image: "" },
            { price: { lte: 0 } },
          ],
        },
      }),
      prisma.product.findMany({
        where: {
          active: true,
          publicationStatus: { not: "DRAFT" },
          price: { gt: 0 },
          image: { not: "" },
          AND: multiStorePublicWhere().AND,
        },
        select: {
          offers: {
            where: { active: true, matchStatus: "EXACT" },
            select: {
              ...PUBLIC_OFFER_SELECT.select,
              active: true,
              matchStatus: true,
            },
          },
        },
      }),
      prisma.product.aggregate({ _max: { updatedAt: true } }),
      prisma.priceHistory.aggregate({ _max: { recordedAt: true } }),
      prisma.marketplaceOffer.count({
        where: {
          active: true,
          available: true,
          nextCheckAt: { lte: generatedAt },
        },
      }),
    ]);

    const [runsResult] = await Promise.allSettled([
      prisma.importRun.findMany({
        select: {
          id: true,
          source: true,
          marketplaceId: true,
          mode: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          itemsFailed: true,
        },
        orderBy: { startedAt: "desc" },
        take: RECENT_RUN_LIMIT,
      }),
    ]);
    const jobsAvailable = runsResult.status === "fulfilled";

    return {
      generatedAt,
      status: "OK",
      metrics: buildOperationsMetrics({
        productStates: productStates.map((bucket) => ({
          active: bucket.active,
          publicationStatus: bucket.publicationStatus,
          count: bucket._count._all,
        })),
        offersByProduct: offersByProduct.map((bucket) => ({
          productId: bucket.productId,
          count: bucket._count._all,
        })),
        offersBySource: offersBySource.map((bucket) => ({
          marketplace: bucket.marketplace,
          active: bucket.active,
          productId: bucket.productId,
          count: bucket._count._all,
          latestUpdatedAt: bucket._max.updatedAt,
          latestCheckedAt: bucket._max.lastCheckedAt,
        })),
        publicProducts: publicCandidates.filter(hasPublicMultiStore).length,
        offersWithoutSourceUrl,
        incompleteOffers,
        dueOffers: dueOfferChecks,
        latestProductUpdate: latestProductUpdate._max.updatedAt,
        latestPriceRecord: latestPriceRecord._max.recordedAt,
        now: generatedAt,
      }),
      runs:
        runsResult.status === "fulfilled"
          ? runsResult.value.map(mapRun)
          : [],
      jobsAvailable,
    };
  } catch {
    return {
      generatedAt,
      status: "UNKNOWN",
      metrics: null,
      runs: [],
      jobsAvailable: false,
    };
  }
}