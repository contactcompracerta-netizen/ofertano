import assert from "node:assert/strict";

import {
  buildMlAcquisitionStagePlan,
  buscarMercadoLivreComFontes,
  type MercadoLivreAcquisitionSources,
} from "./mercadolivre";
import type { DiscoveryQuery } from "./core/types";

const ASPIRADOR =
  "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V";
const NOTEBOOK =
  "Notebook MarcaX Pro 16GB SSD 512GB Intel Core i7 - 15.6 polegadas";

function fontes(
  onStage?: (stage: string) => void,
): MercadoLivreAcquisitionSources {
  const wrap =
    <T,>(stage: string, run: () => Promise<T>) =>
    async () => {
      onStage?.(stage);
      return run();
    };

  return {
    discoverDomain: wrap("domain", async () => "MLB-GENERIC"),
    searchCatalog: wrap("catalog", async () => ({
      status: "EMPTY",
      httpStatus: 200,
      data: [],
    })),
    loadCatalogCandidate: wrap("hydration", async (productId) => ({
      title: productId,
      externalId: productId,
      stage: "offers-fetch",
      status: "DROPPED",
      reason: "sem winner",
      lexicalScore: 0.2,
    })),
    searchItemsApi: wrap("items-api", async () => ({
      status: "EMPTY",
      httpStatus: 200,
      data: [],
    })),
    searchPublicListings: wrap("public-search", async () => ({
      status: "EMPTY",
      httpStatus: 200,
      data: [],
    })),
  };
}

function request(query: string): DiscoveryQuery {
  return {
    query,
    normalizedQuery: query.toLowerCase(),
    limit: 5,
    mode: "MULTILOJA",
  };
}

async function runNoCategoryAcquisitionCases(): Promise<void> {
  const sources = fontes();
  const stagePlanA = buildMlAcquisitionStagePlan(sources);
  const stagePlanB = buildMlAcquisitionStagePlan(sources);
  assert.deepEqual(
    stagePlanA,
    stagePlanB,
    "plano de etapas ML nao pode depender da categoria do produto",
  );
  assert.equal(stagePlanA.includesDomain, true);
  assert.equal(stagePlanA.includesCatalogHydration, true);
  assert.ok(stagePlanA.listingStages.includes("items-api"));

  const aspiradorStages: string[] = [];
  const notebookStages: string[] = [];

  await buscarMercadoLivreComFontes(
    request(ASPIRADOR),
    fontes((stage) => aspiradorStages.push(stage)),
  );
  await buscarMercadoLivreComFontes(
    request(NOTEBOOK),
    fontes((stage) => notebookStages.push(stage)),
  );

  assert.deepEqual(
    aspiradorStages,
    notebookStages,
    "sequencia de etapas executadas deve ser identica entre aspirador e notebook",
  );
  assert.ok(
    aspiradorStages.includes("domain"),
    "aquisicao padrao continua consultando dominio",
  );
  assert.ok(
    aspiradorStages.includes("items-api"),
    "aquisicao padrao continua consultando items-api",
  );

  console.log("NO_CATEGORY_ACQUISITION_PATCH=PASS");
}

void runNoCategoryAcquisitionCases()
  .then(() => {
    console.log("noCategoryAcquisition.test.ts: todos os casos passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
