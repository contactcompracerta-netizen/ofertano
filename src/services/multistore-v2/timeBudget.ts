export type SearchBudget = {
  globalMs: number;
  marketplaceMs: number;
  mercadoLivreMs?: number;
  fetchMs: number;
  persistReserveMs: number;
  hangGraceMs: number;
};

export const DEFAULT_SEARCH_BUDGET: SearchBudget = {
  globalMs: 20_000,
  marketplaceMs: 10_000,
  mercadoLivreMs: 16_000,
  fetchMs: 6_000,
  persistReserveMs: 2_000,
  hangGraceMs: 300,
};

export const V2_RESPONSE_RESERVE_MS = 1_500;

export type SearchDeadline = {
  startedAt: number;
  deadlineAt: number;
  responseReserveMs: number;
  budget: SearchBudget;
  signal: AbortSignal;
  abort: () => void;
  remainingMs: () => number;
  expired: () => boolean;
  acquisitionUntilMs: (persist?: boolean) => number;
};

export function createSearchDeadline(
  budget: SearchBudget = DEFAULT_SEARCH_BUDGET,
  parent?: AbortSignal,
  responseReserveMs: number = V2_RESPONSE_RESERVE_MS,
): SearchDeadline {
  const startedAt = Date.now();
  const deadlineAt = startedAt + budget.globalMs;
  const boundedResponseReserveMs = Math.min(
    Math.max(0, responseReserveMs),
    Math.max(25, Math.floor(budget.globalMs * 0.3)),
  );
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

  const remainingMs = () => Math.max(0, deadlineAt - Date.now());
  const acquisitionUntilMs = (persist = false) =>
    Math.max(
      0,
      deadlineAt -
        Date.now() -
        boundedResponseReserveMs -
        (persist ? budget.persistReserveMs : 0),
    );

  const abort = () => {
    clearTimeout(globalTimer);
    parent?.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  return {
    startedAt,
    deadlineAt,
    responseReserveMs: boundedResponseReserveMs,
    budget,
    signal: controller.signal,
    abort,
    remainingMs,
    acquisitionUntilMs,
    expired: () => controller.signal.aborted || remainingMs() <= 0,
  };
}

export function marketplaceBudgetMs(
  deadline: SearchDeadline,
  persist = false,
): number {
  return Math.max(
    0,
    Math.min(
      deadline.budget.marketplaceMs,
      deadline.acquisitionUntilMs(persist),
    ),
  );
}

export async function waitForAbsoluteTime(
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<void> {
  const ms = Math.max(0, deadlineAt - Date.now());
  if (ms <= 0 || signal?.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
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

export function waitForDeadline(
  deadline: SearchDeadline,
  timeoutMs?: number,
): Promise<void> {
  const ms = Math.max(
    0,
    timeoutMs ?? deadline.remainingMs(),
  );

  if (ms <= 0 || deadline.expired()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(onAbort, ms);
    deadline.signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ status: "result"; value: T } | { status: "timeout" }> {
  if (timeoutMs <= 0 || signal.aborted) {
    return { status: "timeout" };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  const timeout = new Promise<{ status: "timeout" }>((resolve) => {
    const finish = () => resolve({ status: "timeout" });
    onAbort = finish;
    timer = setTimeout(finish, timeoutMs);
    signal.addEventListener("abort", finish, { once: true });
  });
  const result = work.then((value) => ({ status: "result" as const, value }));

  try {
    const outcome = await Promise.race([result, timeout]);
    if (outcome.status === "timeout") {
      signal.dispatchEvent(new Event("abort"));
      await Promise.race([
        result,
        waitMs(50, signal),
      ]).catch(() => undefined);
    }
    return outcome;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
