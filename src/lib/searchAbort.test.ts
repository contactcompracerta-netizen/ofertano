import assert from "node:assert/strict";

import { abortableFetch, withSearchAbort } from "./searchAbort";

async function runResponseBodyDeadlineCase(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let bodyWasAborted = false;

  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const onAbort = () => {
          bodyWasAborted = true;
          controller.error(new DOMException("The operation was aborted.", "AbortError"));
        };

        if (init?.signal?.aborted) {
          onAbort();
          return;
        }

        init?.signal?.addEventListener("abort", onAbort, { once: true });
      },
    });

    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
  }) as typeof fetch;

  const parent = new AbortController();
  const startedAt = Date.now();

  try {
    const outcome = await Promise.race([
      withSearchAbort(
        {
          signal: parent.signal,
          fetchMs: 30,
          deadlineAt: startedAt + 30,
        },
        async () => {
          const response = await abortableFetch("https://body-never-ends.test");
          try {
            await response.text();
            return "completed" as const;
          } catch {
            return "aborted" as const;
          }
        },
      ),
      new Promise<"guard-timeout">((resolve) => {
        setTimeout(() => resolve("guard-timeout"), 250);
      }),
    ]);

    assert.equal(
      outcome,
      "aborted",
      "o timeout precisa continuar ativo ate o corpo da resposta terminar",
    );
    assert.equal(bodyWasAborted, true, "download pendurado recebeu abort");
    assert.ok(
      Date.now() - startedAt < 200,
      "leitura do corpo nao pode sobreviver ao orcamento de fetch",
    );
  } finally {
    parent.abort();
    globalThis.fetch = originalFetch;
  }
}

void runResponseBodyDeadlineCase()
  .then(() => {
    console.log("RESPONSE_BODY_DEADLINE=PASS");
    console.log("searchAbort.test.ts: todos os casos passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
