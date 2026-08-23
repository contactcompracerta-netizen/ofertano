import { listarDiscoveryAdaptersAtivos } from "@/services/discovery/core/registry";
import type {
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "@/services/discovery/core/types";

import type {
  AcquisitionStatus,
  CanonicalProduct,
  MarketplaceAcquisition,
  MarketplaceCode,
  MultistoreV2Result,
  PublicProductView,
  RawCandidate,
  ScoredCandidate,
} from "./types";
import { buildQueryIntent } from "./queryIntent";
import { normalizeCandidate } from "./normalizeCandidate";
import { scoreQueryRelevance } from "./queryRelevance";
import { clusterCandidates } from "./cluster";
import { canonicalizeCluster } from "./canonicalize";
import { persistCanonicalProducts } from "./persist";
import { traceV2 } from "./trace";

export function usarMotorMultistoreV2(): boolean {
  const value = process.env.MULTISTORE_ENGINE?.trim().toLowerCase();
  return value !== "legacy";
}

function mapAcquisitionStatus(
  result: MarketplaceDiscoveryResult,
): AcquisitionStatus {
  if (result.searchOutcome === "BLOCKED") {
    return "BLOCKED";
  }

  if (result.searchOutcome === "UNUSABLE") {
    return "UNUSABLE";
  }

  if (result.searchOutcome === "ERROR" || result.searchOutcome === "NOT_RUN") {
    return "ERROR";
  }

  if (result.searchOutcome === "EMPTY_VALID") {
    return "EMPTY";
  }

  const usable = result.candidates.filter((item) => item.status === "FOUND");
  if (usable.length > 0) {
    return "SUCCESS";
  }

  if (result.error && /403|401|captcha|blocked|challenge/i.test(result.error)) {
    return "BLOCKED";
  }

  if (result.error) {
    return "ERROR";
  }

  return "EMPTY";
}

function toRawCandidate(candidate: DiscoveryCandidate): RawCandidate | null {
  const title = candidate.title.trim();
  const externalId = candidate.externalId.trim();
  const url = candidate.sourceUrl?.trim() || "";

  if (!title || !externalId) {
    return null;
  }

  return {
    marketplace: candidate.marketplace,
    marketplaceName: candidate.marketplaceName,
    externalId,
    title,
    price: candidate.price,
    url,
    image: candidate.image,
    brand: candidate.brand ?? null,
    category: candidate.category ?? null,
    seller: candidate.seller ?? null,
    affiliateLink: candidate.affiliateLink ?? null,
    attributes: candidate.attributes ?? {},
    raw: candidate,
  };
}

export function processRawCandidates(
  query: string,
  rawCandidates: RawCandidate[],
): {
  intent: ReturnType<typeof buildQueryIntent>;
  scored: ScoredCandidate[];
  relevant: ScoredCandidate[];
  clusters: ReturnType<typeof clusterCandidates>;
  products: CanonicalProduct[];
} {
  const intent = buildQueryIntent(query);
  const scored = rawCandidates.map((raw) =>
    scoreQueryRelevance(intent, normalizeCandidate(raw)),
  );
  const relevant = scored.filter((item) => item.status === "RELEVANT");
  const clusters = clusterCandidates(relevant);
  const products = clusters
    .map(canonicalizeCluster)
    .filter((item): item is CanonicalProduct => item !== null);

  return { intent, scored, relevant, clusters, products };
}

function toViews(
  products: CanonicalProduct[],
  persistedIds: string[],
): PublicProductView[] {
  return products.map((product, index) => {
    const discount =
      product.oldPrice && product.oldPrice > product.price
        ? Math.round((1 - product.price / product.oldPrice) * 100)
        : null;

    return {
      id: persistedIds[index] || `v2-${product.clusterId}`,
      name: product.title,
      image: product.image,
      price: product.price,
      oldPrice: product.oldPrice,
      discount,
      store: product.primaryMarketplace,
      brand: product.brand,
      offers: product.offers.map((offer) => ({
        marketplace: offer.marketplace,
      })),
    };
  });
}

export async function acquireMarketplaces(
  query: string,
  limit = 12,
): Promise<MarketplaceAcquisition[]> {
  const adapters = listarDiscoveryAdaptersAtivos();
  const settled = await Promise.allSettled(
    adapters.map((adapter) =>
      adapter.searcher!({
        query,
        normalizedQuery: query,
        limit,
        mode: "MULTILOJA",
      }),
    ),
  );

  return settled.map((result, index) => {
    const adapter = adapters[index]!;

    if (result.status === "rejected") {
      const error =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);

      return {
        marketplace: adapter.marketplace,
        marketplaceName: adapter.marketplaceName,
        status: "ERROR" as const,
        raw: 0,
        usable: 0,
        error,
        candidates: [],
      };
    }

    const payload = result.value;
    const rawCandidates = payload.candidates
      .map(toRawCandidate)
      .filter((item): item is RawCandidate => item !== null);
    const status = mapAcquisitionStatus(payload);

    return {
      marketplace: adapter.marketplace,
      marketplaceName: adapter.marketplaceName,
      status,
      raw: payload.scanned || payload.candidates.length,
      usable: rawCandidates.length,
      error: payload.error ?? null,
      candidates: rawCandidates,
    };
  });
}

export async function searchMultistoreV2(
  query: string,
  options: { persist?: boolean; limit?: number } = {},
): Promise<MultistoreV2Result> {
  const search = query.replace(/\s+/g, " ").trim();
  traceV2("query", { query: search });

  const acquisitions = await acquireMarketplaces(search, options.limit ?? 12);
  const marketplacesAttempted = acquisitions.map((item) => item.marketplace);

  for (const acquisition of acquisitions) {
    traceV2("marketplace", {
      marketplace: acquisition.marketplace,
      status: acquisition.status,
      raw: acquisition.raw,
      usable: acquisition.usable,
      error: acquisition.error,
    });
  }

  const rawCandidates = acquisitions.flatMap((item) => item.candidates);
  const processed = processRawCandidates(search, rawCandidates);

  for (const candidate of processed.scored) {
    const fingerprint = candidate.fingerprint;
    traceV2("candidate", {
      marketplace: candidate.normalized.raw.marketplace,
      title: candidate.normalized.raw.title,
      queryRelevance: candidate.queryRelevance,
      role: fingerprint.role.value,
      soldItem: fingerprint.soldItem.value,
      hostItem: fingerprint.hostItem.value,
      class: fingerprint.productClass.value,
      brand: fingerprint.brand.value,
      model: fingerprint.model.value,
      status: candidate.status,
    });
  }

  for (const cluster of processed.clusters) {
    const canonical = canonicalizeCluster(cluster);
    traceV2("cluster", {
      clusterId: cluster.clusterId,
      title: canonical?.title ?? cluster.members[0]?.candidate.normalized.raw.title,
      offers: canonical?.offers.length ?? cluster.members.length,
      marketplaces: canonical?.marketplaces ?? [],
      confidence: cluster.confidence,
    });
  }

  const persistEnabled = options.persist !== false;
  const persistedProductIds = persistEnabled
    ? await persistCanonicalProducts(search, processed.products)
    : [];

  const views = toViews(processed.products, persistedProductIds);
  const multiStoreClusters = processed.products.filter(
    (item) => item.marketplaces.length >= 2,
  ).length;
  const singleStoreClusters = processed.products.filter(
    (item) => item.marketplaces.length === 1,
  ).length;

  traceV2("result", {
    query: search,
    marketplacesAttempted,
    rawCandidates: rawCandidates.length,
    relevantCandidates: processed.relevant.length,
    clusters: processed.clusters.length,
    multiStoreClusters,
    singleStoreClusters,
  });

  return {
    query: search,
    intent: processed.intent,
    acquisitions,
    rawCandidates: rawCandidates.length,
    relevantCandidates: processed.relevant,
    clusters: processed.clusters,
    products: processed.products,
    views,
    persistedProductIds,
    marketplacesAttempted,
    multiStoreClusters,
    singleStoreClusters,
  };
}

export function emptyMultistoreResult(query: string): MultistoreV2Result {
  return {
    query,
    intent: buildQueryIntent(query),
    acquisitions: [],
    rawCandidates: 0,
    relevantCandidates: [],
    clusters: [],
    products: [],
    views: [],
    persistedProductIds: [],
    marketplacesAttempted: [] as MarketplaceCode[],
    multiStoreClusters: 0,
    singleStoreClusters: 0,
  };
}
