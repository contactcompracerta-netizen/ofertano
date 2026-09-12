import assert from "node:assert/strict";

import {
  buildMlAcquisitionStagePlan,
  buscarMercadoLivreComFontes,
  type MercadoLivreAcquisitionSources,
} from "./mercadolivre";
import type { DiscoveryQuery } from "./core/types";
import { classifyQueryMode } from "../multistore-v2/queryIdentity";
import { extractSanitizedIdentity } from "../multistore-v2/sanitizedIdentity";

const STRONG_IDENTITY_ASPIRADOR =
  "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V";
const GENERIC_ASPIRADOR = "Aspirador";
const NOTEBOOK = "Notebook";

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
  const genericAspiradorStages: string[] = [];
  const notebookStages: string[] = [];

  const strongAspiradorIdentity = extractSanitizedIdentity(
    STRONG_IDENTITY_ASPIRADOR,
  );
  assert.equal(classifyQueryMode(strongAspiradorIdentity), "SPECIFIC");
  assert.equal(strongAspiradorIdentity.queryCore.hasStrongIdentity, true);
  assert.deepEqual(strongAspiradorIdentity.queryCore.modelTokens, ["gtw12"]);
  assert.deepEqual(
    strongAspiradorIdentity.queryCore.identityAnchors.map(
      (anchor) => anchor.value,
    ),
    ["gtw", "gtw12"],
  );

  const genericAspiradorIdentity = extractSanitizedIdentity(GENERIC_ASPIRADOR);
  assert.equal(classifyQueryMode(genericAspiradorIdentity), "GENERIC");
  assert.equal(genericAspiradorIdentity.queryCore.hasStrongIdentity, false);
  assert.deepEqual(genericAspiradorIdentity.queryCore.modelTokens, []);
  assert.deepEqual(genericAspiradorIdentity.queryCore.identityAnchors, []);

  const notebookIdentity = extractSanitizedIdentity(NOTEBOOK);
  assert.equal(classifyQueryMode(notebookIdentity), "GENERIC");
  assert.equal(notebookIdentity.queryCore.hasStrongIdentity, false);
  assert.deepEqual(notebookIdentity.queryCore.modelTokens, []);
  assert.deepEqual(notebookIdentity.queryCore.identityAnchors, []);

  await buscarMercadoLivreComFontes(
    request(STRONG_IDENTITY_ASPIRADOR),
    fontes((stage) => aspiradorStages.push(stage)),
  );
  await buscarMercadoLivreComFontes(
    request(GENERIC_ASPIRADOR),
    fontes((stage) => genericAspiradorStages.push(stage)),
  );
  await buscarMercadoLivreComFontes(
    request(NOTEBOOK),
    fontes((stage) => notebookStages.push(stage)),
  );

  assert.ok(
    !aspiradorStages.includes("domain"),
    "identidade forte pode pular domain discovery",
  );
  assert.ok(
    aspiradorStages.includes("catalog"),
    "identidade forte consulta o catalogo autenticado",
  );
  assert.ok(
    aspiradorStages.includes("items-api"),
    "identidade forte continua consultando items-api",
  );

  assert.ok(
    genericAspiradorStages.includes("domain"),
    "consulta generica sem categoria continua consultando domain discovery",
  );
  assert.ok(
    genericAspiradorStages.includes("items-api"),
    "consulta generica continua consultando items-api",
  );
  assert.ok(
    notebookStages.includes("domain"),
    "notebook generico continua consultando domain discovery",
  );
  assert.ok(
    notebookStages.includes("items-api"),
    "notebook generico continua consultando items-api",
  );

  console.log("STRONG_IDENTITY_CAN_SKIP_DOMAIN=PASS");
  console.log("STRONG_IDENTITY_USES_AUTH_CATALOG=PASS");
  console.log("GENERIC_NO_CATEGORY_STILL_USES_DOMAIN=PASS");
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
