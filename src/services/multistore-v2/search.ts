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
import { scoreQueryRelevance } from "./queryRelevance";
import { clusterCandidates } from "./cluster";
import { canonicalizeCluster } from "./canonicalize";
import { persistCanonicalProducts } from "./persist";
import { traceV2 } from "./trace";
import { compareFingerprints, mergeFingerprints } from "./pairMatcher";
import { normalizeCandidate, normalizeMultistoreText } from "./normalizeCandidate";
import { buildSearchPlan } from "./queryPlan";
import {
  DEFAULT_SEARCH_BUDGET,
  createSearchDeadline,
  marketplaceBudgetMs,
  waitMs,
  withTimeout,
  type SearchBudget,
  type SearchDeadline,
} from "./timeBudget";
import {
  withSearchAbort,
  isAbortError,
  composeAbortSignal,
} from "@/lib/searchAbort";
import {
  resolveListingAffiliate,
  isConfirmedAffiliateLink,
  type AffiliateResolver,
} from "./affiliateEligibility";

export function usarMotorMultistoreV2(): boolean {
  const value = process.env.MULTISTORE_ENGINE?.trim().toLowerCase();
  return value !== "legacy";
}

export { buildSearchPlan };

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

  const provided = candidate.affiliateLink?.trim() || null;
  const affiliateLink = isConfirmedAffiliateLink(provided, url)
    ? provided
    : null;

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
    affiliateLink,
    attributes: candidate.attributes ?? {},
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

function toAcquisition(
  adapter: DiscoveryAdapter,
  status: AcquisitionStatus,
  rawCandidates: RawCandidate[],
  scanned: number,
  error: string | null,
  elapsedMs: number,
): MarketplaceAcquisition {
  return {
    marketplace: adapter.marketplace,
    marketplaceName: adapter.marketplaceName,
    status,
    raw: scanned,
    usable: rawCandidates.length,
    error,
    elapsedMs,
    candidates: rawCandidates,
  };
}

async function huntMissingStoreOffers(
  clusters: ProductCluster[],
  knownKeys: Set<string>,
  limit: number,
  deadline: SearchDeadline,
): Promise<ProductCluster[]> {
  if (deadline.remainingMs() < 4_000) {
    return clusters;
  }

  const huntMs = Math.min(
    deadline.budget.marketplaceMs,
    Math.max(0, deadline.remainingMs() - deadline.budget.persistReserveMs),
  );
  if (huntMs < 500) {
    return clusters;
  }

  const huntAbort = composeAbortSignal(huntMs, deadline.signal);
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

  try {
    const raced = await withTimeout(
      Promise.allSettled(
        targets.map(async (cluster) => {
          if (deadline.expired() || huntAbort.signal.aborted) {
            return;
          }
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
                signal: huntAbort.signal,
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
            }
          }
        }),
      ),
      huntMs,
      huntAbort.signal,
    );
    if (raced.status === "timeout") {
      huntAbort.abort();
    }
  } finally {
    huntAbort.cleanup();
  }

  return nextClusters;
}

async function acquireOneMarketplace(
  adapter: DiscoveryAdapter,
  query: string,
  plan: string[],
  limit: number,
  intent: ReturnType<typeof buildQueryIntent>,
  deadline: SearchDeadline,
): Promise<MarketplaceAcquisition> {
  const started = Date.now();
  const childTimeout = marketplaceBudgetMs(deadline);
  const child = composeAbortSignal(childTimeout, deadline.signal);
  const merged = new Map<string, DiscoveryCandidate>();
  let last: MarketplaceDiscoveryResult | null = null;
  let scanned = 0;
  let timedOut = false;

  const work = withSearchAbort(
    {
      signal: child.signal,
      fetchMs: Math.min(deadline.budget.fetchMs, Math.max(childTimeout, 1)),
      deadlineAt: started + childTimeout,
    },
    async () => {
      for (const searchQuery of plan) {
        if (child.signal.aborted || deadline.expired()) {
          timedOut = true;
          break;
        }

        try {
          last = withAcquisitionOutcome(
            await adapter.searcher!({
              query: searchQuery,
              normalizedQuery: searchQuery,
              limit,
              mode: "MULTILOJA",
              signal: child.signal,
            }),
          );
        } catch (error) {
          if (isAbortError(error) || child.signal.aborted || deadline.expired()) {
            timedOut = true;
            break;
          }
          throw error;
        }

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
    },
  );

  try {
    const raced = await withTimeout(work, childTimeout, child.signal);
    if (raced.status === "timeout") {
      timedOut = true;
      child.abort();
      await waitMs(deadline.budget.hangGraceMs);
    }
  } catch (error) {
    if (!isAbortError(error) && !timedOut) {
      const message = error instanceof Error ? error.message : String(error);
      return toAcquisition(
        adapter,
        mapAcquisitionStatus({
          marketplace: adapter.marketplace,
          query,
          success: false,
          candidates: [],
          scanned: 0,
          error: message,
        }),
        [],
        0,
        message,
        Date.now() - started,
      );
    }
    timedOut = true;
  } finally {
    child.cleanup();
  }

  const rawCandidates = Array.from(merged.values())
    .map(toRawCandidate)
    .filter((item): item is RawCandidate => item !== null);
  const elapsedMs = Date.now() - started;

  if (timedOut) {
    return toAcquisition(
      adapter,
      "TIMEOUT",
      rawCandidates,
      scanned || rawCandidates.length,
      "TIMEOUT: orcamento de busca esgotado.",
      elapsedMs,
    );
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

  return toAcquisition(
    adapter,
    mapAcquisitionStatus({
      ...lastResult,
      candidates: Array.from(merged.values()),
      scanned,
      searchOutcome:
        merged.size > 0 ? "SEARCH_COMPLETED" : lastResult.searchOutcome,
    }),
    rawCandidates,
    scanned || rawCandidates.length,
    lastResult.error ?? null,
    elapsedMs,
  );
}

export async function acquireMarketplaces(
  query: string,
  limit = 12,
  adapters: DiscoveryAdapter[] = listarDiscoveryAdaptersAtivos(),
  budget: SearchBudget = DEFAULT_SEARCH_BUDGET,
  deadline: SearchDeadline = createSearchDeadline(budget),
): Promise<MarketplaceAcquisition[]> {
  const plan = buildSearchPlan(query);
  const intent = buildQueryIntent(query);

  const settled = await Promise.allSettled(
    adapters.map((adapter) =>
      acquireOneMarketplace(adapter, query, plan, limit, intent, deadline),
    ),
  );

  return settled.map((result, index) => {
    const adapter = adapters[index]!;
    if (result.status === "fulfilled") {
      return result.value;
    }

    const error =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    const timedOut = isAbortError(result.reason) || deadline.expired();
    return toAcquisition(
      adapter,
      timedOut ? "TIMEOUT" : mapAcquisitionStatus({
        marketplace: adapter.marketplace,
        query,
        success: false,
        candidates: [],
        scanned: 0,
        error,
      }),
      [],
      0,
      timedOut ? "TIMEOUT: orcamento de busca esgotado." : error,
      0,
    );
  });
}

async function applyAffiliateLayer(
  clusters: ProductCluster[],
  deadline: SearchDeadline,
  resolver?: AffiliateResolver,
): Promise<void> {
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      const raw = member.candidate.normalized.raw;
      if (raw.marketplace !== "MERCADO_LIVRE") {
        continue;
      }
      if (deadline.expired() || deadline.remainingMs() < Math.max(400, deadline.budget.persistReserveMs)) {
        if (!raw.affiliateStatus) {
          raw.affiliateStatus = "UNKNOWN";
        }
        continue;
      }

      const assessment = await resolveListingAffiliate(
        {
          marketplace: raw.marketplace,
          externalId: raw.externalId,
          sourceUrl: raw.url,
          affiliateLink: raw.affiliateLink,
          declaredStatus: raw.affiliateStatus,
        },
        {
          resolver,
          signal: deadline.signal,
          deadline,
        },
      );
      raw.affiliateLink = assessment.affiliateLink;
      raw.affiliateStatus = assessment.status;
    }
  }
}

export async function searchMultistoreV2(
  query: string,
  options: {
    persist?: boolean;
    limit?: number;
    hunt?: boolean;
    adapters?: DiscoveryAdapter[];
    budget?: SearchBudget;
    affiliateResolver?: AffiliateResolver;
  } = {},
): Promise<MultistoreV2Result> {
  const search = query.replace(/\s+/g, " ").trim();
  const budget = options.budget ?? DEFAULT_SEARCH_BUDGET;
  const deadline = createSearchDeadline(budget);
  traceV2("query", {
    query: search,
    budgetMs: budget.globalMs,
    marketplaceBudgetMs: budget.marketplaceMs,
  });

  try {
    const acquisitions = await acquireMarketplaces(
      search,
      options.limit ?? 12,
      options.adapters,
      budget,
      deadline,
    );
    const marketplacesAttempted = acquisitions.map((item) => item.marketplace);
    const marketplacesSucceeded = acquisitions
      .filter((item) => item.status === "SUCCESS")
      .map((item) => item.marketplace);

    const rawCandidates = acquisitions.flatMap((item) => item.candidates);
    const processed = processRawCandidates(search, rawCandidates);
    await applyAffiliateLayer(
      processed.clusters,
      deadline,
      options.affiliateResolver,
    );
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
        elapsedMs: acquisition.elapsedMs,
        raw: acquisition.raw,
        usable: acquisition.usable,
        relevant: relevantByMarketplace.get(acquisition.marketplace) ?? 0,
        timeout: acquisition.status === "TIMEOUT",
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
            deadline,
          )
        : processed.clusters;
    const products = huntedClusters
      .map(canonicalizeCluster)
      .filter((item): item is CanonicalProduct => item !== null)
      .sort((first, second) => first.price - second.price);

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

    const persistEnabled =
      options.persist !== false &&
      deadline.remainingMs() > budget.persistReserveMs;
    let persistedProductIds: string[] = [];
    if (persistEnabled) {
      try {
        persistedProductIds = await persistCanonicalProducts(search, products);
      } catch (error) {
        console.error("[MULTISTORE-V2] persistencia falhou", error);
        persistedProductIds = products.map(() => "");
      }
    } else if (options.persist !== false) {
      persistedProductIds = products.map(() => "");
      traceV2("persist-skipped", {
        query: search,
        remainingMs: deadline.remainingMs(),
      });
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
      elapsedMs: Date.now() - deadline.startedAt,
      deadlineMs: budget.globalMs,
      timedOut: deadline.expired(),
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
  } finally {
    deadline.abort();
  }
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
