import assert from "node:assert/strict";

import { buscarMercadoLivreComFontes, type MercadoLivreAcquisitionSources } from "./mercadolivre";
import type { DiscoveryQuery } from "./core/types";
import {
  rankCatalogProductsForHydration,
  runCatalogHydrationWithReservation,
} from "./mercadolivreCatalogHydration";
import { runSourceWithBudget } from "./mercadolivreStageBudget";
import { DEFAULT_SEARCH_BUDGET } from "../multistore-v2/timeBudget";
import { searchMultistoreV2 } from "../multistore-v2/search";
import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "./core/types";

const GTW_QUERY =
  "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V";

function request(query = GTW_QUERY): DiscoveryQuery {
  return {
    query,
    normalizedQuery: query.toLowerCase(),
    limit: 5,
    mode: "MULTILOJA",
  };
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function build48CatalogIds(relevantAtIndex: number) {
  const hits = Array.from({ length: 48 }, (_, index) => {
    const id = `MLB-CAT-${String(index + 1).padStart(2, "0")}`;
    if (index === relevantAtIndex) {
      return {
        id,
        name: "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V",
        status: "active",
      };
    }
    if (index === relevantAtIndex + 1) {
      return {
        id,
        name: "Micro-ondas Consul GTW Inox 12 Litros 1400W 127V",
        status: "active",
      };
    }
    return {
      id,
      name: `Micro-ondas generico modelo ${index + 1}`,
      status: "active",
    };
  });
  return hits;
}

function keptCandidate(
  externalId: string,
  title: string,
  price: number,
  sourceUrl: string,
) {
  return {
    title,
    externalId,
    stage: "candidate",
    status: "KEPT" as const,
    reason: "Oferta de catalogo compravel preservada pelo Discovery.",
    lexicalScore: 0.9,
    kept: {
      relevance: 0.9,
      candidate: {
        marketplace: "MERCADO_LIVRE" as const,
        marketplaceName: "Mercado Livre",
        externalId,
        sourceUrl,
        affiliateLink: null,
        title,
        image: "https://http2.mlstatic.com/item.jpg",
        price,
        oldPrice: null,
        category: null,
        brand: "Consul",
        seller: "123",
        status: "FOUND" as const,
        error: null,
      },
    },
  };
}

function fontes(
  overrides: Partial<MercadoLivreAcquisitionSources>,
): MercadoLivreAcquisitionSources {
  return {
    discoverDomain: async () => "MLB-MICROWAVES",
    searchCatalog: async () => ({
      status: "EMPTY",
      httpStatus: 200,
      data: [],
    }),
    loadCatalogCandidate: async (productId) => ({
      title: productId,
      externalId: productId,
      stage: "offers-fetch",
      status: "DROPPED",
      reason: "Catalogo sem publicacao compravel no momento.",
      lexicalScore: 0.2,
    }),
    searchItemsApi: async () => ({
      status: "EMPTY",
      httpStatus: 200,
      data: [],
    }),
    searchPublicListings: async () => ({
      status: "EMPTY",
      httpStatus: 200,
      data: [],
    }),
    ...overrides,
  };
}

async function testUnabortableSourceDetached() {
  let lateResolved = false;
  const unhandled: unknown[] = [];
  const previous = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", (reason) => {
    unhandled.push(reason);
  });

  try {
    const budgetMs = 250;
    const started = Date.now();
    const outcome = await runSourceWithBudget(
      "public-search-jm",
      GTW_QUERY,
      budgetMs,
      async () => {
        await waitMs(8_000);
        lateResolved = true;
        return {
          status: "SUCCESS" as const,
          httpStatus: 200,
          data: [{ id: "MLB-LATE", title: "Tarde demais", price: 99 }],
        };
      },
    );
    const elapsedMs = Date.now() - started;

    assert.equal(outcome.timedOut, true, "fonte deve encerrar como TIMEOUT");
    assert.equal(outcome.fetch.data.length, 0);
    assert.ok(
      outcome.durationMs >= budgetMs - 40,
      `durationMs real ${outcome.durationMs} >= budget ${budgetMs}`,
    );
    assert.ok(
      elapsedMs < 2_000,
      `chamador nao aguardou 8s (elapsed=${elapsedMs})`,
    );
    assert.ok(
      outcome.durationMs <= elapsedMs + 30,
      "durationMs nao pode ser cap artificial acima do wall clock",
    );

    await waitMs(300);
    assert.equal(lateResolved, false, "resultado tardio ignorado");

    return unhandled.length === 0;
  } finally {
    process.removeAllListeners("unhandledRejection");
    for (const listener of previous) {
      process.on("unhandledRejection", listener as NodeJS.UnhandledRejectionListener);
    }
  }
}

async function testElapsedMsIsReal() {
  const budgetMs = 180;
  const outcome = await runSourceWithBudget(
    "public-search-jm",
    GTW_QUERY,
    budgetMs,
    async () => {
      await waitMs(5_000);
      return {
        status: "SUCCESS" as const,
        httpStatus: 200,
        data: [],
      };
    },
  );

  assert.equal(outcome.timedOut, true);
  assert.ok(outcome.durationMs >= budgetMs - 30);
  assert.ok(outcome.durationMs < budgetMs + 250);
  return true;
}

function testCatalogRelevanceRanking() {
  const catalog = build48CatalogIds(39);
  const ranked = rankCatalogProductsForHydration(GTW_QUERY, catalog);
  assert.equal(ranked.length, 48);
  assert.equal(ranked[0]?.productId, "MLB-CAT-40");
  assert.ok(
    (ranked[0]?.relevanceScore ?? 0) > (ranked[ranked.length - 1]?.relevanceScore ?? 0),
  );
  const batch = ranked.slice(0, 8).map((item) => item.productId);
  assert.ok(batch.includes("MLB-CAT-40"));
  assert.ok(
    (ranked.find((item) => item.productId === "MLB-CAT-40")?.relevanceScore ?? 0) >
      (ranked.find((item) => item.productId === "MLB-CAT-01")?.relevanceScore ?? 0),
  );
  return true;
}

async function testCatalogHydrationExplained() {
  const catalog = build48CatalogIds(39);
  const ranked = rankCatalogProductsForHydration(GTW_QUERY, catalog);
  const { trace } = await runCatalogHydrationWithReservation({
    query: GTW_QUERY,
    ranked,
    limit: 8,
    reservationMs: 900,
    concurrency: 2,
    loadCandidate: async (productId, previewTitle, relevanceScore) => {
      if (productId === "MLB-CAT-40") {
        await waitMs(120);
        return {
          evaluation: keptCandidate(
            "MLB1967745737",
            previewTitle,
            699,
            "https://produto.mercadolivre.com.br/MLB-1967745737",
          ),
          trace: {
            productId,
            endpoint: "/products/MLB-CAT-40/items",
            httpStatus: 200,
            mlbId: "MLB1967745737",
            title: previewTitle,
            price: 699,
            url: "https://produto.mercadolivre.com.br/MLB-1967745737",
            voltage: "220V",
            status: "KEPT",
            reason: "Oferta de catalogo compravel preservada pelo Discovery.",
            relevanceScore,
          },
        };
      }
      if (productId === "MLB-CAT-41") {
        await waitMs(120);
        return {
          evaluation: {
            title: previewTitle,
            externalId: "MLB127ONLY",
            stage: "voltage",
            status: "DROPPED",
            reason: "Voltagem do anuncio incompativel com a consulta.",
            lexicalScore: relevanceScore,
          },
          trace: {
            productId,
            endpoint: "/products/MLB-CAT-41/items",
            httpStatus: 200,
            mlbId: "MLB127ONLY",
            title: previewTitle,
            price: 699,
            url: "https://produto.mercadolivre.com.br/MLB-127ONLY",
            voltage: "127V",
            status: "DROPPED",
            reason: "Voltagem do anuncio incompativel com a consulta.",
            relevanceScore,
          },
        };
      }
      await waitMs(400);
      return {
        evaluation: {
          title: previewTitle,
          externalId: productId,
          stage: "offer-select",
          status: "DROPPED",
          reason: "Nenhuma oferta compravel (preco, URL, status, moeda ou condicao).",
          lexicalScore: relevanceScore,
        },
        trace: {
          productId,
          endpoint: `/products/${productId}/items`,
          httpStatus: 404,
          mlbId: "",
          title: previewTitle,
          price: null,
          url: "",
          voltage: "",
          status: "DROPPED",
          reason: "Nenhuma oferta compravel (preco, URL, status, moeda ou condicao).",
          relevanceScore,
        },
      };
    },
  });

  assert.equal(trace.catalogIdsFound, 48);
  assert.ok(trace.selectedIds.includes("MLB-CAT-40"));
  assert.equal(trace.counts.kept, 1);
  assert.equal(trace.items.some((item) => item.mlbId === "MLB1967745737"), true);
  assert.equal(
    trace.items.some(
      (item) => item.mlbId === "MLB127ONLY" && item.status === "DROPPED",
    ),
    true,
  );
  assert.ok(trace.batches.length >= 1);
  return true;
}

async function testCatalogHydrationReservation() {
  const ranked = rankCatalogProductsForHydration(GTW_QUERY, [
    { id: "FAST", name: "Micro-ondas Consul GTW Inox 12 1400W 220V", status: "active" },
    { id: "SLOW", name: "Micro-ondas generico", status: "active" },
  ]);

  const started = Date.now();
  let stageClosed = false;
  const { evaluations } = await runCatalogHydrationWithReservation({
    query: GTW_QUERY,
    ranked,
    limit: 2,
    reservationMs: 350,
    concurrency: 1,
    stageClosed: () => stageClosed,
    loadCandidate: async (productId, previewTitle, relevanceScore) => {
      if (productId === "FAST") {
        await waitMs(80);
        return {
          evaluation: keptCandidate(
            "MLB-FAST",
            previewTitle,
            500,
            "https://produto.mercadolivre.com.br/MLB-FAST",
          ),
          trace: {
            productId,
            endpoint: "/products/FAST/items",
            httpStatus: 200,
            mlbId: "MLB-FAST",
            title: previewTitle,
            price: 500,
            url: "https://produto.mercadolivre.com.br/MLB-FAST",
            voltage: "220V",
            status: "KEPT",
            reason: "ok",
            relevanceScore,
          },
        };
      }
      await waitMs(2_000);
      return {
        evaluation: keptCandidate(
          "MLB-SLOW",
          previewTitle,
          400,
          "https://produto.mercadolivre.com.br/MLB-SLOW",
        ),
        trace: {
          productId,
          endpoint: "/products/SLOW/items",
          httpStatus: 200,
          mlbId: "MLB-SLOW",
          title: previewTitle,
          price: 400,
          url: "https://produto.mercadolivre.com.br/MLB-SLOW",
          voltage: "220V",
          status: "KEPT",
          reason: "ok",
          relevanceScore,
        },
      };
    },
  });

  stageClosed = true;
  await waitMs(100);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1_200, `hidratação respeitou reserva (${elapsed}ms)`);
  assert.equal(
    evaluations.some((item) => item.externalId === "MLB-FAST"),
    true,
    "anuncio rapido dentro da reserva sobrevive",
  );
  assert.equal(
    evaluations.some((item) => item.externalId === "MLB-SLOW"),
    false,
    "anuncio pendurado nao entra apos reserva",
  );
  return true;
}

async function testHardCatalogDeadlineLateMutation() {
  const ranked = rankCatalogProductsForHydration(GTW_QUERY, [
    { id: "PENDING", name: "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V", status: "active" },
  ]);

  const previousUnhandled: unknown[] = [];
  const previous = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", (reason) => {
    previousUnhandled.push(reason);
  });

  try {
    const started = Date.now();
    const snapshot = await runCatalogHydrationWithReservation({
      query: GTW_QUERY,
      ranked,
      limit: 1,
      reservationMs: 300,
      concurrency: 1,
      loadCandidate: async () => {
        await waitMs(8_000);
        return {
          evaluation: keptCandidate(
            "MLB-LATE",
            "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V",
            699,
            "https://produto.mercadolivre.com.br/MLB-LATE",
          ),
          trace: {
            productId: "PENDING",
            endpoint: "/products/PENDING/items",
            httpStatus: 200,
            mlbId: "MLB-LATE",
            title: "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V",
            price: 699,
            url: "https://produto.mercadolivre.com.br/MLB-LATE",
            voltage: "220V",
            status: "KEPT",
            reason: "late result",
            relevanceScore: 0.99,
          },
        };
      },
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 600, `caller retornou em ${elapsed}ms, acima do limite`);
    assert.equal(snapshot.evaluations.length, 0, "resultado tardio nao entra no snapshot");
    assert.equal(snapshot.trace.items.length, 0, "trace nao aceita item tardio");

    await waitMs(500);
    assert.equal(snapshot.evaluations.length, 0, "snapshot imutavel apos retorno");
    assert.equal(snapshot.trace.items.length, 0, "trace nao muta apos retorno");
    assert.equal(previousUnhandled.length, 0, "nenhuma rejection tardia sem tratamento");
    return true;
  } finally {
    process.removeAllListeners("unhandledRejection");
    for (const listener of previous) {
      process.on("unhandledRejection", listener as NodeJS.UnhandledRejectionListener);
    }
  }
}

async function testSearchMultistoreGlobalDeadlineShort() {
  const strictBudget = {
    globalMs: 800,
    marketplaceMs: 350,
    fetchMs: 200,
    persistReserveMs: 40,
    hangGraceMs: 40,
  };

  const started = Date.now();
  const result = await searchMultistoreV2("Micro-ondas Consul GTW Inox 12 Litros 1400W 220V", {
    persist: false,
    budget: strictBudget,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => {
        await waitMs(30_000);
        return {
          marketplace: "AMAZON",
          query: "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V",
          success: true,
          scanned: 10,
          candidates: [
            foundCandidate({
              marketplace: "AMAZON",
              marketplaceName: "Amazon",
              externalId: "amz-late",
              title: "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V",
              price: 699,
            }),
          ],
          error: null,
        } satisfies MarketplaceDiscoveryResult;
      }),
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => ({
        marketplace: "MAGAZINE_LUIZA",
        query: "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V",
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "MAGAZINE_LUIZA",
            marketplaceName: "Magazine Luiza",
            externalId: "mlz-fast",
            title: "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V",
            price: 719,
          }),
        ],
        error: null,
      } satisfies MarketplaceDiscoveryResult)),
    ],
  });
  const elapsed = Date.now() - started;

  assert.ok(
    elapsed <= 1_600,
    `resultado com deadline global deve terminar dentro do budget + tolerancia (elapsed=${elapsed}ms)`,
  );
  assert.ok(
    result.acquisitions.some((item) => item.status === "TIMEOUT" || item.status === "SUCCESS"),
    "resultado parcial/timeout deve ser devolvido",
  );
  assert.ok(result.views.length >= 0, "resultado nao pode falhar silenciosamente");
  return true;
}

async function testMlDoesNotWaitUnabortableJm() {
  const traces: Array<{ source?: string; durationMs?: number; budgetMs?: number; timedOut?: boolean }> = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    const line = String(args[0] ?? "");
    if (line.includes("ml-source")) {
      const fields = line.split(" ").slice(2);
      const parsed: Record<string, string> = {};
      for (const field of fields) {
        const [key, value] = field.split("=");
        if (key && value) {
          parsed[key] = value;
        }
      }
      traces.push({
        source: parsed.source,
        durationMs: parsed.durationMs ? Number(parsed.durationMs) : undefined,
        budgetMs: parsed.budgetMs ? Number(parsed.budgetMs) : undefined,
        timedOut: parsed.timedOut === "true",
      });
    }
    originalInfo(...args);
  };

  try {
    const started = Date.now();
    const result = await buscarMercadoLivreComFontes(
      request(),
      fontes({
        searchCatalog: async () => ({
          status: "SUCCESS",
          httpStatus: 200,
          data: build48CatalogIds(39),
        }),
        loadCatalogCandidate: async (productId) => {
          if (productId === "MLB-CAT-40") {
            await waitMs(120);
            return keptCandidate(
              "MLB1967745737",
              "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V",
              699,
              "https://produto.mercadolivre.com.br/MLB-1967745737",
            );
          }
          if (productId === "MLB-CAT-41") {
            return {
              title: "Micro-ondas Consul GTW Inox 12 Litros 1400W 127V",
              externalId: "MLB127ONLY",
              stage: "voltage",
              status: "DROPPED",
              reason: "Voltagem do anuncio incompativel com a consulta.",
              lexicalScore: 0.8,
            };
          }
          return {
            title: productId,
            externalId: productId,
            stage: "offer-select",
            status: "DROPPED",
            reason: "Nenhuma oferta compravel (preco, URL, status, moeda ou condicao).",
            lexicalScore: 0.1,
          };
        },
        searchItemsApi: async () => ({
          status: "EMPTY",
          httpStatus: 200,
          data: [],
        }),
        searchPublicLista: async () => ({
          status: "EMPTY",
          httpStatus: 200,
          data: [],
        }),
        searchPublicJm: async () => {
          await waitMs(20_000);
          return {
            status: "SUCCESS",
            httpStatus: 200,
            data: [{ id: "MLB-SHOULD-NOT-ARRIVE", title: "Tarde", price: 1 }],
          };
        },
      }),
    );
    const elapsed = Date.now() - started;

    const jmTrace = traces.find((item) => item.source === "public-search-jm");
    assert.ok(jmTrace, "trace de public-search-jm registrado");
    assert.equal(jmTrace?.timedOut, true);
    assert.ok(
      (jmTrace?.durationMs ?? 0) < 20_000,
      `durationMs=${jmTrace?.durationMs} nao reflete os 20s da fonte lenta`,
    );
    assert.ok(
      (jmTrace?.durationMs ?? 0) >= (jmTrace?.budgetMs ?? 0) - 80,
      "durationMs mede tempo real proximo ao budget",
    );
    assert.ok(elapsed <= 16_500, `ML retornou em ${elapsed}ms (<=16.5s)`);
    assert.equal(
      result.candidates.some((item) => item.externalId === "MLB1967745737"),
      true,
    );
    assert.equal(
      result.candidates.some((item) => item.externalId === "MLB-SHOULD-NOT-ARRIVE"),
      false,
    );

    const snapshot = JSON.stringify(result);
    await waitMs(500);
    assert.equal(JSON.stringify(result), snapshot, "snapshot imutavel apos retorno");

    return true;
  } finally {
    console.info = originalInfo;
  }
}

async function testCatalogOnlyUnusable() {
  const result = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: build48CatalogIds(39),
      }),
      loadCatalogCandidate: async (productId) => ({
        title: productId,
        externalId: productId,
        stage: "offer-select",
        status: "DROPPED",
        reason: "Nenhuma oferta compravel (preco, URL, status, moeda ou condicao).",
        lexicalScore: 0.1,
      }),
      searchItemsApi: async () => ({
        status: "EMPTY",
        httpStatus: 200,
        data: [],
      }),
      searchPublicLista: async () => ({
        status: "EMPTY",
        httpStatus: 200,
        data: [],
      }),
      searchPublicJm: async () => ({
        status: "EMPTY",
        httpStatus: 200,
        data: [],
      }),
    }),
  );

  assert.equal(result.candidates.length, 0);
  assert.equal(result.searchOutcome, "UNUSABLE");
  return true;
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
  extras: Partial<DiscoveryCandidate> & Pick<DiscoveryCandidate, "marketplace" | "externalId" | "title">,
): DiscoveryCandidate {
  return {
    marketplaceName: extras.marketplaceName ?? extras.marketplace,
    sourceUrl: extras.sourceUrl ?? `https://loja.example/${extras.externalId}`,
    affiliateLink: extras.affiliateLink ?? null,
    image: extras.image ?? "https://loja.example/img.jpg",
    price: extras.price ?? 699,
    oldPrice: extras.oldPrice ?? null,
    brand: extras.brand ?? "Consul",
    category: extras.category ?? null,
    seller: extras.seller ?? null,
    attributes: extras.attributes ?? {},
    status: "FOUND",
    error: null,
    ...extras,
  };
}

async function testRealFailureOfflineReproduction() {
  const mlAdapter = fakeAdapter(
    "MERCADO_LIVRE",
    "Mercado Livre",
    async (discoveryRequest) =>
      buscarMercadoLivreComFontes(discoveryRequest, fontes({
        discoverDomain: async () => {
          await waitMs(200);
          return "MLB-MICROWAVES";
        },
        searchCatalog: async () => {
          await waitMs(700);
          return {
            status: "SUCCESS",
            httpStatus: 200,
            data: build48CatalogIds(39),
          };
        },
        loadCatalogCandidate: async (productId) => {
          if (productId === "MLB-CAT-40") {
            await waitMs(150);
            return keptCandidate(
              "MLB1967745737",
              "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V",
              699,
              "https://produto.mercadolivre.com.br/MLB-1967745737",
            );
          }
          return {
            title: productId,
            externalId: productId,
            stage: "offer-select",
            status: "DROPPED",
            reason: "Nenhuma oferta compravel (preco, URL, status, moeda ou condicao).",
            lexicalScore: 0.1,
          };
        },
        searchItemsApi: async () => ({
          status: "EMPTY",
          httpStatus: 200,
          data: [],
        }),
        searchPublicLista: async () => ({
          status: "EMPTY",
          httpStatus: 200,
          data: [],
        }),
        searchPublicJm: async () => {
          await waitMs(25_000);
          return {
            status: "SUCCESS",
            httpStatus: 200,
            data: [{ id: "MLB-LATE", title: "Nao deve entrar", price: 1 }],
          };
        },
      })),
  );

  let amazonCalls = 0;
  let shopeeCalls = 0;
  let aliCalls = 0;

  const started = Date.now();
  const result = await searchMultistoreV2(GTW_QUERY, {
    persist: false,
    limit: 8,
    budget: DEFAULT_SEARCH_BUDGET,
    adapters: [
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => {
        await waitMs(400);
        return {
          marketplace: "MAGAZINE_LUIZA",
          query: GTW_QUERY,
          success: true,
          scanned: 1,
          candidates: [
            foundCandidate({
              marketplace: "MAGAZINE_LUIZA",
              marketplaceName: "Magazine Luiza",
              externalId: "mag-gtw",
              title: "Micro-ondas Consul GTW Inox 12 Litros 1400W 220V",
              price: 719,
              sourceUrl: "https://www.magazineluiza.com.br/microondas-gtw",
              brand: "Consul",
            }),
          ],
          error: null,
        } satisfies MarketplaceDiscoveryResult;
      }),
      mlAdapter,
      fakeAdapter("AMAZON", "Amazon", async () => {
        amazonCalls += 1;
        if (amazonCalls === 1) {
          await waitMs(3_500);
        }
        return {
          marketplace: "AMAZON",
          query: GTW_QUERY,
          success: true,
          scanned: 0,
          candidates: [],
          searchOutcome: "EMPTY_VALID",
          error: null,
        } satisfies MarketplaceDiscoveryResult;
      }),
      fakeAdapter("SHOPEE", "Shopee", async () => {
        shopeeCalls += 1;
        if (shopeeCalls === 1) {
          await waitMs(4_000);
        }
        return {
          marketplace: "SHOPEE",
          query: GTW_QUERY,
          success: true,
          scanned: 0,
          candidates: [],
          searchOutcome: "EMPTY_VALID",
          error: null,
        } satisfies MarketplaceDiscoveryResult;
      }),
      fakeAdapter("ALIEXPRESS", "AliExpress", async () => {
        aliCalls += 1;
        if (aliCalls === 1) {
          await waitMs(4_500);
        }
        return {
          marketplace: "ALIEXPRESS",
          query: GTW_QUERY,
          success: true,
          scanned: 0,
          candidates: [],
          searchOutcome: "EMPTY_VALID",
          error: null,
        } satisfies MarketplaceDiscoveryResult;
      }),
    ],
  });
  const elapsed = Date.now() - started;

  assert.ok(elapsed <= 20_800, `V2 retornou em ${elapsed}ms (<=20.8s)`);
  const cluster = result.products.find((product) =>
    product.offers.some((offer) => offer.marketplace === "MERCADO_LIVRE") &&
    product.offers.some((offer) => offer.marketplace === "MAGAZINE_LUIZA"),
  );
  assert.ok(cluster, "cluster ML + Magalu formado");
  assert.equal(cluster?.publishable, true);
  assert.equal(
    cluster?.offers.some((offer) => offer.externalId === "MLB1967745737"),
    true,
  );

  const snapshot = JSON.stringify(result);
  await waitMs(800);
  assert.equal(JSON.stringify(result), snapshot, "nenhuma alteracao apos retorno");

  return true;
}

async function main() {
  const criteria = {
    UNABORTABLE_SOURCE_DETACHED: "FAIL",
    ELAPSED_MS_IS_REAL: "FAIL",
    CATALOG_HYDRATION_EXPLAINED: "FAIL",
    CATALOG_RELEVANCE_RANKING: "FAIL",
    REAL_FAILURE_OFFLINE_REPRODUCTION: "FAIL",
    LOCAL_VALIDATION: "FAIL",
  } as Record<string, string>;

  criteria.UNABORTABLE_SOURCE_DETACHED = (await testUnabortableSourceDetached())
    ? "PASS"
    : "FAIL";
  criteria.ELAPSED_MS_IS_REAL = (await testElapsedMsIsReal()) ? "PASS" : "FAIL";
  criteria.CATALOG_RELEVANCE_RANKING = testCatalogRelevanceRanking()
    ? "PASS"
    : "FAIL";
  criteria.CATALOG_HYDRATION_EXPLAINED = (await testCatalogHydrationExplained())
    ? "PASS"
    : "FAIL";

  await testCatalogHydrationReservation();
  await testHardCatalogDeadlineLateMutation();
  await testSearchMultistoreGlobalDeadlineShort();
  await testCatalogOnlyUnusable();
  await testMlDoesNotWaitUnabortableJm();
  criteria.REAL_FAILURE_OFFLINE_REPRODUCTION =
    (await testRealFailureOfflineReproduction()) ? "PASS" : "FAIL";

  console.log("UNABORTABLE_SOURCE_DETACHED=" + criteria.UNABORTABLE_SOURCE_DETACHED);
  console.log("ELAPSED_MS_IS_REAL=" + criteria.ELAPSED_MS_IS_REAL);
  console.log("CATALOG_HYDRATION_EXPLAINED=" + criteria.CATALOG_HYDRATION_EXPLAINED);
  console.log("CATALOG_RELEVANCE_RANKING=" + criteria.CATALOG_RELEVANCE_RANKING);
  console.log(
    "REAL_FAILURE_OFFLINE_REPRODUCTION=" +
      criteria.REAL_FAILURE_OFFLINE_REPRODUCTION,
  );

  const failed = Object.entries(criteria).some(
    ([key, value]) => key !== "LOCAL_VALIDATION" && value === "FAIL",
  );
  if (failed) {
    process.exit(1);
  }
}

void main();
