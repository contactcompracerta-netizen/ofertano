import assert from "node:assert/strict";

import {
  buscarMercadoLivreComFontes,
  type MercadoLivreAcquisitionSources,
} from "./mercadolivre";
import type { DiscoveryQuery } from "./core/types";
import {
  createMlStageBudgetClock,
  ML_HYDRATION_RESERVE_MS,
  ML_TOTAL_BUDGET_MS,
  runMlStageWithBudget,
} from "./mlStageBudget";
import {
  isMlDiagnosticTraceEnabled,
  traceMlAcquisition,
  traceMlSourceEnd,
  traceMlSourceStart,
} from "./mlAcquisitionTrace";

const QUERY = "Headphone MarcaX Wireless Rosa";

function request(query = QUERY): DiscoveryQuery {
  return {
    query,
    normalizedQuery: query.toLowerCase(),
    limit: 5,
    mode: "MULTILOJA",
  };
}

function item(input: {
  id: string;
  title: string;
  price?: number;
}) {
  return {
    id: input.id,
    title: input.title,
    price: input.price ?? 149,
    permalink: `https://produto.mercadolivre.com.br/${input.id}`,
    thumbnail: "https://http2.mlstatic.com/item.jpg",
    condition: "new",
    currency_id: "BRL",
  };
}

function fontes(
  overrides: Partial<MercadoLivreAcquisitionSources>,
): MercadoLivreAcquisitionSources {
  return {
    discoverDomain: async () => "MLB-HEADPHONES",
    searchCatalog: async () => ({
      status: "EMPTY",
      httpStatus: 200,
      data: [],
      reason: "Catalogo vazio.",
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

const listingItem = item({
  id: "MLB111222333",
  title: "Headphone MarcaX Wireless Rosa",
});

function hangForever(): Promise<never> {
  return new Promise(() => undefined);
}

async function runMlTraceCases(): Promise<void> {
  const previous = process.env.ML_DIAGNOSTIC_TRACE;
  delete process.env.ML_DIAGNOSTIC_TRACE;
  assert.equal(isMlDiagnosticTraceEnabled(), false);
  const silentLogs: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    silentLogs.push(args.map(String).join(" "));
  };
  traceMlAcquisition("ENTRY", { query: QUERY });
  traceMlSourceStart("items-api", { query: QUERY });
  traceMlSourceEnd("items-api", "TIMEOUT", { query: QUERY });
  console.info = originalInfo;
  assert.equal(
    silentLogs.filter((line) => line.includes("[ML-ACQUISITION-TRACE]")).length,
    0,
    "trace desligado nao gera ruido",
  );

  process.env.ML_DIAGNOSTIC_TRACE = "1";
  assert.equal(isMlDiagnosticTraceEnabled(), true);

  const tracedLogs: string[] = [];
  console.info = (...args: unknown[]) => {
    tracedLogs.push(args.map(String).join(" "));
  };

  let itemsApiStarted = false;
  const traced = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: async () => {
        itemsApiStarted = true;
        return {
          status: "SUCCESS",
          httpStatus: 200,
          data: [listingItem],
        };
      },
    }),
  );

  console.info = originalInfo;
  process.env.ML_DIAGNOSTIC_TRACE = previous;

  const traceLines = tracedLogs.filter((line) =>
    line.includes("[ML-ACQUISITION-TRACE]"),
  );
  assert.ok(traceLines.length > 0, "trace habilitado gera eventos");
  const entryIndex = traceLines.findIndex((line) => line.includes("ENTRY"));
  const firstSourceIndex = traceLines.findIndex((line) =>
    line.includes("SOURCE_START"),
  );
  assert.ok(entryIndex >= 0, "entrada registrada");
  assert.ok(firstSourceIndex > entryIndex, "primeiro trace antes das fontes");
  assert.ok(itemsApiStarted, "fonte externa foi chamada depois do trace inicial");
  assert.ok(
    traceLines.some((line) => line.includes("SOURCE_END") && line.includes("SUCCESS")),
    "fonte concluiu com evento terminal",
  );
  assert.ok(
    traceLines.some((line) => line.includes("EXIT")),
    "saida final registrada",
  );
  assert.equal(traced.candidates.length, 1);

  const hungLogs: string[] = [];
  process.env.ML_DIAGNOSTIC_TRACE = "1";
  console.info = (...args: unknown[]) => {
    hungLogs.push(args.map(String).join(" "));
  };
  await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: async () => hangForever(),
      searchCatalog: async () => ({
        status: "EMPTY",
        httpStatus: 200,
        data: [],
      }),
    }),
  );
  console.info = originalInfo;
  process.env.ML_DIAGNOSTIC_TRACE = previous;

  const hungTrace = hungLogs.filter((line) =>
    line.includes("[ML-ACQUISITION-TRACE]"),
  );
  assert.ok(
    hungTrace.some(
      (line) => line.includes("SOURCE_START") && line.includes("items-api"),
    ),
    "fonte pendurada registra START",
  );
  assert.ok(
    hungTrace.some(
      (line) =>
        line.includes("SOURCE_END") &&
        line.includes("items-api") &&
        line.includes("TIMEOUT"),
    ),
    "fonte pendurada registra TIMEOUT",
  );
  assert.ok(
    hungTrace.some((line) => line.includes("SOURCE_START") && line.includes("catalog")),
    "catalogo ainda recebe orcamento apos fonte pendurada",
  );

  console.log("ML_TRACE_COVERAGE=PASS");
}

async function runMlStageBudgetCases(): Promise<void> {
  const clock = createMlStageBudgetClock(ML_TOTAL_BUDGET_MS);
  assert.equal(clock.totalMs, ML_TOTAL_BUDGET_MS);
  assert.equal(
    clock.catalogBudgetMs(),
    ML_TOTAL_BUDGET_MS - ML_HYDRATION_RESERVE_MS,
    "catalogo com 16s disponiveis deve receber remainingMs - hydrationReserve",
  );
  assert.equal(
    clock.hydrationBudgetMs(),
    ML_TOTAL_BUDGET_MS,
    "tempo nao usado pelo catalogo e transferido para hidratacao",
  );

  const itemsHangCatalogRuns = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: async () => hangForever(),
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLB-CATALOG-STAGE",
            name: "Headphone MarcaX Wireless Rosa",
            status: "active",
          },
        ],
      }),
      loadCatalogCandidate: async () => ({
        title: "Headphone MarcaX Wireless Rosa",
        externalId: "MLB-CATALOG-STAGE",
        stage: "candidate",
        status: "KEPT",
        reason: "ok",
        lexicalScore: 0.9,
        kept: {
          relevance: 0.9,
          candidate: {
            marketplace: "MERCADO_LIVRE",
            marketplaceName: "Mercado Livre",
            externalId: "MLB-CATALOG-STAGE",
            sourceUrl: "https://produto.mercadolivre.com.br/MLB-CATALOG-STAGE",
            affiliateLink: null,
            title: "Headphone MarcaX Wireless Rosa",
            image: "https://http2.mlstatic.com/item.jpg",
            price: 149,
            oldPrice: null,
            category: null,
            brand: "MarcaX",
            seller: null,
            status: "FOUND",
            error: null,
          },
        },
      }),
    }),
  );
  assert.ok(
    itemsHangCatalogRuns.candidates.some(
      (entry) => entry.externalId === "MLB-CATALOG-STAGE",
    ),
    "items-api pendurada nao impede catalogo",
  );

  let publicFallbackStarted = false;
  const publicHangCatalogRuns = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: async () => ({
        status: "EMPTY",
        httpStatus: 200,
        data: [],
      }),
      searchPublicListings: async () => {
        publicFallbackStarted = true;
        return hangForever();
      },
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLB-CATALOG-PUBLIC",
            name: "Headphone MarcaX Wireless Rosa",
            status: "active",
          },
        ],
      }),
      loadCatalogCandidate: async () => ({
        title: "Headphone MarcaX Wireless Rosa",
        externalId: "MLB-CATALOG-PUBLIC",
        stage: "candidate",
        status: "KEPT",
        reason: "ok",
        lexicalScore: 0.9,
        kept: {
          relevance: 0.9,
          candidate: {
            marketplace: "MERCADO_LIVRE",
            marketplaceName: "Mercado Livre",
            externalId: "MLB-CATALOG-PUBLIC",
            sourceUrl: "https://produto.mercadolivre.com.br/MLB-CATALOG-PUBLIC",
            affiliateLink: null,
            title: "Headphone MarcaX Wireless Rosa",
            image: "https://http2.mlstatic.com/item.jpg",
            price: 149,
            oldPrice: null,
            category: null,
            brand: "MarcaX",
            seller: null,
            status: "FOUND",
            error: null,
          },
        },
      }),
    }),
  );
  assert.ok(
    publicHangCatalogRuns.candidates.some(
      (entry) => entry.externalId === "MLB-CATALOG-PUBLIC",
    ),
    "busca publica pendurada nao impede catalogo",
  );
  assert.equal(
    publicFallbackStarted,
    false,
    "HTML publico nao deve competir com catalogo que ja encontrou oferta",
  );

  const hydrationHang = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [listingItem],
      }),
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLB-CATALOG-HYDRATE",
            name: "Headphone MarcaX Wireless Rosa",
            status: "active",
          },
        ],
      }),
      loadCatalogCandidate: async () => hangForever(),
    }),
  );
  assert.ok(
    hydrationHang.candidates.some((entry) => entry.externalId === "MLB111222333"),
    "candidatos completos sobrevivem a hidratacao pendurada",
  );

  const hydrationOrder: string[] = [];
  const concurrentHydrationStartedAt = Date.now();
  const concurrentHydration = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: async () => ({
        status: "EMPTY",
        httpStatus: 200,
        data: [],
      }),
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [1, 2, 3, 4].map((index) => ({
          id: `MLB-CONCURRENT-${index}`,
          name: "Headphone MarcaX Wireless Rosa",
          status: "active",
        })),
      }),
      loadCatalogCandidate: async (productId) => {
        hydrationOrder.push(productId);
        if (productId !== "MLB-CONCURRENT-4") {
          return hangForever();
        }
        return {
          title: "Headphone MarcaX Wireless Rosa",
          externalId: "MLB-CONCURRENT-LISTING",
          stage: "candidate",
          status: "KEPT",
          reason: "oferta compravel",
          lexicalScore: 0.9,
          kept: {
            relevance: 0.9,
            candidate: {
              marketplace: "MERCADO_LIVRE",
              marketplaceName: "Mercado Livre",
              externalId: "MLB-CONCURRENT-LISTING",
              sourceUrl:
                "https://produto.mercadolivre.com.br/MLB-CONCURRENT-LISTING",
              affiliateLink: null,
              title: "Headphone MarcaX Wireless Rosa",
              image: "https://http2.mlstatic.com/item.jpg",
              price: 149,
              oldPrice: null,
              category: null,
              brand: "MarcaX",
              seller: null,
              status: "FOUND",
              error: null,
            },
          },
        };
      },
    }),
  );
  assert.ok(
    hydrationOrder.includes("MLB-CONCURRENT-4"),
    "IDs seguintes nao podem ficar bloqueados pelo primeiro produto pendurado",
  );
  assert.ok(
    concurrentHydration.candidates.some(
      (entry) => entry.externalId === "MLB-CONCURRENT-LISTING",
    ),
    "primeira oferta compravel concluida em paralelo e preservada",
  );
  assert.ok(
    Date.now() - concurrentHydrationStartedAt < 1_000,
    "hidratacao encerra ao obter candidato utilizavel",
  );

  const vacuumQuery =
    "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V";
  let bulkHydrationStarted = false;
  const bulkCatalogStartedAt = Date.now();
  const bulkCatalog = await buscarMercadoLivreComFontes(
    {
      ...request(vacuumQuery),
      normalizedQuery: vacuumQuery,
      limit: 8,
    },
    fontes({
      discoverDomain: async () => null,
      searchItemsApi: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "items-api bloqueada",
      }),
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: Array.from({ length: 29 }, (_, index) => ({
          id: `MLB-BULK-${index}`,
          name:
            index === 0
              ? vacuumQuery
              : `Produto de catalogo generico modelo ${index}`,
          status: "active",
        })),
      }),
      loadCatalogCandidate: async (productId) => {
        bulkHydrationStarted = true;
        if (productId !== "MLB-BULK-0") {
          return {
            title: productId,
            externalId: productId,
            stage: "offers-fetch",
            status: "DROPPED",
            reason: "nao equivalente",
            lexicalScore: 0,
          };
        }
        return {
          title: vacuumQuery,
          externalId: productId,
          stage: "candidate",
          status: "KEPT",
          reason: "oferta compravel",
          lexicalScore: 1,
          kept: {
            relevance: 1,
            candidate: {
              marketplace: "MERCADO_LIVRE",
              marketplaceName: "Mercado Livre",
              externalId: productId,
              sourceUrl: `https://produto.mercadolivre.com.br/${productId}`,
              affiliateLink: null,
              title: vacuumQuery,
              image: "https://http2.mlstatic.com/item.jpg",
              price: 299,
              oldPrice: null,
              category: null,
              brand: "Wap",
              seller: null,
              status: "FOUND",
              error: null,
            },
          },
        };
      },
    }),
  );
  const bulkCatalogElapsedMs = Date.now() - bulkCatalogStartedAt;
  assert.equal(bulkHydrationStarted, true, "lote ranqueado chega a hidratacao");
  assert.ok(
    bulkCatalog.candidates.some(
      (entry) => entry.externalId === "MLB-BULK-0",
    ),
    "oferta relevante do lote de catalogo e preservada",
  );
  assert.ok(
    bulkCatalogElapsedMs < 2_000,
    `ranking de 29 IDs nao bloqueia o event loop (${bulkCatalogElapsedMs}ms)`,
  );
  console.log(
    `CATALOG_RANKING_BOUNDED=PASS elapsedMs=${bulkCatalogElapsedMs}`,
  );

  let variantCalls = 0;
  const variantBudget = await buscarMercadoLivreComFontes(
    request("Headphone MarcaX"),
    fontes({
      searchItemsApi: async () => ({
        status: "EMPTY",
        httpStatus: 200,
        data: [],
      }),
      searchPublicListings: async (queryText) => {
        variantCalls += 1;
        if (queryText === "Headphone MarcaX") {
          return {
            status: "EMPTY",
            httpStatus: 200,
            data: [],
          };
        }
        if (variantCalls === 2) {
          return {
            status: "EMPTY",
            httpStatus: 200,
            data: [],
          };
        }
        return {
          status: "SUCCESS",
          httpStatus: 200,
          data: [listingItem],
        };
      },
    }),
  );
  assert.ok(variantCalls >= 3, "segunda variante ainda recebe orcamento");
  assert.equal(variantBudget.searchOutcome, "SEARCH_COMPLETED");

  const started = Date.now();
  const allFail = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: async () => hangForever(),
      searchPublicListings: async () => hangForever(),
      searchCatalog: async () => hangForever(),
      discoverDomain: async () => hangForever(),
    }),
  );
  const elapsed = Date.now() - started;
  assert.ok(
    elapsed <= ML_TOTAL_BUDGET_MS + 1_500,
    `todas as fontes falham dentro de ${ML_TOTAL_BUDGET_MS}ms (${elapsed}ms)`,
  );
  assert.notEqual(allFail.searchOutcome, "EMPTY_VALID");
  assert.equal(allFail.candidates.length, 0);

  const dynamicCatalog = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          status: "EMPTY",
          httpStatus: 200,
          data: [],
        };
      },
      searchCatalog: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_500));
        return {
          status: "SUCCESS",
          httpStatus: 200,
          data: [
            {
              id: "MLB-DYNAMIC-CATALOG",
              name: "Headphone MarcaX Wireless Rosa",
              status: "active",
            },
          ],
        };
      },
      loadCatalogCandidate: async () => ({
        title: "Headphone MarcaX Wireless Rosa",
        externalId: "MLB-DYNAMIC-CATALOG",
        stage: "candidate",
        status: "KEPT",
        reason: "ok",
        lexicalScore: 0.9,
        kept: {
          relevance: 0.9,
          candidate: {
            marketplace: "MERCADO_LIVRE",
            marketplaceName: "Mercado Livre",
            externalId: "MLB-DYNAMIC-CATALOG",
            sourceUrl: "https://produto.mercadolivre.com.br/MLB-DYNAMIC-CATALOG",
            affiliateLink: null,
            title: "Headphone MarcaX Wireless Rosa",
            image: "https://http2.mlstatic.com/item.jpg",
            price: 149,
            oldPrice: null,
            category: null,
            brand: "MarcaX",
            seller: null,
            status: "FOUND",
            error: null,
          },
        },
      }),
    }),
  );
  assert.ok(
    dynamicCatalog.candidates.some(
      (entry) => entry.externalId === "MLB-DYNAMIC-CATALOG",
    ),
    "catalogo lento ainda completa com orcamento dinamico transferido",
  );

  let releaseCatalog: (() => void) | undefined;
  const catalogStarted = Date.now();
  const catalogBudgetProbe = createMlStageBudgetClock(ML_TOTAL_BUDGET_MS);
  const catalogProbe = runMlStageWithBudget(
    catalogBudgetProbe.catalogBudgetMs(),
    undefined,
    async () => {
      await new Promise<void>((resolve) => {
        releaseCatalog = resolve;
      });
      return "ok";
    },
  );
  assert.ok(
    catalogBudgetProbe.catalogBudgetMs() >= 12_500,
    `catalogo comeca com ~13s (${catalogBudgetProbe.catalogBudgetMs()}ms)`,
  );
  releaseCatalog?.();
  await catalogProbe;
  assert.ok(Date.now() - catalogStarted < 1_000);

  console.log("DYNAMIC_ML_BUDGET_TRANSFER=PASS");
}

void runMlTraceCases()
  .then(() => runMlStageBudgetCases())
  .then(() => {
    console.log("mlAcquisitionDiagnostics.test.ts: todos os casos passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
