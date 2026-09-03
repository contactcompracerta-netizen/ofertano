import { listarDiscoveryAdaptersAtivos } from "@/services/discovery/core/registry";
import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "@/services/discovery/core/types";
import {
  inferSearchOutcome,
  reduzirSearchOutcomes,
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
  QueryIntent,
  RawCandidate,
  ScoredCandidate,
} from "./types";
import { buildQueryIntent } from "./queryIntent";
import { scoreQueryRelevance } from "./queryRelevance";
import { buildQueryCore, queryIntentFromCore } from "./queryCore";
import { clusterCandidates } from "./cluster";
import { canonicalizeCluster } from "./canonicalize";
import {
  isClusterPublishable,
  isSearchVisible,
  persistCanonicalProducts,
  type PersistProductFn,
} from "./persist";
import { traceV2 } from "./trace";
import { compareFingerprints, mergeFingerprints } from "./pairMatcher";
import { normalizeCandidate, normalizeMultistoreText } from "./normalizeCandidate";
import { buildAliExpressCompactFallbackQuery, buildSearchPlan } from "./queryPlan";
import { extractSanitizedIdentity } from "./sanitizedIdentity";
import { detectDistinctiveConflict } from "./distinctiveAnchors";
export { buildSearchPlan };
import { rankCanonicalProducts } from "./rank";
import {
  DEFAULT_SEARCH_BUDGET,
  createSearchDeadline,
  waitForAbsoluteTime,
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

export function coverageStatusOf(
  acquisitions: MarketplaceAcquisition[],
): "COMPLETE" | "INCOMPLETE" {
  return acquisitions.some(
    (item) => item.status !== "SUCCESS" && item.status !== "EMPTY",
  )
    ? "INCOMPLETE"
    : "COMPLETE";
}

function snapshotAcquisitions(
  acquisitions: MarketplaceAcquisition[],
): MarketplaceAcquisition[] {
  return acquisitions.map((item) => ({
    ...item,
    candidates: item.candidates.map((candidate) => ({
      ...candidate,
      attributes: { ...candidate.attributes },
    })),
  }));
}

type V2Phase =
  | "ACQUISITION"
  | "NORMALIZATION"
  | "RELEVANCE"
  | "CLUSTERING"
  | "RESPONSE";

type PreparedSearchQuery = {
  identity: ReturnType<typeof extractSanitizedIdentity>;
  core: ReturnType<typeof buildQueryCore>;
  intent: QueryIntent;
  plan: string[];
};

const MIN_POSTPROCESS_BUDGET_MS = 100;
const CLUSTERING_RESERVE_MS = 1_500;

function canRunPostprocess(
  deadline: SearchDeadline,
  candidateCount = 0,
): boolean {
  if (deadline.expired()) {
    return false;
  }

  return deadline.remainingMs() > MIN_POSTPROCESS_BUDGET_MS;
}

function traceV2Phase(
  phase: V2Phase,
  event: "start" | "end",
  startedAt: number,
  deadline: SearchDeadline,
  fields: Record<string, unknown> = {},
): void {
  traceV2("phase", {
    phase,
    event,
    ...(event === "end" ? { durationMs: Date.now() - startedAt } : {}),
    remainingMs: deadline.remainingMs(),
    ...fields,
  });
}

export function elapsedV2Ms(deadline: SearchDeadline): number {
  return Math.max(0, Date.now() - deadline.startedAt);
}

function titleHasBrand(title: string, brand: string | null): boolean {
  if (!brand) {
    return true;
  }

  const normalized = normalizeMultistoreText(title);
  return brand.split(" ").every((token) => normalized.includes(token));
}

/*
 * A aquisicao so precisa decidir se vale tentar outra variante de consulta.
 * A relevancia completa cria fingerprint/conceitos e pertence a fase protegida
 * de RELEVANCE; repeti-la aqui bloqueava timers quando varias lojas retornavam
 * lotes grandes ao mesmo tempo.
 */
function hasLightweightQueryEvidence(
  title: string,
  intent: QueryIntent,
): boolean {
  if (!titleHasBrand(title, intent.brand)) {
    return false;
  }

  const normalized = normalizeMultistoreText(title);
  const tokens = new Set(normalized.split(" ").filter(Boolean));
  const compact = normalized.replace(/\s+/g, "");
  const identityValues = [
    ...intent.modelTokens,
    ...intent.identityNumbers,
    ...intent.identityAnchors.map((anchor) => anchor.value),
  ]
    .map((value) => normalizeMultistoreText(value))
    .filter(Boolean);

  if (intent.importantAttributes.capacity) {
    const queryCapacity = normalizeMultistoreText(intent.importantAttributes.capacity);
    const capacityMatch = queryCapacity &&
      (tokens.has(queryCapacity) || compact.includes(queryCapacity.replace(/\s+/g, "")));
    if (!capacityMatch) {
      return false;
    }
  }

  if (intent.importantAttributes.voltage) {
    const queryVoltage = normalizeMultistoreText(intent.importantAttributes.voltage);
    const voltageMatch = queryVoltage &&
      (tokens.has(queryVoltage) || compact.includes(queryVoltage.replace(/\s+/g, "")));
    if (!voltageMatch) {
      return false;
    }
  }

  if (intent.importantAttributes.quantity) {
    const queryQty = normalizeMultistoreText(intent.importantAttributes.quantity);
    const quantityMatch = queryQty &&
      (tokens.has(queryQty) || compact.includes(queryQty.replace(/\s+/g, "")));
    if (!quantityMatch) {
      return false;
    }
  }

  if (
    intent.hasStrongIdentity &&
    identityValues.length > 0 &&
    !identityValues.some((value) => {
      const normalizedValue = value.replace(/\s+/g, "");
      return tokens.has(value) || compact.includes(normalizedValue);
    })
  ) {
    return false;
  }

  if (intent.distinctiveTokens.length >= 3) {
    const distinctiveHits = intent.distinctiveTokens.filter((token) =>
      tokens.has(normalizeMultistoreText(token)),
    ).length;
    if (distinctiveHits < 2) {
      return false;
    }
  }

  return true;
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

  if (outcome === "NOT_RUN") {
    return "NOT_RUN";
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
  const products = rankCanonicalProducts(
    clusters
      .map(canonicalizeCluster)
      .filter((item): item is CanonicalProduct => item !== null),
  );

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

type MarketplaceRunTrace = {
  closed: boolean;
  scheduledAt: number;
  startedAt: number | null;
  firstCandidateAt: number | null;
  finishedAt: number | null;
  abortedAt: number | null;
  budgetMs: number;
  remainingMsAtStart: number;
  partialCountAtAbort: number;
  partialCandidates: RawCandidate[];
};

function traceMarketplaceTiming(
  marketplace: MarketplaceCode,
  trace: MarketplaceRunTrace,
  status: AcquisitionStatus,
  partialCount: number,
): void {
  if (trace.closed) {
    return;
  }
  traceV2("marketplace-timing", {
    marketplace,
    status,
    scheduledAt: trace.scheduledAt,
    startedAt: trace.startedAt ?? "",
    firstCandidateAt: trace.firstCandidateAt ?? "",
    finishedAt: trace.finishedAt ?? "",
    abortedAt: trace.abortedAt ?? "",
    budgetMs: trace.budgetMs,
    remainingMsAtStart: trace.remainingMsAtStart,
    partialCountAtAbort: trace.partialCountAtAbort,
    partialCount,
  });
}

function mergeDiscoveryCandidates(
  merged: Map<string, DiscoveryCandidate>,
  candidates: DiscoveryCandidate[],
  trace: MarketplaceRunTrace,
): void {
  for (const candidate of candidates) {
    const key = candidateKey(candidate.marketplace, candidate.externalId);
    if (!merged.has(key)) {
      if (!trace.firstCandidateAt) {
        trace.firstCandidateAt = Date.now();
      }
      merged.set(key, {
        ...candidate,
        attributes: candidate.attributes ? { ...candidate.attributes } : candidate.attributes,
      });
    }
  }

  trace.partialCountAtAbort = merged.size;
  trace.partialCandidates = Array.from(merged.values())
    .map(toRawCandidate)
    .filter((item): item is RawCandidate => item !== null);
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
  adapters: DiscoveryAdapter[] = listarDiscoveryAdaptersAtivos(),
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
  let acceptingHuntResults = true;
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

          if (
            !acceptingHuntResults ||
            huntAbort.signal.aborted ||
            deadline.expired()
          ) {
            return;
          }

          for (const result of settled) {
            if (result.status !== "fulfilled") {
              continue;
            }

            for (const candidate of result.value.candidates) {
              if (!acceptingHuntResults || huntAbort.signal.aborted) {
                return;
              }
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
      acceptingHuntResults = false;
      huntAbort.abort();
    }
  } finally {
    acceptingHuntResults = false;
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
  budget: SearchBudget,
  globalDeadline: SearchDeadline,
  acquisitionPhase: AbortSignal,
  trace: MarketplaceRunTrace,
  persist: boolean,
  queryCore: ReturnType<typeof buildQueryCore>,
  identity: ReturnType<typeof extractSanitizedIdentity>,
): Promise<MarketplaceAcquisition> {
  trace.startedAt = Date.now();
  const configuredAdapterBudgetMs =
    adapter.marketplace === "MERCADO_LIVRE"
      ? (budget.mercadoLivreMs ?? budget.marketplaceMs)
      : budget.marketplaceMs;
  const adapterBudgetMs = Math.min(
    configuredAdapterBudgetMs,
    globalDeadline.acquisitionUntilMs(persist),
  );
  const hardBudgetMs = Math.max(0, adapterBudgetMs);

  trace.budgetMs = hardBudgetMs;
  trace.remainingMsAtStart = globalDeadline.remainingMs();

  const isolated = composeAbortSignal(
    hardBudgetMs,
    acquisitionPhase,
    globalDeadline.signal,
  );
  const merged = new Map<string, DiscoveryCandidate>();
  const outcomes: ReturnType<typeof inferSearchOutcome>[] = [];
  let scanned = 0;
  let timedOut = false;
  let abortedByGlobal = false;
  let acceptingResults = true;

  const work = withSearchAbort(
    {
      signal: isolated.signal,
      fetchMs: Math.min(
        budget.fetchMs,
        Math.max(hardBudgetMs, 1),
      ),
      deadlineAt: trace.startedAt + hardBudgetMs,
    },
    async () => {
      const basePlan =
        adapter.marketplace === "MERCADO_LIVRE" && plan.length > 1
          ? plan.slice(0, Math.min(plan.length, 3))
          : plan;
      const compactFallbackQuery =
        adapter.marketplace === "ALIEXPRESS"
          ? buildAliExpressCompactFallbackQuery(query, queryCore, identity)
          : null;
      const effectivePlan = compactFallbackQuery
        ? Array.from(
            new Set([
              ...basePlan,
              compactFallbackQuery,
            ].map((item) => normalizeMultistoreText(item).trim()).filter(Boolean)),
          )
        : basePlan;
      for (const [index, searchQuery] of effectivePlan.entries()) {
        if (isolated.signal.aborted || globalDeadline.expired()) {
          timedOut = true;
          abortedByGlobal = globalDeadline.expired();
          break;
        }

        let result: MarketplaceDiscoveryResult;
        traceV2("query-variant", {
          marketplace: adapter.marketplace,
          variantIndex: index + 1,
          variant: searchQuery,
          sanitizedQuery: query,
        });
        const variantStartedAt = Date.now();

        try {
          result = withAcquisitionOutcome(
            await adapter.searcher!({
              query: searchQuery,
              normalizedQuery: searchQuery,
              limit,
              mode: "MULTILOJA",
              signal: isolated.signal,
            }),
          );
        } catch (error) {
          if (
            isAbortError(error) ||
            isolated.signal.aborted ||
            globalDeadline.expired()
          ) {
            timedOut = true;
            abortedByGlobal = globalDeadline.expired();
            break;
          }
          throw error;
        }

        if (adapter.marketplace === "ALIEXPRESS") {
          traceV2("aliexpress-variant-result", {
            variantIndex: index + 1,
            variant: searchQuery,
            raw: result.candidates.length,
            scanned: result.scanned,
            status: result.searchOutcome ?? (result.success ? "SEARCH_COMPLETED" : "ERROR"),
            durationMs: Date.now() - variantStartedAt,
            error: result.error,
          });
        }

        if (
          !acceptingResults ||
          trace.closed ||
          isolated.signal.aborted ||
          globalDeadline.expired()
        ) {
          timedOut = true;
          abortedByGlobal = globalDeadline.expired();
          break;
        }

        outcomes.push(inferSearchOutcome(result));
        scanned += result.scanned || result.candidates.length;
        mergeDiscoveryCandidates(merged, result.candidates, trace);

        const minRelevant =
          intent.brand ||
          intent.hasStrongIdentity ||
          intent.distinctiveTokens.length >= 3
            ? 1
            : Math.min(4, limit);
        const relevanceProbeLimit = Math.min(12, Math.max(4, limit));
        let relevantHitCount = 0;
        let probedCandidates = 0;
        for (const candidate of merged.values()) {
          if (
            probedCandidates >= relevanceProbeLimit ||
            relevantHitCount >= minRelevant ||
            isolated.signal.aborted ||
            globalDeadline.expired() ||
            globalDeadline.remainingMs() <= MIN_POSTPROCESS_BUDGET_MS
          ) {
            break;
          }
          probedCandidates += 1;
          if (hasLightweightQueryEvidence(candidate.title, intent)) {
            relevantHitCount += 1;
          }
        }
        const enoughHits = relevantHitCount >= minRelevant;
        if (enoughHits) {
          break;
        }
      }
    },
  );
  void work.catch(() => undefined);

  try {
    const raced = await withTimeout(work, hardBudgetMs, isolated.signal);
    if (raced.status === "timeout") {
      timedOut = true;
    }
  } catch (error) {
    if (!isAbortError(error) && !timedOut) {
      trace.finishedAt = Date.now();
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
        trace.finishedAt - trace.startedAt!,
      );
    }
    timedOut = true;
  } finally {
    acceptingResults = false;
    if (timedOut || globalDeadline.expired()) {
      isolated.abort();
    }
    isolated.cleanup();
  }

  if (globalDeadline.expired() && !trace.finishedAt) {
    abortedByGlobal = true;
    trace.abortedAt = Date.now();
  }

  const rawCandidates = Array.from(merged.values())
    .map(toRawCandidate)
    .filter((item): item is RawCandidate => item !== null);
  trace.partialCountAtAbort = rawCandidates.length;
  trace.finishedAt = Date.now();
  const elapsedMs = trace.finishedAt - trace.startedAt!;

  if (timedOut || abortedByGlobal) {
    const status: AcquisitionStatus = "TIMEOUT";
    traceMarketplaceTiming(adapter.marketplace, trace, status, rawCandidates.length);
    return toAcquisition(
      adapter,
      status,
      rawCandidates,
      scanned || rawCandidates.length,
      rawCandidates.length > 0
        ? null
        : "TIMEOUT: orcamento de busca esgotado.",
      elapsedMs,
    );
  }

  const aggregatedOutcome =
    merged.size > 0
      ? ("SEARCH_COMPLETED" as const)
      : reduzirSearchOutcomes(outcomes);

  const status = mapAcquisitionStatus({
    marketplace: adapter.marketplace,
    query: plan[0] || query,
    success: aggregatedOutcome !== "ERROR" && aggregatedOutcome !== "BLOCKED",
    candidates: Array.from(merged.values()),
    scanned,
    searchOutcome: aggregatedOutcome,
    error: null,
  });

  traceMarketplaceTiming(adapter.marketplace, trace, status, rawCandidates.length);

  return toAcquisition(
    adapter,
    status,
    rawCandidates,
    scanned || rawCandidates.length,
    null,
    elapsedMs,
  );
}

export async function acquireMarketplaces(
  query: string,
  limit = 12,
  adapters: DiscoveryAdapter[] = listarDiscoveryAdaptersAtivos(),
  budget: SearchBudget = DEFAULT_SEARCH_BUDGET,
  deadline: SearchDeadline = createSearchDeadline(budget),
  persist = false,
  prepared?: PreparedSearchQuery,
): Promise<MarketplaceAcquisition[]> {
  const identity = prepared?.identity ?? extractSanitizedIdentity(query);
  const queryCore = prepared?.core ?? identity.queryCore;
  const plan = prepared?.plan ?? buildSearchPlan(query, queryCore, identity);
  const intent = prepared?.intent ?? queryIntentFromCore(queryCore);
  const scheduledAt = Date.now();
  const acquisitionEndAt =
    deadline.deadlineAt -
    deadline.responseReserveMs -
    (persist ? deadline.budget.persistReserveMs : 0);
  const acquisitionPhase = composeAbortSignal(
    Math.max(0, acquisitionEndAt - Date.now()),
    deadline.signal,
  );
  const runs = adapters.map((adapter) => {
    const trace: MarketplaceRunTrace = {
      closed: false,
      scheduledAt,
      startedAt: null,
      firstCandidateAt: null,
      finishedAt: null,
      abortedAt: null,
      budgetMs: budget.marketplaceMs,
      remainingMsAtStart: deadline.remainingMs(),
      partialCountAtAbort: 0,
      partialCandidates: [],
    };

    traceV2("marketplace-scheduled", {
      marketplace: adapter.marketplace,
      scheduledAt,
      budgetMs:
        adapter.marketplace === "MERCADO_LIVRE"
          ? (budget.mercadoLivreMs ?? budget.marketplaceMs)
          : budget.marketplaceMs,
      globalRemainingMs: deadline.remainingMs(),
      startDelayMs: 0,
    });

    const slot: {
      adapter: DiscoveryAdapter;
      trace: MarketplaceRunTrace;
      result: MarketplaceAcquisition | null;
      promise: Promise<MarketplaceAcquisition>;
    } = {
      adapter,
      trace,
      result: null,
      promise: null!,
    };

    slot.promise = acquireOneMarketplace(
      adapter,
      query,
      plan,
      limit,
      intent,
      budget,
      deadline,
      acquisitionPhase.signal,
      trace,
      persist,
      queryCore,
      identity,
    ).then((acquisition) => {
      if (!trace.closed) {
        slot.result = acquisition;
      }
      return acquisition;
    });
    void slot.promise.catch(() => undefined);

    return slot;
  });
  const runByMarketplace = new Map(
    runs.map((run) => [run.adapter.marketplace, run] as const),
  );

  try {
    await Promise.race([
      Promise.allSettled(runs.map((run) => run.promise)),
      waitForAbsoluteTime(acquisitionEndAt, deadline.signal),
    ]);

    for (const run of runs) {
      if (!run.result) {
        run.trace.abortedAt = Date.now();
      }
    }
    acquisitionPhase.abort();
  } finally {
    acquisitionPhase.cleanup();
  }

  return adapters.map((adapter) => {
    const run = runByMarketplace.get(adapter.marketplace);
    if (!run) {
      return toAcquisition(
        adapter,
        "ERROR",
        [],
        0,
        "Adapter nao agendado.",
        0,
      );
    }

    if (run.result) {
      run.trace.closed = true;
      return run.result;
    }

    const elapsedMs =
      run.trace.startedAt != null
        ? (run.trace.abortedAt ?? Date.now()) - run.trace.startedAt
        : 0;

    traceMarketplaceTiming(
      run.adapter.marketplace,
      run.trace,
      "TIMEOUT",
      run.trace.partialCandidates.length,
    );
    const acquisition = toAcquisition(
      run.adapter,
      "TIMEOUT",
      run.trace.partialCandidates,
      run.trace.partialCountAtAbort,
      "TIMEOUT: orcamento de busca esgotado.",
      elapsedMs,
    );
    run.trace.closed = true;
    return acquisition;
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
      if (deadline.expired() || deadline.remainingMs() < 400) {
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

/*
 * persist: true aguarda saveProduct no caminho da busca (scripts/batch).
 * persist: false (ou omitido) nao toca Prisma; a Home agenda persistencia
 * pos-resposta via after() + persistSelectedSearchClusters.
 */
export async function searchMultistoreV2(
  query: string,
  options: {
    persist?: boolean;
    limit?: number;
    hunt?: boolean;
    adapters?: DiscoveryAdapter[];
    budget?: SearchBudget;
    affiliateResolver?: AffiliateResolver;
    persistProduct?: PersistProductFn;
  } = {},
): Promise<MultistoreV2Result> {
  const rawQuery = query.replace(/\s+/g, " ").trim();
  const budget = options.budget ?? DEFAULT_SEARCH_BUDGET;
  const limit = options.limit ?? 12;
  const deadline = createSearchDeadline(budget);
  const persistEnabled = options.persist === true;
  const identity = extractSanitizedIdentity(rawQuery);
  const search = identity.sanitizedQuery || rawQuery;
  const core = identity.queryCore;
  const intent = queryIntentFromCore(core);
  const prepared: PreparedSearchQuery = {
    identity,
    core,
    intent,
    plan: buildSearchPlan(search, core, identity),
  };
  traceV2("query-input", {
    rawQuery,
    sanitizedQuery: search,
    removedNoise: identity.removedNoise,
  });
  traceV2("query", {
    query: search,
    budgetMs: budget.globalMs,
    deadlineAt: deadline.deadlineAt,
    marketplaceBudgetMs: budget.marketplaceMs,
  });

  try {
    const acquisitionStarted = Date.now();
    traceV2Phase("ACQUISITION", "start", acquisitionStarted, deadline);
    const acquisitions = await acquireMarketplaces(
      search,
      limit,
      options.adapters,
      budget,
      deadline,
      persistEnabled,
      prepared,
    );
    const acquisitionsSnapshot = snapshotAcquisitions(acquisitions);
    traceV2Phase("ACQUISITION", "end", acquisitionStarted, deadline, {
      marketplaces: acquisitionsSnapshot.length,
    });

    const marketplacesAttempted = acquisitionsSnapshot.map(
      (item) => item.marketplace,
    );
    const marketplacesSucceeded = acquisitionsSnapshot
      .filter((item) => item.status === "SUCCESS")
      .map((item) => item.marketplace);

    const normalizationStarted = Date.now();
    traceV2Phase("NORMALIZATION", "start", normalizationStarted, deadline);
    const rawCandidates = acquisitionsSnapshot.flatMap((item) => item.candidates);
    const queryCore = prepared.core;
    const normalized: ReturnType<typeof normalizeCandidate>[] = [];
    for (const raw of rawCandidates) {
      if (!canRunPostprocess(deadline, rawCandidates.length)) {
        break;
      }
      const candidate = normalizeCandidate(raw);
      const conflict = detectDistinctiveConflict(identity, candidate.raw.title);
      if (conflict.conflict) {
        traceV2("candidate-identity", {
          marketplace: raw.marketplace,
          externalId: raw.externalId,
          title: candidate.raw.title,
          compatible: false,
          rejectionReason: conflict.reason,
          rawQuery,
          sanitizedQuery: search,
        });
        continue;
      }
      normalized.push(candidate);
    }
    traceV2Phase("NORMALIZATION", "end", normalizationStarted, deadline, {
      rawCandidates: rawCandidates.length,
      processed: normalized.length,
      skipped: normalized.length < rawCandidates.length,
    });

    const relevanceStarted = Date.now();
    traceV2Phase("RELEVANCE", "start", relevanceStarted, deadline);
    const scored: ScoredCandidate[] = [];
    const relevanceStopMs = deadline.responseReserveMs + CLUSTERING_RESERVE_MS;
    const allowSmallSetScoring = normalized.length > 0 && normalized.length <= 4;
    for (const item of normalized) {
      if (
        deadline.remainingMs() <= relevanceStopMs &&
        !allowSmallSetScoring
      ) {
        break;
      }
      scored.push(scoreQueryRelevance(intent, item, queryCore));
    }
    const relevant = scored.filter((item) => item.status === "RELEVANT");
    traceV2Phase("RELEVANCE", "end", relevanceStarted, deadline, {
      relevant: relevant.length,
      processed: scored.length,
      skipped: scored.length < normalized.length,
    });

    const clusteringStarted = Date.now();
    traceV2Phase("CLUSTERING", "start", clusteringStarted, deadline);
    let clusters: ProductCluster[] = [];
    let processedProducts: CanonicalProduct[] = [];
    if (canRunPostprocess(deadline)) {
      clusters = clusterCandidates(relevant, {
        shouldContinue: () => canRunPostprocess(deadline),
      });
      const canonicalProducts: CanonicalProduct[] = [];
      for (const cluster of clusters) {
        if (!canRunPostprocess(deadline)) {
          break;
        }
        const canonical = canonicalizeCluster(cluster);
        if (canonical) {
          canonicalProducts.push(canonical);
        }
      }
      processedProducts = rankCanonicalProducts(canonicalProducts);
    }
    traceV2Phase("CLUSTERING", "end", clusteringStarted, deadline, {
      clusters: clusters.length,
      products: processedProducts.length,
      skipped: relevant.length > 0 && clusters.length === 0,
    });

    const responseStarted = Date.now();
    traceV2Phase("RESPONSE", "start", responseStarted, deadline);

    if (!deadline.expired() && deadline.remainingMs() > deadline.responseReserveMs) {
      await applyAffiliateLayer(
        clusters,
        deadline,
        options.affiliateResolver,
      );
    }
    const relevantByMarketplace = new Map<string, number>();
    for (const candidate of relevant) {
      const code = candidate.normalized.raw.marketplace;
      relevantByMarketplace.set(
        code,
        (relevantByMarketplace.get(code) ?? 0) + 1,
      );
    }

    for (const acquisition of acquisitionsSnapshot) {
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
    const shouldHunt =
      options.hunt === true &&
      !deadline.expired() &&
      deadline.remainingMs() > deadline.responseReserveMs &&
      !processedProducts.some((product) => isSearchVisible(product));
    const huntedClusters = shouldHunt
      ? await huntMissingStoreOffers(
          clusters,
          knownKeys,
          limit,
          deadline,
          options.adapters ?? listarDiscoveryAdaptersAtivos(),
        )
      : clusters;
    const coverageStatus = coverageStatusOf(acquisitionsSnapshot);
    const responseCanonicalProducts: CanonicalProduct[] = [];
    for (const cluster of huntedClusters) {
      if (!canRunPostprocess(deadline)) {
        break;
      }
      const canonical = canonicalizeCluster(cluster);
      if (canonical) {
        responseCanonicalProducts.push(canonical);
      }
    }
    const rankedResponseProducts = canRunPostprocess(deadline)
      ? rankCanonicalProducts(responseCanonicalProducts)
      : [];
    const products = rankedResponseProducts.map((product) => {
      const withCoverage = { ...product, coverageStatus };
      return {
        ...withCoverage,
        searchVisible: isSearchVisible(withCoverage),
        publishable: isClusterPublishable(withCoverage),
      };
    });
    const selectedProducts = products
      .filter((product) => product.searchVisible)
      .slice(0, limit);
    const selectedClusters = selectedProducts
      .map((product) =>
        huntedClusters.find((cluster) => cluster.clusterId === product.clusterId),
      )
      .filter((cluster): cluster is NonNullable<typeof cluster> => Boolean(cluster));

    for (const cluster of selectedClusters) {
      const canonical = canonicalizeCluster(cluster);
      traceV2("cluster", {
        clusterId: cluster.clusterId,
        title: canonical?.title ?? cluster.members[0]?.candidate.normalized.raw.title,
        offers: canonical?.offers.length ?? cluster.members.length,
        marketplaces: canonical?.marketplaces ?? [],
        confidence: cluster.confidence,
      });
    }

    const persistReady =
      persistEnabled && deadline.remainingMs() > deadline.responseReserveMs;
    let persistedProductIds: string[] = [];
    const persistStartedAt = Date.now();
    if (persistReady) {
      try {
        persistedProductIds = await persistCanonicalProducts(
          search,
          selectedProducts,
          {
            limit,
            deadline,
            persistProduct: options.persistProduct,
          },
        );
      } catch (error) {
        console.error("[MULTISTORE-V2] persistencia falhou", error);
        persistedProductIds = selectedProducts.map(() => "");
      }
    } else {
      persistedProductIds = selectedProducts.map(() => "");
      traceV2(
        options.persist === true ? "persist-skipped" : "persist-deferred",
        {
          query: search,
          remainingMs: deadline.remainingMs(),
          selected: selectedProducts.length,
        },
      );
    }

    const persistElapsedMs = Date.now() - persistStartedAt;
    const persistedCount = persistedProductIds.filter(Boolean).length;
    const views = toViews(selectedProducts, persistedProductIds);
    const multiStoreClusters = selectedProducts.filter(
      (item) => item.marketplaces.length >= 2,
    ).length;
    const singleStoreClusters = selectedProducts.filter(
      (item) => item.marketplaces.length === 1,
    ).length;

    traceV2("persist", {
      query: search,
      selected: selectedProducts.length,
      attempted: persistReady ? selectedProducts.length : 0,
      persisted: persistedCount,
      elapsedMs: persistElapsedMs,
      remainingMs: deadline.remainingMs(),
    });

    traceV2("result", {
      query: search,
      elapsedMs: elapsedV2Ms(deadline),
      deadlineMs: budget.globalMs,
      timedOut: deadline.expired(),
      marketplacesAttempted,
      marketplacesSucceeded,
      rawCandidates: rawCandidates.length,
      relevantCandidates: relevant.length,
      clusters: selectedClusters.length,
      singleStoreClusters,
      multiStoreClusters,
      persistElapsedMs,
      persisted: persistedCount,
    });

    traceV2Phase("RESPONSE", "end", responseStarted, deadline, {
      views: views.length,
      products: selectedProducts.length,
    });

    return {
      query: search,
      rawQuery,
      intent,
      acquisitions: acquisitionsSnapshot,
      rawCandidates: rawCandidates.length,
      relevantCandidates: relevant,
      clusters: selectedClusters,
      products: selectedProducts,
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
