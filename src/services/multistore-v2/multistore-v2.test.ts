import assert from "node:assert/strict";

import {
  buildFingerprint,
  buildQueryIntent,
  clusterCandidates,
  compareFingerprints,
  normalizeCandidate,
  processRawCandidates,
  scoreQueryRelevance,
} from "./index";
import type { RawCandidate } from "./types";

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
assert.equal(accessoryQuery.brand, null);
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

console.log("multistore-v2: todos os casos globais passaram");
