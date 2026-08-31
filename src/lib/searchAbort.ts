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
    const response = await fetch(input, {
      ...init,
      signal: composed.signal,
    });

    /*
     * fetch() resolve assim que os headers chegam. Manter o AbortController
     * apenas ate esse ponto deixa response.text()/json() sem prazo e foi o
     * que permitiu uma pagina do ML ocupar mais de 40 s. O proxy prolonga o
     * mesmo timeout ate o corpo terminar (ou falhar).
     */
    if (!response.body) {
      composed.cleanup();
      return response;
    }

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      composed.signal.removeEventListener("abort", cleanup);
      composed.cleanup();
    };
    composed.signal.addEventListener("abort", cleanup, { once: true });

    const bodyReaders = new Set<PropertyKey>([
      "arrayBuffer",
      "blob",
      "bytes",
      "formData",
      "json",
      "text",
    ]);

    return new Proxy(response, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") {
          return value;
        }

        if (!bodyReaders.has(property)) {
          return value.bind(target);
        }

        return async (...args: unknown[]) => {
          try {
            const reader = value as (...readerArgs: unknown[]) => Promise<unknown>;
            return await reader.apply(target, args);
          } finally {
            cleanup();
          }
        };
      },
    });
  } catch (error) {
    composed.cleanup();
    throw error;
  }
}

export async function drainAbortableWork<T>(
  work: Promise<T>,
  maxDrainMs = 50,
): Promise<T | undefined> {
  if (maxDrainMs <= 0) {
    return undefined;
  }

  const done = new Promise<T>((resolve, reject) => {
    work.then(resolve, reject);
  });

  const timeout = new Promise<undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), maxDrainMs);
    void done.finally(() => clearTimeout(timer));
  });

  return Promise.race([done, timeout]);
}
