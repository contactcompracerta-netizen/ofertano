import { composeAbortSignal } from "@/lib/searchAbort";

export const ML_TOTAL_BUDGET_MS = 16_000;
export const ML_HYDRATION_RESERVE_MS = 3_000;

export type MlListingSource =
  | "items-api"
  | "public-search"
  | "public-search-lista"
  | "public-search-jm";

export type MlStageKind =
  | MlListingSource
  | "domain"
  | "catalog"
  | "catalog-hydration"
  | "variant-public"
  | "catalog-ids";

export type MlDynamicBudgetClock = {
  startedAt: number;
  deadlineAt: number;
  totalMs: number;
  hydrationReserveMs: number;
  elapsedMs: () => number;
  remainingMs: () => number;
  catalogBudgetMs: () => number;
  hydrationBudgetMs: () => number;
  listingBudgetMs: () => number;
  stageBudgetMs: (stage: MlStageKind) => number;
};

export function resolveMlTotalBudgetMs(
  signal?: AbortSignal,
  explicitMs?: number,
): number {
  if (explicitMs != null && explicitMs > 0) {
    return explicitMs;
  }

  const deadlineMs = readAbortDeadlineMs(signal);
  if (deadlineMs != null && deadlineMs > 0) {
    return Math.min(ML_TOTAL_BUDGET_MS, deadlineMs);
  }

  return ML_TOTAL_BUDGET_MS;
}

function readAbortDeadlineMs(signal?: AbortSignal): number | null {
  if (!signal) {
    return null;
  }

  const withDeadline = signal as AbortSignal & { deadlineMs?: number };
  if (
    typeof withDeadline.deadlineMs === "number" &&
    Number.isFinite(withDeadline.deadlineMs)
  ) {
    return withDeadline.deadlineMs;
  }

  return null;
}

export function createMlStageBudgetClock(
  totalMs: number,
  startedAt = Date.now(),
  hydrationReserveMs: number = ML_HYDRATION_RESERVE_MS,
): MlDynamicBudgetClock {
  const bounded = Math.max(1_000, Math.min(ML_TOTAL_BUDGET_MS, totalMs));
  const deadlineAt = startedAt + bounded;

  const elapsedMs = () => Math.max(0, Date.now() - startedAt);
  const remainingMs = () => Math.max(0, deadlineAt - Date.now());
  const catalogBudgetMs = () => Math.max(0, remainingMs() - hydrationReserveMs);
  /*
   * A reserva e um piso protegido contra catalog/listings, nao um teto.
   * Se o catalogo termina cedo, todo o tempo restante pode ser transferido
   * para a hidratacao dos anuncios.
   */
  const hydrationBudgetMs = () => remainingMs();
  const listingBudgetMs = () => catalogBudgetMs();

  const stageBudgetMs = (stage: MlStageKind): number => {
    const left = remainingMs();
    if (left <= 0) {
      return 0;
    }

    if (stage === "catalog" || stage === "domain") {
      return catalogBudgetMs();
    }

    if (stage === "catalog-hydration" || stage === "catalog-ids") {
      return hydrationBudgetMs();
    }

    if (stage === "variant-public") {
      return Math.min(1_500, listingBudgetMs());
    }

    return listingBudgetMs();
  };

  return {
    startedAt,
    deadlineAt,
    totalMs: bounded,
    hydrationReserveMs,
    elapsedMs,
    remainingMs,
    catalogBudgetMs,
    hydrationBudgetMs,
    listingBudgetMs,
    stageBudgetMs,
  };
}

export async function runMlStage<T>(
  stage: MlStageKind,
  clock: MlDynamicBudgetClock,
  signal: AbortSignal | undefined,
  run: (stageSignal: AbortSignal) => Promise<T>,
): Promise<
  | { status: "result"; value: T }
  | { status: "timeout" }
  | { status: "aborted" }
> {
  const budgetMs = clock.stageBudgetMs(stage);
  return runMlStageWithBudget(budgetMs, signal, run);
}

export async function runMlStageWithBudget<T>(
  budgetMs: number,
  signal: AbortSignal | undefined,
  run: (stageSignal: AbortSignal) => Promise<T>,
): Promise<
  | { status: "result"; value: T }
  | { status: "timeout" }
  | { status: "aborted" }
> {
  if (budgetMs <= 0 || signal?.aborted) {
    return { status: signal?.aborted ? "aborted" : "timeout" };
  }

  const stageAbort = composeAbortSignal(budgetMs, signal);
  let workPromise: Promise<T>;
  try {
    workPromise = run(stageAbort.signal);
  } catch (error) {
    workPromise = Promise.reject(error);
  }
  const work = workPromise.then((value) => ({ status: "result" as const, value }));

  const stopped = new Promise<{ status: "timeout" | "aborted" }>((resolve) => {
    const finish = () => {
      resolve({ status: signal?.aborted ? "aborted" : "timeout" });
    };

    if (stageAbort.signal.aborted) {
      finish();
      return;
    }
    stageAbort.signal.addEventListener("abort", finish, { once: true });
  });

  try {
    const outcome = await Promise.race([work, stopped]);
    if (outcome.status === "timeout" || outcome.status === "aborted") {
      stageAbort.abort();
      await Promise.race([
        work,
        new Promise((resolve) => setTimeout(resolve, 50)),
      ]).catch(() => undefined);
    }
    return outcome;
  } finally {
    stageAbort.cleanup();
  }
}
