export type ProductStateBucket = {
  active: boolean;
  publicationStatus: string;
  count: number;
};

export type ProductOfferBucket = {
  productId: string;
  count: number;
};

export type SourceOfferBucket = {
  marketplace: string;
  active: boolean;
  productId: string;
  count: number;
  latestUpdatedAt: Date | null;
  latestCheckedAt: Date | null;
};

export type OperationsMetricsInput = {
  productStates: ProductStateBucket[];
  offersByProduct: ProductOfferBucket[];
  offersBySource: SourceOfferBucket[];
  publicProducts: number;
  offersWithoutSourceUrl: number;
  incompleteOffers: number;
  dueOffers: number;
  latestProductUpdate: Date | null;
  latestPriceRecord: Date | null;
  now: Date;
};

export type Freshness = "RECENT" | "STALE" | "UNKNOWN";

export function freshness(
  timestamp: Date | null,
  now: Date,
  staleAfterMs = 24 * 60 * 60 * 1000,
): Freshness {
  if (!timestamp || Number.isNaN(timestamp.getTime())) return "UNKNOWN";
  return now.getTime() - timestamp.getTime() > staleAfterMs
    ? "STALE"
    : "RECENT";
}

function latestDate(current: Date | null, next: Date | null): Date | null {
  if (!next) return current;
  if (!current || next.getTime() > current.getTime()) return next;
  return current;
}

const MARKETPLACE_LABELS: Record<string, string> = {
  ALIEXPRESS: "AliExpress",
  AMAZON: "Amazon",
  CARREFOUR: "Carrefour",
  CASAS_BAHIA: "Casas Bahia",
  KABUM: "KaBuM",
  MAGAZINE_LUIZA: "Magazine Luiza",
  MERCADO_LIVRE: "Mercado Livre",
  SHOPEE: "Shopee",
  TERABYTE: "Terabyte",
};

export function marketplaceLabel(value: string): string {
  return MARKETPLACE_LABELS[value] ?? "Outra fonte registrada";
}

export function buildOperationsMetrics(input: OperationsMetricsInput) {
  const productCount = input.productStates.reduce(
    (total, bucket) => total + bucket.count,
    0,
  );
  const activeProducts = input.productStates
    .filter((bucket) => bucket.active)
    .reduce((total, bucket) => total + bucket.count, 0);
  const publishedProducts = input.productStates
    .filter((bucket) =>
      ["LIVE_PARTIAL", "LIVE_COMPLETE"].includes(bucket.publicationStatus),
    )
    .reduce((total, bucket) => total + bucket.count, 0);
  const offerCount = input.offersByProduct.reduce(
    (total, bucket) => total + bucket.count,
    0,
  );

  const sources = new Map<
    string,
    {
      offers: number;
      activeOffers: number;
      products: Set<string>;
      latestUpdatedAt: Date | null;
      latestCheckedAt: Date | null;
    }
  >();

  let latestOfferUpdate: Date | null = null;
  let latestOfferCheck: Date | null = null;
  let activeOffers = 0;

  for (const bucket of input.offersBySource) {
    const source = sources.get(bucket.marketplace) ?? {
      offers: 0,
      activeOffers: 0,
      products: new Set<string>(),
      latestUpdatedAt: null,
      latestCheckedAt: null,
    };

    source.offers += bucket.count;
    source.products.add(bucket.productId);
    source.latestUpdatedAt = latestDate(
      source.latestUpdatedAt,
      bucket.latestUpdatedAt,
    );
    source.latestCheckedAt = latestDate(
      source.latestCheckedAt,
      bucket.latestCheckedAt,
    );
    latestOfferUpdate = latestDate(latestOfferUpdate, bucket.latestUpdatedAt);

    if (bucket.active) {
      source.activeOffers += bucket.count;
      activeOffers += bucket.count;
      latestOfferCheck = latestDate(latestOfferCheck, bucket.latestCheckedAt);
    }

    sources.set(bucket.marketplace, source);
  }

  const sourceRows = [...sources.entries()]
    .map(([marketplace, source]) => ({
      marketplace,
      label: marketplaceLabel(marketplace),
      offers: source.offers,
      activeOffers: source.activeOffers,
      products: source.products.size,
      latestUpdatedAt: source.latestUpdatedAt,
      latestCheckedAt: source.latestCheckedAt,
      status: source.activeOffers > 0 ? ("ACTIVE" as const) : ("UNKNOWN" as const),
    }))
    .sort((left, right) => right.offers - left.offers);

  return {
    catalog: {
      products: productCount,
      activeProducts,
      inactiveProducts: productCount - activeProducts,
      publishedProducts,
      unpublishedProducts: productCount - publishedProducts,
      publicProducts: input.publicProducts,
      productsWithoutOffers: Math.max(
        0,
        productCount - input.offersByProduct.length,
      ),
      productsWithOneOffer: input.offersByProduct.filter(
        (bucket) => bucket.count === 1,
      ).length,
      productsWithMultipleOffers: input.offersByProduct.filter(
        (bucket) => bucket.count >= 2,
      ).length,
      productsWithPublicComparison: input.publicProducts,
      publicationStatuses: input.productStates.reduce<
        Array<{ status: string; count: number }>
      >((statuses, bucket) => {
        const existing = statuses.find(
          (status) => status.status === bucket.publicationStatus,
        );
        if (existing) existing.count += bucket.count;
        else statuses.push({
          status: bucket.publicationStatus,
          count: bucket.count,
        });
        return statuses;
      }, []),
      latestUpdate: input.latestProductUpdate,
    },
    offers: {
      total: offerCount,
      active: activeOffers,
      inactive: offerCount - activeOffers,
      averagePerProduct: productCount ? offerCount / productCount : 0,
      productsWithComparison: input.publicProducts,
      withoutSourceUrl: input.offersWithoutSourceUrl,
      incomplete: input.incompleteOffers,
      bySource: sourceRows,
      latestUpdate: latestOfferUpdate,
    },
    priceMonitor: {
      mode: "REFRESH_ONLY" as const,
      productCreation: 0 as const,
      activeOffers,
      dueOffers: input.dueOffers,
      latestOfferCheck,
      freshness: freshness(latestOfferCheck, input.now),
      latestPriceRecord: input.latestPriceRecord,
    },
  };
}