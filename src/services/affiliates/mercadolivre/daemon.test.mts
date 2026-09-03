import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createMercadoLivreAffiliateDaemon,
  acquireInstanceLock,
  type CycleSummary,
} from "./daemon";
import type { GeneratorFn } from "./worker";
import type {
  MercadoLivreApplyStore,
  MercadoLivrePending,
  MercadoLivrePendingStore,
} from "./pending";

const SOURCE_ML =
  "https://produto.mercadolivre.com.br/MLB-1234567890-smartphone-_JM";
const AFFILIATE_ML = "https://meli.la/2qvdFzv";

function pending(): MercadoLivrePending {
  return {
    offerId: "offer-1",
    productId: "prod-1",
    externalId: "MLB-1",
    sourceUrl: SOURCE_ML,
    opportunityId: "opp-1",
  };
}

function createMemoryStores(init: { pendingList?: MercadoLivrePending[] } = {}) {
  let list = [...(init.pendingList ?? [])];
  const offers = new Map<string, {
    id: string;
    productId: string;
    marketplace: string;
    externalId: string | null;
    sourceUrl: string | null;
    affiliateLink: string | null;
  }>();
  for (const p of list) {
    offers.set(p.offerId, {
      id: p.offerId,
      productId: p.productId,
      marketplace: "MERCADO_LIVRE",
      externalId: p.externalId,
      sourceUrl: p.sourceUrl,
      affiliateLink: null,
    });
  }
  const applied: string[] = [];

  const pendingStore: MercadoLivrePendingStore = {
    async listPendingMercadoLivreOffers(limit) {
      return list.slice(0, limit);
    },
    async countPending() {
      return list.length;
    },
    async findOfferById(offerId) {
      const o = offers.get(offerId);
      return o ? { ...o } : null;
    },
  };

  const applyStore: MercadoLivreApplyStore = {
    async applyValidatedAffiliateLink(input) {
      applied.push(input.offerId);
      const o = offers.get(input.offerId);
      if (o) o.affiliateLink = input.affiliateUrl;
      list = list.filter((p) => p.offerId !== input.offerId);
    },
  };

  return {
    pendingStore,
    applyStore,
    applied,
    offers,
    get pendingCount() {
      return list.length;
    },
  };
}

type Outcome = Awaited<ReturnType<GeneratorFn>>;

const seq = (items: Outcome[]): GeneratorFn => {
  let i = 0;
  return async () => items[Math.min(i++, items.length - 1)] ?? {
    status: "GENERATION_FAILED",
    reason: "sem sequência",
  };
};

type HarnessOpts = {
  pollMs?: number;
  cooldownMs?: number;
  chromeRetryMs?: number;
  authRetryMs?: number;
  backoffMs?: number;
  maxPerHour?: number;
  limit?: number;
  dryRun?: boolean;
  singleRun?: boolean;
  cycles?: number;
  sleep?: (ms: number) => Promise<void>;
};

function trackingGen(outcome: Outcome): GeneratorFn & { calls: number } {
  let calls = 0;
  const fn: GeneratorFn = async () => {
    calls += 1;
    return outcome;
  };
  Object.defineProperty(fn, "calls", {
    get: () => calls,
    enumerable: true,
    configurable: true,
  });
  return fn as GeneratorFn & { calls: number };
}

function timerSleep() {
  return (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
}

async function runDaemon(
  stores: ReturnType<typeof createMemoryStores>,
  generate: GeneratorFn,
  opts: HarnessOpts = {},
  onCycle?: (s: CycleSummary) => void,
): Promise<{
  state: () => string;
  stop: () => Promise<void>;
  nextState: string;
}> {
  // Nota: `shouldContinue` para sozinho quando o número de ciclos é atingido,
  // evitando busy-loop via microtask que estaria o event loop (timers).
  const cycles = opts.cycles ?? 1;
  let ran = 0;
  const daemon = createMercadoLivreAffiliateDaemon(
    {
      pendingStore: stores.pendingStore,
      applyStore: stores.applyStore,
      generate,
      sleep: opts.sleep ?? timerSleep(),
      shouldContinue: () => ran < cycles,
    },
    {
      dryRun: opts.dryRun ?? false,
      pollMs: opts.pollMs ?? 1000,
      cooldownMs: opts.cooldownMs ?? 0,
      chromeRetryMs: opts.chromeRetryMs ?? 1000,
      authRetryMs: opts.authRetryMs ?? 1000,
      backoffMs: opts.backoffMs ?? 1000,
      maxPerHour: opts.maxPerHour ?? 0,
      limit: opts.limit ?? 10,
      singleRun: opts.singleRun ?? false,
      log: () => {},
    },
    {
      onCycle: (s) => {
        onCycle?.(s);
        ran += 1;
      },
    },
  );

  await daemon.start();
  return {
    state: () => daemon.state(),
    stop: () => daemon.stop(),
    nextState: daemon.state(),
  };
}

async function run() {
  // 1) IDLE sem pendência
  {
    const stores = createMemoryStores({ pendingList: [] });
    const summaries: CycleSummary[] = [];
    await runDaemon(stores, seq([]), { cycles: 1, pollMs: 1 }, (s) =>
      summaries.push(s),
    );
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].offeredThisCycle, 0);
  }

  // 2) Processa pendência (SUCCESS grava)
  {
    const stores = createMemoryStores({ pendingList: [pending()] });
    await runDaemon(stores, seq([
      { status: "SUCCESS", affiliateUrl: AFFILIATE_ML, sourceItemId: "MLB-1", validated: true },
    ]), { cycles: 1, limit: 5 });
    assert.equal(stores.applied.length, 1);
    assert.equal(stores.applied[0], "offer-1");
  }

  // 3) Concorrência sempre 1 (processa 2 pendências em itens individuais por ciclo)
  {
    const stores = createMemoryStores({
      pendingList: [
        pending(),
        { ...pending(), offerId: "offer-2", externalId: "MLB-2" },
        { ...pending(), offerId: "offer-3", externalId: "MLB-3" },
      ],
    });
    let maxConcurrent = 0;
    let active = 0;
    await runDaemon(stores, async () => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return { status: "SUCCESS", affiliateUrl: AFFILIATE_ML, sourceItemId: "MLB-1", validated: true };
    }, { cycles: 1, limit: 5 });
    assert.equal(stores.applied.length, 3);
    assert.equal(maxConcurrent, 1);
  }

  // 4) Chrome offline -> PAUSED_CHROME
  {
    const stores = createMemoryStores({ pendingList: [pending()] });
    let next: string | undefined;
    await runDaemon(
      stores,
      seq([{ status: "CHROME_NOT_RUNNING", reason: "chrome indisponível" }]),
      { cycles: 1, limit: 5, chromeRetryMs: 1 },
      (s) => { next = s.state; },
    );
    assert.equal(next, "PAUSED_CHROME");
    assert.equal(stores.applied.length, 0);
  }

  // 5) Auth -> PAUSED_AUTH
  {
    const stores = createMemoryStores({ pendingList: [pending()] });
    let next: string | undefined;
    let notified: string | null = null;
    let stop = false;
    const daemon = createMercadoLivreAffiliateDaemon(
      {
        pendingStore: stores.pendingStore,
        applyStore: stores.applyStore,
        generate: seq([{ status: "AUTH_REQUIRED", reason: "autentique" }]),
        sleep: timerSleep(),
        shouldContinue: () => !stop,
      },
      {
        dryRun: false,
        pollMs: 1,
        cooldownMs: 0,
        chromeRetryMs: 1,
        authRetryMs: 1,
        backoffMs: 1,
        maxPerHour: 0,
        limit: 5,
        log: () => {},
      },
      {
        onCycle: (s) => {
          next = s.state;
        },
        onAuthRequired: (id) => {
          notified = id;
        },
      },
    );
    const p = daemon.start().then(() => undefined);
    const deadline = Date.now() + 5000;
    while (next === undefined && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    stop = true;
    await p;
    assert.equal(next, "PAUSED_AUTH");
    assert.equal(notified, "offer-1");
    assert.equal(stores.applied.length, 0);
  }

  // 6) Geração falha -> BACKOFF (transient)
  {
    const stores = createMemoryStores({ pendingList: [pending()] });
    let next: string | undefined;
    await runDaemon(
      stores,
      seq([{ status: "GENERATION_FAILED", reason: "botão ausente" }]),
      { cycles: 1, limit: 5, backoffMs: 1 },
      (s) => { next = s.state; },
    );
    assert.equal(next, "BACKOFF");
    assert.equal(stores.applied.length, 0);
  }

  // 7) Validation failed -> não grava
  {
    const stores = createMemoryStores({ pendingList: [pending()] });
    await runDaemon(
      stores,
      seq([{ status: "VALIDATION_FAILED", reason: "MLB não confere" }]),
      { cycles: 1, limit: 5, backoffMs: 1 },
    );
    assert.equal(stores.applied.length, 0);
    assert.equal(stores.offers.get("offer-1")?.affiliateLink, null);
  }

  // 8) Já afiliado -> skip (não grava, conta como skip)
  {
    const list = [pending()];
    const stores = createMemoryStores({ pendingList: list });
    stores.offers.set("offer-1", {
      id: "offer-1",
      productId: "prod-1",
      marketplace: "MERCADO_LIVRE",
      externalId: "MLB-1",
      sourceUrl: SOURCE_ML,
      affiliateLink: AFFILIATE_ML,
    });
    const gen = seq([]);
    let summarize: CycleSummary | undefined;
    await runDaemon(stores, gen, { cycles: 1, limit: 5 }, (s) => {
      summarize = s;
    });
    assert.equal(stores.applied.length, 0);
    assert.equal(summarize?.skippedCount, 1);
    assert.equal(summarize?.updatedCount, 0);
  }

  // 9) Shutdown seguro (deve retornar à parada sem deixar pendência perdida)
  {
    const stores = createMemoryStores({ pendingList: [pending()] });
    let st: string | undefined;
    let stop = false;
    const daemon = createMercadoLivreAffiliateDaemon(
      {
        pendingStore: stores.pendingStore,
        applyStore: stores.applyStore,
        generate: seq([{ status: "SUCCESS", affiliateUrl: AFFILIATE_ML, sourceItemId: "MLB-1", validated: true }]),
        sleep: timerSleep(),
        shouldContinue: () => !stop,
      },
      {
        dryRun: false,
        pollMs: 1,
        cooldownMs: 0,
        chromeRetryMs: 1,
        authRetryMs: 1,
        backoffMs: 1,
        maxPerHour: 0,
        limit: 5,
        log: () => {},
      },
      { onCycle: (s) => { st = s.state; } },
    );
    const p = daemon.start().then(() => undefined);
    const deadline = Date.now() + 5000;
    while (st === undefined && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    stop = true;
    await p;
    assert.equal(stores.pendingCount, 0);
  }

  // 10) Lock: ACTIVE bloqueia; STALE recuperado; SHUTDOWN normal libera
  {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ml-lock-"));
    const lockPath = path.join(dir, "daemon.lock");

    // ACTIVE_LOCK_BLOCKS: dono = processo atual (vivo) → bloqueia sem remover.
    await fs.writeFile(lockPath, `${process.pid}:${Date.now()}\n`, "utf8");
    const blockedByActive = await acquireInstanceLock(lockPath);
    assert.equal(blockedByActive.acquired, false);
    // Lock do processo ativo NÃO é removido.
    const ownerText = await fs.readFile(lockPath, "utf8");
    assert.equal(ownerText.startsWith(`${process.pid}:`), true);
    await fs.unlink(lockPath);

    // STALE_LOCK_RECOVERED: dono morto → removido e re-adquirido.
    const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    const deadPid = child.pid;
    await fs.writeFile(lockPath, `${deadPid}:${Date.now()}\n`, "utf8");
    const recovered = await acquireInstanceLock(lockPath);
    assert.equal(recovered.acquired, true);
    assert.equal(recovered.release instanceof Function, true);
    await recovered.release();

    // NORMAL_SHUTDOWN_RELEASES: lock liberado permite nova aquisição.
    const first = await acquireInstanceLock(lockPath);
    assert.equal(first.acquired, true);
    const second = await acquireInstanceLock(lockPath);
    assert.equal(second.acquired, false);
    await first.release();
    const third = await acquireInstanceLock(lockPath);
    assert.equal(third.acquired, true);
    await third.release();

    await fs.rm(dir, { recursive: true, force: true });
  }

  // 11) Dry-run não grava
  {
    const stores = createMemoryStores({ pendingList: [pending()] });
    await runDaemon(
      stores,
      seq([{ status: "SUCCESS", affiliateUrl: AFFILIATE_ML, sourceItemId: "MLB-1", validated: true }]),
      { cycles: 1, limit: 5, dryRun: true },
    );
    assert.equal(stores.applied.length, 0);
    assert.equal(stores.offers.get("offer-1")?.affiliateLink, null);
  }

  // 12) Max-per-hour respeitado (não processa além do limite)
  {
    const list = [
      pending(),
      { ...pending(), offerId: "o2", externalId: "MLB-2" },
      { ...pending(), offerId: "o3", externalId: "MLB-3" },
    ];
    const stores = createMemoryStores({ pendingList: list });
    let calls = 0;
    await runDaemon(
      stores,
      async () => {
        calls += 1;
        return { status: "SUCCESS", affiliateUrl: AFFILIATE_ML, sourceItemId: "MLB-1", validated: true };
      },
      { cycles: 1, limit: 10, maxPerHour: 2 },
    );
    assert.equal(calls, 2);
    assert.equal(stores.applied.length, 2);
  }

  // 13) CHROME_OFFLINE_FAILS_FAST: primeiro CHROME_NOT_RUNNING → interrompe ciclo
  {
    const stores = createMemoryStores({
      pendingList: [
        pending(),
        { ...pending(), offerId: "o2", externalId: "MLB-2" },
        { ...pending(), offerId: "o3", externalId: "MLB-3" },
      ],
    });
    const gen = trackingGen({ status: "CHROME_NOT_RUNNING", reason: "chrome indisponível" });
    const summaries: CycleSummary[] = [];
    await runDaemon(stores, gen, { cycles: 1, limit: 5, chromeRetryMs: 1 }, (s) =>
      summaries.push(s),
    );
    // Oferece 1 (rho) é processada; 2 e 3 NÃO são chamadas.
    assert.equal(gen.calls, 1);
    assert.equal(stores.applied.length, 0);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].chromeOfflineCount, 1);
  }

  // 14) AUTH_REQUIRED_FAILS_FAST
  {
    const stores = createMemoryStores({
      pendingList: [
        pending(),
        { ...pending(), offerId: "o2", externalId: "MLB-2" },
        { ...pending(), offerId: "o3", externalId: "MLB-3" },
      ],
    });
    const gen = trackingGen({ status: "AUTH_REQUIRED", reason: "autentique" });
    const summaries: CycleSummary[] = [];
    await runDaemon(stores, gen, { cycles: 1, limit: 5, authRetryMs: 1 }, (s) =>
      summaries.push(s),
    );
    assert.equal(gen.calls, 1);
    assert.equal(stores.applied.length, 0);
    assert.equal(summaries[0].authCount, 1);
  }

  // 15) SINGLE_RUN_DOES_NOT_SLEEP_RETRY_INTERVAL
  {
    const stores = createMemoryStores({ pendingList: [pending()] });
    const gen = trackingGen({ status: "CHROME_NOT_RUNNING", reason: "chrome indisponível" });
    const started = Date.now();
    await runDaemon(stores, gen, {
      cycles: 1,
      limit: 5,
      singleRun: true,
      chromeRetryMs: 60_000, // não deve ser dormido em single-run
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `single-run não deve dormir retry; levou ${elapsed}ms`);
  }

  // 16) PENDING_ITEMS_PRESERVED_ON_GLOBAL_PAUSE
  {
    const stores = createMemoryStores({
      pendingList: [
        pending(),
        { ...pending(), offerId: "o2", externalId: "MLB-2" },
      ],
    });
    await runDaemon(
      stores,
      trackingGen({ status: "AUTH_REQUIRED", reason: "autentique" }),
      { cycles: 1, limit: 5, authRetryMs: 1 },
    );
    // Nada foi aplicado → todas as pendências preservadas.
    assert.equal(stores.applied.length, 0);
    assert.equal(stores.pendingCount, 2);
  }

  console.log("ML_AFFILIATE_DAEMON_TEST_OK");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
