import { AsyncLocalStorage } from "node:async_hooks";

export type SearchAbortContext = {
  signal: AbortSignal;
  fetchMs: number;
  deadlineAt: number;
};

export type ComposedAbort = {
  signal: AbortSignal;
  abort: () => void;
  cleanup: () => void;
};

const storage = new AsyncLocalStorage<SearchAbortContext>();

export function withSearchAbort<T>(
  context: SearchAbortContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

export function activeSearchAbort(): SearchAbortContext | undefined {
  return storage.getStore();
}

export function isSearchAborted(): boolean {
  const context = storage.getStore();
  if (!context) {
    return false;
  }

  return context.signal.aborted || Date.now() >= context.deadlineAt;
}

export function remainingBudgetMs(): number {
  const context = storage.getStore();
  if (!context) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, context.deadlineAt - Date.now());
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    /aborted|abort|timeout|deadline/i.test(message)
  );
}

function abortedError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export function composeAbortSignal(
  timeoutMs: number | null,
  ...parents: Array<AbortSignal | undefined>
): ComposedAbort {
  const controller = new AbortController();
  const liveParents = parents.filter((signal): signal is AbortSignal =>
    Boolean(signal),
  );
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  const timeout =
    timeoutMs == null
      ? null
      : setTimeout(abort, Math.max(0, timeoutMs));
  const onParentAbort = () => abort();

  for (const parent of liveParents) {
    if (parent.aborted) {
      abort();
    } else {
      parent.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    abort,
    cleanup: () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      for (const parent of liveParents) {
        parent.removeEventListener("abort", onParentAbort);
      }
    },
  };
}

export async function abortableFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const context = storage.getStore();
  const timeoutMs = context
    ? Math.min(context.fetchMs, remainingBudgetMs())
    : undefined;

  if (
    init?.signal?.aborted ||
    context?.signal.aborted ||
    isSearchAborted() ||
    (timeoutMs !== undefined && timeoutMs <= 0)
  ) {
    throw abortedError();
  }

  if (!init?.signal && !context && timeoutMs === undefined) {
    return fetch(input, init);
  }

  const composed = composeAbortSignal(
    timeoutMs ?? null,
    init?.signal ?? undefined,
    context?.signal,
  );

  try {
    return await fetch(input, {
      ...init,
      signal: composed.signal,
    });
  } finally {
    composed.cleanup();
  }
}
