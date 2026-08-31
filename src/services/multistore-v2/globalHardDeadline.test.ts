import assert from "node:assert/strict";

import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "../discovery/core/types";
import { DEFAULT_SEARCH_BUDGET, type SearchDeadline } from "./timeBudget";

type TimerTask = {
  at: number;
  fn: () => void;
};

class FakeClock {
  now = 0;
  private nextId = 1;
  private tasks = new Map<number, TimerTask>();
  private original = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    dateNow: Date.now,
  };

  install(): void {
    const schedule = this.schedule.bind(this);
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number) => {
      const id = this.nextId++;
      schedule(id, Number(timeout ?? 0), handler);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
      if (id != null) {
        this.tasks.delete(id as unknown as number);
      }
    }) as typeof clearTimeout;

    Date.now = () => this.now;
  }

  restore(): void {
    globalThis.setTimeout = this.original.setTimeout;
    globalThis.clearTimeout = this.original.clearTimeout;
    Date.now = this.original.dateNow;
    this.tasks.clear();
  }

  private schedule(id: number, delay: number, handler: TimerHandler): void {
    this.tasks.set(id, {
      at: this.now + Math.max(0, delay),
      fn: () => {
        if (typeof handler === "function") {
          handler();
        }
      },
    });
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
    attributes: extras.attributes ?? {},
    ...extras,
  };
}

async function runGlobalHardDeadlineCase(): Promise<void> {
  const clock = new FakeClock();
  clock.install();

  const lateRejections: unknown[] = [];
  const onLateRejection = (reason: unknown) => {
    lateRejections.push(reason);
  };
  process.on("unhandledRejection", onLateRejection);

  const { searchMultistoreV2 } = await import("./search");

  let hangStarted = false;
  const budget = {
    ...DEFAULT_SEARCH_BUDGET,
    globalMs: 20_000,
    marketplaceMs: 10_000,
    persistReserveMs: 2_000,
    hangGraceMs: 300,
  };

  const promise = searchMultistoreV2("Headphone JBL Tune 520BT", {
    persist: false,
    budget,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => {
        hangStarted = true;
        await new Promise<void>(() => undefined);
        return {
          marketplace: "MERCADO_LIVRE",
          query: "Headphone JBL Tune 520BT",
          success: false,
          scanned: 0,
          candidates: [],
          error: "nunca resolve",
        };
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
            externalId: "shopee-fast-deadline",
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
  const finishedAt = clock.now;

  process.off("unhandledRejection", onLateRejection);
  clock.restore();

  assert.ok(hangStarted, "adapter pendurado foi iniciado");
  assert.ok(
    finishedAt >= 20_000 && finishedAt <= 20_500,
    `retorno respeitou deadline global (${finishedAt}ms)`,
  );
  assert.ok(
    result.acquisitions.some(
      (item) =>
        item.marketplace === "SHOPEE" &&
        item.usable >= 1 &&
        item.candidates.some(
          (candidate) => candidate.externalId === "shopee-fast-deadline",
        ),
    ),
    "candidato rapido preservado",
  );
  assert.equal(lateRejections.length, 0, "nenhuma rejeicao tardia sem handler");

  console.log("GLOBAL_HARD_DEADLINE=PASS");
}

async function runMarketplaceContentionCase(): Promise<void> {
  const { searchMultistoreV2 } = await import("./search");
  const budget = {
    globalMs: 1_200,
    marketplaceMs: 900,
    fetchMs: 300,
    persistReserveMs: 100,
    hangGraceMs: 50,
  };

  let hangA = false;
  let hangB = false;
  const started = Date.now();
  const result = await searchMultistoreV2("Headphone JBL Tune 520BT", {
    persist: false,
    budget,
    adapters: [
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => {
        hangA = true;
        await new Promise<void>(() => undefined);
        return {
          marketplace: "MERCADO_LIVRE",
          query: "Headphone JBL Tune 520BT",
          success: false,
          scanned: 0,
          candidates: [],
          error: "pendurado",
        } satisfies MarketplaceDiscoveryResult;
      }),
      fakeAdapter("SHOPEE", "Shopee", async () => {
        hangB = true;
        await new Promise<void>(() => undefined);
        return {
          marketplace: "SHOPEE",
          query: "Headphone JBL Tune 520BT",
          success: false,
          scanned: 0,
          candidates: [],
          error: "pendurado",
        } satisfies MarketplaceDiscoveryResult;
      }),
      fakeAdapter("AMAZON", "Amazon", async (request) => ({
        marketplace: "AMAZON",
        query: request.query,
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-fast-contention",
            title: "Headphone JBL Tune 520BT",
            price: 199,
          }),
        ],
        error: null,
      })),
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async (request) => ({
        marketplace: "MAGAZINE_LUIZA",
        query: request.query,
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "MAGAZINE_LUIZA",
            marketplaceName: "Magazine Luiza",
            externalId: "magalu-fast-contention",
            title: "Headphone JBL Tune 520BT",
            price: 189,
          }),
        ],
        error: null,
      })),
      fakeAdapter("ALIEXPRESS", "AliExpress", async () => {
        throw new Error("AliExpress indisponivel.");
      }),
    ],
  });
  const elapsed = Date.now() - started;

  assert.ok(hangA && hangB, "adapters pendurados foram iniciados em paralelo");
  assert.ok(
    elapsed <= budget.globalMs + 250,
    `retorno global respeitou deadline (${elapsed}ms)`,
  );
  assert.ok(
    (result.acquisitions.find((item) => item.marketplace === "AMAZON")?.usable ??
      0) >= 1,
    "Amazon rapida preservada",
  );
  assert.ok(
    (result.acquisitions.find((item) => item.marketplace === "MAGAZINE_LUIZA")
      ?.usable ?? 0) >= 1,
    "Magalu rapida preservada",
  );
  assert.equal(
    result.acquisitions.find((item) => item.marketplace === "ALIEXPRESS")?.status,
    "ERROR",
  );
  assert.equal(
    result.acquisitions.filter((item) => item.status === "TIMEOUT").length,
    2,
    "dois adapters pendurados viram TIMEOUT",
  );
  assert.equal(result.marketplacesAttempted.length, 5);
  assert.equal(result.marketplacesSucceeded.length, 2);

  console.log("MARKETPLACE_CONTENTION_ISOLATION=PASS");
}

async function runParallelStartCase(): Promise<void> {
  const { elapsedV2Ms, searchMultistoreV2 } = await import("./search");
  const starts = new Map<string, number>();
  const marketplaces = [
    "MERCADO_LIVRE",
    "SHOPEE",
    "AMAZON",
    "MAGAZINE_LUIZA",
    "ALIEXPRESS",
  ] as const;

  await searchMultistoreV2("Headphone JBL Tune 520BT", {
    persist: false,
    budget: {
      globalMs: 6_000,
      marketplaceMs: 1_000,
      fetchMs: 500,
      persistReserveMs: 100,
      hangGraceMs: 0,
    },
    adapters: marketplaces.map((marketplace) =>
      fakeAdapter(marketplace, marketplace, async (request) => {
        if (!starts.has(marketplace)) {
          starts.set(marketplace, Date.now());
        }
        return {
          marketplace,
          query: request.query,
          success: true,
          scanned: 0,
          candidates: [],
          error: null,
          searchOutcome: "EMPTY_VALID",
        } satisfies MarketplaceDiscoveryResult;
      }),
    ),
  });

  const firstStarts = Array.from(starts.values());
  assert.equal(firstStarts.length, marketplaces.length);
  assert.ok(
    Math.max(...firstStarts) - Math.min(...firstStarts) < 250,
    "todos os adapters devem iniciar na mesma janela, sem atraso fixo por loja",
  );
  const now = Date.now();
  assert.ok(
    elapsedV2Ms({
      startedAt: now - 26_000,
      deadlineAt: now - 6_000,
    } as SearchDeadline) >= 26_000,
    "elapsedMs precisa reportar o wall clock real, sem cap artificial",
  );
  console.log("MARKETPLACE_PARALLEL_START=PASS");
}

void runGlobalHardDeadlineCase()
  .then(() => runMarketplaceContentionCase())
  .then(() => runParallelStartCase())
  .then(() => {
    console.log("globalHardDeadline.test.ts: todos os casos passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
