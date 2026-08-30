export type SearchBudget = {
  globalMs: number;
  marketplaceMs: number;
  fetchMs: number;
  persistReserveMs: number;
  hangGraceMs: number;
};

export const DEFAULT_SEARCH_BUDGET: SearchBudget = {
  globalMs: 20_500,
  marketplaceMs: 16_000,
  fetchMs: 6_000,
  persistReserveMs: 2_000,
  hangGraceMs: 300,
};

export type SearchDeadline = {
  startedAt: number;
  budget: SearchBudget;
  signal: AbortSignal;
  abort: () => void;
  remainingMs: () => number;
  expired: () => boolean;
};

export function createSearchDeadline(
  budget: SearchBudget = DEFAULT_SEARCH_BUDGET,
  parent?: AbortSignal,
): SearchDeadline {
  const startedAt = Date.now();
  const controller = new AbortController();
  const globalTimer = setTimeout(() => {
    controller.abort();
  }, budget.globalMs);

  const onParentAbort = () => {
    controller.abort();
  };

  if (parent) {
    if (parent.aborted) {
      controller.abort();
    } else {
      parent.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  const remainingMs = () =>
    Math.max(0, startedAt + budget.globalMs - Date.now());

  const abort = () => {
    clearTimeout(globalTimer);
    parent?.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  return {
    startedAt,
    budget,
    signal: controller.signal,
    abort,
    remainingMs,
    expired: () => controller.signal.aborted || remainingMs() <= 0,
  };
}

export function marketplaceBudgetMs(
  deadline: SearchDeadline,
): number {
  return Math.max(
    0,
    Math.min(
      deadline.budget.marketplaceMs,
      deadline.remainingMs() - deadline.budget.persistReserveMs,
    ),
  );
}

export function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
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

export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ status: "result"; value: T } | { status: "timeout" }> {
  void work.catch(() => undefined);

  if (timeoutMs <= 0 || signal.aborted) {
    return { status: "timeout" };
  }

  let settled = false;
  const timeout = waitMs(timeoutMs, signal).then(() => {
    if (settled) {
      return { status: "timeout" as const };
    }
    return { status: "timeout" as const };
  });

  const result = work.then((value) => {
    settled = true;
    return { status: "result" as const, value };
  });

  return Promise.race([result, timeout]);
}
