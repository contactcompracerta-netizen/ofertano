import assert from "node:assert/strict";

import { buildFingerprint } from "./fingerprint";
import { normalizeCandidate } from "./normalizeCandidate";
import { compareFingerprints } from "./pairMatcher";
import { buildQueryIntent } from "./queryIntent";
import { scoreQueryRelevance } from "./queryRelevance";
import { searchMultistoreV2 } from "./search";
import type { RawCandidate } from "./types";

function fingerprint(
  marketplace: RawCandidate["marketplace"],
  externalId: string,
  title: string,
  brand: string | null = null,
  attributes: Record<string, string> = {},
) {
  return buildFingerprint(
    normalizeCandidate({
      marketplace,
      marketplaceName: marketplace,
      externalId,
      title,
      price: 100,
      url: `https://example.test/${externalId}`,
      image: null,
      brand,
      category: null,
      seller: null,
      affiliateLink: null,
      attributes,
    }),
  );
}

const mlGtw12 = fingerprint(
  "MERCADO_LIVRE",
  "ml-gtw12",
  "Aspirador Pó E Água 1400W 12 Litros Inox GTW 12 WAP",
  "WAP",
);
const amazonGtw12 = fingerprint(
  "AMAZON",
  "amazon-gtw12",
  "WAP Aspirador de Pó e Água Barril GTW Inox 12 Compacto 12 Litros 1400W",
  "WAP",
);

for (const candidate of [mlGtw12, amazonGtw12]) {
  assert.equal(candidate.model.value, "gtw12");
  assert.equal(candidate.capacity.value, "12l");
  assert.equal(candidate.importantAttributes.power, "1400w");
  assert.equal(candidate.quantity.value, null);
  assert.equal(candidate.role.value, "MAIN");
  assert.equal(candidate.variantCodes.value?.includes("po1400"), false);
}

const lexicalMismatch = {
  ...amazonGtw12,
  lexicalSignature: ["catalogo", "alternativo"],
  distinctiveTokens: ["catalogo", "alternativo"],
};
const equivalent = compareFingerprints(mlGtw12, lexicalMismatch);
assert.equal(equivalent.relation, "SAME");
assert.deepEqual(equivalent.hardConflicts, []);
assert.ok(equivalent.positiveEvidence.includes("model"));
assert.ok(equivalent.positiveEvidence.includes("capacity"));
assert.ok(equivalent.positiveEvidence.includes("power"));
assert.ok(equivalent.positiveEvidence.includes("brand"));

const classMissingOnOneSide = compareFingerprints(mlGtw12, {
  ...lexicalMismatch,
  productClass: { value: null, confidence: "NONE", source: "UNKNOWN" },
});
assert.equal(classMissingOnOneSide.relation, "SAME");

const gtw20 = fingerprint(
  "AMAZON",
  "amazon-gtw20",
  "Aspirador de Pó e Água WAP GTW Inox 20 20 Litros 1600W",
  "WAP",
);
const differentCapacityAndPower = compareFingerprints(mlGtw12, gtw20);
assert.equal(differentCapacityAndPower.relation, "DIFFERENT");
assert.ok(differentCapacityAndPower.hardConflicts.some((item) => item.startsWith("capacity:")));
assert.ok(differentCapacityAndPower.hardConflicts.some((item) => item.startsWith("power:")));

const gtw12MorePower = fingerprint(
  "AMAZON",
  "amazon-gtw12-1600",
  "Aspirador de Pó e Água WAP GTW Inox 12 12 Litros 1600W",
  "WAP",
);
const differentPower = compareFingerprints(mlGtw12, gtw12MorePower);
assert.equal(differentPower.relation, "DIFFERENT");
assert.ok(differentPower.hardConflicts.some((item) => item.startsWith("power:")));

const quantityTwo = fingerprint(
  "AMAZON",
  "amazon-gtw12-kit-two",
  "Aspirador WAP GTW 12 12 Litros 1400W Kit 2 Unidades",
  "WAP",
);
const quantityThree = fingerprint(
  "MERCADO_LIVRE",
  "ml-gtw12-kit-three",
  "Aspirador WAP GTW 12 12 Litros 1400W Kit 3 Unidades",
  "WAP",
);
const quantityConflict = compareFingerprints(quantityTwo, quantityThree);
assert.equal(quantityConflict.relation, "DIFFERENT");
assert.ok(quantityConflict.hardConflicts.some((item) => item.startsWith("quantity:")));

const replacementPart = fingerprint(
  "AMAZON",
  "amazon-gtw12-filter",
  "Saco Filtro Lavável para Aspirador WAP GTW 12",
  "WAP",
);
const accessoryConflict = compareFingerprints(mlGtw12, replacementPart);
assert.equal(accessoryConflict.relation, "DIFFERENT");
assert.ok(accessoryConflict.hardConflicts.some((item) => item.startsWith("role:")));

const differentBrand = fingerprint(
  "AMAZON",
  "amazon-gtw12-other-brand",
  "Aspirador de Pó e Água GTW Inox 12 12 Litros 1400W",
  "Outra Marca",
);
const brandConflict = compareFingerprints(mlGtw12, differentBrand);
assert.equal(brandConflict.relation, "DIFFERENT");
assert.ok(brandConflict.hardConflicts.some((item) => item.startsWith("brand:")));

const weakModelA = fingerprint(
  "AMAZON",
  "weak-model-a",
  "Liquidificador Pro 12L 1400W",
  "Acme",
  { MODEL: "pro" },
);
const weakModelB = fingerprint(
  "MERCADO_LIVRE",
  "weak-model-b",
  "Liquidificador Pro 12 Litros 1400W",
  "Acme",
  { MODEL: "pro" },
);
assert.equal(weakModelA.model.value, "pro");
assert.notEqual(compareFingerprints(weakModelA, weakModelB).relation, "SAME");

const tire45 = fingerprint(
  "AMAZON",
  "pneu-45",
  "Pneu Pirelli 205/45R15",
  "Pirelli",
);
const tire55 = fingerprint(
  "MERCADO_LIVRE",
  "pneu-55",
  "Pneu Pirelli 205/55R15",
  "Pirelli",
);
assert.equal(compareFingerprints(tire45, tire55).relation, "DIFFERENT");

const blenderL99 = fingerprint(
  "AMAZON",
  "blender-l99",
  "Liquidificador Mondial L99 550W",
  "Mondial",
);
const blenderL98 = fingerprint(
  "MERCADO_LIVRE",
  "blender-l98",
  "Liquidificador Mondial L98 550W",
  "Mondial",
);
assert.equal(compareFingerprints(blenderL99, blenderL98).relation, "DIFFERENT");

const blenderIntent = buildQueryIntent("Liquidificador");
const jblHeadphone = normalizeCandidate({
  marketplace: "AMAZON",
  marketplaceName: "Amazon",
  externalId: "jbl-headphone",
  title: "Headphone JBL Tune 520BT",
  price: 100,
  url: "https://example.test/jbl-headphone",
  image: null,
  brand: "JBL",
  category: null,
  seller: null,
  affiliateLink: null,
  attributes: {},
});
assert.equal(scoreQueryRelevance(blenderIntent, jblHeadphone).status, "REJECTED");

async function runCrossStorePublicationRegression(): Promise<void> {
  const query = "WAP GTW Inox 12 1400W";
  const adapter = (
    marketplace: "MERCADO_LIVRE" | "AMAZON",
    title: string,
  ) => ({
    marketplace,
    marketplaceName: marketplace === "AMAZON" ? "Amazon" : "Mercado Livre",
    enabled: true,
    searcher: async () => ({
      marketplace,
      query,
      success: true,
      searchOutcome: "SEARCH_COMPLETED" as const,
      scanned: 1,
      error: null,
      candidates: [{
        marketplace,
        marketplaceName: marketplace === "AMAZON" ? "Amazon" : "Mercado Livre",
        externalId: `${marketplace.toLowerCase()}-gtw12`,
        sourceUrl: `https://example.test/${marketplace.toLowerCase()}-gtw12`,
        title,
        image: "https://example.test/gtw12.jpg",
        price: 100,
        oldPrice: null,
        brand: "WAP",
        category: "Aspiradores",
        seller: null,
        affiliateLink: null,
        attributes: {},
      }],
    }),
  });
  const started = Date.now();
  const result = await searchMultistoreV2(query, {
    persist: false,
    adapters: [
      adapter(
        "MERCADO_LIVRE",
        "Aspirador Pó E Água 1400W 12 Litros Inox GTW 12 WAP",
      ),
      adapter(
        "AMAZON",
        "WAP Aspirador de Pó e Água Barril GTW Inox 12 Compacto 12 Litros 1400W",
      ),
    ],
    budget: {
      globalMs: 3_000,
      marketplaceMs: 1_000,
      mercadoLivreMs: 1_000,
      fetchMs: 250,
      persistReserveMs: 100,
      hangGraceMs: 25,
    },
  });

  assert.ok(Date.now() - started <= 3_000);
  assert.equal(result.multiStoreClusters, 1);
  assert.equal(result.singleStoreClusters, 0);
  assert.equal(result.products.length, 1);
  assert.equal(result.views.length, 1);
  assert.deepEqual(result.products[0]?.marketplaces.slice().sort(), [
    "AMAZON",
    "MERCADO_LIVRE",
  ]);
  assert.ok(
    result.relevantCandidates.some(
      (candidate) =>
        candidate.normalized.raw.marketplace === "AMAZON" &&
        candidate.fingerprint.role.value === "MAIN" &&
        candidate.fingerprint.model.value === "gtw12",
      ),
  );

  const blenderQuery = "Liquidificador Mondial L99 550W";
  const blenderAdapter = (
    marketplace: "MERCADO_LIVRE" | "AMAZON",
    candidates: Array<{ externalId: string; title: string; brand: string }>,
  ) => ({
    marketplace,
    marketplaceName: marketplace === "AMAZON" ? "Amazon" : "Mercado Livre",
    enabled: true,
    searcher: async () => ({
      marketplace,
      query: blenderQuery,
      success: true,
      searchOutcome: "SEARCH_COMPLETED" as const,
      scanned: candidates.length,
      error: null,
      candidates: candidates.map((candidate) => ({
        marketplace,
        marketplaceName: marketplace === "AMAZON" ? "Amazon" : "Mercado Livre",
        sourceUrl: `https://example.test/${candidate.externalId}`,
        image: "https://example.test/liquidificador.jpg",
        price: 100,
        oldPrice: null,
        category: "Liquidificadores",
        seller: null,
        affiliateLink: null,
        attributes: {},
        ...candidate,
      })),
    }),
  });
  const blenderResult = await searchMultistoreV2(blenderQuery, {
    persist: false,
    adapters: [
      blenderAdapter("AMAZON", [
        {
          externalId: "amazon-liquidificador-l99",
          title: "Liquidificador Mondial L99 550W",
          brand: "Mondial",
        },
        {
          externalId: "amazon-jbl-headphone",
          title: "Headphone JBL Tune 520BT",
          brand: "JBL",
        },
      ]),
      blenderAdapter("MERCADO_LIVRE", [{
        externalId: "ml-liquidificador-l99",
        title: "Liquidificador Mondial L99 Preto 550W",
        brand: "Mondial",
      }]),
    ],
    budget: {
      globalMs: 3_000,
      marketplaceMs: 1_000,
      mercadoLivreMs: 1_000,
      fetchMs: 250,
      persistReserveMs: 100,
      hangGraceMs: 25,
    },
  });
  assert.equal(blenderResult.multiStoreClusters, 1);
  assert.equal(blenderResult.views.length, 1);
  assert.equal(
    blenderResult.relevantCandidates.some(
      (candidate) => candidate.normalized.raw.externalId === "amazon-jbl-headphone",
    ),
    false,
  );
}

void runCrossStorePublicationRegression()
  .then(() => {
    console.log("pair matcher WAP cross-store regressions passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
