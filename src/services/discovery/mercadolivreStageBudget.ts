import { isSearchAborted } from "@/lib/searchAbort";

import type { MercadoLivreSourceFetch } from "./mercadolivrePublicSearch";

export const ML_TOTAL_BUDGET_MS = 16_000;
export const ML_CATALOG_HYDRATION_RESERVE_MS = 3_000;

const SOURCE_BUDGET_DEFAULTS: Record<string, number> = {
  "discover-domain": 800,
  catalog: 2_500,
  "catalog-no-domain": 2_000,
  "items-api": 2_500,
  "public-search-lista": 2_500,
};

export type MlStageBudget = {
  startedAt: number;
  totalMs: number;
  hydrationReserveMs: number;
  close: () => void;
  isClosed: () => boolean;
  elapsedMs: () => number;
  remainingMs: () => number;
  allocateSourceBudget: (source: string) => number;
  hydrationBudgetMs: () => number;
};

export function createMlStageBudget(
  totalMs = ML_TOTAL_BUDGET_MS,
  hydrationReserveMs = ML_CATALOG_HYDRATION_RESERVE_MS,
): MlStageBudget {
  const startedAt = Date.now();
  let closed = false;

  const elapsedMs = () => Date.now() - startedAt;
  const remainingMs = () => Math.max(0, totalMs - elapsedMs());

  return {
    startedAt,
    totalMs,
    hydrationReserveMs,
    close: () => {
      closed = true;
    },
    isClosed: () => closed,
    elapsedMs,
    remainingMs,
    allocateSourceBudget: (source: string) => {
      const remaining = remainingMs();
      if (remaining <= 0) {
        return 0;
      }

      if (source === "public-search-jm") {
        return Math.max(0, remaining - hydrationReserveMs);
      }

      const requested = SOURCE_BUDGET_DEFAULTS[source] ?? 2_000;
      return Math.min(requested, remaining);
    },
    hydrationBudgetMs: () =>
      Math.min(hydrationReserveMs, remainingMs()),
  };
}

export type SourceRunOutcome<T> = {
  fetch: MercadoLivreSourceFetch<T[]>;
  budgetMs: number;
  durationMs: number;
  timedOut: boolean;
};

function emptyTimedOutFetch<T>(): MercadoLivreSourceFetch<T[]> {
  return {
    status: "ERROR",
    httpStatus: null,
    data: [],
    reason: "TIMEOUT: orcamento de fonte esgotado.",
  };
}

function waitForBudgetMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runSourceWithBudget<T>(
  source: string,
  query: string,
  budgetMs: number,
  run: () => Promise<MercadoLivreSourceFetch<T[]>>,
  options: {
    signal?: AbortSignal;
    stageClosed?: () => boolean;
  } = {},
): Promise<SourceRunOutcome<T>> {
  const startedAt = Date.now();

  if (
    budgetMs <= 0 ||
    options.stageClosed?.() ||
    options.signal?.aborted ||
    isSearchAborted()
  ) {
    const durationMs = Date.now() - startedAt;
    return {
      fetch: emptyTimedOutFetch<T>(),
      budgetMs,
      durationMs,
      timedOut: true,
    };
  }

  const work = run();
  void work.catch(() => undefined);

  const raced = await Promise.race([
    work.then((value) => ({ kind: "result" as const, value })),
    waitForBudgetMs(budgetMs, options.signal).then(() => ({
      kind: "timeout" as const,
    })),
  ]);

  const durationMs = Date.now() - startedAt;

  if (raced.kind === "timeout") {
    return {
      fetch: emptyTimedOutFetch<T>(),
      budgetMs,
      durationMs,
      timedOut: true,
    };
  }

  return {
    fetch: raced.value,
    budgetMs,
    durationMs,
    timedOut: false,
  };
}
