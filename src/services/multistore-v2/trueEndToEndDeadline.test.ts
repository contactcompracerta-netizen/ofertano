import assert from "node:assert/strict";

import { abortableFetch } from "@/lib/searchAbort";
import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "../discovery/core/types";
import { DEFAULT_SEARCH_BUDGET } from "./timeBudget";

class FakeClock {
  now = 0;
  private nextId = 1;
  private tasks = new Map<number, { at: number; fn: () => void }>();
  private original = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    dateNow: Date.now,
    fetch: globalThis.fetch,
  };

  install(): void {
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number) => {
      const id = this.nextId++;
      this.tasks.set(id, {
        at: this.now + Math.max(0, Number(timeout ?? 0)),
        fn: () => {
          if (typeof handler === "function") {
            handler();
          }
        },
      });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
      if (id != null) {
        this.tasks.delete(id as unknown as number);
      }
    }) as typeof clearTimeout;

    Date.now = () => this.now;

    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        };
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener("abort", abort, { once: true });
      })) as typeof fetch;
  }

  restore(): void {
    globalThis.setTimeout = this.original.setTimeout;
    globalThis.clearTimeout = this.original.clearTimeout;
    Date.now = this.original.dateNow;
    globalThis.fetch = this.original.fetch;
    this.tasks.clear();
  }

  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    while (this.now < target) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((first, second) => first[1].at - second[1].at)[0];
      if (!due) {
        this.now = target;
        break;
      }
      const [id, task] = due;
      this.now = task.at;
      this.tasks.delete(id);
      await Promise.resolve();
      task.fn();
    }
  }
}

function fakeAdapter(
  marketplace: DiscoveryAdapter["marketplace"],
  marketplaceName: string,
  searcher: NonNullable<DiscoveryAdapter["searcher"]>,
): DiscoveryAdapter {
  return {
    marketplace,
    marketplaceName,
    enabled: true,
    searcher,
  };
}

function foundCandidate(
  extras: Partial<DiscoveryCandidate> &
    Pick<DiscoveryCandidate, "marketplace" | "externalId" | "title">,
): DiscoveryCandidate {
  return {
    marketplaceName: extras.marketplaceName ?? extras.marketplace,
    sourceUrl: extras.sourceUrl ?? `https://loja.example/${extras.externalId}`,
    affiliateLink: extras.affiliateLink ?? null,
    image: extras.image ?? "https://loja.example/img.jpg",
    price: extras.price ?? 199,
    oldPrice: extras.oldPrice ?? null,
    brand: extras.brand ?? "JBL",
    category: extras.category ?? null,
    seller: extras.seller ?? null,
    status: "FOUND",
    attributes: extras.attributes ?? {},
    ...extras,
  };
}

async function runTrueEndToEndDeadlineCase(): Promise<void> {
  const clock = new FakeClock();
  clock.install();

  const lateRejections: unknown[] = [];
  const onLateRejection = (reason: unknown) => {
    lateRejections.push(reason);
  };
  process.on("unhandledRejection", onLateRejection);

  const phaseLogs: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.includes("[MULTISTORE-V2] phase")) {
      phaseLogs.push(line);
    }
    originalInfo(...args);
  };

  const { searchMultistoreV2: searchV2 } = await import("./search");

  const budget = {
    ...DEFAULT_SEARCH_BUDGET,
    globalMs: 20_000,
    marketplaceMs: 10_000,
    persistReserveMs: 2_000,
    hangGraceMs: 0,
  };

  const promise = searchV2("Headphone JBL Tune 520BT", {
    persist: false,
    budget,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async (request) => {
        await abortableFetch("https://never-resolve.test/hang", {
          signal: request.signal,
        });
        return {
          marketplace: "MERCADO_LIVRE",
          query: request.query,
          success: false,
          scanned: 0,
          candidates: [],
          error: "nunca resolve",
        } satisfies MarketplaceDiscoveryResult;
      }),
      fakeAdapter("SHOPEE", "Shopee", async (request) => ({
        marketplace: "SHOPEE",
        query: request.query,
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "SHOPEE",
            marketplaceName: "Shopee",
            externalId: "shopee-e2e-fast",
            title: "Headphone JBL Tune 520BT",
            price: 179,
          }),
        ],
        error: null,
      })),
    ],
  });

  await clock.advance(20_500);
  const result = await promise;

  console.info = originalInfo;
  process.off("unhandledRejection", onLateRejection);
  clock.restore();

  const phases = [
    "ACQUISITION",
    "NORMALIZATION",
    "RELEVANCE",
    "CLUSTERING",
    "RESPONSE",
  ];
  for (const phase of phases) {
    assert.ok(
      phaseLogs.some(
        (line) =>
          line.includes(`phase=${phase}`) && line.includes("event=start"),
      ),
      `fase ${phase} deve ter inicio registrado`,
    );
    assert.ok(
      phaseLogs.some(
        (line) => line.includes(`phase=${phase}`) && line.includes("event=end"),
      ),
      `fase ${phase} deve ter fim registrado`,
    );
  }

  assert.ok(
    clock.now <= 20_500,
    `elapsedMs deve respeitar deadline global (${clock.now}ms)`,
  );
  assert.ok(
    result.acquisitions.some(
      (item) =>
        item.marketplace === "SHOPEE" &&
        item.candidates.some(
          (candidate) => candidate.externalId === "shopee-e2e-fast",
        ),
    ),
    "candidato rapido preservado no caminho real do V2",
  );
  assert.equal(lateRejections.length, 0, "nenhuma rejeicao tardia sem handler");

  console.log("TRUE_END_TO_END_DEADLINE=PASS");
}

async function runExpiredPostprocessCase(): Promise<void> {
  const { searchMultistoreV2 } = await import("./search");
  const manyCandidates = Array.from({ length: 250 }, (_, index) =>
    foundCandidate({
      marketplace: "MAGAZINE_LUIZA",
      marketplaceName: "Magazine Luiza",
      externalId: `magalu-deadline-${index}`,
      title: `Headphone MarcaX ZX${1000 + index}`,
      price: 200 + index,
    }),
  );
  const budget = {
    globalMs: 220,
    marketplaceMs: 180,
    mercadoLivreMs: 180,
    fetchMs: 100,
    persistReserveMs: 20,
    hangGraceMs: 0,
  };

  const startedAt = Date.now();
  const result = await searchMultistoreV2("Headphone MarcaX", {
    persist: false,
    budget,
    adapters: [
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async (request) => ({
        marketplace: "MAGAZINE_LUIZA",
        query: request.query,
        success: true,
        scanned: manyCandidates.length,
        candidates: manyCandidates,
        error: null,
      })),
      fakeAdapter("ALIEXPRESS", "AliExpress", async () => {
        setTimeout(() => {
          const blockedUntil = Date.now() + 320;
          while (Date.now() < blockedUntil) {
            // Simula parser externo sincrono que atrasou os timers na execucao live.
          }
        }, 30);
        await new Promise<void>(() => undefined);
        throw new Error("inalcancavel");
      }),
    ],
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.rawCandidates, manyCandidates.length);
  assert.equal(
    result.relevantCandidates.length,
    0,
    "deadline expirado nao inicia relevancia cara",
  );
  assert.equal(result.clusters.length, 0);
  assert.ok(
    elapsedMs < 600,
    `pos-processamento nao pode somar segundos apos deadline (${elapsedMs}ms)`,
  );

  console.log("POST_DEADLINE_CPU_GUARD=PASS");
}

void runTrueEndToEndDeadlineCase()
  .then(runExpiredPostprocessCase)
  .then(() => {
    console.log("trueEndToEndDeadline.test.ts: todos os casos passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
