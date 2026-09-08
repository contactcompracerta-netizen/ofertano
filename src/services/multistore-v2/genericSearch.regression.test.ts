import assert from "node:assert/strict";

import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "@/services/discovery/core/types";
import { classifyQueryMode } from "./queryIdentity";
import { extractSanitizedIdentity } from "./sanitizedIdentity";
import { hasStrongProductConceptConflict } from "./queryCore";
import { normalizeMultistoreText } from "./normalizeCandidate";
import { searchMultistoreV2 } from "./search";

function candidate(
  marketplace: DiscoveryCandidate["marketplace"],
  externalId: string,
  title: string,
  brand: string,
  modelNumber: string,
  price: number,
): DiscoveryCandidate {
  return {
    marketplace,
    marketplaceName: marketplace,
    externalId,
    sourceUrl: `https://offline.example/${externalId}`,
    title,
    image: "https://offline.example/product.jpg",
    price,
    oldPrice: null,
    brand,
    category: null,
    seller: null,
    attributes: { modelNumber, capacity: "550W" },
  };
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
  return { marketplace, marketplaceName: marketplace, enabled: true, searcher };
}

function modelFromQuery(query: string): "L-99" | "OLI" | null {
  const normalized = normalizeMultistoreText(query).replace(/\s+/g, "");
  if (normalized.includes("l99")) return "L-99";
  if (normalized.includes("oli")) return "OLI";
  return null;
}

async function main(): Promise<void> {
  const genericQueries = [
    "Liquidificador",
    "Bone",
    "Vestido evangelico",
    "Pneu aro 15 Pirelli",
    "TV 50 polegadas",
    "Furadeira Bosch",
  ];
  for (const query of genericQueries) {
    assert.equal(
      classifyQueryMode(extractSanitizedIdentity(query)),
      "GENERIC",
      `consulta de categoria permanece GENERIC: ${query}`,
    );
  }
  assert.equal(
    classifyQueryMode(extractSanitizedIdentity("WAP GTW Inox 12 1400W")),
    "SPECIFIC",
  );
  assert.equal(
    normalizeMultistoreText("Bone") === normalizeMultistoreText("Boné"),
    true,
    "accent folding trata Bone e Boné como a mesma variante",
  );

  const liquidificador = extractSanitizedIdentity("Liquidificador");
  assert.equal(
    hasStrongProductConceptConflict(liquidificador.queryCore, "Copo para liquidificador"),
    true,
    "acessorio conflitante cai no prefilter generico",
  );
  assert.equal(
    hasStrongProductConceptConflict(liquidificador.queryCore, "Liquidificador Mondial"),
    false,
  );

  const mondialAmazon = candidate(
    "AMAZON",
    "amazon-mondial",
    "Liquidificador Mondial L-99 550W",
    "Mondial",
    "L-99",
    199,
  );
  const osterAmazon = candidate(
    "AMAZON",
    "amazon-oster",
    "Liquidificador Oster OLI 550W",
    "Oster",
    "OLI",
    249,
  );
  const calls = new Map<string, number>();
  const huntQueries: string[] = [];
  const traceLines: string[] = [];
  const originalConsoleInfo = console.info;
  console.info = (...values: unknown[]) => traceLines.push(values.map(String).join(" "));

  const search = await searchMultistoreV2("Liquidificador", {
    hunt: true,
    persist: false,
    limit: 8,
    budget: {
      globalMs: 5_000,
      marketplaceMs: 900,
      mercadoLivreMs: 900,
      fetchMs: 200,
      persistReserveMs: 100,
      hangGraceMs: 25,
      huntReserveMs: 2_000,
      relevanceReserveMs: 400,
    },
    adapters: [
      adapter("AMAZON", async (request) => {
        calls.set("AMAZON", (calls.get("AMAZON") ?? 0) + 1);
        return result("AMAZON", request.query, [mondialAmazon, osterAmazon]);
      }),
      adapter("SHOPEE", async (request) => {
        calls.set("SHOPEE", (calls.get("SHOPEE") ?? 0) + 1);
        const model = modelFromQuery(request.query);
        huntQueries.push(request.query);
        if (model === "L-99") {
          return result("SHOPEE", request.query, [
            candidate("SHOPEE", "shopee-mondial", "Liquidificador Mondial L-99 550W", "Mondial", "L-99", 189),
            candidate("SHOPEE", "shopee-unknown", "Liquidificador Mondial 550W", "Mondial", "UNKNOWN", 179),
            candidate("SHOPEE", "shopee-different", "Liquidificador Mondial L-88 550W", "Mondial", "L-88", 159),
          ]);
        }
        if (model === "OLI") {
          return result("SHOPEE", request.query, [
            candidate("SHOPEE", "shopee-oster", "Liquidificador Oster OLI 550W", "Oster", "OLI", 239),
          ]);
        }
        return result("SHOPEE", request.query, []);
      }),
      adapter("MAGAZINE_LUIZA", async (request) => {
        calls.set("MAGAZINE_LUIZA", (calls.get("MAGAZINE_LUIZA") ?? 0) + 1);
        const model = modelFromQuery(request.query);
        huntQueries.push(request.query);
        if (model === "L-99") {
          return result("MAGAZINE_LUIZA", request.query, [
            candidate("MAGAZINE_LUIZA", "magalu-mondial", "Liquidificador Mondial L-99 550W", "Mondial", "L-99", 209),
          ]);
        }
        if (model === "OLI") {
          return result("MAGAZINE_LUIZA", request.query, [
            candidate("MAGAZINE_LUIZA", "magalu-oster", "Liquidificador Oster OLI 550W", "Oster", "OLI", 229),
          ]);
        }
        return result("MAGAZINE_LUIZA", request.query, []);
      }),
      adapter("MERCADO_LIVRE", async () => ({
        marketplace: "MERCADO_LIVRE",
        query: "Liquidificador",
        success: false,
        searchOutcome: "BLOCKED",
        scanned: 0,
        candidates: [],
        error: "offline blocked fixture",
      })),
    ],
  });
  console.info = originalConsoleInfo;

  assert.ok(
    huntQueries.some((query) => /mondial/i.test(query) && /l99/i.test(normalizeMultistoreText(query).replace(/\s/g, ""))),
    `hunt queries: ${huntQueries.join(" | ")} traces: ${traceLines.join(" | ")}`,
  );
  assert.ok(huntQueries.some((query) => /oster/i.test(query) || /philco/i.test(query)) || traceLines.some((line) => line.includes("hunt-seeds")));
  assert.ok((calls.get("SHOPEE") ?? 0) > 1, "o primeiro Multi Loja nao encerra o hunt global");
  assert.ok(search.products.length >= 2, "busca generica retorna varios produtos Multi Loja");

  const mondial = search.products.find((product) => product.brand?.toLowerCase() === "mondial");
  assert.ok(mondial);
  assert.deepEqual(mondial!.marketplaces.slice().sort(), ["AMAZON", "MAGAZINE_LUIZA", "SHOPEE"]);
  const offerIds = new Set(mondial!.offers.map((offer) => offer.externalId));
  assert.equal(offerIds.has("shopee-unknown"), false);
  assert.equal(offerIds.has("shopee-different"), false);
  assert.ok(search.products.every((product) => product.marketplaces.length >= 2));

  console.log("generic search regressions: modes, accent folding, seeds, multi-store continuation, prefilter and identity safety passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
