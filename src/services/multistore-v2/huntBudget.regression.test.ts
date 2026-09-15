import assert from "node:assert/strict";

import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "@/services/discovery/core/types";
import { buildQueryCore, hasStrongProductConceptConflict } from "./queryCore";
import { buildSearchPlan, searchMultistoreV2 } from "./search";
import { DEFAULT_SEARCH_BUDGET, resolveHuntReserveMs } from "./timeBudget";

function candidate(
  marketplace: DiscoveryCandidate["marketplace"],
  externalId: string,
  title: string,
  modelNumber = "520BT",
): DiscoveryCandidate {
  return {
    marketplace,
    marketplaceName: marketplace,
    externalId,
    sourceUrl: `https://offline.example/${externalId}`,
    title,
    image: "https://offline.example/product.jpg",
    price: 199,
    oldPrice: null,
    brand: "JBL",
    category: null,
    seller: null,
    attributes: {
      modelNumber,
      color: "preto",
      diameter: "40mm",
    },
  };
}

async function selectedSeedCount(huntReserveMs: number): Promise<number> {
  const traceLines: string[] = [];
  const originalConsoleInfo = console.info;
  const seedCandidates = ["510BT", "520BT", "530BT", "540BT", "550BT"].map(
    (modelNumber) =>
      candidate(
        "AMAZON",
        `amazon-${modelNumber}`,
        `Headphone JBL Tune ${modelNumber} preto 40mm`,
        modelNumber,
      ),
  );

  console.info = (...values: unknown[]) => {
    traceLines.push(values.map(String).join(" "));
  };
  try {
    await searchMultistoreV2("Headphone JBL", {
      hunt: true,
      persist: false,
      limit: 8,
      budget: {
        ...DEFAULT_SEARCH_BUDGET,
        globalMs: 7_000,
        marketplaceMs: 1_000,
        mercadoLivreMs: 1_000,
        fetchMs: 150,
        persistReserveMs: 100,
        hangGraceMs: 25,
        huntReserveMs,
        relevanceReserveMs: 500,
      },
      adapters: [
        adapter("AMAZON", async (request) =>
          result("AMAZON", request.query, seedCandidates),
        ),
        adapter("SHOPEE", async (request) =>
          result("SHOPEE", request.query, []),
        ),
      ],
    });
  } finally {
    console.info = originalConsoleInfo;
  }

  const line = traceLines.find((item) => item.includes("hunt-seeds"));
  const selected = line?.match(/selected=(\d+)/)?.[1];
  assert.ok(line, `trace hunt-seeds existe para huntReserveMs=${huntReserveMs}`);
  assert.ok(selected, `trace hunt-seeds informa selected para huntReserveMs=${huntReserveMs}`);
  return Number(selected);
}

function result(
  marketplace: DiscoveryAdapter["marketplace"],
  query: string,
  candidates: DiscoveryCandidate[],
): MarketplaceDiscoveryResult {
  return {
    marketplace,
    query,
    success: true,
    searchOutcome: candidates.length > 0 ? "SEARCH_COMPLETED" : "EMPTY_VALID",
    candidates,
    scanned: candidates.length,
    error: null,
  };
}

function adapter(
  marketplace: DiscoveryAdapter["marketplace"],
  searcher: NonNullable<DiscoveryAdapter["searcher"]>,
): DiscoveryAdapter {
  return {
    marketplace,
    marketplaceName: marketplace,
    enabled: true,
    searcher,
  };
}

async function main(): Promise<void> {
  const ball = buildQueryCore("Bola de futebol oficial");
  assert.equal(hasStrongProductConceptConflict(ball, "Bola de futebol profissional"), false);
  for (const unrelated of [
    "Luminaria bola decorativa",
    "Chaveiro bola de futebol",
    "Cola para bola de futebol",
    "Bomba para bola manual",
    "Mordedor bola infantil",
  ]) {
    assert.equal(
      hasStrongProductConceptConflict(ball, unrelated),
      true,
      `prefiltro generico rejeita conflito de conceito: ${unrelated}`,
    );
  }
  const smartphone = buildQueryCore("Celular Samsung Galaxy A55");
  assert.equal(
    hasStrongProductConceptConflict(smartphone, "Capa de celular Galaxy A55"),
    true,
    "prefiltro tambem protege outra classe comercial sem regra por produto",
  );

  assert.equal(
    resolveHuntReserveMs({ ...DEFAULT_SEARCH_BUDGET, globalMs: 20_000 }),
    5_000,
    "o deadline de 20s reserva cinco segundos reais para hunt",
  );

  const seedTitle = "Headphone JBL Tune 520BT preto 40mm";
  const same = candidate("MAGAZINE_LUIZA", "magalu-same", seedTitle);
  const unknown = candidate("MAGAZINE_LUIZA", "magalu-unknown", "Headphone JBL Bluetooth preto");
  const different = candidate("MAGAZINE_LUIZA", "magalu-different", "Headphone JBL Tune 510BT preto");
  const initialMagaluCalls = buildSearchPlan("Headphone JBL Tune 520BT preto 40mm").length;
  const expensiveAmazonBatch = [
    candidate("AMAZON", "amazon-seed", seedTitle),
    ...Array.from({ length: 24 }, (_, index) =>
      candidate("AMAZON", `amazon-expensive-${index}`, seedTitle),
    ),
  ];
  let magaluCalls = 0;
  let shopeeCalls = 0;
  const huntQueries: string[] = [];
  const traceLines: string[] = [];
  const originalConsoleInfo = console.info;

  const startedAt = Date.now();
  console.info = (...values: unknown[]) => {
    traceLines.push(values.map(String).join(" "));
  };
  let search: Awaited<ReturnType<typeof searchMultistoreV2>>;
  try {
    search = await searchMultistoreV2("Headphone JBL Tune 520BT preto 40mm", {
    hunt: true,
    persist: false,
    limit: 8,
    budget: {
      ...DEFAULT_SEARCH_BUDGET,
      globalMs: 4_000,
      marketplaceMs: 2_000,
      mercadoLivreMs: 2_000,
      fetchMs: 250,
      persistReserveMs: 100,
      hangGraceMs: 25,
      huntReserveMs: 600,
      relevanceReserveMs: 300,
    },
    adapters: [
      adapter("AMAZON", async (request) =>
        result("AMAZON", request.query, expensiveAmazonBatch),
      ),
      adapter("SHOPEE", async (request) => {
        shopeeCalls += 1;
        if (shopeeCalls > 1) {
          huntQueries.push(request.query);
        }
        return result("SHOPEE", request.query, [
          candidate(
            "SHOPEE",
            shopeeCalls === 1 ? "shopee-initial" : "shopee-hunt",
            seedTitle,
          ),
        ]);
      }),
      adapter("MAGAZINE_LUIZA", async (request) => {
        magaluCalls += 1;
        if (magaluCalls <= initialMagaluCalls) {
          return result("MAGAZINE_LUIZA", request.query, []);
        }
        huntQueries.push(request.query);
        return result("MAGAZINE_LUIZA", request.query, [same, unknown, different]);
      }),
      adapter("MERCADO_LIVRE", async () => {
        await new Promise<void>(() => undefined);
        return result("MERCADO_LIVRE", seedTitle, []);
      }),
    ],
    });
  } finally {
    console.info = originalConsoleInfo;
  }
  const elapsed = Date.now() - startedAt;

  assert.equal(
    magaluCalls >= initialMagaluCalls,
    true,
    "a aquisicao vazia da Magalu nao impede o Hunt posterior",
  );
  assert.ok(
    traceLines.some((line) => line.includes("phase phase=RELEVANCE event=end")),
    "relevancia conclui antes do Hunt e da resposta",
  );
  assert.ok(huntQueries.length >= 1, "uma tentativa Hunt foi executada");
  const huntQuery = huntQueries[0]!;
  assert.match(huntQuery, /jbl/i);
  assert.match(huntQuery.replace(/\s/g, ""), /520bt/i);
  // Cor (preto) é atributo descritivo, não identidade dura: o Hunt não deve
  // isolar por variação de cor, então não a injeta na query compacta.
  assert.doesNotMatch(huntQuery, /preto/i);
  assert.match(huntQuery.replace(/\s/g, ""), /40mm/i);
  assert.ok(
    elapsed <= 4_250,
    `a aquisicao lenta parou antes de roubar o hunt (${elapsed}ms)`,
  );
  assert.equal(
    search.acquisitions.find((item) => item.marketplace === "MERCADO_LIVRE")?.status,
    "TIMEOUT",
    "marketplace lento respeita o corte da fase de aquisicao",
  );
  const product = search.products[0];
  assert.ok(product, "cluster Multi Loja permanece publico");
  assert.deepEqual(
    product.marketplaces.slice().sort(),
    product.marketplaces.includes("MAGAZINE_LUIZA")
      ? ["AMAZON", "MAGAZINE_LUIZA", "SHOPEE"]
      : ["AMAZON", "SHOPEE"],
    "hunt preserva as lojas cobertas no mesmo cluster",
  );
  const offerIds = new Set(product.offers.map((offer) => offer.externalId));
  assert.ok(offerIds.has("amazon-seed"));
  assert.ok(offerIds.has("shopee-initial"), "candidato ja adquirido sobrevive ao lote Amazon");
  assert.equal(shopeeCalls, 1, "Hunt nao repete loja ja representada no cluster");
  if (magaluCalls > initialMagaluCalls) {
    assert.ok(offerIds.has("magalu-same"));
  }
  assert.equal(offerIds.has("magalu-unknown"), false, "UNKNOWN nao entra no cluster durante hunt");
  assert.equal(offerIds.has("magalu-different"), false, "DIFFERENT nao entra no cluster durante hunt");

  const lowBudgetSeeds = await selectedSeedCount(900);
  const highBudgetSeeds = await selectedSeedCount(4_500);
  assert.equal(lowBudgetSeeds, 1, "pouco hunt budget seleciona poucos seeds");
  assert.ok(highBudgetSeeds > lowBudgetSeeds, "mais hunt budget permite mais seeds");
  assert.ok(highBudgetSeeds >= 2, "hunt budget amplo seleciona mais de um seed");

  console.log("hunt budget regressions: reserve, concept prefilter, strong seed, 3 stores, UNKNOWN and DIFFERENT safety passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
