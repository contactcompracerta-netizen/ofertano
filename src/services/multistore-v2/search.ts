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
  ProductFingerprint,
  PublicProductView,
  QueryIntent,
  RawCandidate,
  ScoredCandidate,
} from "./types";
import { buildQueryIntent } from "./queryIntent";
import { scoreQueryRelevance } from "./queryRelevance";
import {
  buildQueryCore,
  hasStrongProductConceptConflict,
  queryIntentFromCore,
} from "./queryCore";
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
import { classifyQueryMode } from "./queryIdentity";
import { detectDistinctiveConflict } from "./distinctiveAnchors";
import { extractSoldItemNucleus } from "./productConcepts";
export { buildSearchPlan };
import { rankCanonicalProducts } from "./rank";
import {
  DEFAULT_SEARCH_BUDGET,
  createSearchDeadline,
  resolveHuntReserveMs,
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
import {
  createCoverageStats,
  createHuntAttemptStats,
  createHuntIdentityDiagnostic,
  diffFingerprints,
  distributionOfClusters,
  emitCoverageSummary,
  emitHuntAttemptSummary,
  emitHuntIdentityDiagnostic,
  MARKETPLACE_TO_COVERAGE_KEY,
  summarizeFingerprint,
  type HuntAttemptStats,
  type HuntCoverage,
  type HuntIdentityDiagnostic,
} from "./searchCoverage";

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
const MAX_CLUSTERING_RESERVE_MS = 1_500;
const PHASE_HANDOFF_RESERVE_MS = 150;
const MIN_HUNT_ATTEMPT_MS = 250;
// Floor estrutural: um Ãºnico search de provider (Shopee/Amazon/AliExpress) leva,
// nos dados reais observados, ~1.5sâ€“2.5s. Abaixo disso o attempt aborta antes de
// qualquer candidato. Com a reserva de 5s e concorrÃªncia 2, ~4â€“6 attempts Ãºteis.
const USEFUL_HUNT_ATTEMPT_MS = 2_500;
const MAX_HUNT_SEEDS = 5;
const HUNT_CONCURRENCY = 2;

function canRunPostprocess(
  deadline: SearchDeadline,
  candidateCount = 0,
): boolean {
  if (deadline.expired()) {
    return false;
  }

  return deadline.remainingMs() > MIN_POSTPROCESS_BUDGET_MS;
}

function hasPhaseBudget(
  deadline: SearchDeadline,
  reservedMs: number,
): boolean {
  return !deadline.expired() && deadline.remainingMs() > reservedMs;
}

function resolveClusteringReserveMs(budget: SearchBudget): number {
  return Math.min(
    MAX_CLUSTERING_RESERVE_MS,
    Math.max(150, Math.floor(budget.globalMs * 0.1)),
  );
}

function resolveRelevanceReserveMs(
  budget: SearchBudget,
  deadline: SearchDeadline,
  huntReserveMs: number,
  clusteringReserveMs: number,
  persist: boolean,
): number {
  const configured = budget.relevanceReserveMs ?? Math.min(2_500, Math.floor(budget.globalMs * 0.15));
  const available = Math.max(
    0,
    budget.globalMs -
      deadline.responseReserveMs -
      huntReserveMs -
      clusteringReserveMs -
      (persist ? budget.persistReserveMs : 0),
  );
  return Math.min(Math.max(0, configured), available);
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

function isAliExpressPermanentConfigurationError(
  error: string | null | undefined,
): boolean {
  return /invalidappkey|invalid app key|app key is invalid|authentication|autentica(?:c|Ã§)(?:a|Ã£)o/i.test(
    error ?? "",
  );
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

function uniqueSearchTerms(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values) {
    const term = (value ?? "").replace(/\s+/g, " ").trim();
    const key = normalizeMultistoreText(term).replace(/\s+/g, " ");
    const coveredByExistingTerm = terms.some((existing) => {
      const existingKey = normalizeMultistoreText(existing).replace(/\s+/g, " ");
      return existingKey.includes(key) || key.includes(existingKey);
    });
    if (!key || seen.has(key) || coveredByExistingTerm) {
      continue;
    }
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

function discriminativeIdentityNumbers(identity: ProductFingerprint): string[] {
  const strongFields = [
    identity.model.value,
    identity.manufacturerSku.value,
    ...(identity.variantCodes.value ?? []),
    ...(identity.identityAnchors ?? []),
  ].filter((item): item is string => Boolean(item));

  return (identity.identityNumbers ?? []).filter((number) => {
    const compact = number.replace(/\s+/g, "");

    // Se o numero ja aparece dentro de um campo forte tipado (modelo/sku/
    // ancora/variante), nao o replique separadamente.
    if (strongFields.some((field) => field.includes(compact) || compact.includes(field))) {
      return false;
    }

    // Numeros isolados de 1-4 digitos extraidos genericamente de titulo sao
    // SOFT. So contam como identidade quando sao codigos longos tipados
    // (GTIN/EAN etc.), nunca tokens soltos como "3" ou "2".
    return /^\d{6,}$/.test(compact);
  });
}

function buildHuntIdentityQuery(cluster: ProductCluster): string {
  const identity = cluster.identity;

  // Identidade estrutural, em ordem de forÃ§a: marca, sku, modelo, ancoras
  // fortes, cÃ³digos de variante, e especificaÃ§Ãµes discriminantes (capacidade
  // e quantidade). Nada de tÃ­tulo inteiro nem palavra de classe estrangeira.
  const strongTerms = uniqueSearchTerms([
    identity.brand.value,
    identity.manufacturerSku.value,
    identity.model.value,
    ...(identity.identityAnchors ?? []),
    ...(identity.variantCodes.value ?? []),
    ...discriminativeIdentityNumbers(identity),
    identity.capacity.value,
    identity.quantity.value,
  ]);

  // CabeÃ§a nominal em portuguÃªs do item vendido (ex.: "aspirador", "vestido")
  // serve para desambiguar a classe sem poluir a identidade.
  const headToken = extractSoldItemNucleus(identity.soldItem.value ?? "").headToken;

  if (strongTerms.length > 0) {
    return uniqueSearchTerms([...strongTerms, headToken]).join(" ");
  }

  // Fallback estrutural: identidade fraca vira uma versÃ£o compactada do tÃ­tulo
  // (cabeÃ§a nominal + poucos termos discriminantes), nunca o tÃ­tulo integral.
  const compactTitle = uniqueSearchTerms([
    headToken,
    ...(identity.distinctiveTokens ?? []).slice(0, 4),
  ]);

  return compactTitle.join(" ");
}

function huntSeedStrength(cluster: ProductCluster): number {
  const identity = cluster.identity;
  const identitySignals = [
    identity.brand.value,
    identity.model.value,
    identity.manufacturerSku.value,
    ...(identity.variantCodes.value ?? []),
    ...identity.identityAnchors,
    ...identity.identityNumbers,
  ].filter(Boolean).length;
  const hasPurchasableMainMember = cluster.members.some((member) =>
    member.candidate.status === "RELEVANT" &&
    member.candidate.fingerprint.role.value === "MAIN" &&
    (member.candidate.normalized.raw.price ?? 0) > 0,
  );

  if (!hasPurchasableMainMember || identitySignals === 0) {
    return 0;
  }

  return identitySignals * 10 + cluster.members.length;
}

type HuntSeed = {
  cluster: ProductCluster;
  query: string;
  strength: number;
};

function selectStrongHuntSeeds(
  clusters: ProductCluster[],
  adapters: DiscoveryAdapter[],
  huntMs: number,
): HuntSeed[] {
  const adaptiveCount = Math.max(
    1,
    Math.min(MAX_HUNT_SEEDS, Math.ceil(huntMs / 900)),
  );

  const seeds = clusters
    .map((cluster) => {
      const present = new Set(
        cluster.members.map((member) => member.candidate.normalized.raw.marketplace),
      );
      const strength = huntSeedStrength(cluster);
      const query = buildHuntIdentityQuery(cluster);
      return { cluster, present, strength, query };
    })
    .filter(({ present, strength, query }) =>
      present.size < adapters.length && strength > 0 && Boolean(query),
    )
    .sort((left, right) => right.strength - left.strength)
    .slice(0, adaptiveCount)
    .map(({ cluster, query, strength }) => ({ cluster, query, strength }));

  traceV2("hunt-seeds", {
    availableClusters: clusters.length,
    selected: seeds.length,
    adaptiveCount,
    huntMs,
  });
  return seeds;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await run(items[index]!, index);
      }
    },
  );
  await Promise.all(workers);
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

function clusterStoreCount(cluster: ProductCluster): number {
  const codes = new Set(
    cluster.members.map((member) => member.candidate.normalized.raw.marketplace),
  );
  return codes.size;
}

async function huntMissingStoreOffers(
  clusters: ProductCluster[],
  knownKeys: Set<string>,
  limit: number,
  deadline: SearchDeadline,
  adapters: DiscoveryAdapter[] = listarDiscoveryAdaptersAtivos(),
  huntReserveMs = 0,
  persist = false,
  coverage?: HuntCoverage,
  attemptStats?: HuntAttemptStats,
  identityDiag?: HuntIdentityDiagnostic,
): Promise<ProductCluster[]> {
  const huntMs = Math.min(
    huntReserveMs,
    Math.max(
      0,
      deadline.remainingMs() -
        deadline.responseReserveMs -
        (persist ? deadline.budget.persistReserveMs : 0),
    ),
  );
  if (huntMs < MIN_HUNT_ATTEMPT_MS) {
    traceV2("phase-budget-stop", {
      phase: "HUNT",
      remainingMs: deadline.remainingMs(),
      reservedMs: huntReserveMs,
      reason: "HUNT_RESERVE_UNAVAILABLE",
    });
    return clusters;
  }

  const huntAbort = composeAbortSignal(huntMs, deadline.signal);
  let acceptingHuntResults = true;
  const nextClusters = clusters.map((cluster) => ({
    ...cluster,
    members: [...cluster.members],
  }));
  const seeds = selectStrongHuntSeeds(nextClusters, adapters, huntMs);
  if (identityDiag) {
    for (const seed of seeds) {
      const head = seed.cluster.members[0];
      identityDiag.seeds.push({
        seedId: seed.cluster.clusterId,
        seedMarketplace: head?.candidate.normalized.raw.marketplace ?? "",
        seedTitle: head?.candidate.normalized.raw.title ?? "",
        seedExternalId: head?.candidate.normalized.raw.externalId ?? "",
        fingerprintSummary: summarizeFingerprint(seed.cluster.identity),
        query: seed.query,
        identityQuery: seed.query,
      });
    }
  }
  const generated = seeds.flatMap((seed, seedIndex) => {
    const present = new Set(
      seed.cluster.members.map((member) => member.candidate.normalized.raw.marketplace),
    );
    const missing = adapters.filter(
      (adapter) => !present.has(adapter.marketplace),
    );
    // Rotaciona a ordem das lojas ausentes por seed: evita que o primeiro provider
    // (ex.: ML, lento) monopolize todos os primeiros slots da fila de attempts.
    const offset = seedIndex % Math.max(1, missing.length);
    const rotated = [...missing.slice(offset), ...missing.slice(0, offset)];
    return rotated.map((adapter) => ({ seed, adapter }));
  });

  // Dedupe redundant attempts (same seed query + same target marketplace).
  const seen = new Set<string>();
  const deduped: typeof generated = [];
  for (const attempt of generated) {
    const key = `${attempt.adapter.marketplace}\u0000${attempt.seed.query}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(attempt);
  }

  // Preserve seed diversity: interleave store-slots across seeds (strength DESC).
  const bySeed = seeds.map((seed) => ({
    seed,
    list: deduped.filter((attempt) => attempt.seed === seed),
  }));
  const maxSlots = bySeed.reduce((max, group) => Math.max(max, group.list.length), 0);
  const interleaved: typeof deduped = [];
  for (let slot = 0; slot < maxSlots; slot += 1) {
    for (const group of bySeed) {
      const attempt = group.list[slot];
      if (attempt) {
        interleaved.push(attempt);
      }
    }
  }

// OrÃ§amento/qualidade por attempt: sem divisÃ£o linear. Cada attempt recebe um
  // orÃ§amento Ãºtil (nÃ£o fragmentado); os attempts que sobrarem sÃ£o naturalmente
  // impedidos pelo timeout de fase (huntMs) e pelo guard de budget insuficiente.
  const scheduled = interleaved;

  if (scheduled.length === 0) {
    huntAbort.cleanup();
    return nextClusters;
  }

  if (coverage) {
    coverage.executed = true;
    coverage.remainingBudgetAtStart = deadline.remainingMs();
    coverage.seedCount = seeds.length;
    coverage.queriesGenerated = scheduled.length;
  }
  if (attemptStats) {
    attemptStats.huntReserveMs = huntReserveMs;
    attemptStats.huntRemainingAtStart = deadline.remainingMs();
    attemptStats.attemptCount = scheduled.length;
    attemptStats.attemptsGenerated = generated.length;
    attemptStats.attemptsDeduplicated = generated.length - deduped.length;
    attemptStats.attemptsEligible = scheduled.length;
    attemptStats.attemptsSkippedInsufficientBudget = 0;
    let skippedAlreadyRepresented = 0;
    for (const seed of seeds) {
      const present = new Set(
        seed.cluster.members.map(
          (member) => member.candidate.normalized.raw.marketplace,
        ),
      );
      skippedAlreadyRepresented += adapters.filter((adapter) =>
        present.has(adapter.marketplace),
      ).length;
    }
    attemptStats.attemptsSkippedAlreadyRepresentedStore = skippedAlreadyRepresented;
    attemptStats.computedPerAttemptMs =
      scheduled.length > 0 ? Math.floor(huntMs / scheduled.length) : 0;
    attemptStats.minAttemptMs = MIN_HUNT_ATTEMPT_MS;
    attemptStats.maxConcurrentAttempts = HUNT_CONCURRENCY;
    attemptStats.steps = scheduled.map(({ seed, adapter }, index) => ({
      index,
      seedId: seed.cluster.clusterId,
      marketplace: adapter.marketplace,
      query: seed.query,
      budgetMs: 0,
      started: false,
      elapsedMs: 0,
      status: "NOT_STARTED",
      rawReturned: 0,
      error: null,
    }));
  }

  const initialStoreCounts = new Map<string, number>();
  for (const cluster of nextClusters) {
    initialStoreCounts.set(cluster.clusterId, clusterStoreCount(cluster));
  }

  const huntStartedAt = Date.now();
  const huntEndAt = Date.now() + huntMs;

  try {
    const raced = await withTimeout(
      runWithConcurrency(scheduled, HUNT_CONCURRENCY, async ({ seed, adapter }, index) => {
        const step = attemptStats?.steps[index];
        if (
          !acceptingHuntResults ||
          deadline.expired() ||
          huntAbort.signal.aborted ||
          !adapter.searcher
        ) {
          if (step) {
            step.status = "NOT_STARTED";
          }
          return;
        }

        const remainingPhase = Math.floor(Math.max(0, huntEndAt - Date.now()));
        if (remainingPhase < MIN_HUNT_ATTEMPT_MS) {
          if (step) {
            step.status = "BUDGET_TOO_SMALL";
          }
          return;
        }
        const perAttemptMs = Math.min(USEFUL_HUNT_ATTEMPT_MS, remainingPhase);
        if (step) {
          step.budgetMs = perAttemptMs;
          step.started = true;
        }
        const attemptAbort = composeAbortSignal(
          perAttemptMs,
          huntAbort.signal,
          deadline.signal,
        );
        const huntCore = buildQueryCore(seed.query);
        const huntIntent = queryIntentFromCore(huntCore);

        traceV2("hunt", {
          huntQuery: seed.query,
          marketplace: adapter.marketplace,
          perAttemptMs,
          strength: seed.strength,
          remainingMs: deadline.remainingMs(),
        });

        const attemptStartedAt = Date.now();
        try {
          const outcome = await withTimeout(
            adapter.searcher({
              query: seed.query,
              normalizedQuery: seed.query,
              limit: Math.min(limit, 8),
              mode: "MULTILOJA",
              signal: attemptAbort.signal,
            }),
            perAttemptMs,
            attemptAbort.signal,
          );

          if (step) {
            step.elapsedMs = Date.now() - attemptStartedAt;
          }

          if (outcome.status === "timeout") {
            if (step) {
              step.status = "TIMEOUT";
              step.rawReturned = 0;
            }
            if (attemptStats) {
              attemptStats.attemptsTimedOut += 1;
              attemptStats.attemptsFinished += 1;
            }
            return;
          }

          const value = outcome.value;
          if (step) {
            step.rawReturned = value.candidates.length;
            step.error = value.error ?? null;
          }
          if (
            !acceptingHuntResults ||
            huntAbort.signal.aborted ||
            deadline.expired()
          ) {
            if (step) {
              step.status = "ABORTED";
            }
            if (attemptStats) {
              attemptStats.attemptsFinished += 1;
            }
            return;
          }

          if (step) {
            step.status = value.candidates.length === 0 ? "EMPTY" : "SUCCESS";
          }
          if (attemptStats) {
            attemptStats.attemptsFinished += 1;
            if (value.candidates.length === 0) {
              attemptStats.attemptsEmpty += 1;
            } else {
              attemptStats.attemptsWithCandidates += 1;
            }
          }

          for (const candidate of value.candidates) {
            if (!acceptingHuntResults || huntAbort.signal.aborted) {
              return;
            }
            if (coverage) {
              coverage.rawCandidatesFound += 1;
            }
            const key = candidateKey(candidate.marketplace, candidate.externalId);
            if (knownKeys.has(key)) {
              if (identityDiag) {
                identityDiag.knownKeyDropped += 1;
              }
              continue;
            }

            const raw = toRawCandidate(candidate);
            if (!raw || raw.price == null || raw.price <= 0) {
              if (identityDiag) {
                identityDiag.priceDropped += 1;
              }
              continue;
            }

            const scored = scoreQueryRelevance(
              huntIntent,
              normalizeCandidate(raw),
              huntCore,
              { huntPrefilter: true },
            );
            if (identityDiag) {
              identityDiag.candidatesBeforeRelevance += 1;
            }
            if (scored.status !== "RELEVANT") {
              if (identityDiag) {
                identityDiag.relevanceRejections += 1;
                if (identityDiag.relevanceSamples.length < 10) {
                  identityDiag.relevanceSamples.push({
                    marketplace: scored.normalized.raw.marketplace,
                    title: scored.normalized.raw.title,
                    externalId: scored.normalized.raw.externalId,
                    reason: scored.reason,
                  });
                }
              }
              continue;
            }
            if (identityDiag) {
              identityDiag.candidatesAfterRelevance += 1;
            }
            const versusCluster = compareFingerprints(
              scored.fingerprint,
              seed.cluster.identity,
            );
            if (identityDiag) {
              identityDiag.candidatesSentToIdentity += 1;
            }
            if (versusCluster.relation !== "SAME") {
              if (identityDiag) {
                identityDiag.totalIdentityRejections += 1;
                const head = seed.cluster.members[0];
                const sample = {
                  seedMarketplace: head?.candidate.normalized.raw.marketplace ?? "",
                  seedTitle: head?.candidate.normalized.raw.title ?? "",
                  seedExternalId: head?.candidate.normalized.raw.externalId ?? "",
                  huntMarketplace: scored.normalized.raw.marketplace,
                  huntTitle: scored.normalized.raw.title,
                  huntExternalId: scored.normalized.raw.externalId,
                  huntQuery: seed.query,
                  relation: versusCluster.relation,
                  reason:
                    versusCluster.hardConflicts.length > 0
                      ? versusCluster.hardConflicts.join(",")
                      : versusCluster.positiveEvidence.length > 0
                        ? `weak:${versusCluster.positiveEvidence.join(",")}`
                        : "no evidence",
                  fingerprintDiff: diffFingerprints(
                    seed.cluster.identity,
                    scored.fingerprint,
                  ),
                };
                if (identityDiag.samples.length < 10) {
                  identityDiag.samples.push(sample);
                } else if (sample.relation === "UNKNOWN") {
                  const idx = identityDiag.samples.findIndex(
                    (item) => item.relation === "DIFFERENT",
                  );
                  if (idx >= 0) {
                    identityDiag.samples[idx] = sample;
                  }
                }
              }
              continue;
            }

            const memberConflict = seed.cluster.members.some(
              (member) =>
                compareFingerprints(
                  scored.fingerprint,
                  member.candidate.fingerprint,
                ).relation === "DIFFERENT",
            );
            if (memberConflict) {
              continue;
            }

            seed.cluster.members.push({ candidate: scored });
            seed.cluster.identity = mergeFingerprints(
              seed.cluster.identity,
              scored.fingerprint,
            );
            knownKeys.add(key);
            if (coverage) {
              coverage.acceptedIntoClusters += 1;
            }
            if (identityDiag) {
              identityDiag.acceptedCount += 1;
            }
          }
        } catch (error) {
          if (step) {
            step.elapsedMs = Date.now() - attemptStartedAt;
            step.rawReturned = 0;
            if (isAbortError(error) || attemptAbort.signal.aborted) {
              step.status = "ABORTED";
            } else {
              step.status = "ERROR";
              step.error = error instanceof Error ? error.message : String(error);
            }
          }
          if (attemptStats) {
            attemptStats.attemptsFinished += 1;
          }
        } finally {
          attemptAbort.abort();
          attemptAbort.cleanup();
          if (attemptStats) {
            attemptStats.attemptsStarted += 1;
          }
        }
      }),
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

  // Fase de proteÃ§Ã£o: garante que o hunt retorna dentro do deadline
  // mesmo se workers continuarem rodando. O withTimeout deve ter retornado
  // dentro de huntMs, mas adicionamos um timeout de proteÃ§Ã£o como seguro.
  if (huntReserveMs > 0) {
    const huntPhaseDeadline = Date.now() + huntMs + 200;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, huntMs + 500);
      // Se o withTimeout ja resolveu timeout, o intervalo curta antes
      const check = setInterval(() => {
        // Se o pipeline ja foi limpo, resolver
        if (!acceptingHuntResults) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
        // Se ja passou o tempo limite total, resolver de qualquer jeito
        if (Date.now() >= huntPhaseDeadline) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 100);
    });
  }

  if (coverage) {
    coverage.elapsedMs = Date.now() - huntStartedAt;
  }

  if (attemptStats) {
    let promoted2 = 0;
    let promoted3 = 0;
    for (const cluster of nextClusters) {
      const count = clusterStoreCount(cluster);
      const before = initialStoreCounts.get(cluster.clusterId) ?? count;
      if (before < 2 && count >= 2) {
        promoted2 += 1;
      }
      if (before < 3 && count >= 3) {
        promoted3 += 1;
      }
    }
    attemptStats.clustersPromotedTo2Stores = promoted2;
    attemptStats.clustersPromotedTo3Stores = promoted3;
    attemptStats.attemptsExecuted = attemptStats.attemptsStarted;
    attemptStats.attemptsSkippedInsufficientBudget = attemptStats.steps.filter(
      (page) => page.status === "NOT_STARTED" || page.status === "BUDGET_TOO_SMALL",
    ).length;

    const budgets = attemptStats.steps
      .filter((page) => page.started)
      .map((page) => page.budgetMs);
    attemptStats.attemptBudgetMin = budgets.length > 0 ? Math.min(...budgets) : 0;
    attemptStats.attemptBudgetMax = budgets.length > 0 ? Math.max(...budgets) : 0;
    attemptStats.attemptBudgetAvg =
      budgets.length > 0
        ? Math.round(budgets.reduce((sum, value) => sum + value, 0) / budgets.length)
        : 0;
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
  protectedPostAcquisitionMs: number,
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
    Math.max(
      0,
      globalDeadline.acquisitionUntilMs(persist) - protectedPostAcquisitionMs,
    ),
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
          adapter.marketplace === "ALIEXPRESS" &&
          isAliExpressPermanentConfigurationError(result.error)
        ) {
          outcomes.push("ERROR");
          traceV2("aliexpress-variant-short-circuit", {
            variantIndex: index + 1,
            reason: "PERMANENT_CONFIGURATION_ERROR",
            error: result.error,
          });
          break;
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
  protectedPostAcquisitionMs = 0,
): Promise<MarketplaceAcquisition[]> {
  const identity = prepared?.identity ?? extractSanitizedIdentity(query);
  const queryCore = prepared?.core ?? identity.queryCore;
  const plan = prepared?.plan ?? buildSearchPlan(query, queryCore, identity);
  const intent = prepared?.intent ?? queryIntentFromCore(queryCore);
  const scheduledAt = Date.now();
  const acquisitionEndAt =
    deadline.deadlineAt -
    deadline.responseReserveMs -
    (persist ? deadline.budget.persistReserveMs : 0) -
    protectedPostAcquisitionMs;
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
      protectedPostAcquisitionMs,
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
      protectedPostAcquisitionMs,
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
  const clusteringReserveMs = resolveClusteringReserveMs(budget);
  const huntReserveMs = options.hunt === true
    ? resolveHuntReserveMs(budget, deadline.responseReserveMs)
    : 0;
  const relevanceReserveMs = options.hunt === true
    ? resolveRelevanceReserveMs(
        budget,
        deadline,
        huntReserveMs,
        clusteringReserveMs,
        persistEnabled,
      )
    : 0;
  const preHuntReserveMs =
    deadline.responseReserveMs +
    (persistEnabled ? budget.persistReserveMs : 0) +
    huntReserveMs +
    clusteringReserveMs;
  const normalizationStopMs = preHuntReserveMs + relevanceReserveMs;
  const postAcquisitionReserveMs =
    huntReserveMs +
    clusteringReserveMs +
    relevanceReserveMs +
    PHASE_HANDOFF_RESERVE_MS;
  const identity = extractSanitizedIdentity(rawQuery);
  const queryMode = classifyQueryMode(identity);
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
    queryMode,
    budgetMs: budget.globalMs,
    deadlineAt: deadline.deadlineAt,
    marketplaceBudgetMs: budget.marketplaceMs,
    huntReserveMs,
    relevanceReserveMs,
    responseReserveMs: deadline.responseReserveMs,
  });
  if (options.hunt === true) {
    traceV2("hunt-reserve", {
      globalMs: budget.globalMs,
      huntReserveMs,
      relevanceReserveMs,
      clusteringReserveMs,
      responseReserveMs: deadline.responseReserveMs,
      handoffReserveMs: PHASE_HANDOFF_RESERVE_MS,
      acquisitionStopRemainingMs: normalizationStopMs,
    });
  }

  const coverage = createCoverageStats();
  const attemptStats = createHuntAttemptStats();
  const identityDiag = createHuntIdentityDiagnostic();
  const markExpiredAtStage = (stage: string) => {
    if (coverage.deadline.expiredAtStage === null && deadline.expired()) {
      coverage.deadline.expiredAtStage = stage;
      coverage.deadline.expired = true;
    }
  };

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
      postAcquisitionReserveMs,
    );
    const acquisitionsSnapshot = snapshotAcquisitions(acquisitions);
    traceV2Phase("ACQUISITION", "end", acquisitionStarted, deadline, {
      marketplaces: acquisitionsSnapshot.length,
    });

    for (const acquisition of acquisitionsSnapshot) {
      const storeKey = MARKETPLACE_TO_COVERAGE_KEY[acquisition.marketplace];
      if (!storeKey) {
        continue;
      }
      coverage.stores[storeKey] = {
        status: acquisition.status,
        scanned: acquisition.raw,
        accepted: acquisition.usable,
        elapsedMs: acquisition.elapsedMs,
        error: acquisition.error,
      };
    }
    markExpiredAtStage("ACQUISITION");

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
    const processedAcquiredKeys = new Set<string>();
    let prefilterDropped = 0;
    for (const raw of rawCandidates) {
      if (!hasPhaseBudget(deadline, normalizationStopMs)) {
        traceV2("phase-budget-stop", {
          phase: "NORMALIZATION",
          remainingMs: deadline.remainingMs(),
          reservedMs: normalizationStopMs,
        });
        break;
      }
      const key = candidateKey(raw.marketplace, raw.externalId);
      if (hasStrongProductConceptConflict(queryCore, raw.title)) {
        processedAcquiredKeys.add(key);
        prefilterDropped += 1;
        traceV2("concept-prefilter", {
          marketplace: raw.marketplace,
          externalId: raw.externalId,
          title: raw.title,
          queryClass: queryCore.productClass,
          reason: "STRONG_CONCEPT_CONFLICT",
        });
        continue;
      }
      const candidate = normalizeCandidate(raw);
      const conflict = detectDistinctiveConflict(identity, candidate.raw.title);
      if (conflict.conflict) {
        processedAcquiredKeys.add(key);
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
      processedAcquiredKeys.add(key);
    }
    traceV2Phase("NORMALIZATION", "end", normalizationStarted, deadline, {
      rawCandidates: rawCandidates.length,
      processed: normalized.length,
      skipped: normalized.length < rawCandidates.length,
      prefilterDropped,
    });
    coverage.rawCandidates = rawCandidates.length;
    coverage.uniqueCandidates = new Set(
      rawCandidates.map((item) => candidateKey(item.marketplace, item.externalId)),
    ).size;
    coverage.normalizedCandidates = normalized.length;
    markExpiredAtStage("NORMALIZATION");

    const relevanceStarted = Date.now();
    traceV2Phase("RELEVANCE", "start", relevanceStarted, deadline);
    const scored: ScoredCandidate[] = [];
    const relevanceStopMs = preHuntReserveMs;
    for (const item of normalized) {
      if (!hasPhaseBudget(deadline, relevanceStopMs)) {
        traceV2("phase-budget-stop", {
          phase: "RELEVANCE",
          remainingMs: deadline.remainingMs(),
          reservedMs: relevanceStopMs,
        });
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
    coverage.relevantCandidates = relevant.length;
    markExpiredAtStage("RELEVANCE");

    const clusteringStarted = Date.now();
    traceV2Phase("CLUSTERING", "start", clusteringStarted, deadline);
    let clusters: ProductCluster[] = [];
    let processedProducts: CanonicalProduct[] = [];
    const clusteringStopMs =
      deadline.responseReserveMs +
      (persistEnabled ? budget.persistReserveMs : 0) +
      huntReserveMs;
    if (hasPhaseBudget(deadline, clusteringStopMs)) {
      clusters = clusterCandidates(relevant, {
        shouldContinue: () => hasPhaseBudget(deadline, clusteringStopMs),
      });
      const canonicalProducts: CanonicalProduct[] = [];
      for (const cluster of clusters) {
        if (!hasPhaseBudget(deadline, clusteringStopMs)) {
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
    coverage.preHunt = distributionOfClusters(clusters);
    markExpiredAtStage("CLUSTERING");

    const responseStarted = Date.now();
    traceV2Phase("RESPONSE", "start", responseStarted, deadline);

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

    const knownKeys = new Set(processedAcquiredKeys);
    const shouldHunt =
      options.hunt === true &&
      !deadline.expired() &&
      deadline.remainingMs() > deadline.responseReserveMs &&
      clusters.length > 0;
    const huntedClusters = shouldHunt
      ? await huntMissingStoreOffers(
          clusters,
          knownKeys,
          limit,
          deadline,
          options.adapters ?? listarDiscoveryAdaptersAtivos(),
          huntReserveMs,
          persistEnabled,
          coverage.hunt,
          attemptStats,
          identityDiag,
        )
      : clusters;
    markExpiredAtStage("HUNT");
    if (!deadline.expired() && deadline.remainingMs() > deadline.responseReserveMs) {
      await applyAffiliateLayer(
        huntedClusters,
        deadline,
        options.affiliateResolver,
      );
    }
    markExpiredAtStage("AFFILIATE");
    coverage.postHunt = distributionOfClusters(huntedClusters);
    const coverageStatus = coverageStatusOf(acquisitionsSnapshot);
    const responseCanonicalProducts: CanonicalProduct[] = [];
    if (canRunPostprocess(deadline)) {
      for (const cluster of huntedClusters) {
        if (!canRunPostprocess(deadline)) {
          break;
        }
        const canonical = canonicalizeCluster(cluster);
        if (canonical) {
          responseCanonicalProducts.push(canonical);
        }
      }
    }
    const rankedResponseProducts = canRunPostprocess(deadline)
      ? rankCanonicalProducts(responseCanonicalProducts)
      : processedProducts;
    const products = rankedResponseProducts.map((product) => {
      const withCoverage = { ...product, coverageStatus };
      return {
        ...withCoverage,
        searchVisible:
          withCoverage.marketplaces.length >= 2 && isSearchVisible(withCoverage),
        publishable: isClusterPublishable(withCoverage),
      };
    });
    const selectedProducts = products
      .filter((product) => product.searchVisible)
      .slice(0, limit);
    coverage.public.productsBuilt = products.length;
    coverage.public.eligible2PlusStores = products.filter(
      (product) => product.marketplaces.length >= 2,
    ).length;
    coverage.public.returned = selectedProducts.length;
    coverage.public.rejectedSingleStore = products.filter(
      (product) => product.marketplaces.length === 1,
    ).length;
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
    markExpiredAtStage("RESPONSE");
    coverage.deadline.expired = deadline.expired();
    coverage.deadline.elapsedMs = elapsedV2Ms(deadline);
    coverage.deadline.remainingBudgetMs = deadline.remainingMs();
    emitCoverageSummary(search, coverage);
    emitHuntAttemptSummary(attemptStats);
    emitHuntIdentityDiagnostic(identityDiag);
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
