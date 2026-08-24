import assert from "node:assert/strict";

import {
  acquireMarketplaces,
  buildFingerprint,
  buildQueryIntent,
  buildSearchPlan,
  clusterCandidates,
  compareFingerprints,
  normalizeCandidate,
  processRawCandidates,
  scoreQueryRelevance,
  searchMultistoreV2,
} from "./index";
import type { RawCandidate } from "./types";
import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "../discovery/core/types";

function raw(
  title: string,
  extras: Partial<RawCandidate> = {},
): RawCandidate {
  return {
    marketplace: extras.marketplace ?? "AMAZON",
    marketplaceName: extras.marketplaceName ?? "Amazon",
    externalId: extras.externalId ?? title.replace(/\s+/g, "-").slice(0, 24),
    title,
    price: extras.price ?? 100,
    url: extras.url ?? "https://loja.example/item",
    image: extras.image ?? "https://loja.example/img.jpg",
    brand: extras.brand ?? null,
    category: extras.category ?? null,
    seller: extras.seller ?? null,
    affiliateLink: extras.affiliateLink ?? null,
    attributes: extras.attributes ?? {},
  };
}

function fingerprintOf(title: string, extras: Partial<RawCandidate> = {}) {
  return buildFingerprint(normalizeCandidate(raw(title, extras)));
}

const testA = compareFingerprints(
  fingerprintOf("Headphone JBL Tune 520BT Bluetooth", { brand: "JBL" }),
  fingerprintOf("Fone JBL Tune 520BT", {
    brand: "JBL",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "ml-a",
  }),
);
assert.equal(testA.relation, "SAME", "A) same brand + same model → SAME");

const testB = compareFingerprints(
  fingerprintOf("Headphone JBL Tune 520BT", { brand: "JBL" }),
  fingerprintOf("Headphone JBL Tune 510BT", {
    brand: "JBL",
    marketplace: "SHOPEE",
    marketplaceName: "Shopee",
    externalId: "shp-b",
  }),
);
assert.equal(testB.relation, "DIFFERENT", "B) same brand + different model → DIFFERENT");

const testC = compareFingerprints(
  fingerprintOf("Headphone Tune 520BT Preto"),
  fingerprintOf("Fone de ouvido Tune 520BT", {
    marketplace: "SHOPEE",
    marketplaceName: "Shopee",
    externalId: "shp-c",
  }),
);
assert.equal(
  testC.relation,
  "SAME",
  "C) unknown brand + same distinctive model/class → pode SAME",
);

const testD = compareFingerprints(
  fingerprintOf("Panela de pressao antiaderente"),
  fingerprintOf("Panela de pressao preta", { marketplace: "SHOPEE", marketplaceName: "Shopee", externalId: "shp-d" }),
);
assert.notEqual(testD.relation, "DIFFERENT", "D) missing model → nao DIFFERENT automaticamente");

const testE = compareFingerprints(
  fingerprintOf("KM-1995 Profissional"),
  fingerprintOf("KM-1995 Bivolt", { marketplace: "SHOPEE", marketplaceName: "Shopee", externalId: "shp-e" }),
);
assert.notEqual(testE.relation, "DIFFERENT", "E) missing productClass → nao DIFFERENT automaticamente");

const testF = compareFingerprints(
  fingerprintOf("JBL Tune 520BT Bluetooth", { brand: "JBL" }),
  fingerprintOf("Estojo para JBL Tune 520BT", {
    brand: "JBL",
    marketplace: "SHOPEE",
    marketplaceName: "Shopee",
    externalId: "shp-f",
  }),
);
assert.equal(testF.relation, "DIFFERENT", "F) MAIN vs ACCESSORY → DIFFERENT");

const accessoryQuery = buildQueryIntent("estojo JBL Tune 520BT");
assert.equal(accessoryQuery.requestedRole, "ACCESSORY");
assert.equal(accessoryQuery.brand, "jbl");
const accessoryNormalized = normalizeCandidate(
  raw("Estojo para JBL Tune 520BT", { brand: "JBL" }),
);
const accessoryRelevance = scoreQueryRelevance(accessoryQuery, accessoryNormalized);
assert.equal(accessoryRelevance.status, "RELEVANT", "G) query de ACCESSORY permite o acessorio");

const mainQuery = buildQueryIntent("JBL Tune 520BT");
assert.equal(mainQuery.requestedRole, "MAIN");
assert.equal(
  scoreQueryRelevance(mainQuery, accessoryNormalized).status,
  "REJECTED",
  "F/G) acessorio nao entra na query MAIN",
);

const singleton = processRawCandidates("JBL Tune 520BT", [
  raw("JBL Tune 520BT Bluetooth", { brand: "JBL", marketplace: "AMAZON", externalId: "amz-520" }),
]);
assert.equal(singleton.products.length, 1, "H) candidato relevante sem equivalente → singleton");
assert.equal(singleton.products[0]?.offers.length, 1);

const twoStores = processRawCandidates("JBL Tune 520BT", [
  raw("JBL Tune 520BT Bluetooth", { brand: "JBL", marketplace: "AMAZON", externalId: "amz-520", price: 199 }),
  raw("Headphone JBL Tune 520BT", {
    brand: "JBL",
    marketplace: "SHOPEE",
    marketplaceName: "Shopee",
    externalId: "shp-520",
    price: 189,
  }),
]);
assert.equal(twoStores.products.length, 1, "I) 2 lojas mesmo produto → 1 cluster");
assert.equal(twoStores.products[0]?.offers.length, 2, "I) cluster com 2 offers");

const blockedStore = processRawCandidates("JBL Tune 520BT", [
  raw("JBL Tune 520BT", { brand: "JBL", marketplace: "AMAZON", externalId: "amz-1", price: 199 }),
  raw("Fone JBL Tune 520BT", {
    brand: "JBL",
    marketplace: "SHOPEE",
    marketplaceName: "Shopee",
    externalId: "shp-1",
    price: 180,
  }),
]);
assert.ok(blockedStore.products.length >= 1, "J) loja bloqueada nao zera as demais");
assert.ok(
  (blockedStore.products[0]?.offers.length ?? 0) >= 1,
  "J) resultados das lojas validas continuam",
);

const genericIntent = buildQueryIntent("lapis");
assert.equal(genericIntent.brand, null, "queryBrand nao vira lapis");
assert.equal(genericIntent.productClass, "lapis");
const generic = processRawCandidates("lapis", [
  raw("Lapis Faber-Castell 12 cores", { brand: "Faber-Castell", marketplace: "AMAZON", externalId: "amz-fc" }),
  raw("Lapis Staedtler HB", { brand: "Staedtler", marketplace: "SHOPEE", marketplaceName: "Shopee", externalId: "amz-st" }),
  raw("Lapis de cor 24 cores", { brand: null, marketplace: "MAGAZINE_LUIZA", marketplaceName: "Magazine Luiza", externalId: "amz-24" }),
]);
assert.ok(generic.products.length >= 2, "K) query generica → multiplos clusters");

const priced = compareFingerprints(
  fingerprintOf("JBL Tune 520BT", { price: 90, brand: "JBL" }),
  fingerprintOf("JBL Tune 520BT", {
    price: 400,
    brand: "JBL",
    marketplace: "SHOPEE",
    marketplaceName: "Shopee",
    externalId: "shp-price",
  }),
);
assert.equal(priced.relation, "SAME", "L) preco nao e identidade");

const crossStore = compareFingerprints(
  fingerprintOf("JBL Tune 520BT", { marketplace: "AMAZON", brand: "JBL" }),
  fingerprintOf("JBL Tune 520BT", {
    marketplace: "ALIEXPRESS",
    marketplaceName: "AliExpress",
    brand: "JBL",
    externalId: "ali-1",
  }),
);
assert.equal(crossStore.relation, "SAME", "M) marketplace nao e regra de identidade");

const generation = compareFingerprints(
  fingerprintOf("iphone 18 pro max"),
  fingerprintOf("iphone 17 pro max", { marketplace: "SHOPEE", marketplaceName: "Shopee", externalId: "shp-17" }),
);
assert.equal(generation.relation, "DIFFERENT", "Geracao distinta nao vira o modelo pedido.");

const phoneCase = scoreQueryRelevance(
  buildQueryIntent("iphone 18 pro max"),
  normalizeCandidate(
    raw("Caso de telefone para iPhone 18 17 16 Pro Max", {
      marketplace: "SHOPEE",
      marketplaceName: "Shopee",
      externalId: "shp-case",
    }),
  ),
);
assert.equal(phoneCase.fingerprint.role.value, "ACCESSORY");
assert.equal(
  phoneCase.status,
  "REJECTED",
  "Capa/caso nao entra na consulta do produto principal.",
);

const clustered = clusterCandidates([
  scoreQueryRelevance(
    mainQuery,
    normalizeCandidate(raw("JBL Tune 520BT", { marketplace: "AMAZON", brand: "JBL", externalId: "a" })),
  ),
  scoreQueryRelevance(
    mainQuery,
    normalizeCandidate(
      raw("Estojo para JBL Tune 520BT", {
        marketplace: "SHOPEE",
        marketplaceName: "Shopee",
        brand: "JBL",
        externalId: "b",
      }),
    ),
  ),
].filter((item) => item.status === "RELEVANT"));
assert.equal(
  clustered.every((cluster) =>
    cluster.members.every((member) => member.candidate.fingerprint.role.value !== "ACCESSORY"),
  ),
  true,
  "Acessorio nao entra no cluster do produto principal na query MAIN",
);

const nightstandQuery = "Mesa De Cabeceira Criado Mais Moveis Mdp/mdf 3 Gavetas";
const nightstandMulti = processRawCandidates(nightstandQuery, [
  raw("Mesa De Cabeceira Criado Mais Moveis Mdp/mdf 3 Gavetas", {
    brand: "Criado Mais",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "ml-mesa",
    price: 189,
  }),
  raw("Mesa de Cabeceira Criado Mais 3 Gavetas MDF", {
    brand: "Criado Mais",
    marketplace: "AMAZON",
    externalId: "amz-mesa",
    price: 199,
  }),
]);
assert.equal(nightstandMulti.products.length, 1, "Mesa de cabeceira vira um produto");
assert.equal(
  nightstandMulti.products[0]?.offers.length,
  2,
  "Mesa de cabeceira agrupa precos de duas lojas",
);

const ihomeQuery = "Fones De Ouvido Ihome Wireless Rosa Resistentes A Agua";
const ihomeMulti = processRawCandidates(ihomeQuery, [
  raw("Fones De Ouvido Ihome Wireless Rosa Resistentes A Agua", {
    brand: "iHome",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "ml-ihome",
    price: 89,
  }),
  raw("Fone Ihome Bluetooth Rosa a prova d agua", {
    brand: "iHome",
    marketplace: "AMAZON",
    externalId: "amz-ihome",
    price: 79,
  }),
]);
assert.equal(ihomeMulti.products.length, 1, "Fone iHome vira um produto");
assert.equal(
  ihomeMulti.products[0]?.offers.length,
  2,
  "Fone iHome agrupa precos de duas lojas",
);

const ihomePlan = buildSearchPlan(
  "Fones De Ouvido Ihome Wireless Rosa Resistentes A Agua",
);
assert.ok(
  ihomePlan.some((item) => item.includes("ihome") && item.includes("fone")),
  "iHome usa consulta curta com marca + classe",
);

const nightstandPlan = buildSearchPlan(
  "Mesa De Cabeceira Criado Mais Moveis Mdp/mdf 3 Gavetas",
);
assert.ok(
  nightstandPlan.some((item) => item.includes("criado mais") && item.includes("moveis")),
  "Mesa Criado Mais usa consulta curta com marca + moveis",
);

const ihomeColorConflict = processRawCandidates(
  "Fones De Ouvido Ihome Wireless Rosa Resistentes A Agua",
  [
    raw("iHome Fone de ouvido basico LifeTalks (preto)", {
      brand: "iHome",
      marketplace: "AMAZON",
      marketplaceName: "Amazon",
      externalId: "amz-lifetalks",
      price: 49,
    }),
  ],
);
assert.equal(
  ihomeColorConflict.products.length,
  0,
  "Fone iHome preto nao substitui o modelo rosa pesquisado",
);

const cheapFurniture = processRawCandidates(
  "Criado-Mudo em MDF com 2 Gavetas Corredicas e Puxadores",
  [
    raw("Criado-Mudo em MDF com 2 Gavetas Corredicas e Puxadores Compacto", {
      marketplace: "SHOPEE",
      marketplaceName: "Shopee",
      externalId: "shopee-criado",
      price: 156.99,
    }),
    raw("Criado Mudo MDF 2 Gavetas Puxadores Compacto", {
      marketplace: "MAGAZINE_LUIZA",
      marketplaceName: "Magazine Luiza",
      externalId: "magalu-criado",
      price: 89.9,
    }),
  ],
);
assert.equal(cheapFurniture.products.length, 1, "Criado-mudo equivalente vira um produto");
assert.equal(
  cheapFurniture.products[0]?.offers.length,
  2,
  "Criado-mudo junta Shopee e Magazine Luiza",
);
assert.equal(
  cheapFurniture.products[0]?.price,
  89.9,
  "Preco canonico e sempre o menor entre as lojas",
);
assert.equal(
  cheapFurniture.products[0]?.primaryMarketplace,
  "Magazine Luiza",
  "Loja principal segue a oferta mais barata",
);

const brandConflictFurniture = processRawCandidates(
  "Mesa De Cabeceira Criado Mais Moveis 3 Gavetas",
  [
    raw("Mesa De Cabeceira Criado Mais Moveis Mdp 3 Gavetas", {
      brand: "Criado Mais",
      marketplace: "MERCADO_LIVRE",
      marketplaceName: "Mercado Livre",
      externalId: "ml-criado-mais",
      price: 189,
    }),
    raw("Mesa de Cabeceira EJ Moveis Off White 3 Gavetas", {
      brand: "EJ Moveis",
      marketplace: "SHOPEE",
      marketplaceName: "Shopee",
      externalId: "shopee-ej",
      price: 140.99,
    }),
  ],
);
assert.equal(
  brandConflictFurniture.relevant.filter(
    (item) => item.normalized.raw.externalId === "shopee-ej",
  ).length,
  0,
  "Marca diferente nao entra no produto pesquisado",
);

assert.equal(
  scoreQueryRelevance(
    buildQueryIntent("Headphone MarcaX ZX100"),
    normalizeCandidate(raw("Headphone MarcaX Bluetooth Preto", { brand: "MarcaX" })),
  ).status,
  "REJECTED",
  "Modelo pedido na consulta precisa aparecer no candidato",
);
assert.equal(
  scoreQueryRelevance(
    buildQueryIntent("Headphone MarcaX ZX100"),
    normalizeCandidate(raw("Headphone MarcaX ZX100 Bluetooth", { brand: "MarcaX" })),
  ).status,
  "RELEVANT",
  "Candidato com o modelo pedido continua relevante",
);

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
    price: extras.price ?? 199,
    oldPrice: extras.oldPrice ?? null,
    brand: extras.brand ?? "JBL",
    category: extras.category ?? null,
    seller: extras.seller ?? null,
    attributes: extras.attributes ?? {},
    status: "FOUND",
    error: null,
    ...extras,
  };
}

async function runAcquisitionContract() {
  const calls: string[] = [];
  const adapters = [
    fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => {
      calls.push("MERCADO_LIVRE");
      throw new Error("Mercado Livre items-api retornou 403.");
    }),
    fakeAdapter("AMAZON", "Amazon", async () => {
      calls.push("AMAZON");
      return {
        marketplace: "AMAZON",
        query: "JBL Tune 520BT",
        success: false,
        scanned: 0,
        candidates: [],
        error: "Amazon bloqueou temporariamente a busca HTML automatizada.",
      } satisfies MarketplaceDiscoveryResult;
    }),
    fakeAdapter("SHOPEE", "Shopee", async () => {
      calls.push("SHOPEE");
      return {
        marketplace: "SHOPEE",
        query: "JBL Tune 520BT",
        success: true,
        scanned: 3,
        candidates: [
          foundCandidate({
            marketplace: "SHOPEE",
            marketplaceName: "Shopee",
            externalId: "shp-520",
            title: "Headphone JBL Tune 520BT",
            price: 189,
          }),
        ],
      } satisfies MarketplaceDiscoveryResult;
    }),
    fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => {
      calls.push("MAGAZINE_LUIZA");
      return {
        marketplace: "MAGAZINE_LUIZA",
        query: "JBL Tune 520BT",
        success: true,
        scanned: 0,
        candidates: [],
        error: null,
      } satisfies MarketplaceDiscoveryResult;
    }),
    fakeAdapter("ALIEXPRESS", "AliExpress", async () => {
      calls.push("ALIEXPRESS");
      throw new Error("AliExpress indisponivel.");
    }),
  ];

  const acquisitions = await acquireMarketplaces("JBL Tune 520BT", 8, adapters);
  assert.equal(new Set(calls).size, 5, "Todas as lojas habilitadas devem ser consultadas.");
  assert.ok(
    adapters.every((adapter) => calls.includes(adapter.marketplace)),
    "Nenhuma loja habilitada pode ficar de fora da pesquisa.",
  );
  assert.equal(acquisitions.length, 5);
  assert.equal(
    acquisitions.find((item) => item.marketplace === "MERCADO_LIVRE")?.status,
    "BLOCKED",
  );
  assert.equal(
    acquisitions.find((item) => item.marketplace === "AMAZON")?.status,
    "BLOCKED",
  );
  assert.equal(
    acquisitions.find((item) => item.marketplace === "SHOPEE")?.status,
    "SUCCESS",
  );
  assert.equal(
    acquisitions.find((item) => item.marketplace === "MAGAZINE_LUIZA")?.status,
    "EMPTY",
  );
  assert.equal(
    acquisitions.find((item) => item.marketplace === "ALIEXPRESS")?.status,
    "ERROR",
  );

  const mixed = await searchMultistoreV2("JBL Tune 520BT", {
    persist: false,
    adapters,
  });
  assert.ok(mixed.views.length >= 1, "Candidato relevante de uma loja nao vira zero.");
  assert.equal(mixed.singleStoreClusters, mixed.products.length);
  assert.ok(mixed.views[0]?.id.startsWith("v2-"), "Persistencia desligada nao apaga o cluster vivo.");
  assert.deepEqual(mixed.marketplacesAttempted, [
    "MERCADO_LIVRE",
    "AMAZON",
    "SHOPEE",
    "MAGAZINE_LUIZA",
    "ALIEXPRESS",
  ]);
  assert.deepEqual(mixed.marketplacesSucceeded, ["SHOPEE"]);

  const noneAvailable = await searchMultistoreV2("lapis", {
    persist: false,
    adapters: adapters.map((adapter) =>
      fakeAdapter(adapter.marketplace, adapter.marketplaceName, async () => {
        throw new Error("HTTP 403");
      }),
    ),
  });
  assert.equal(noneAvailable.views.length, 0);
  assert.equal(noneAvailable.marketplacesAttempted.length, 5);
  assert.ok(
    noneAvailable.acquisitions.every((item) => item.status === "BLOCKED" || item.status === "ERROR"),
    "Nenhuma fonte disponivel nao pode crashar a busca.",
  );
}

void runAcquisitionContract()
  .then(() => {
    console.log("multistore-v2: todos os casos globais passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
