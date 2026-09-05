import assert from "node:assert/strict";

import {
  acquireMarketplaces,
  buildFingerprint,
  buildQueryIntent,
  buildSearchPlan,
  clusterCandidates,
  compareFingerprints,
  extractIdentityAnchors,
  normalizeCandidate,
  processRawCandidates,
  scoreQueryRelevance,
  searchMultistoreV2,
} from "./index";
import { classifyListingAffiliate } from "./affiliateEligibility";
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
    affiliateStatus: extras.affiliateStatus,
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
const accessoryOnMain = scoreQueryRelevance(mainQuery, accessoryNormalized);
assert.equal(
  accessoryOnMain.status,
  "RELEVANT",
  "F/G) acessorio com HOST do produto pedido entra na query MAIN em tier inferior",
);
assert.equal(accessoryOnMain.rankTier, 2);
assert.equal(accessoryOnMain.fingerprint.role.value, "ACCESSORY");

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
  "RELEVANT",
  "Capa/caso com HOST do aparelho pedido entra em tier inferior.",
);
assert.equal(phoneCase.rankTier, 2);

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
  clustered.some(
    (cluster) =>
      cluster.members.some((member) => member.candidate.fingerprint.role.value === "MAIN") &&
      cluster.members.some(
        (member) => member.candidate.fingerprint.role.value === "ACCESSORY",
      ),
  ),
  false,
  "MAIN e ACCESSORY nao compartilham o mesmo cluster",
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
assert.ok(
  ihomePlan.every((item) => item.trim() !== "ihome"),
  "consulta de fone nao pode reduzir so para a marca",
);

const nightstandPlan = buildSearchPlan(
  "Mesa De Cabeceira Criado Mais Moveis Mdp/mdf 3 Gavetas",
);
assert.ok(
  nightstandPlan.some(
    (item) =>
      item.includes("mesa de cabeceira") || item.includes("criado mudo"),
  ),
  "consulta de mesa de cabeceira preserva o nucleo do produto",
);
assert.ok(
  nightstandPlan.every((item) => item.trim() !== "mais"),
  "termo fraco isolado nao vira query de marketplace",
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
  1,
  "mesa de cabeceira equivalente de outra marca continua relevante sem marca forte na consulta",
);
assert.ok(
  brandConflictFurniture.products.length >= 1,
  "consulta de movel sem SKU continua aberta",
);
assert.equal(
  brandConflictFurniture.products.some((product) =>
    product.offers.some((offer) => offer.externalId === "ml-criado-mais") &&
    product.offers.some((offer) => offer.externalId === "shopee-ej"),
  ),
  false,
  "marcas distintas nao contaminam o mesmo cluster",
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

const pegQuery = "Peg 4.000 Sem Sabor De 20 Gramas";
const pegIntent = buildQueryIntent(pegQuery);
assert.equal(pegIntent.hasStrongIdentity, true, "PEG 4.000 e ancora de identidade");
assert.ok(
  pegIntent.identityAnchors.some((anchor) => anchor.value === "peg4000"),
  "4.000 colapsa para peg4000",
);
assert.equal(pegIntent.importantAttributes.capacity, "20g");
assert.ok(
  !pegIntent.identityAnchors.some((anchor) => /20g|20gramas|24cores/.test(anchor.value)),
  "20 gramas nao vira ancora de identidade",
);

const pegProcessed = processRawCandidates(pegQuery, [
  raw("PEG 4000 Sem Sabor 20g", { marketplace: "AMAZON", brand: null, externalId: "peg-1" }),
  raw("Colorau Paprika Defumada 20g Sem Sabor", {
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    brand: null,
    externalId: "paprika",
  }),
  raw("Colageno Hidrolisado 20g Sem Sabor", {
    marketplace: "SHOPEE",
    marketplaceName: "Shopee",
    brand: null,
    externalId: "colageno",
  }),
  raw("Snack Integral 20g Sem Sabor", {
    marketplace: "MAGAZINE_LUIZA",
    marketplaceName: "Magazine Luiza",
    brand: null,
    externalId: "snack",
  }),
  raw("PEG 4.000 Po 20 Gramas Sem Sabor", {
    marketplace: "SHOPEE",
    marketplaceName: "Shopee",
    brand: null,
    externalId: "peg-5",
  }),
]);
const pegRelevantIds = pegProcessed.relevant.map((item) => item.normalized.raw.externalId);
assert.equal(pegRelevantIds.includes("peg-1"), true, "A) PEG correto permanece relevante");
assert.equal(pegRelevantIds.includes("peg-5"), true, "A) segundo PEG correto permanece relevante");
assert.equal(pegRelevantIds.includes("paprika"), false, "B) paprika nao entra por 20g/sem sabor");
assert.equal(pegRelevantIds.includes("colageno"), false, "C) colageno nao entra por 20g/sem sabor");
assert.equal(pegRelevantIds.includes("snack"), false, "D) snack nao entra por 20g/sem sabor");
assert.equal(
  pegProcessed.scored.filter((item) => item.status === "REJECTED").length,
  3,
  "falsos positivos sao rejeitados antes do clustering",
);
assert.ok(
  pegProcessed.products.every((product) =>
    product.offers.every((offer) => !["paprika", "colageno", "snack"].includes(offer.externalId)),
  ),
  "E) clustering nao junta paprika/colageno/snack ao PEG",
);
assert.equal(
  pegProcessed.products.some((product) => product.offers.length >= 2),
  true,
  "os dois PEG corretos podem formar cluster multi-loja",
);

const galaxyIntent = buildQueryIntent("Samsung Galaxy A55 256GB");
assert.equal(galaxyIntent.hasStrongIdentity, true);
assert.ok(galaxyIntent.identityAnchors.some((anchor) => anchor.value === "a55"));
assert.equal(galaxyIntent.importantAttributes.capacity, "256gb");
assert.equal(
  scoreQueryRelevance(
    galaxyIntent,
    normalizeCandidate(
      raw("Smartphone Samsung Galaxy A55 256GB", { brand: "Samsung", externalId: "a55-ok" }),
    ),
  ).status,
  "RELEVANT",
  "Galaxy A55 pedido continua relevante",
);
assert.equal(
  scoreQueryRelevance(
    galaxyIntent,
    normalizeCandidate(
      raw("Smartphone Samsung Galaxy A15 256GB", { brand: "Samsung", externalId: "a15-no" }),
    ),
  ).status,
  "REJECTED",
  "A15 nao substitui A55",
);
assert.equal(
  scoreQueryRelevance(
    galaxyIntent,
    normalizeCandidate(
      raw("Samsung Galaxy A55 5G Dual SIM 256 GB Preto 8 GB RAM", {
        brand: "Samsung",
        externalId: "a55-5g",
      }),
    ),
  ).status,
  "RELEVANT",
  "5G de rede nao vira capacidade 5g quando ha GB no titulo",
);

const jblIntent = buildQueryIntent("JBL Tune 520BT");
assert.equal(jblIntent.hasStrongIdentity, true);
assert.ok(
  extractIdentityAnchors("JBL Tune 520BT").some(
    (anchor) => anchor.value === "520bt" || anchor.value === "tune520bt" || anchor.value === "tune520",
  ),
);

const isolatedJblIntent = buildQueryIntent("520BT");
assert.equal(isolatedJblIntent.hasStrongIdentity, true);
assert.ok(isolatedJblIntent.identityAnchors.some((anchor) => anchor.value === "520bt"));
assert.equal(
  scoreQueryRelevance(
    isolatedJblIntent,
    normalizeCandidate(raw("JBL Tune 520BT", { brand: "JBL", externalId: "520bt-spaced-ok" })),
  ).status,
  "RELEVANT",
  "consulta isolada 520BT aceita o codigo com fronteira real",
);
assert.equal(
  scoreQueryRelevance(
    isolatedJblIntent,
    normalizeCandidate(raw("JBL Tune520BT", { brand: "JBL", externalId: "tune520bt-no" })),
  ).status,
  "REJECTED",
  "consulta isolada 520BT nao aceita Tune520BT sem a linha na query",
);
assert.equal(
  scoreQueryRelevance(
    isolatedJblIntent,
    normalizeCandidate(raw("JBL Tune X520BT", { brand: "JBL", externalId: "x520bt-no" })),
  ).status,
  "REJECTED",
  "consulta isolada 520BT rejeita X520BT",
);
assert.equal(
  scoreQueryRelevance(
    isolatedJblIntent,
    normalizeCandidate(raw("JBL AB520BT", { brand: "JBL", externalId: "ab520bt-no" })),
  ).status,
  "REJECTED",
  "consulta isolada 520BT rejeita AB520BT",
);
assert.equal(
  scoreQueryRelevance(
    jblIntent,
    normalizeCandidate(raw("JBL Tune520BT", { brand: "JBL", externalId: "tune520bt-with-line" })),
  ).status,
  "RELEVANT",
  "consulta com linha Tune aceita Tune520BT",
);
assert.equal(
  scoreQueryRelevance(
    jblIntent,
    normalizeCandidate(raw("JBL AB520BT", { brand: "JBL", externalId: "ab520bt-with-line" })),
  ).status,
  "REJECTED",
  "consulta com linha Tune rejeita AB520BT",
);

const isolatedGalaxyIntent = buildQueryIntent("A55");
assert.equal(isolatedGalaxyIntent.hasStrongIdentity, true);
assert.ok(isolatedGalaxyIntent.identityAnchors.some((anchor) => anchor.value === "a55"));
assert.equal(
  scoreQueryRelevance(
    isolatedGalaxyIntent,
    normalizeCandidate(
      raw("Samsung Galaxy A55", { brand: "Samsung", externalId: "a55-isolated-ok" }),
    ),
  ).status,
  "RELEVANT",
  "consulta isolada A55 aceita Galaxy A55",
);
assert.equal(
  scoreQueryRelevance(
    isolatedGalaxyIntent,
    normalizeCandidate(
      raw("Samsung GalaxyA55", { brand: "Samsung", externalId: "galaxya55-isolated-no" }),
    ),
  ).status,
  "REJECTED",
  "consulta isolada A55 nao aceita GalaxyA55 sem a linha na query",
);
assert.equal(
  scoreQueryRelevance(
    isolatedGalaxyIntent,
    normalizeCandidate(
      raw("Samsung Galaxy XA55", { brand: "Samsung", externalId: "xa55-no" }),
    ),
  ).status,
  "REJECTED",
  "consulta isolada A55 rejeita XA55",
);

const galaxyLineIntent = buildQueryIntent("Samsung Galaxy A55");
assert.equal(
  scoreQueryRelevance(
    galaxyLineIntent,
    normalizeCandidate(
      raw("Samsung GalaxyA55", { brand: "Samsung", externalId: "galaxya55-with-line" }),
    ),
  ).status,
  "RELEVANT",
  "consulta com linha Galaxy aceita GalaxyA55",
);
assert.equal(
  scoreQueryRelevance(
    galaxyLineIntent,
    normalizeCandidate(
      raw("Samsung ABA55", { brand: "Samsung", externalId: "aba55-with-line" }),
    ),
  ).status,
  "REJECTED",
  "consulta com linha Galaxy rejeita ABA55",
);

const panelaIntent = buildQueryIntent("panela de pressao 4,5L");
assert.equal(panelaIntent.hasStrongIdentity, false, "4,5L nao e modelo/SKU");
assert.equal(panelaIntent.importantAttributes.capacity, "4.5l");

const lapisColorsIntent = buildQueryIntent("lapis 24 cores");
assert.equal(lapisColorsIntent.hasStrongIdentity, false, "24 cores nao e identidade");
assert.equal(lapisColorsIntent.importantAttributes.quantity, "24cores");

const filtroIntent = buildQueryIntent("Filtro de barro");
assert.equal(filtroIntent.hasStrongIdentity, false, "consulta generica permanece aberta");
const filtroGeneric = processRawCandidates("Filtro de barro", [
  raw("Filtro de barro 8 litros tradicional", { marketplace: "AMAZON", externalId: "filtro-a" }),
  raw("Filtro de barro 6 litros com torneira", { marketplace: "SHOPEE", marketplaceName: "Shopee", externalId: "filtro-b" }),
]);
assert.ok(filtroGeneric.relevant.length >= 1, "filtro de barro continua encontravel");

const mlSource = "https://produto.mercadolivre.com.br/MLB-111";
const mlAffiliate = "https://meli.la/abc123ready";
const affiliateCase1 = processRawCandidates("Headphone MarcaX ZX100", [
  raw("Headphone MarcaX ZX100 Bluetooth", {
    brand: "MarcaX",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "mlb-a",
    price: 90,
    url: `${mlSource}-a`,
    affiliateLink: null,
    affiliateStatus: "INELIGIBLE",
  }),
  raw("Fone MarcaX ZX100", {
    brand: "MarcaX",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "mlb-b",
    price: 95,
    url: `${mlSource}-b`,
    affiliateLink: mlAffiliate,
    affiliateStatus: "READY",
  }),
  raw("Headphone MarcaX ZX200 Bluetooth", {
    brand: "MarcaX",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "mlb-c",
    price: 80,
    url: `${mlSource}-c`,
    affiliateLink: "https://meli.la/otherproduct",
    affiliateStatus: "READY",
  }),
]);
const zx100 = affiliateCase1.products.find((product) =>
  product.offers.some((offer) => offer.externalId === "mlb-b" || offer.externalId === "mlb-a"),
);
assert.ok(zx100, "CASO 1: produto ZX100 continua existindo");
assert.equal(zx100?.offers[0]?.externalId, "mlb-b", "CASO 1: escolhe o SAME elegivel");
assert.equal(zx100?.offers[0]?.affiliateLink, mlAffiliate);
assert.equal(
  zx100?.offers.some((offer) => offer.externalId === "mlb-c"),
  false,
  "CASO 1: jamais escolhe produto diferente so porque monetiza",
);

const affiliateCase2 = processRawCandidates("Headphone MarcaX ZX100", [
  raw("Headphone MarcaX ZX100", {
    brand: "MarcaX",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "mlb-in-1",
    price: 90,
    url: `${mlSource}-in1`,
    affiliateStatus: "INELIGIBLE",
  }),
  raw("Fone MarcaX ZX100 Bluetooth", {
    brand: "MarcaX",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "mlb-in-2",
    price: 91,
    url: `${mlSource}-in2`,
    affiliateStatus: "INELIGIBLE",
  }),
  raw("Headphone MarcaX ZX100 Amazon", {
    brand: "MarcaX",
    marketplace: "AMAZON",
    marketplaceName: "Amazon",
    externalId: "amz-ok",
    price: 110,
    url: "https://amazon.example/zx100",
    affiliateLink: "https://amazon.example/zx100?tag=ofertano",
    affiliateStatus: "READY",
  }),
]);
assert.equal(affiliateCase2.products.length, 1, "CASO 2: produto continua existindo");
const case2Ml = affiliateCase2.products[0]?.offers.find((offer) => offer.marketplace === "MERCADO_LIVRE");
const case2Amz = affiliateCase2.products[0]?.offers.find((offer) => offer.marketplace === "AMAZON");
assert.ok(case2Amz, "CASO 2: Amazon permanece");
assert.equal(case2Amz?.affiliateLink, "https://amazon.example/zx100?tag=ofertano");
assert.equal(case2Ml?.affiliateLink ?? null, null, "CASO 2: ML nao ganha falso affiliateLink");

const promoted = classifyListingAffiliate({
  marketplace: "MERCADO_LIVRE",
  sourceUrl: "https://produto.mercadolivre.com.br/MLB-333",
  affiliateLink: "https://produto.mercadolivre.com.br/MLB-333",
});
assert.equal(promoted.status, "UNKNOWN", "CASO 3: sourceUrl nao vira afiliada");
assert.equal(promoted.affiliateLink, null);
const affiliateCase3 = processRawCandidates("Headphone MarcaX ZX100", [
  raw("Headphone MarcaX ZX100", {
    brand: "MarcaX",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "mlb-src",
    url: "https://produto.mercadolivre.com.br/MLB-333",
    affiliateLink: "https://produto.mercadolivre.com.br/MLB-333",
  }),
]);
assert.equal(affiliateCase3.products[0]?.offers[0]?.affiliateLink ?? null, null, "CASO 3: persistencia sem promocao");
assert.notEqual(affiliateCase3.products[0]?.offers[0]?.affiliateStatus, "READY");

const affiliateCase4 = processRawCandidates("Headphone MarcaX ZX100", [
  raw("Headphone MarcaX ZX100", {
    brand: "MarcaX",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "mlb-err",
    affiliateStatus: "ERROR",
  }),
  raw("Headphone MarcaX ZX100 Amazon", {
    brand: "MarcaX",
    marketplace: "AMAZON",
    externalId: "amz-err",
    affiliateLink: "https://amazon.example/zx100?tag=ofertano",
  }),
]);
assert.equal(affiliateCase4.products.length, 1, "CASO 4: busca global continua");
assert.equal(
  affiliateCase4.products[0]?.offers.find((offer) => offer.marketplace === "MERCADO_LIVRE")?.affiliateStatus,
  "ERROR",
  "CASO 4: falha tecnica nao vira INELIGIBLE",
);

const affiliateCase6 = processRawCandidates("Headphone MarcaX ZX100", [
  raw("Headphone MarcaX ZX100", {
    brand: "MarcaX",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "mlb-90",
    price: 90,
    affiliateStatus: "INELIGIBLE",
  }),
  raw("Fone MarcaX ZX100 Preto", {
    brand: "MarcaX",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "mlb-95",
    price: 95,
    affiliateLink: mlAffiliate,
    affiliateStatus: "READY",
  }),
  raw("Headphone MarcaX ZX200 Barato", {
    brand: "MarcaX",
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    externalId: "mlb-80-diff",
    price: 80,
    affiliateLink: "https://meli.la/zx200",
    affiliateStatus: "READY",
  }),
]);
const case6Ml = affiliateCase6.products.find((product) =>
  product.offers.some((offer) => offer.externalId === "mlb-95" || offer.externalId === "mlb-90"),
);
assert.equal(case6Ml?.offers.find((offer) => offer.marketplace === "MERCADO_LIVRE")?.externalId, "mlb-95");
assert.equal(
  case6Ml?.offers.some((offer) => offer.externalId === "mlb-80-diff"),
  false,
  "CASO 6: R$ 80 de produto diferente nunca substitui o SAME",
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
  assert.ok(
    mixed.relevantCandidates.length >= 1,
    "Candidato relevante de uma loja nao vira zero.",
  );
  assert.equal(
    mixed.views.length,
    0,
    "1 oferta relevante + BLOCKED/ERROR fica interna; resposta publica exige Multi Loja",
  );
  assert.equal(mixed.products.length, 0);
  assert.equal(mixed.singleStoreClusters, 0);
  assert.equal(mixed.multiStoreClusters, 0);
  assert.equal(mixed.persistedProductIds.length, 0);
  assert.ok(
    mixed.relevantCandidates.some((item) => item.status === "RELEVANT"),
    "Persistencia desligada nao apaga o candidato vivo interno.",
  );
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

  const tightBudget = {
    globalMs: 800,
    marketplaceMs: 350,
    fetchMs: 200,
    persistReserveMs: 50,
    hangGraceMs: 40,
  };
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

  let hangCalls = 0;
  const timeoutAdapters = [
    fakeAdapter("AMAZON", "Amazon", async (request) => ({
      marketplace: "AMAZON",
      query: request.query,
      success: true,
      scanned: 1,
      candidates: [
        foundCandidate({
          marketplace: "AMAZON",
          marketplaceName: "Amazon",
          externalId: "amz-fast",
          title: "Headphone JBL Tune 520BT",
          price: 199,
        }),
      ],
      error: null,
    })),
    fakeAdapter("SHOPEE", "Shopee", async (request) => {
      hangCalls += 1;
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
    fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => ({
      marketplace: "MAGAZINE_LUIZA",
      query: "JBL Tune 520BT",
      success: false,
      scanned: 0,
      candidates: [],
      error: "Magazine Luiza bloqueou a busca HTML.",
    })),
    fakeAdapter("ALIEXPRESS", "AliExpress", async () => {
      throw new Error("AliExpress indisponivel.");
    }),
    fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => {
      throw new Error("Mercado Livre items-api retornou 403.");
    }),
  ];

  const timeoutStarted = Date.now();
  const timeoutResult = await searchMultistoreV2("JBL Tune 520BT", {
    persist: false,
    adapters: timeoutAdapters,
    budget: tightBudget,
  });
  const timeoutElapsed = Date.now() - timeoutStarted;
  assert.ok(timeoutElapsed < 2_000, `CASO timeout: terminou em ${timeoutElapsed}ms, dentro do orcamento`);
  assert.ok(
    timeoutResult.relevantCandidates.length >= 1,
    "CASO timeout: candidato valido da loja rapida permanece internamente",
  );
  assert.equal(
    timeoutResult.views.length,
    0,
    "CASO timeout: singleton relevante permanece interno sem fallback publico",
  );
  assert.equal(timeoutResult.products.length, 0);
  assert.equal(timeoutResult.multiStoreClusters, 0);
  assert.equal(timeoutResult.persistedProductIds.length, 0);
  assert.equal(
    timeoutResult.acquisitions.find((item) => item.marketplace === "SHOPEE")?.status,
    "TIMEOUT",
  );
  assert.equal(
    timeoutResult.acquisitions.find((item) => item.marketplace === "AMAZON")?.status,
    "SUCCESS",
  );
  assert.equal(
    timeoutResult.acquisitions.find((item) => item.marketplace === "MAGAZINE_LUIZA")?.status,
    "BLOCKED",
  );
  assert.ok(hangCalls >= 1, "adapter pendurado foi consultado e cancelado");

  let slowIgnoresAbort = false;
  const isolationBudget = {
    globalMs: 900,
    marketplaceMs: 700,
    fetchMs: 300,
    persistReserveMs: 80,
    hangGraceMs: 0,
  };
  const isolationStarted = Date.now();
  const isolation = await searchMultistoreV2(
    "Headphone JBL Tune 520BT",
    {
      persist: false,
      budget: isolationBudget,
      adapters: [
        fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async (request) => {
          slowIgnoresAbort = true;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 30_000);
            request.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
          return {
            marketplace: "MERCADO_LIVRE",
            query: request.query,
            success: false,
            scanned: 0,
            candidates: [],
            error: "lento",
          };
        }),
        fakeAdapter("SHOPEE", "Shopee", async (request) => ({
          marketplace: "SHOPEE",
          query: request.query,
          success: true,
          scanned: 1,
          candidates: [
            foundCandidate({
              marketplace: "SHOPEE",
              marketplaceName: "Shopee",
              externalId: "shopee-fast-isolation",
              title: "Headphone JBL Tune 520BT",
              price: 179,
            }),
          ],
          error: null,
        })),
        fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async (request) => ({
          marketplace: "MAGAZINE_LUIZA",
          query: request.query,
          success: true,
          scanned: 1,
          candidates: [
            foundCandidate({
              marketplace: "MAGAZINE_LUIZA",
              marketplaceName: "Magazine Luiza",
              externalId: "magalu-fast-isolation",
              title: "Headphone JBL Tune 520BT",
              price: 189,
            }),
          ],
          error: null,
        })),
      ],
    },
  );
  const isolationElapsed = Date.now() - isolationStarted;
  assert.ok(
    isolationElapsed < isolationBudget.globalMs + 350,
    `isolamento: busca global terminou em ${isolationElapsed}ms (< ${isolationBudget.globalMs + 350}ms)`,
  );
  assert.ok(slowIgnoresAbort, "adapter lento foi iniciado em paralelo");
  assert.ok(
    (isolation.acquisitions.find((item) => item.marketplace === "SHOPEE")?.usable ?? 0) >= 1,
    "Shopee retorna candidatos mesmo com ML lento",
  );
  assert.ok(
    (isolation.acquisitions.find((item) => item.marketplace === "MAGAZINE_LUIZA")?.usable ??
      0) >= 1,
    "Magalu retorna candidatos mesmo com ML lento",
  );
  assert.equal(
    isolation.acquisitions.find((item) => item.marketplace === "MERCADO_LIVRE")?.status,
    "TIMEOUT",
  );

  const timeoutFixtureQuery = "Aspirador de Po e Agua Wap GTW Inox 12L 1400W 220V";
  const timeoutFixturePlan = buildSearchPlan(timeoutFixtureQuery);
  assert.ok(timeoutFixturePlan.length >= 2, "fixture de timeout precisa de duas variantes");
  let panelaCalls = 0;
  let secondVariantStarted = false;
  let secondVariantAborted = false;
  const partialTimeout = await searchMultistoreV2(timeoutFixtureQuery, {
    persist: false,
    budget: tightBudget,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async (request) => {
        panelaCalls += 1;
        if (panelaCalls === 1) {
          return {
            marketplace: "AMAZON",
            query: request.query,
            success: true,
            scanned: 1,
            candidates: [
              foundCandidate({
                marketplace: "AMAZON",
                marketplaceName: "Amazon",
                brand: null,
                externalId: "panela-1",
                title: "Aspirador de Po e Agua Wap GTW Inox 6L 1400W 220V",
                price: 129,
              }),
            ],
            error: null,
          };
        }
        secondVariantStarted = true;
        request.signal.addEventListener(
          "abort",
          () => {
            secondVariantAborted = true;
          },
          { once: true },
        );
        await hangUntilAbort(request.signal);
        return {
          marketplace: "AMAZON",
          query: request.query,
          success: false,
          scanned: 0,
          candidates: [],
          error: null,
        };
      }),
    ],
  });
  assert.equal(
    partialTimeout.acquisitions[0]?.status,
    "TIMEOUT",
    "TIMEOUT diagnostica marketplace que nao fechou no orcamento",
  );
  assert.ok(panelaCalls >= 2, "fixture de timeout consultou a segunda variante");
  assert.equal(secondVariantStarted, true, "segunda variante foi iniciada");
  assert.equal(secondVariantAborted, true, "segunda variante recebeu abort");
  assert.ok(
    (partialTimeout.acquisitions[0]?.usable ?? 0) >= 1,
    "candidatos parciais do adapter lento sao preservados",
  );
  assert.equal(
    partialTimeout.relevantCandidates.length,
    0,
    "candidato incompatível não conta como cobertura compatível",
  );

  const affiliateTimeoutStarted = Date.now();
  const affiliateTimeout = await searchMultistoreV2("JBL Tune 520BT", {
    persist: false,
    budget: tightBudget,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "JBL Tune 520BT",
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-aff",
            title: "JBL Tune 520BT",
            price: 199,
            affiliateLink: "https://amazon.example/520?tag=ofertano",
          }),
        ],
        error: null,
      })),
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query: "JBL Tune 520BT",
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "MERCADO_LIVRE",
            marketplaceName: "Mercado Livre",
            externalId: "mlb-aff-timeout",
            title: "Headphone JBL Tune 520BT",
            price: 189,
            sourceUrl: "https://produto.mercadolivre.com.br/MLB-520",
            affiliateLink: null,
          }),
        ],
        error: null,
      })),
    ],
    affiliateResolver: async (_input, signal) => {
      await hangUntilAbort(signal);
      return { status: "READY", affiliateLink: "https://meli.la/should-not-apply" };
    },
  });
  assert.ok(
    Date.now() - affiliateTimeoutStarted < 2_000,
    "CASO 5: validacao de afiliado respeita o time budget",
  );
  assert.ok(affiliateTimeout.views.length >= 1, "CASO 5: outros resultados permanecem");
  const timedMl = affiliateTimeout.products[0]?.offers.find(
    (offer) => offer.marketplace === "MERCADO_LIVRE",
  );
  assert.notEqual(timedMl?.affiliateStatus, "INELIGIBLE");
  assert.equal(timedMl?.affiliateLink ?? null, null, "CASO 5: nao finge que sourceUrl e afiliada");

  const technicalAffiliate = await searchMultistoreV2("JBL Tune 520BT", {
    persist: false,
    adapters: [
      fakeAdapter("AMAZON", "Amazon", async () => ({
        marketplace: "AMAZON",
        query: "JBL Tune 520BT",
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "AMAZON",
            marketplaceName: "Amazon",
            externalId: "amz-tech",
            title: "JBL Tune 520BT",
            price: 199,
            affiliateLink: "https://amazon.example/520?tag=ofertano",
          }),
        ],
        error: null,
      })),
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query: "JBL Tune 520BT",
        success: true,
        scanned: 1,
        candidates: [
          foundCandidate({
            marketplace: "MERCADO_LIVRE",
            marketplaceName: "Mercado Livre",
            externalId: "mlb-tech",
            title: "Headphone JBL Tune 520BT",
            price: 189,
            sourceUrl: "https://produto.mercadolivre.com.br/MLB-520b",
          }),
        ],
        error: null,
      })),
    ],
    affiliateResolver: async () => {
      throw new Error("oauth 500");
    },
  });
  const techMl = technicalAffiliate.products[0]?.offers.find(
    (offer) => offer.marketplace === "MERCADO_LIVRE",
  );
  assert.equal(techMl?.affiliateStatus, "ERROR", "CASO 4 fluxo vivo: erro tecnico");
  assert.notEqual(techMl?.affiliateStatus, "INELIGIBLE");
  assert.ok(technicalAffiliate.views.length >= 1);
}

void runAcquisitionContract()
  .then(() => {
    console.log("multistore-v2: todos os casos globais passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
