import assert from "node:assert/strict";

import type { DiscoveryAdapter, DiscoveryCandidate } from "../discovery/core/types";
import { persistCanonicalProducts, persistSelectedSearchClusters, scheduleSelectedClusterPersist } from "./persist";
import { searchMultistoreV2 } from "./search";
import { searchCatalogOrDiscover } from "../search/searchCatalogOrDiscover";
import type { CanonicalProduct } from "./types";

function canonicalProduct(
  title: string,
  extras: Partial<CanonicalProduct> = {},
): CanonicalProduct {
  const clusterId = extras.clusterId ?? title.replace(/\s+/g, "-").slice(0, 24);
  return {
    clusterId,
    title,
    image: extras.image ?? "https://loja.example/img.jpg",
    description: extras.description ?? null,
    brand: extras.brand ?? "MarcaX",
    price: extras.price ?? 100,
    oldPrice: extras.oldPrice ?? null,
    primaryMarketplace: extras.primaryMarketplace ?? "Amazon",
    marketplaces: extras.marketplaces ?? ["AMAZON"],
    confidence: extras.confidence ?? 1,
    rankTier: extras.rankTier ?? 0,
    offers: extras.offers ?? [
      {
        marketplace: "AMAZON",
        marketplaceName: "Amazon",
        externalId: clusterId,
        title,
        url: `https://loja.example/${clusterId}`,
        image: "https://loja.example/img.jpg",
        price: extras.price ?? 100,
        oldPrice: null,
        brand: extras.brand ?? "MarcaX",
        affiliateLink: `https://aff.example/${clusterId}`,
        attributes: {},
        seller: null,
      },
    ],
  };
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
    affiliateLink: extras.affiliateLink ?? `https://aff.example/${extras.externalId}`,
    image: extras.image ?? "https://loja.example/img.jpg",
    price: extras.price ?? 199,
    oldPrice: extras.oldPrice ?? null,
    brand: extras.brand ?? "MarcaX",
    category: extras.category ?? null,
    seller: extras.seller ?? null,
    attributes: extras.attributes ?? {},
    status: "FOUND",
    error: null,
    ...extras,
  };
}

async function runPersistContract() {
  const thirty = Array.from({ length: 30 }, (_, index) =>
    canonicalProduct(`Headphone MarcaX ZX${100 + index}`, {
      clusterId: `cluster-${index}`,
      price: 100 + index,
    }),
  );

  let clusterAttempts = 0;
  const limited = await persistCanonicalProducts("Headphone MarcaX", thirty, {
    limit: 12,
    persistProduct: async (product) => {
      clusterAttempts += 1;
      return { id: `saved-${product.externalId}` };
    },
  });
  assert.equal(
    clusterAttempts,
    12,
    "30 clusters RELEVANT + limit 12 nao podem iniciar mais de 12 persistencias",
  );
  assert.equal(limited.filter(Boolean).length, 12);
  assert.equal(limited.length, 12);

  let expiredAttempts = 0;
  const expired = await persistCanonicalProducts("Headphone MarcaX", thirty, {
    limit: 12,
    deadline: {
      expired: () => true,
      remainingMs: () => 0,
      budget: { hangGraceMs: 40 },
    },
    persistProduct: async () => {
      expiredAttempts += 1;
      return { id: "should-not-save" };
    },
  });
  assert.equal(expiredAttempts, 0, "deadline esgotado nao inicia persistencia");
  assert.equal(expired.filter(Boolean).length, 0);

  let remaining = 1_000;
  let midAttempts = 0;
  await persistCanonicalProducts("Headphone MarcaX", thirty.slice(0, 5), {
    deadline: {
      expired: () => remaining <= 0,
      remainingMs: () => remaining,
      budget: { hangGraceMs: 0 },
    },
    persistProduct: async () => {
      midAttempts += 1;
      remaining = 0;
      return { id: `mid-${midAttempts}` };
    },
  });
  assert.equal(
    midAttempts,
    1,
    "depois que o budget acaba, nenhuma nova gravacao inicia",
  );

  const rejectedTitle = "Caixa de som MarcaX ZX100";
  const persistedTitles: string[] = [];
  const mixed = await searchMultistoreV2("Headphone MarcaX ZX100", {
    persist: true,
    limit: 12,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX ZX100",
        success: true,
        scanned: 4,
        candidates: [
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-ok",
            title: "Headphone MarcaX ZX100 Bluetooth",
            price: 199,
          }),
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-rejected",
            title: rejectedTitle,
            price: 89,
          }),
        ],
        error: null,
      })),
    ],
    persistProduct: async (product) => {
      persistedTitles.push(product.title);
      return { id: `saved-${product.externalId}` };
    },
  });
  assert.ok(mixed.products.length >= 1);
  assert.equal(
    persistedTitles.some((title) => title === rejectedTitle),
    false,
    "REJECTED nunca e persistido",
  );
  assert.ok(
    persistedTitles.every((title) => title.toLowerCase().includes("headphone")),
  );

  const hangUntilAbort = (signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 30_000);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

  const timeoutBudget = {
    globalMs: 2_500,
    marketplaceMs: 400,
    fetchMs: 250,
    persistReserveMs: 1_200,
    hangGraceMs: 40,
  };
  const timeoutTitles: string[] = [];
  const partialTimeout = await searchMultistoreV2("Headphone MarcaX ZX100", {
    persist: true,
    limit: 12,
    budget: timeoutBudget,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX ZX100",
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-fast",
            title: "Headphone MarcaX ZX100",
            price: 199,
          }),
        ],
        error: null,
      })),
      fakeAdapter("SHOPEE", "Shopee", async (request) => {
        await hangUntilAbort(request.signal);
        return {
          marketplace: "SHOPEE",
          query: request.query,
          success: false,
          scanned: 0,
          candidates: [],
          error: "ainda rodando",
        };
      }),
    ],
    persistProduct: async (product) => {
      timeoutTitles.push(product.title);
      return { id: `saved-${product.externalId}` };
    },
  });
  assert.equal(
    partialTimeout.acquisitions.find((item) => item.marketplace === "SHOPEE")?.status,
    "TIMEOUT",
  );
  assert.ok(
    partialTimeout.views.length >= 1,
    "timeout parcial de marketplace nao impede retornar candidatos validos",
  );
  assert.ok(
    timeoutTitles.length >= 1,
    "timeout parcial de marketplace nao impede persistir candidatos validos",
  );

  const thirtyLive = await searchMultistoreV2("Headphone MarcaX", {
    persist: true,
    limit: 12,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX",
        success: true,
        scanned: 30,
        candidates: Array.from({ length: 30 }, (_, index) =>
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            brand: "MarcaX",
            externalId: `amz-${index}`,
            title: `Headphone MarcaX ZX${100 + index}`,
            price: 80 + index,
          }),
        ),
        error: null,
      })),
    ],
    persistProduct: async (product) => {
      return { id: `saved-${product.externalId}` };
    },
  });
  assert.ok(thirtyLive.products.length <= 12);
  assert.ok(thirtyLive.persistedProductIds.filter(Boolean).length <= 12);

  await runAdversarialLatencyCases(thirty);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function runAdversarialLatencyCases(thirty: CanonicalProduct[]) {
  const writeDelayMs = 100;
  let caseAWrites = 0;
  const caseAStarted = Date.now();
  await persistCanonicalProducts("Headphone MarcaX", thirty, {
    limit: 12,
    persistProduct: async (product) => {
      caseAWrites += 1;
      await wait(writeDelayMs);
      return { id: `slow-${product.externalId}` };
    },
  });
  const caseAElapsed = Date.now() - caseAStarted;
  assert.equal(
    caseAWrites,
    12,
    "CASO A: 30 clusters + limit 12 inicia no maximo 12 writes mesmo com latencia de DB",
  );
  assert.ok(
    caseAElapsed >= 12 * writeDelayMs - 50,
    `CASO A: persistencia sequencial espera cada write; elapsed=${caseAElapsed}ms`,
  );
  assert.ok(
    caseAElapsed < 30 * writeDelayMs,
    `CASO A: nao percorre os 30 clusters; elapsed=${caseAElapsed}ms`,
  );
  console.log(
    `CASO A writes=${caseAWrites} elapsedMs=${caseAElapsed} sequentialFloorMs=${12 * writeDelayMs}`,
  );

  const persistBudgetMs = 80;
  const slowWriteMs = 450;
  const persistClockStarted = Date.now();
  let caseBWrites = 0;
  const caseBStarted = Date.now();
  await persistCanonicalProducts("Headphone MarcaX", thirty.slice(0, 5), {
    deadline: {
      expired: () => Date.now() - persistClockStarted >= persistBudgetMs,
      remainingMs: () =>
        Math.max(0, persistBudgetMs - (Date.now() - persistClockStarted)),
      budget: { hangGraceMs: 0 },
    },
    persistProduct: async (product) => {
      caseBWrites += 1;
      await wait(slowWriteMs);
      return { id: `over-budget-${product.externalId}` };
    },
  });
  const caseBElapsed = Date.now() - caseBStarted;
  assert.equal(
    caseBWrites,
    1,
    "CASO B: so o write ja iniciado corre; novos nao comecam",
  );
  assert.ok(
    caseBElapsed >= slowWriteMs - 40,
    `CASO B: persistCanonicalProducts espera o write alem do budget; elapsed=${caseBElapsed}ms remainingWas=${persistBudgetMs}ms`,
  );
  console.log(
    `CASO B writes=${caseBWrites} elapsedMs=${caseBElapsed} remainingAtStartMs=${persistBudgetMs} writeMs=${slowWriteMs}`,
  );

  const hang = deferred<{ id: string }>();
  let persistWriteStarted = false;
  let persistReturned = false;
  const persistHang = persistCanonicalProducts(
    "Headphone MarcaX",
    thirty.slice(0, 3),
    {
      limit: 12,
      persistProduct: async () => {
        persistWriteStarted = true;
        return hang.promise;
      },
    },
  );
  void persistHang.then(() => {
    persistReturned = true;
  });
  while (!persistWriteStarted) {
    await wait(5);
  }
  await wait(20);
  assert.equal(
    persistReturned,
    false,
    "CASO C: persistCanonicalProducts fica bloqueado enquanto saveProduct nao resolve",
  );

  let searchWriteStarted = false;
  let searchReturned = false;
  const searchHang = searchMultistoreV2("Headphone MarcaX ZX100", {
    persist: true,
    limit: 12,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX ZX100",
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-hang",
            title: "Headphone MarcaX ZX100",
            price: 199,
          }),
        ],
        error: null,
      })),
    ],
    persistProduct: async () => {
      searchWriteStarted = true;
      return hang.promise;
    },
  });
  void searchHang.then(() => {
    searchReturned = true;
  });
  while (!searchWriteStarted) {
    await wait(5);
  }
  await wait(20);
  assert.equal(
    searchReturned,
    false,
    "CASO C: searchMultistoreV2 (caminho publico) nao retorna enquanto o write iniciado nao termina",
  );

  hang.resolve({ id: "released-after-simulated-30s" });
  const [persistResult, searchResult] = await Promise.all([
    persistHang,
    searchHang,
  ]);
  assert.equal(persistReturned, true);
  assert.equal(searchReturned, true);
  assert.equal(persistResult[0], "released-after-simulated-30s");
  assert.ok(searchResult.views.length >= 1);
  console.log(
    "CASO C: write pendente bloqueia persistCanonicalProducts e searchMultistoreV2; resposta publica so sai depois do await de saveProduct",
  );

  await runAfterResponseCases();
}

async function runAfterResponseCases() {
  const hang = deferred<{ id: string }>();
  let persistCalls = 0;
  let scheduled: (() => Promise<void>) | null = null;
  const searchStarted = Date.now();
  const publicResult = await searchCatalogOrDiscover("Headphone MarcaX ZX100", 5, {
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX ZX100",
        success: true,
        scanned: 2,
        candidates: [
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-ok",
            title: "Headphone MarcaX ZX100 Bluetooth",
            price: 199,
          }),
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-rejected",
            title: "Caixa de som MarcaX ZX100",
            price: 89,
          }),
        ],
        error: null,
      })),
    ],
    persistProduct: async (product) => {
      persistCalls += 1;
      assert.equal(
        product.title.includes("Caixa de som"),
        false,
        "after() nao recebe cluster REJECTED",
      );
      return hang.promise;
    },
    schedulePersist: (task) => {
      scheduled = task;
    },
  });
  const availableMs = Date.now() - searchStarted;
  assert.ok(publicResult.products.length >= 1, "busca publica devolve resultados");
  assert.ok(
    publicResult.products[0]?.id.startsWith("v2-"),
    "resposta publica usa id efemero sem esperar Prisma",
  );
  assert.equal(persistCalls, 0, "saveProduct nao roda no caminho sincrono da busca");
  assert.ok(availableMs < 500, `resultados disponiveis em ${availableMs}ms sem esperar o write`);
  assert.ok(scheduled, "after() recebeu o trabalho de persistencia");

  let afterSettled = false;
  const afterWork = scheduled!();
  void afterWork.then(() => {
    afterSettled = true;
  });
  while (persistCalls === 0) {
    await wait(5);
  }
  await wait(20);
  assert.equal(
    afterSettled,
    false,
    "saveProduct pode continuar depois sem bloquear a resposta ja disponivel",
  );
  hang.resolve({ id: "after-saved" });
  await afterWork;
  assert.equal(afterSettled, true);
  assert.equal(persistCalls, 1);

  let scheduledCount = 0;
  const limitedPublic = await searchCatalogOrDiscover("Headphone MarcaX", 5, {
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "Headphone MarcaX",
        success: true,
        scanned: 30,
        candidates: Array.from({ length: 30 }, (_, index) =>
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            brand: "MarcaX",
            externalId: `amz-after-${index}`,
            title: `Headphone MarcaX ZX${100 + index}`,
            price: 80 + index,
          }),
        ),
        error: null,
      })),
    ],
    persistProduct: async (product) => {
      scheduledCount += 1;
      return { id: `after-${product.externalId}` };
    },
    schedulePersist: (task) => {
      scheduled = task;
    },
  });
  assert.ok(limitedPublic.products.length <= 12);
  assert.equal(scheduledCount, 0, "nenhuma persistencia duplicada no caminho sincrono");
  await scheduled!();
  assert.ok(scheduledCount <= 12, "after() recebe no maximo limit clusters");
  assert.equal(scheduledCount, limitedPublic.products.length);

  const logged = await persistSelectedSearchClusters(
    "Headphone MarcaX ZX100",
    [
      canonicalProduct("Headphone MarcaX ZX100", { clusterId: "err-1" }),
    ],
    {
      persistProduct: async () => {
        throw new Error("db down");
      },
    },
  );
  assert.equal(logged[0], "");

  let scheduleThrew = false;
  try {
    let afterTask: (() => Promise<void>) | null = null;
    scheduleSelectedClusterPersist(
      (task) => {
        afterTask = task;
      },
      "Headphone MarcaX ZX100",
      [canonicalProduct("Headphone MarcaX ZX100", { clusterId: "err-2" })],
      {
        persistProduct: async () => {
          throw new Error("db down after");
        },
      },
    );
    const pending = afterTask;
    assert.ok(pending);
    await pending();
  } catch {
    scheduleThrew = true;
  }
  assert.equal(
    scheduleThrew,
    false,
    "erro em saveProduct no trabalho pos-resposta e capturado e nao vira erro da pesquisa",
  );
}

void runPersistContract()
  .then(() => {
    console.log("multistore-v2 persist: invariantes estruturais passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
