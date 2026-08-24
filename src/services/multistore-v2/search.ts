import { listarDiscoveryAdaptersAtivos } from "@/services/discovery/core/registry";
import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "@/services/discovery/core/types";
import {
  inferSearchOutcome,
  withAcquisitionOutcome,
} from "@/services/search/searchCompletionBarrier";

import type {
  AcquisitionStatus,
  CanonicalProduct,
  MarketplaceAcquisition,
  MarketplaceCode,
  MultistoreV2Result,
  ProductCluster,
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
import { normalizeMultistoreText } from "./normalizeCandidate";
import { compareFingerprints, mergeFingerprints } from "./pairMatcher";

export function usarMotorMultistoreV2(): boolean {
  const value = process.env.MULTISTORE_ENGINE?.trim().toLowerCase();
  return value !== "legacy";
}

function formatSearchAttribute(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value.replace(/(\d+)([a-z]+)/i, "$1 $2");
}

function classSearchHint(productClass: string, hasBrand: boolean): string {
  if (productClass === "headphone") {
    return "fone";
  }

  if (productClass === "mesa") {
    return hasBrand ? "moveis" : "mesa de cabeceira";
  }

  if (productClass === "UNKNOWN" || !productClass) {
    return "";
  }

  return productClass;
}

export function buildSearchPlan(query: string): string[] {
  const intent = buildQueryIntent(query);
  const original = query.replace(/\s+/g, " ").trim();
  const classHint = classSearchHint(intent.productClass, Boolean(intent.brand));
  const focused = [
    intent.brand,
    classHint,
    formatSearchAttribute(intent.importantAttributes.quantity),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const brandModel = [intent.brand, ...intent.modelTokens]
    .filter(Boolean)
    .join(" ")
    .trim();
  const productModel = [classHint, ...intent.modelTokens]
    .filter(Boolean)
    .join(" ")
    .trim();
  const distinctive = intent.distinctiveTokens.slice(0, 6).join(" ").trim();

  return Array.from(
    new Set(
      [original, focused, brandModel, productModel, distinctive].filter(
        (item) => item.length >= 2,
      ),
    ),
  );
}

function titleHasBrand(title: string, brand: string | null): boolean {
  if (!brand) {
    return true;
  }

  const normalized = normalizeMultistoreText(title);
  return brand.split(" ").every((token) => normalized.includes(token));
}

function mapAcquisitionStatus(
  result: MarketplaceDiscoveryResult,
): AcquisitionStatus {
  const outcome = inferSearchOutcome(result);

  if (outcome === "SEARCH_COMPLETED") {
    return "SUCCESS";
  }

  if (outcome === "EMPTY_VALID") {
    return "EMPTY";
  }

  if (outcome === "BLOCKED") {
    return "BLOCKED";
  }

  if (outcome === "UNUSABLE") {
    return "UNUSABLE";
  }

  return "ERROR";
}

function toRawCandidate(candidate: DiscoveryCandidate): RawCandidate | null {
  const title = candidate.title.trim();
  const url = candidate.sourceUrl?.trim() || "";
  const externalId = candidate.externalId.trim() || url;

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

function candidateKey(marketplace: string, externalId: string): string {
  return `${marketplace}:${externalId}`;
}

async function huntMissingStoreOffers(
  clusters: ProductCluster[],
  knownKeys: Set<string>,
  limit: number,
): Promise<ProductCluster[]> {
  const adapters = listarDiscoveryAdaptersAtivos();
  const nextClusters = clusters.map((cluster) => ({
    ...cluster,
    members: [...cluster.members],
  }));

  const targets = nextClusters
    .filter((cluster) => {
      const stores = new Set(
        cluster.members.map((member) => member.candidate.normalized.raw.marketplace),
      );
      return stores.size < adapters.length;
    })
    .slice(0, 3);

  await Promise.allSettled(
    targets.map(async (cluster) => {
      const present = new Set(
        cluster.members.map((member) => member.candidate.normalized.raw.marketplace),
      );
      const missing = adapters.filter((adapter) => !present.has(adapter.marketplace));
      const title =
        cluster.members[0]?.candidate.normalized.raw.title.trim() || "";
      if (!title || missing.length === 0) {
        return;
      }

      const huntQuery = buildSearchPlan(title)[0] || title;
      const huntIntent = buildQueryIntent(title);

      traceV2("hunt", {
        title,
        huntQuery,
        missing: missing.map((adapter) => adapter.marketplace),
      });

      const settled = await Promise.allSettled(
        missing.map((adapter) =>
          adapter.searcher!({
            query: huntQuery,
            normalizedQuery: huntQuery,
            limit: Math.min(limit, 8),
            mode: "MULTILOJA",
          }),
        ),
      );

      for (const result of settled) {
        if (result.status !== "fulfilled") {
          continue;
        }

        for (const candidate of result.value.candidates) {
          const key = candidateKey(candidate.marketplace, candidate.externalId);
          if (knownKeys.has(key)) {
            continue;
          }

          const raw = toRawCandidate(candidate);
          if (!raw || raw.price == null || raw.price <= 0) {
            continue;
          }

          const scored = scoreQueryRelevance(
            huntIntent,
            normalizeCandidate(raw),
          );
          const versusCluster = compareFingerprints(
            scored.fingerprint,
            cluster.identity,
          );
          if (versusCluster.relation !== "SAME") {
            continue;
          }

          const memberConflict = cluster.members.some(
            (member) =>
              compareFingerprints(
                scored.fingerprint,
                member.candidate.fingerprint,
              ).relation === "DIFFERENT",
          );
          if (memberConflict) {
            continue;
          }

          cluster.members.push({ candidate: scored });
          cluster.identity = mergeFingerprints(
            cluster.identity,
            scored.fingerprint,
          );
          knownKeys.add(key);

          traceV2("hunt-hit", {
            title: raw.title,
            marketplace: raw.marketplace,
            price: raw.price,
          });
        }
      }
    }),
  );

  return nextClusters;
}

export async function acquireMarketplaces(
  query: string,
  limit = 12,
  adapters: DiscoveryAdapter[] = listarDiscoveryAdaptersAtivos(),
): Promise<MarketplaceAcquisition[]> {
  const plan = buildSearchPlan(query);
  const intent = buildQueryIntent(query);

  const settled = await Promise.allSettled(
    adapters.map(async (adapter) => {
      const merged = new Map<string, DiscoveryCandidate>();
      let last: MarketplaceDiscoveryResult | null = null;
      let scanned = 0;

      for (const searchQuery of plan) {
        last = withAcquisitionOutcome(
          await adapter.searcher!({
            query: searchQuery,
            normalizedQuery: searchQuery,
            limit,
            mode: "MULTILOJA",
          }),
        );
        scanned += last.scanned || last.candidates.length;

        for (const candidate of last.candidates) {
          const key = candidateKey(candidate.marketplace, candidate.externalId);
          if (!merged.has(key)) {
            merged.set(key, candidate);
          }
        }

        const relevantHits = Array.from(merged.values()).filter((candidate) => {
          if (!titleHasBrand(candidate.title, intent.brand)) {
            return false;
          }

          const raw = toRawCandidate(candidate);
          if (!raw) {
            return false;
          }

          return (
            scoreQueryRelevance(intent, normalizeCandidate(raw)).status ===
            "RELEVANT"
          );
        });
        const enoughHits = intent.brand
          ? relevantHits.length >= 1
          : relevantHits.length >= Math.min(4, limit);
        if (enoughHits) {
          break;
        }
      }

      const lastResult =
        last ?? {
          marketplace: adapter.marketplace,
          query: plan[0] || query,
          success: false,
          candidates: [],
          scanned: 0,
          searchOutcome: "EMPTY_VALID" as const,
          error: null,
        };

      return {
        last: lastResult,
        scanned,
        candidates: Array.from(merged.values()),
      };
    }),
  );

  return settled.map((result, index) => {
    const adapter = adapters[index]!;

    if (result.status === "rejected") {
      const error =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      const status = mapAcquisitionStatus({
        marketplace: adapter.marketplace,
        query,
        success: false,
        candidates: [],
        scanned: 0,
        error,
      });

      return {
        marketplace: adapter.marketplace,
        marketplaceName: adapter.marketplaceName,
        status,
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
    const status = mapAcquisitionStatus({
      ...payload.last,
      candidates: payload.candidates,
      scanned: payload.scanned,
      searchOutcome:
        payload.candidates.length > 0
          ? "SEARCH_COMPLETED"
          : payload.last.searchOutcome,
    });

    return {
      marketplace: adapter.marketplace,
      marketplaceName: adapter.marketplaceName,
      status,
      raw: payload.scanned || payload.candidates.length,
      usable: rawCandidates.length,
      error: payload.last.error ?? null,
      candidates: rawCandidates,
    };
  });
}

export async function searchMultistoreV2(
  query: string,
  options: {
    persist?: boolean;
    limit?: number;
    hunt?: boolean;
    adapters?: DiscoveryAdapter[];
  } = {},
): Promise<MultistoreV2Result> {
  const search = query.replace(/\s+/g, " ").trim();
  traceV2("query", { query: search });

  const acquisitions = await acquireMarketplaces(
    search,
    options.limit ?? 12,
    options.adapters,
  );
  const marketplacesAttempted = acquisitions.map((item) => item.marketplace);
  const marketplacesSucceeded = acquisitions
    .filter((item) => item.status === "SUCCESS")
    .map((item) => item.marketplace);

  const rawCandidates = acquisitions.flatMap((item) => item.candidates);
  const processed = processRawCandidates(search, rawCandidates);
  const relevantByMarketplace = new Map<string, number>();
  for (const candidate of processed.relevant) {
    const code = candidate.normalized.raw.marketplace;
    relevantByMarketplace.set(
      code,
      (relevantByMarketplace.get(code) ?? 0) + 1,
    );
  }

  for (const acquisition of acquisitions) {
    traceV2("marketplace", {
      query: search,
      marketplace: acquisition.marketplace,
      status: acquisition.status,
      raw: acquisition.raw,
      usable: acquisition.usable,
      relevant: relevantByMarketplace.get(acquisition.marketplace) ?? 0,
      error: acquisition.error,
    });
  }

  const knownKeys = new Set(
    rawCandidates.map((item) => candidateKey(item.marketplace, item.externalId)),
  );
  const huntedClusters =
    options.hunt === true
      ? await huntMissingStoreOffers(
          processed.clusters,
          knownKeys,
          options.limit ?? 12,
        )
      : processed.clusters;
  const products = huntedClusters
    .map(canonicalizeCluster)
    .filter((item): item is CanonicalProduct => item !== null)
    .sort((first, second) => first.price - second.price);

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
      reason: candidate.reason,
    });
  }

  for (const cluster of huntedClusters) {
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
  let persistedProductIds: string[] = [];
  if (persistEnabled) {
    try {
      persistedProductIds = await persistCanonicalProducts(search, products);
    } catch (error) {
      console.error("[MULTISTORE-V2] persistencia falhou", error);
      persistedProductIds = products.map(() => "");
    }
  }

  const views = toViews(products, persistedProductIds);
  const multiStoreClusters = products.filter(
    (item) => item.marketplaces.length >= 2,
  ).length;
  const singleStoreClusters = products.filter(
    (item) => item.marketplaces.length === 1,
  ).length;

  traceV2("result", {
    query: search,
    marketplacesAttempted,
    marketplacesSucceeded,
    rawCandidates: rawCandidates.length,
    relevantCandidates: processed.relevant.length,
    clusters: huntedClusters.length,
    singleStoreClusters,
    multiStoreClusters,
  });

  return {
    query: search,
    intent: processed.intent,
    acquisitions,
    rawCandidates: rawCandidates.length,
    relevantCandidates: processed.relevant,
    clusters: huntedClusters,
    products,
    views,
    persistedProductIds,
    marketplacesAttempted,
    marketplacesSucceeded,
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
    marketplacesSucceeded: [] as MarketplaceCode[],
    multiStoreClusters: 0,
    singleStoreClusters: 0,
  };
}
