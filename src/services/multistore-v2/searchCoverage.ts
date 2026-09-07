import type { ProductCluster, ProductFingerprint } from "./types";

export const SEARCH_COVERAGE_STORES = [
  "mercadolivre",
  "amazon",
  "shopee",
  "aliexpress",
  "magalu",
] as const;

export type CoverageStoreKey = (typeof SEARCH_COVERAGE_STORES)[number];

export const MARKETPLACE_TO_COVERAGE_KEY: Record<string, CoverageStoreKey> = {
  MERCADO_LIVRE: "mercadolivre",
  AMAZON: "amazon",
  SHOPEE: "shopee",
  ALIEXPRESS: "aliexpress",
  MAGAZINE_LUIZA: "magalu",
};

export type StoreCoverageStat = {
  status: string;
  scanned: number;
  accepted: number;
  elapsedMs: number;
  error: string | null;
};

export type ClusterDistribution = {
  total: number;
  singleStore: number;
  twoStores: number;
  threePlusStores: number;
};

export type HuntCoverage = {
  executed: boolean;
  remainingBudgetAtStart: number;
  seedCount: number;
  queriesGenerated: number;
  rawCandidatesFound: number;
  acceptedIntoClusters: number;
  elapsedMs: number;
};

export type HuntAttemptStatus =
  | "SUCCESS"
  | "EMPTY"
  | "TIMEOUT"
  | "ABORTED"
  | "ERROR"
  | "NOT_STARTED"
  | "BUDGET_TOO_SMALL";

export type HuntAttemptRecord = {
  index: number;
  seedId: string;
  marketplace: string;
  query: string;
  budgetMs: number;
  started: boolean;
  elapsedMs: number;
  status: HuntAttemptStatus;
  rawReturned: number;
  error: string | null;
};

export type HuntAttemptStats = {
  huntReserveMs: number;
  huntRemainingAtStart: number;
  attemptCount: number;
  computedPerAttemptMs: number;
  minAttemptMs: number;
  maxConcurrentAttempts: number;
  attemptsGenerated: number;
  attemptsDeduplicated: number;
  attemptsEligible: number;
  attemptsExecuted: number;
  attemptsSkippedInsufficientBudget: number;
  attemptsSkippedAlreadyRepresentedStore: number;
  attemptsStarted: number;
  attemptsFinished: number;
  attemptsTimedOut: number;
  attemptsEmpty: number;
  attemptsWithCandidates: number;
  attemptBudgetMin: number;
  attemptBudgetAvg: number;
  attemptBudgetMax: number;
  clustersPromotedTo2Stores: number;
  clustersPromotedTo3Stores: number;
  steps: HuntAttemptRecord[];
};

export function createHuntAttemptStats(): HuntAttemptStats {
  return {
    huntReserveMs: 0,
    huntRemainingAtStart: 0,
    attemptCount: 0,
    computedPerAttemptMs: 0,
    minAttemptMs: 0,
    maxConcurrentAttempts: 0,
    attemptsGenerated: 0,
    attemptsDeduplicated: 0,
    attemptsEligible: 0,
    attemptsExecuted: 0,
    attemptsSkippedInsufficientBudget: 0,
    attemptsSkippedAlreadyRepresentedStore: 0,
    attemptsStarted: 0,
    attemptsFinished: 0,
    attemptsTimedOut: 0,
    attemptsEmpty: 0,
    attemptsWithCandidates: 0,
    attemptBudgetMin: 0,
    attemptBudgetAvg: 0,
    attemptBudgetMax: 0,
    clustersPromotedTo2Stores: 0,
    clustersPromotedTo3Stores: 0,
    steps: [],
  };
}

export type HuntSeedInfo = {
  seedId: string;
  seedMarketplace: string;
  seedTitle: string;
  seedExternalId: string;
  fingerprintSummary: string;
  query: string;
  identityQuery: string;
};

export type HuntRejectionSample = {
  seedMarketplace: string;
  seedTitle: string;
  seedExternalId: string;
  huntMarketplace: string;
  huntTitle: string;
  huntExternalId: string;
  huntQuery: string;
  relation: string;
  reason: string;
  fingerprintDiff: string;
};

export type HuntRelevanceSample = {
  marketplace: string;
  title: string;
  externalId: string;
  reason: string;
};

export type HuntIdentityDiagnostic = {
  seeds: HuntSeedInfo[];
  samples: HuntRejectionSample[];
  relevanceSamples: HuntRelevanceSample[];
  totalIdentityRejections: number;
  relevanceRejections: number;
  priceDropped: number;
  knownKeyDropped: number;
  acceptedCount: number;
  candidatesBeforeRelevance: number;
  candidatesAfterRelevance: number;
  candidatesSentToIdentity: number;
};

export function createHuntIdentityDiagnostic(): HuntIdentityDiagnostic {
  return {
    seeds: [],
    samples: [],
    relevanceSamples: [],
    totalIdentityRejections: 0,
    relevanceRejections: 0,
    priceDropped: 0,
    knownKeyDropped: 0,
    acceptedCount: 0,
    candidatesBeforeRelevance: 0,
    candidatesAfterRelevance: 0,
    candidatesSentToIdentity: 0,
  };
}

function fpValue(value: string | null | undefined): string {
  return value == null || value === "" ? "" : value;
}

export function summarizeFingerprint(fp: ProductFingerprint): string {
  const parts: string[] = [];
  const add = (key: string, value: string | null | undefined) => {
    const text = fpValue(value);
    if (text) {
      parts.push(`${key}=${text}`);
    }
  };
  add("brand", fp.brand.value);
  add("model", fp.model.value);
  add("productClass", fp.productClass.value);
  add("role", fp.role.value);
  add("soldItem", fp.soldItem.value);
  add("hostItem", fp.hostItem.value);
  add("capacity", fp.capacity.value);
  add("quantity", fp.quantity.value);
  add("size", fp.size.value);
  add("sku", fp.manufacturerSku.value);
  if (fp.identityNumbers.length > 0) {
    parts.push(`idNumbers=${fp.identityNumbers.join("/")}`);
  }
  if (fp.identityAnchors.length > 0) {
    parts.push(`anchors=${fp.identityAnchors.join("/")}`);
  }
  if (fp.distinctiveTokens.length > 0) {
    parts.push(`distinctive=${fp.distinctiveTokens.slice(0, 5).join("/")}`);
  }
  return parts.join(" ");
}

const DIFF_FIELDS: Array<{
  key: string;
  get: (fp: ProductFingerprint) => string;
}> = [
  { key: "brand", get: (fp) => fpValue(fp.brand.value) },
  { key: "model", get: (fp) => fpValue(fp.model.value) },
  { key: "productClass", get: (fp) => fpValue(fp.productClass.value) },
  { key: "role", get: (fp) => fpValue(fp.role.value) },
  { key: "soldItem", get: (fp) => fpValue(fp.soldItem.value) },
  { key: "capacity", get: (fp) => fpValue(fp.capacity.value) },
  { key: "quantity", get: (fp) => fpValue(fp.quantity.value) },
  { key: "sku", get: (fp) => fpValue(fp.manufacturerSku.value) },
];

export function diffFingerprints(
  seed: ProductFingerprint,
  candidate: ProductFingerprint,
): string {
  const diffs = DIFF_FIELDS
    .filter((field) => field.get(seed) !== field.get(candidate))
    .map((field) => `${field.key}(${field.get(seed) || "-"} vs ${field.get(candidate) || "-"})`);
  if (diffs.length === 0) {
    return "(sem diferença nos campos extraídos)";
  }
  return diffs.join(" | ");
}

export type PublicCoverage = {
  productsBuilt: number;
  eligible2PlusStores: number;
  returned: number;
  rejectedSingleStore: number;
};

export type DeadlineCoverage = {
  expired: boolean;
  expiredAtStage: string | null;
  elapsedMs: number;
  remainingBudgetMs: number;
};

export type SearchCoverageStats = {
  stores: Record<CoverageStoreKey, StoreCoverageStat>;
  rawCandidates: number;
  uniqueCandidates: number;
  normalizedCandidates: number;
  relevantCandidates: number;
  preHunt: ClusterDistribution;
  hunt: HuntCoverage;
  postHunt: ClusterDistribution;
  public: PublicCoverage;
  deadline: DeadlineCoverage;
};

export function isCoverageDebugEnabled(): boolean {
  return process.env.SEARCH_COVERAGE_DEBUG === "1";
}

function emptyStoreStat(): StoreCoverageStat {
  return {
    status: "NOT_RUN",
    scanned: 0,
    accepted: 0,
    elapsedMs: 0,
    error: null,
  };
}

export function createCoverageStats(): SearchCoverageStats {
  const stores = {} as Record<CoverageStoreKey, StoreCoverageStat>;
  for (const store of SEARCH_COVERAGE_STORES) {
    stores[store] = emptyStoreStat();
  }

  return {
    stores,
    rawCandidates: 0,
    uniqueCandidates: 0,
    normalizedCandidates: 0,
    relevantCandidates: 0,
    preHunt: { total: 0, singleStore: 0, twoStores: 0, threePlusStores: 0 },
    hunt: {
      executed: false,
      remainingBudgetAtStart: 0,
      seedCount: 0,
      queriesGenerated: 0,
      rawCandidatesFound: 0,
      acceptedIntoClusters: 0,
      elapsedMs: 0,
    },
    postHunt: { total: 0, singleStore: 0, twoStores: 0, threePlusStores: 0 },
    public: {
      productsBuilt: 0,
      eligible2PlusStores: 0,
      returned: 0,
      rejectedSingleStore: 0,
    },
    deadline: {
      expired: false,
      expiredAtStage: null,
      elapsedMs: 0,
      remainingBudgetMs: 0,
    },
  };
}

function countDistinctStores(cluster: ProductCluster): number {
  const codes = new Set(
    cluster.members.map((member) => member.candidate.normalized.raw.marketplace),
  );
  return codes.size;
}

export function distributionOfClusters(clusters: ProductCluster[]): ClusterDistribution {
  const distribution: ClusterDistribution = {
    total: clusters.length,
    singleStore: 0,
    twoStores: 0,
    threePlusStores: 0,
  };

  for (const cluster of clusters) {
    const stores = countDistinctStores(cluster);
    if (stores === 1) {
      distribution.singleStore += 1;
    } else if (stores === 2) {
      distribution.twoStores += 1;
    } else if (stores >= 3) {
      distribution.threePlusStores += 1;
    }
  }

  return distribution;
}

function fmt(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function emitStore(label: CoverageStoreKey, stat: StoreCoverageStat): string[] {
  return [
    `${label}.status=${fmt(stat.status)}`,
    `${label}.scanned=${fmt(stat.scanned)}`,
    `${label}.accepted=${fmt(stat.accepted)}`,
    `${label}.elapsedMs=${fmt(stat.elapsedMs)}`,
    `${label}.error=${fmt(stat.error)}`,
  ];
}

function emitDistribution(dist: ClusterDistribution): string[] {
  return [
    `total=${fmt(dist.total)}`,
    `singleStore=${fmt(dist.singleStore)}`,
    `twoStores=${fmt(dist.twoStores)}`,
    `threePlusStores=${fmt(dist.threePlusStores)}`,
  ];
}

export function emitCoverageSummary(query: string, stats: SearchCoverageStats): void {
  if (!isCoverageDebugEnabled()) {
    return;
  }

  const lines: string[] = [];

  lines.push("[SEARCH-COVERAGE]");
  lines.push(`query="${query}"`);
  lines.push("");
  lines.push("TOTAL:");
  lines.push(`elapsedMs=${fmt(stats.deadline.elapsedMs)}`);
  lines.push(`remainingBudgetMs=${fmt(stats.deadline.remainingBudgetMs)}`);
  lines.push(`deadlineExpired=${fmt(stats.deadline.expired)}`);
  lines.push("");
  lines.push("DISCOVERY:");
  lines.push("");
  for (const store of SEARCH_COVERAGE_STORES) {
    lines.push(...emitStore(store, stats.stores[store]));
    lines.push("");
  }
  lines.push("CANDIDATES:");
  lines.push("");
  lines.push(`raw=${fmt(stats.rawCandidates)}`);
  lines.push(`unique=${fmt(stats.uniqueCandidates)}`);
  lines.push(`normalized=${fmt(stats.normalizedCandidates)}`);
  lines.push(`relevant=${fmt(stats.relevantCandidates)}`);
  lines.push("");
  lines.push("CLUSTER_PRE_HUNT:");
  lines.push("");
  lines.push(...emitDistribution(stats.preHunt));
  lines.push("");
  lines.push("HUNT:");
  lines.push("");
  lines.push(`executed=${fmt(stats.hunt.executed)}`);
  lines.push(`remainingBudgetAtStart=${fmt(stats.hunt.remainingBudgetAtStart)}`);
  lines.push(`seedCount=${fmt(stats.hunt.seedCount)}`);
  lines.push(`queriesGenerated=${fmt(stats.hunt.queriesGenerated)}`);
  lines.push(`rawCandidatesFound=${fmt(stats.hunt.rawCandidatesFound)}`);
  lines.push(`acceptedIntoClusters=${fmt(stats.hunt.acceptedIntoClusters)}`);
  lines.push(`elapsedMs=${fmt(stats.hunt.elapsedMs)}`);
  lines.push("");
  lines.push("CLUSTER_POST_HUNT:");
  lines.push("");
  lines.push(...emitDistribution(stats.postHunt));
  lines.push("");
  lines.push("PUBLIC:");
  lines.push("");
  lines.push(`productsBuilt=${fmt(stats.public.productsBuilt)}`);
  lines.push(`eligible2PlusStores=${fmt(stats.public.eligible2PlusStores)}`);
  lines.push(`returned=${fmt(stats.public.returned)}`);
  lines.push(`rejectedSingleStore=${fmt(stats.public.rejectedSingleStore)}`);
  lines.push("");
  lines.push("DEADLINE:");
  lines.push("");
  lines.push(`expired=${fmt(stats.deadline.expired)}`);
  lines.push(`expiredAtStage=${fmt(stats.deadline.expiredAtStage)}`);
  lines.push(`elapsedMs=${fmt(stats.deadline.elapsedMs)}`);

  console.info(lines.join("\n"));
}

export function emitHuntAttemptSummary(stats: HuntAttemptStats): void {
  if (!isCoverageDebugEnabled()) {
    return;
  }

  const lines: string[] = [];

  lines.push("[HUNT-ATTEMPTS]");
  lines.push(`huntReserveMs=${fmt(stats.huntReserveMs)}`);
  lines.push(`huntRemainingAtStart=${fmt(stats.huntRemainingAtStart)}`);
  lines.push(`attemptCount=${fmt(stats.attemptCount)}`);
  lines.push(`computedPerAttemptMs=${fmt(stats.computedPerAttemptMs)}`);
  lines.push(`minAttemptMs=${fmt(stats.minAttemptMs)}`);
  lines.push(`maxConcurrentAttempts=${fmt(stats.maxConcurrentAttempts)}`);
  lines.push(`attemptsGenerated=${fmt(stats.attemptsGenerated)}`);
  lines.push(`attemptsDeduplicated=${fmt(stats.attemptsDeduplicated)}`);
  lines.push(`attemptsEligible=${fmt(stats.attemptsEligible)}`);
  lines.push(`attemptsExecuted=${fmt(stats.attemptsExecuted)}`);
  lines.push(`attemptsSkippedInsufficientBudget=${fmt(stats.attemptsSkippedInsufficientBudget)}`);
  lines.push(`attemptsSkippedAlreadyRepresentedStore=${fmt(stats.attemptsSkippedAlreadyRepresentedStore)}`);
  lines.push(`attemptBudgetMin=${fmt(stats.attemptBudgetMin)}`);
  lines.push(`attemptBudgetAvg=${fmt(stats.attemptBudgetAvg)}`);
  lines.push(`attemptBudgetMax=${fmt(stats.attemptBudgetMax)}`);
  lines.push(`clustersPromotedTo2Stores=${fmt(stats.clustersPromotedTo2Stores)}`);
  lines.push(`clustersPromotedTo3Stores=${fmt(stats.clustersPromotedTo3Stores)}`);
  lines.push(`attemptsStarted=${fmt(stats.attemptsStarted)}`);
  lines.push(`attemptsFinished=${fmt(stats.attemptsFinished)}`);
  lines.push(`attemptsTimedOut=${fmt(stats.attemptsTimedOut)}`);
  lines.push(`attemptsEmpty=${fmt(stats.attemptsEmpty)}`);
  lines.push(`attemptsWithCandidates=${fmt(stats.attemptsWithCandidates)}`);
  lines.push("");

  for (const step of stats.steps) {
    lines.push(`attempt.${step.index}.seedId=${fmt(step.seedId)}`);
    lines.push(`attempt.${step.index}.marketplace=${fmt(step.marketplace)}`);
    lines.push(`attempt.${step.index}.query="${step.query.replace(/"/g, '\\"')}"`);
    lines.push(`attempt.${step.index}.budgetMs=${fmt(step.budgetMs)}`);
    lines.push(`attempt.${step.index}.started=${fmt(step.started)}`);
    lines.push(`attempt.${step.index}.elapsedMs=${fmt(step.elapsedMs)}`);
    lines.push(`attempt.${step.index}.status=${fmt(step.status)}`);
    lines.push(`attempt.${step.index}.rawReturned=${fmt(step.rawReturned)}`);
    lines.push(`attempt.${step.index}.error=${fmt(step.error)}`);
    lines.push("");
  }

  console.info(lines.join("\n"));
}

export function emitHuntIdentityDiagnostic(diag: HuntIdentityDiagnostic): void {
  if (!isCoverageDebugEnabled()) {
    return;
  }

  const lines: string[] = [];

  lines.push("[HUNT-IDENTITY]");
  lines.push(`totalIdentityRejections=${fmt(diag.totalIdentityRejections)}`);
  lines.push(`relevanceRejections=${fmt(diag.relevanceRejections)}`);
  lines.push(`priceDropped=${fmt(diag.priceDropped)}`);
  lines.push(`knownKeyDropped=${fmt(diag.knownKeyDropped)}`);
  lines.push(`acceptedCount=${fmt(diag.acceptedCount)}`);
  lines.push(`candidatesBeforeRelevance=${fmt(diag.candidatesBeforeRelevance)}`);
  lines.push(`candidatesRejectedByRelevance=${fmt(diag.relevanceRejections)}`);
  lines.push(`candidatesAfterRelevance=${fmt(diag.candidatesAfterRelevance)}`);
  lines.push(`candidatesSentToIdentity=${fmt(diag.candidatesSentToIdentity)}`);
  lines.push(`samples=${fmt(diag.samples.length)}`);
  lines.push("");
  lines.push("SEEDS:");
  for (const seed of diag.seeds) {
    lines.push(`seed.id=${fmt(seed.seedId)}`);
    lines.push(`seed.marketplace=${fmt(seed.seedMarketplace)}`);
    lines.push(`seed.title=${fmt(seed.seedTitle)}`);
    lines.push(`seed.externalId=${fmt(seed.seedExternalId)}`);
    lines.push(`seed.fingerprint=${fmt(seed.fingerprintSummary)}`);
    lines.push(`seed.huntQuery="${seed.query.replace(/"/g, '\\"')}"`);
    lines.push(`seed.identityQuery="${seed.identityQuery.replace(/"/g, '\\"')}"`);
    lines.push("");
  }
  lines.push("REJECTIONS:");
  for (const sample of diag.samples) {
    lines.push(`rej.seed.title=${fmt(sample.seedTitle)}`);
    lines.push(`rej.seed.marketplace=${fmt(sample.seedMarketplace)}`);
    lines.push(`rej.candidate.title=${fmt(sample.huntTitle)}`);
    lines.push(`rej.candidate.marketplace=${fmt(sample.huntMarketplace)}`);
    lines.push(`rej.candidate.externalId=${fmt(sample.huntExternalId)}`);
    lines.push(`rej.huntQuery="${sample.huntQuery.replace(/"/g, '\\"')}"`);
    lines.push(`rej.relation=${fmt(sample.relation)}`);
    lines.push(`rej.reason=${fmt(sample.reason)}`);
    lines.push(`rej.fingerprintDiff=${fmt(sample.fingerprintDiff)}`);
    lines.push("");
  }
  lines.push("RELEVANCE_REJECTIONS:");
  for (const sample of diag.relevanceSamples) {
    lines.push(`rel.marketplace=${fmt(sample.marketplace)}`);
    lines.push(`rel.title=${fmt(sample.title)}`);
    lines.push(`rel.externalId=${fmt(sample.externalId)}`);
    lines.push(`rel.reason=${fmt(sample.reason)}`);
    lines.push("");
  }

  console.info(lines.join("\n"));
}