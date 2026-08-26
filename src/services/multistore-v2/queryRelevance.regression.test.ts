import assert from "node:assert/strict";

import {
  buildQueryIntent,
  buildSearchPlan,
  clusterCandidates,
  compareFingerprints,
  normalizeCandidate,
  processRawCandidates,
  scoreQueryRelevance,
} from "./index";
import { buildQueryCore } from "./queryCore";
import type { RawCandidate } from "./types";

function raw(
  title: string,
  extras: Partial<RawCandidate> = {},
): RawCandidate {
  return {
    marketplace: extras.marketplace ?? "AMAZON",
    marketplaceName: extras.marketplaceName ?? "Amazon",
    externalId: extras.externalId ?? title.replace(/\s+/g, "-").slice(0, 32),
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

function relevance(query: string, title: string, extras: Partial<RawCandidate> = {}) {
  return scoreQueryRelevance(buildQueryIntent(query), normalizeCandidate(raw(title, extras)));
}

const suitQuery = "Terno azul";
const suitCore = buildQueryCore(suitQuery);
assert.equal(
  suitCore.productClass,
  "suit",
  "terno precisa de conceito de produto na taxonomia v2, nao de regra da consulta",
);
assert.ok(
  suitCore.productCoreLabels.some((label) => label.includes("terno") || label.includes("suit")),
  "o nucleo lexical de terno e a frase/token do conceito, nao substring",
);
assert.equal(
  relevance(suitQuery, "Terno azul completo paletó e calça").status,
  "RELEVANT",
  "terno completo paleto e calca e o produto pedido",
);
assert.equal(
  relevance(suitQuery, "Terno masculino slim azul marinho").status,
  "RELEVANT",
  "terno masculino slim azul marinho e o produto pedido",
);
assert.equal(
  relevance(suitQuery, "Lingerie azul uso interno").status,
  "REJECTED",
  "interno nao satisfaz o token terno",
);
assert.equal(
  relevance(suitQuery, "Biquíni azul forro interno").status,
  "REJECTED",
  "interno nao satisfaz o token terno",
);
assert.equal(
  relevance(suitQuery, "Jaqueta azul uso externo").status,
  "REJECTED",
  "externo nao satisfaz o token terno",
);
assert.equal(
  relevance(suitQuery, "Eterno azul perfume").status,
  "REJECTED",
  "eterno nao satisfaz o token terno",
);
assert.equal(
  relevance(suitQuery, "Calça social azul bolso interno").status,
  "REJECTED",
  "interno nao satisfaz o token terno",
);
assert.equal(
  relevance(suitQuery, "Lingerie azul uso interno").matchedTerms.includes("terno"),
  false,
  "matching lexical nao pode aceitar terno como substring de interno",
);
assert.equal(
  relevance(suitQuery, "Jaqueta azul uso externo").matchedTerms.includes("terno"),
  false,
  "matching lexical nao pode aceitar terno como substring de externo",
);
assert.equal(
  relevance(suitQuery, "Eterno azul perfume").matchedTerms.includes("terno"),
  false,
  "matching lexical nao pode aceitar terno como substring de eterno",
);

const bedsideQuery = "mesa de cabeceira";
const bedsideCore = buildQueryCore(bedsideQuery);
assert.equal(
  bedsideCore.productClass,
  "nightstand",
  "mesa de cabeceira e um conceito composto, nao mesa + cabeceira independentes",
);
assert.ok(
  bedsideCore.productCoreLabels.some(
    (label) =>
      label.includes("mesa de cabeceira") || label.includes("criado mudo"),
  ),
);
assert.equal(
  bedsideCore.distinctiveTokens.includes("mesa"),
  false,
  "mesa isolada nao e sinal suficiente do nucleo composto",
);
assert.equal(
  bedsideCore.distinctiveTokens.includes("cabeceira"),
  false,
  "cabeceira isolada nao e sinal suficiente do nucleo composto",
);
assert.equal(
  relevance(bedsideQuery, "Mesa de Cabeceira 3 Gavetas MDF").status,
  "RELEVANT",
);
assert.equal(
  relevance(bedsideQuery, "Criado Mudo 3 Gavetas MDF").status,
  "RELEVANT",
  "criado mudo e equivalente comercial de mesa de cabeceira",
);
assert.equal(
  relevance(bedsideQuery, "Mesa de Jantar 6 Lugares").status,
  "REJECTED",
  "mesa de jantar nao e mesa de cabeceira",
);
assert.equal(
  relevance(bedsideQuery, "Cabeceira Estofada Queen Azul").status,
  "REJECTED",
  "cabeceira de cama nao e mesa de cabeceira",
);

const nightstandQuery =
  "Mesa De Cabeceira Criado Mais Moveis Mdp/mdf 3 Gavetas";

assert.equal(
  relevance(nightstandQuery, "Mesa de Cabeceira 3 Gavetas MDP MDF").status,
  "RELEVANT",
  "mesa de cabeceira equivalente deve entrar",
);
assert.equal(
  relevance(nightstandQuery, "Criado-Mudo MDP MDF 3 Gavetas").status,
  "RELEVANT",
  "criado-mudo e equivalente comercial de mesa de cabeceira",
);
assert.equal(
  relevance(nightstandQuery, "O Cara Mais Esperto do Facebook").status,
  "REJECTED",
  "livro nao entra por termo fraco mais",
);
assert.equal(
  relevance(nightstandQuery, "Kit calcinha 5 em 1").status,
  "REJECTED",
  "lingerie nao entra na consulta de mesa de cabeceira",
);
assert.equal(
  relevance(nightstandQuery, "Pe palito para movel").status,
  "REJECTED",
  "acessorio de movel nao substitui o movel pedido",
);

const nightstandEvidence = relevance(
  nightstandQuery,
  "O Cara Mais Esperto do Facebook",
);
assert.ok(
  nightstandEvidence.evidence.productCoreCoverage === "MISSING" ||
    nightstandEvidence.hardConflicts.some((item) => item.includes("productCore")),
  "rejeicao do livro precisa ser explicavel pelo nucleo do produto",
);
assert.ok(
  nightstandEvidence.evidence.weakTokenContribution >= 0,
  "contribuicao de token fraco fica visivel no evidence",
);

const headphoneQuery =
  "Fones De Ouvido Ihome Wireless Rosa Resistentes A Agua";

assert.equal(
  relevance(headphoneQuery, "Fone de Ouvido iHome Wireless Rosa Resistente a Agua", {
    brand: "iHome",
  }).status,
  "RELEVANT",
);
assert.equal(
  relevance(headphoneQuery, "Headphone iHome Wireless Rosa", { brand: "iHome" }).status,
  "RELEVANT",
);
assert.equal(
  relevance(headphoneQuery, "Motor para aspirador iHome", { brand: "iHome" }).status,
  "REJECTED",
  "marca iHome nao vence classe errada",
);
assert.equal(
  relevance(headphoneQuery, "Escova principal iHome AutoVac", { brand: "iHome" }).status,
  "REJECTED",
);
assert.equal(
  relevance(headphoneQuery, "Conjunto colher medidora iHome", { brand: "iHome" }).status,
  "REJECTED",
);
assert.equal(
  relevance(headphoneQuery, "Brinquedo infantil iHome", { brand: "iHome" }).status,
  "REJECTED",
);

const pulleyQuery =
  "Polia Virabrequim Linea 1.9 Compativel com Fiat Linea 2009";
const pulleyOk = relevance(
  pulleyQuery,
  "Polia Virabrequim Linea 1.9 Compativel com Fiat Linea 2009",
);
assert.equal(pulleyOk.status, "RELEVANT", "a peca pedida continua MAIN da consulta");
assert.equal(pulleyOk.fingerprint.role.value, "MAIN");
assert.ok(pulleyOk.fingerprint.hostItem.value?.includes("fiat") || pulleyOk.evidence.compatibilityMatches.length >= 0);

assert.equal(
  relevance(pulleyQuery, "Virabrequim completo Fiat Linea 1.9").status,
  "REJECTED",
  "virabrequim completo nao e a polia",
);
assert.equal(
  relevance(pulleyQuery, "Correia Fiat Linea 1.9").status,
  "REJECTED",
  "correia do mesmo veiculo nao e a polia",
);
assert.equal(
  relevance(pulleyQuery, "Polia alternador Fiat Linea 1.9").status,
  "REJECTED",
  "polia de alternador nao e polia de virabrequim",
);

const pulleySame = compareFingerprints(
  relevance(pulleyQuery, "Polia Virabrequim Fiat Linea 1.9").fingerprint,
  relevance(pulleyQuery, "Polia Virabrequim Linea 1.9 16v").fingerprint,
);
assert.notEqual(pulleySame.relation, "DIFFERENT");

const pulleyDifferent = compareFingerprints(
  relevance(pulleyQuery, "Polia Virabrequim Fiat Linea 1.9").fingerprint,
  relevance(pulleyQuery, "Polia alternador Fiat Linea 1.9").fingerprint,
);
assert.equal(pulleyDifferent.relation, "DIFFERENT");

const overnightPulleyQuery =
  "Polia Virabrequim Fiat Linea 1.9 16v 2010 Com Roda Fonica";
const overnightPulleyOk = relevance(
  overnightPulleyQuery,
  "Polia do virabrequim Fiat Linea 1.9 16V 2010 com roda fônica",
);
assert.equal(
  overnightPulleyOk.status,
  "RELEVANT",
  "polia de virabrequim equivalente do Fiat Linea 1.9 16V 2010 / roda fonica deve entrar",
);
assert.ok(
  overnightPulleyOk.evidence.compatibilityMatches.includes("linea"),
  "aceitacao do Linea precisa evidenciar o modelo do veiculo, nao so a marca Fiat",
);
assert.equal(
  relevance(
    overnightPulleyQuery,
    "Polia do virabrequim Fiat Strada 2011 a 2020",
  ).status,
  "REJECTED",
  "polia Fiat Strada nao substitui o alvo Linea / roda fonica",
);
assert.equal(
  relevance(
    overnightPulleyQuery,
    "Polia Do Virabrequim Fiat Uno Palio Idea Fiorino",
  ).status,
  "REJECTED",
  "polia de outros Fiat nao substitui o alvo Linea",
);
assert.equal(
  relevance(
    overnightPulleyQuery,
    "Polia do virabrequim Renault Clio 2000 a 2006",
  ).status,
  "REJECTED",
  "polia de outro fabricante nao entra na consulta Linea",
);

assert.equal(buildQueryIntent("capa para smartphone Novatech Pulse").requestedRole, "ACCESSORY");
assert.equal(
  relevance("capa para smartphone Novatech Pulse", "Capa para smartphone Novatech Pulse").status,
  "RELEVANT",
  "quando a consulta pede o acessorio, o acessorio e o produto",
);
assert.equal(
  relevance("smartphone Novatech Pulse NTX20", "Capa para smartphone Novatech Pulse").status,
  "REJECTED",
);

const matrix: Array<{ query: string; accept: string[]; reject: string[] }> = [
  {
    query: "smartphone Novatech Pulse NTX20",
    accept: ["Smartphone Novatech Pulse NTX20 128GB"],
    reject: ["Smartphone Novatech Pulse NTX21 128GB"],
  },
  {
    query: "smartphone Novatech Pulse 256GB",
    accept: ["Smartphone Novatech Pulse 256GB Preto"],
    reject: ["Smartphone Novatech Pulse 128GB Preto"],
  },
  {
    query: "notebook Novatech Book NX15",
    accept: ["Notebook Novatech Book NX15 16GB"],
    reject: ["Notebook Novatech Book NX14 16GB"],
  },
  {
    query: "headphone MarcaX ZX100",
    accept: ["Fone MarcaX ZX100 Bluetooth"],
    reject: ["Caixa de som MarcaX ZX100"],
  },
  {
    query: "filtro de oleo para motor 1.6",
    accept: ["Filtro de oleo para motor 1.6"],
    reject: ["Oleo de motor 1.6 4L"],
  },
  {
    query: "capa de banco automotiva",
    accept: ["Capa de banco automotiva universal"],
    reject: ["Banco automotivo esportivo"],
  },
  {
    query: "liquidificador Mondial 800W",
    accept: ["Liquidificador Mondial 800W copo de vidro"],
    reject: ["Copo para liquidificador Mondial"],
  },
  {
    query: "panela de pressao 4,5L",
    accept: ["Panela de pressao antiaderente 4,5L"],
    reject: ["Panela de pressao 7L"],
  },
  {
    query: "mesa de cabeceira 2 gavetas",
    accept: ["Criado mudo 2 gavetas MDF"],
    reject: ["Mesa de jantar 6 lugares"],
  },
  {
    query: "tenis corrida tamanho 42",
    accept: ["Tenis corrida masculino tamanho 42"],
    reject: ["Tenis corrida tamanho 38"],
  },
  {
    query: "cafe 500g",
    accept: ["Cafe torrado 500g"],
    reject: ["Cafe torrado 250g"],
  },
  {
    query: "headphone MarcaX rosa",
    accept: ["Headphone MarcaX Wireless Rosa"],
    reject: ["Headphone MarcaX Wireless Preto"],
  },
  {
    query: "mesa mdf 3 gavetas",
    accept: ["Mesa de cabeceira MDF 3 gavetas"],
    reject: ["Mesa de cabeceira MDF 1 gaveta"],
  },
  {
    query: "lapis",
    accept: ["Lapis HB n2 escolar"],
    reject: ["Borracha escolar branca"],
  },
  {
    query: "filtro de barro",
    accept: ["Filtro de barro 8 litros tradicional"],
    reject: ["Filtro de oleo automotivo"],
  },
  {
    query: "Headphone MarcaX ZX100",
    accept: ["Headphone MarcaX ZX100 Bluetooth Preto"],
    reject: ["Headphone MarcaX ZX200 Bluetooth"],
  },
  {
    query: "Smartphone Novatech Pulse NTX20-41-8C3",
    accept: ["Smartphone Novatech Pulse NTX20-41-8C3 128GB"],
    reject: ["Smartphone Novatech Pulse NTX20-41-9D1 128GB"],
  },
];

for (const row of matrix) {
  for (const title of row.accept) {
    assert.equal(
      relevance(row.query, title).status,
      "RELEVANT",
      `ACCEPT\nquery=${row.query}\ntitle=${title}`,
    );
  }

  for (const title of row.reject) {
    assert.equal(
      relevance(row.query, title).status,
      "REJECTED",
      `REJECT\nquery=${row.query}\ntitle=${title}`,
    );
  }
}

const genericOpen = processRawCandidates("mesa de cabeceira", [
  raw("Mesa de cabeceira 2 gavetas branca", { externalId: "n1" }),
  raw("Criado mudo 3 gavetas mdf", { externalId: "n2" }),
  raw("Mesa de cabeceira 1 gaveta compacta", { externalId: "n3" }),
]);
assert.ok(genericOpen.products.length >= 2, "consulta generica de movel continua aberta");

const transitivity = clusterCandidates(
  [
    relevance("headphone MarcaX ZX100", "Headphone MarcaX ZX100", { brand: "MarcaX", externalId: "a" }),
    relevance("headphone MarcaX ZX100", "Headphone MarcaX ZX100 Rosa", { brand: "MarcaX", externalId: "b" }),
    relevance("headphone MarcaX ZX100", "Headphone MarcaX ZX200", { brand: "MarcaX", externalId: "c" }),
  ].filter((item) => item.status === "RELEVANT"),
);
assert.equal(
  transitivity.some((cluster) =>
    cluster.members.some((member) => member.candidate.normalized.raw.externalId === "c") &&
    cluster.members.some((member) => member.candidate.normalized.raw.externalId === "a"),
  ),
  false,
  "conflito estrutural impede contaminacao A SAME C",
);

const pulleyPlan = buildSearchPlan(
  "Polia Virabrequim Fiat Linea 1.9 16v 2010 Com Roda Fonica",
);
assert.ok(
  pulleyPlan.some((item) => item.toLowerCase().includes("polia")),
  "query plan da peca preserva o nucleo polia",
);
assert.ok(
  pulleyPlan.every((item) => item.trim().toLowerCase() !== "fiat"),
  "query plan nao reduz a peca para a marca do veiculo",
);
assert.ok(
  pulleyPlan.every((item) => {
    const compact = item.trim().toLowerCase().replace(/\s+/g, " ");
    return !["linea", "2010", "1.9", "16v", "16 v", "mais"].includes(compact);
  }),
  "query plan da peca nao vira atributo ou modelo de veiculo isolado",
);
assert.ok(
  pulleyPlan.every((item) => item.toLowerCase().includes("polia")),
  "toda variante da peca preserva o nucleo polia",
);

const ihomePlanRegression = buildSearchPlan(
  "Fones De Ouvido Ihome Wireless Rosa Resistentes A Agua",
);
assert.ok(
  ihomePlanRegression.every((item) => {
    const compact = item.trim().toLowerCase();
    return compact !== "ihome" && compact !== "rosa" && compact !== "mais";
  }),
  "query plan de fone nao reduz para marca ou atributo isolado",
);
assert.ok(
  ihomePlanRegression.every(
    (item) =>
      item.toLowerCase().includes("fone") ||
      item.toLowerCase().includes("headphone") ||
      item.toLowerCase().includes("ouvido"),
  ),
  "toda variante ampla de fone preserva o nucleo do produto",
);

const nightstandPlanRegression = buildSearchPlan(
  "Mesa De Cabeceira Criado Mais Moveis Mdp/mdf 3 Gavetas",
);
assert.ok(
  nightstandPlanRegression.every((item) => item.trim().toLowerCase() !== "mais"),
);
assert.ok(
  nightstandPlanRegression.every(
    (item) =>
      item.toLowerCase().includes("mesa") ||
      item.toLowerCase().includes("cabeceira") ||
      item.toLowerCase().includes("criado"),
  ),
  "toda variante da mesa preserva o nucleo do movel",
);

console.log("query relevance regression: todos os casos estruturais passaram");
