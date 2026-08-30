import { pontuarCoberturaLexicalPonderada } from "@/services/identity";

import type { MarketplaceFilterEvent } from "./marketplaceTrace";
import { rastrearCatalogHydration } from "./marketplaceTrace";
import type { DiscoveryCandidate } from "./core/types";

export type CatalogSearchHit = {
  id?: string;
  name?: string;
  status?: string;
  domain_id?: string;
};

export type RankedCatalogHit = CatalogSearchHit & {
  productId: string;
  relevanceScore: number;
  title: string;
};

export type CatalogHydrationItemTrace = {
  productId: string;
  endpoint: string;
  httpStatus: number | null;
  mlbId: string;
  title: string;
  price: number | null;
  url: string;
  voltage: string;
  status: "KEPT" | "DROPPED";
  reason: string;
  relevanceScore: number;
};

export type CatalogHydrationTrace = {
  query: string;
  catalogIdsFound: number;
  selectedIds: string[];
  rankedPreview: Array<{ productId: string; title: string; relevanceScore: number }>;
  reservationMs: number;
  batches: Array<{
    batchIndex: number;
    productIds: string[];
    startedAt: number;
    endedAt: number;
  }>;
  items: CatalogHydrationItemTrace[];
  counts: {
    beforeHydration: number;
    afterHydration: number;
    kept: number;
    dropped: number;
  };
};

function normalizarTexto(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function boostRelevance(queryNorm: string, titleNorm: string, base: number): number {
  let score = base;

  const boosts: Array<[string, number]> = [
    ["gtw", 0.18],
    ["inox", 0.12],
    ["1400", 0.14],
    ["220", 0.16],
    ["127", 0.1],
  ];

  for (const [token, weight] of boosts) {
    if (queryNorm.includes(token) && titleNorm.includes(token)) {
      score += weight;
    }
  }

  if (
    queryNorm.includes("12") &&
    (titleNorm.includes("12 litros") || titleNorm.includes("inox 12"))
  ) {
    score += 0.08;
  }

  if (queryNorm.includes("220") && titleNorm.includes("127")) {
    score -= 0.35;
  }

  if (queryNorm.includes("127") && titleNorm.includes("220")) {
    score -= 0.35;
  }

  if (titleNorm.includes("generico")) {
    score -= 0.25;
  }

  return score;
}

export function scoreCatalogProductRelevance(
  query: string,
  product: CatalogSearchHit,
): number {
  const title = product.name?.trim() || product.id?.trim() || "";
  if (!title) {
    return 0;
  }

  const lexical = pontuarCoberturaLexicalPonderada(query, title);
  const queryNorm = normalizarTexto(query);
  const titleNorm = normalizarTexto(title);

  return boostRelevance(queryNorm, titleNorm, lexical.score);
}

export function rankCatalogProductsForHydration(
  query: string,
  products: CatalogSearchHit[],
): RankedCatalogHit[] {
  const unique = new Map<string, RankedCatalogHit>();

  for (const product of products) {
    const productId = product.id?.trim();
    if (!productId) {
      continue;
    }

    const title = product.name?.trim() || productId;
    const relevanceScore = scoreCatalogProductRelevance(query, product);

    unique.set(productId, {
      ...product,
      productId,
      title,
      relevanceScore,
    });
  }

  return Array.from(unique.values()).sort(
    (first, second) => second.relevanceScore - first.relevanceScore,
  );
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    setTimeout(resolve, ms);
  });
}

export type CatalogHydrationEvaluation = MarketplaceFilterEvent & {
  kept?: {
    candidate: DiscoveryCandidate;
    relevance: number;
  };
};

export type CatalogHydrationLoaderResult = {
  evaluation: CatalogHydrationEvaluation;
  trace: CatalogHydrationItemTrace;
};

export async function runCatalogHydrationWithReservation(input: {
  query: string;
  ranked: RankedCatalogHit[];
  limit: number;
  reservationMs: number;
  concurrency: number;
  signal?: AbortSignal;
  stageClosed?: () => boolean;
  loadCandidate: (
    productId: string,
    previewTitle: string,
    relevanceScore: number,
  ) => Promise<CatalogHydrationLoaderResult>;
}): Promise<{
  evaluations: CatalogHydrationEvaluation[];
  trace: CatalogHydrationTrace;
}> {
  const selected = input.ranked.slice(0, input.limit);
  const selectedIds = selected.map((item) => item.productId);
  const reservationStarted = Date.now();
  const reservationEndsAt = reservationStarted + input.reservationMs;

  const trace: CatalogHydrationTrace = {
    query: input.query,
    catalogIdsFound: input.ranked.length,
    selectedIds,
    rankedPreview: selected.slice(0, 12).map((item) => ({
      productId: item.productId,
      title: item.title,
      relevanceScore: Number(item.relevanceScore.toFixed(4)),
    })),
    reservationMs: input.reservationMs,
    batches: [],
    items: [],
    counts: {
      beforeHydration: selected.length,
      afterHydration: 0,
      kept: 0,
      dropped: 0,
    },
  };

  rastrearCatalogHydration("catalog-hydration-start", {
    query: input.query,
    catalogIdsFound: input.ranked.length,
    selectedIds,
    reservationMs: input.reservationMs,
    rankedPreview: trace.rankedPreview,
  });

  const evaluations: CatalogHydrationEvaluation[] = [];
  const inFlight = new Set<Promise<void>>();
  let cursor = 0;
  let batchIndex = 0;

  const loadOne = async (hit: RankedCatalogHit) => {
    try {
      const result = await input.loadCandidate(
        hit.productId,
        hit.title,
        hit.relevanceScore,
      );
      if (input.stageClosed?.()) {
        return;
      }
      trace.items.push(result.trace);
      evaluations.push(result.evaluation);
      rastrearCatalogHydration("catalog-hydration-item", result.trace);
    } catch (error) {
      if (input.stageClosed?.()) {
        return;
      }
      const reason =
        error instanceof Error
          ? error.message.slice(0, 180)
          : "Falha ao hidratar produto de catalogo.";
      const fallbackTrace: CatalogHydrationItemTrace = {
        productId: hit.productId,
        endpoint: `/products/${hit.productId}`,
        httpStatus: null,
        mlbId: "",
        title: hit.title,
        price: null,
        url: "",
        voltage: "",
        status: "DROPPED",
        reason,
        relevanceScore: hit.relevanceScore,
      };
      trace.items.push(fallbackTrace);
      evaluations.push({
        title: hit.title,
        externalId: hit.productId,
        stage: "error",
        status: "DROPPED",
        reason,
        lexicalScore: hit.relevanceScore,
      });
      rastrearCatalogHydration("catalog-hydration-item", fallbackTrace);
    }
  };

  while (
    cursor < selected.length &&
    Date.now() < reservationEndsAt &&
    !input.stageClosed?.() &&
    !input.signal?.aborted
  ) {
    const batchStartedAt = Date.now();
    const batchIds: string[] = [];

    while (
      batchIds.length < input.concurrency &&
      cursor < selected.length &&
      Date.now() < reservationEndsAt
    ) {
      batchIds.push(selected[cursor]!.productId);
      cursor += 1;
    }

    if (batchIds.length === 0) {
      break;
    }

    for (const productId of batchIds) {
      const hit = selected.find((item) => item.productId === productId);
      if (!hit) {
        continue;
      }
      const task = loadOne(hit).finally(() => {
        inFlight.delete(task);
      });
      inFlight.add(task);
    }

    trace.batches.push({
      batchIndex,
      productIds: batchIds,
      startedAt: batchStartedAt,
      endedAt: Date.now(),
    });
    rastrearCatalogHydration("catalog-hydration-batch", {
      batchIndex,
      productIds: batchIds,
      startedAt: batchStartedAt,
      endedAt: Date.now(),
      elapsedMs: Date.now() - batchStartedAt,
    });
    batchIndex += 1;

    if (inFlight.size === 0) {
      continue;
    }

    const remaining = reservationEndsAt - Date.now();
    await Promise.race([Promise.allSettled(inFlight), waitMs(Math.max(0, remaining))]);
  }

  const tailRemaining = reservationEndsAt - Date.now();
  if (tailRemaining > 0 && inFlight.size > 0) {
    await Promise.race([
      Promise.allSettled(inFlight),
      waitMs(Math.max(0, tailRemaining)),
    ]);
  }

  void Promise.allSettled([...inFlight]).catch(() => undefined);

  trace.counts.afterHydration = evaluations.length;
  trace.counts.kept = evaluations.filter((item) => item.status === "KEPT").length;
  trace.counts.dropped = evaluations.filter((item) => item.status === "DROPPED").length;

  rastrearCatalogHydration("catalog-hydration-summary", {
    query: input.query,
    reservationMs: input.reservationMs,
    reservationUsedMs: Date.now() - reservationStarted,
    ...trace.counts,
    selectedIds,
  });

  return { evaluations, trace };
}
