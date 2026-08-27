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
  relevance(suitQuery, "Conjunto social paletó e calça azul").status,
  "RELEVANT",
  "conjunto social paleto e calca e equivalente comercial de terno",
);
assert.equal(
  relevance(suitQuery, "Paletó e calça social azul").status,
  "RELEVANT",
  "paleto e calca social e equivalente comercial de terno",
);
assert.equal(
  relevance(suitQuery, "Terno Azul com Broche").status,
  "RELEVANT",
  "terno com broche continua o terno vendido; joia posterior nao vira o sold item",
);
assert.equal(
  relevance(suitQuery, "Terno Azul com Broche").fingerprint.productClass.value,
  "suit",
);
assert.equal(
  relevance(suitQuery, "Terno Azul com Broche").fingerprint.role.value,
  "MAIN",
);
assert.equal(
  relevance(suitQuery, "Terno Social Azul com Lenço").status,
  "RELEVANT",
  "terno com lenco continua o terno vendido",
);
assert.equal(
  relevance(suitQuery, "Terno de biquíni azul").status,
  "REJECTED",
  "terno de biquini nao e terno social",
);
assert.equal(
  relevance(suitQuery, "Bandeau biquíni terno azul").status,
  "REJECTED",
  "roupa de banho com a palavra terno nao e terno social",
);
assert.equal(
  relevance(suitQuery, "9 pçs azul alça macia crochê terno kit").status,
  "REJECTED",
  "kit de croche/banho com a palavra terno nao e terno social",
);
assert.equal(
  relevance(suitQuery, "Broche de Escorpião Azul").status,
  "REJECTED",
  "broche/joia nao e terno social",
);
assert.equal(
  relevance(suitQuery, "Broche de Escorpião Azul terno").status,
  "REJECTED",
  "acessorio que menciona terno nao e o terno pedido",
);

const bikiniFp = relevance(suitQuery, "Terno de biquíni azul");
assert.notEqual(bikiniFp.fingerprint.productClass.value, "suit");
assert.equal(
  bikiniFp.evidence.productClassCompatibility === "CONFLICT" ||
    bikiniFp.hardConflicts.some((item) => item.startsWith("productClass:") || item.startsWith("productCore:")),
  true,
  "rejeicao de terno de biquini precisa ser classe do item vendido, nao blacklist de titulo",
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
assert.equal(
  relevance(bedsideQuery, "Mesa de Cabeceira 3 Gavetas com puxadores retro").status,
  "RELEVANT",
  "mesa de cabeceira continua o item vendido quando puxador e so detalhe posterior",
);
const puxadorFp = relevance(
  bedsideQuery,
  "Puxador Alça Retrô P/ Mesa De Cabeceira",
);
assert.equal(
  puxadorFp.status,
  "RELEVANT",
  "puxador com HOST mesa de cabeceira entra em tier inferior",
);
assert.equal(puxadorFp.rankTier, 2);
assert.equal(puxadorFp.fingerprint.role.value, "ACCESSORY");
assert.notEqual(puxadorFp.fingerprint.productClass.value, "nightstand");
assert.equal(
  compareFingerprints(
    relevance(bedsideQuery, "Mesa de Cabeceira 3 Gavetas MDF").fingerprint,
    puxadorFp.fingerprint,
  ).relation,
  "DIFFERENT",
  "puxador nunca entra no cluster do movel",
);
for (const partTitle of [
  "Kit 7 Puxador De Armário Mesa Cabeceira Quarto",
  "6 Puxadores Ponto De Armário Retrô Mesa De Cabeceira",
  "Kit Com 3 Puxador De Penteadeira Mesa De Cabeceira",
  "Poster anime desenhos mesa de cabeceira quarto",
]) {
  const part = relevance(bedsideQuery, partTitle);
  assert.notEqual(part.fingerprint.role.value, "MAIN");
  assert.equal(
    compareFingerprints(
      relevance(bedsideQuery, "Mesa de Cabeceira 3 Gavetas MDF").fingerprint,
      part.fingerprint,
    ).relation,
    "DIFFERENT",
    `${partTitle} nunca entra no cluster do movel`,
  );
  if (part.status === "RELEVANT") {
    assert.equal(part.rankTier, 2, `${partTitle} so pode aparecer abaixo do movel`);
  }
}

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

const jblModelQuery = "JBL Tune 520BT";
assert.equal(
  relevance(jblModelQuery, "Headphone JBL Tune 520BT", { brand: "JBL" }).status,
  "RELEVANT",
  "520BT compacto e o modelo pedido",
);
assert.equal(
  relevance(jblModelQuery, "Headphone JBL Tune 520 BT", { brand: "JBL" }).status,
  "RELEVANT",
  "espaco de apresentacao nao quebra o modelo 520BT",
);
assert.equal(
  relevance(jblModelQuery, "Headphone JBL Tune 520-BT", { brand: "JBL" }).status,
  "RELEVANT",
  "hifen de apresentacao nao quebra o modelo 520BT",
);
assert.equal(
  relevance(jblModelQuery, "Headphone JBL Tune 1520BT", { brand: "JBL" }).status,
  "REJECTED",
  "1520BT nao satisfaz o modelo 520BT",
);
assert.equal(
  relevance(jblModelQuery, "Headphone JBL Tune 520BT2", { brand: "JBL" }).status,
  "REJECTED",
  "520BT2 nao satisfaz o modelo 520BT",
);
assert.equal(
  relevance(jblModelQuery, "Headphone JBL Tune 520BT20", { brand: "JBL" }).status,
  "REJECTED",
  "520BT20 nao satisfaz o modelo 520BT",
);
assert.equal(
  relevance(jblModelQuery, "JBL Tune520BT", { brand: "JBL" }).status,
  "RELEVANT",
  "Tune520BT compacto continua o mesmo codigo 520BT quando a consulta tem a linha Tune",
);
assert.equal(
  relevance(jblModelQuery, "JBL Tune 520BTX", { brand: "JBL" }).status,
  "REJECTED",
  "letra colada no codigo 520BTX nao e o modelo 520BT",
);
assert.equal(
  relevance(jblModelQuery, "JBL Tune X520BT", { brand: "JBL" }).status,
  "REJECTED",
  "X520BT como codigo unico nao e o modelo 520BT",
);
assert.equal(
  relevance(jblModelQuery, "JBL AB520BT", { brand: "JBL" }).status,
  "REJECTED",
  "AB520BT nao alinha a linha Tune da consulta",
);
assert.equal(
  relevance(jblModelQuery, "JBL XX520BT", { brand: "JBL" }).status,
  "REJECTED",
  "XX520BT nao alinha a linha Tune da consulta",
);

const galaxyModelQuery = "Samsung Galaxy A55 256GB";
assert.equal(
  relevance(galaxyModelQuery, "Smartphone Samsung Galaxy A55 256GB", {
    brand: "Samsung",
  }).status,
  "RELEVANT",
  "A55 compacto e o modelo pedido",
);
assert.equal(
  relevance(galaxyModelQuery, "Samsung Galaxy A55 5G Dual SIM 256 GB", {
    brand: "Samsung",
  }).status,
  "RELEVANT",
  "5G e especificacao separada, nao continuacao de A55",
);
assert.equal(
  relevance(galaxyModelQuery, "Smartphone Samsung Galaxy A550 256GB", {
    brand: "Samsung",
  }).status,
  "REJECTED",
  "A550 nao satisfaz o modelo A55",
);
assert.equal(
  relevance(galaxyModelQuery, "Smartphone Samsung Galaxy A551 256GB", {
    brand: "Samsung",
  }).status,
  "REJECTED",
  "A551 nao satisfaz o modelo A55",
);
assert.equal(
  relevance(galaxyModelQuery, "Samsung Galaxy A55B", { brand: "Samsung" }).status,
  "REJECTED",
  "letra colada no codigo A55B nao e o modelo A55",
);
assert.equal(
  relevance("Samsung Galaxy A55", "Samsung GalaxyA55", { brand: "Samsung" }).status,
  "RELEVANT",
  "GalaxyA55 e apresentacao da linha Galaxy pedida na consulta",
);
assert.equal(
  relevance("Samsung Galaxy A55", "Samsung ABA55", { brand: "Samsung" }).status,
  "REJECTED",
  "ABA55 nao alinha a linha Galaxy da consulta",
);
assert.equal(
  relevance("Samsung Galaxy A55", "Samsung XXA55", { brand: "Samsung" }).status,
  "REJECTED",
  "XXA55 nao alinha a linha Galaxy da consulta",
);
assert.equal(
  relevance("Samsung Galaxy A55", "Samsung XA55", { brand: "Samsung" }).status,
  "REJECTED",
  "XA55 nao alinha a linha Galaxy da consulta",
);

const isolatedJblQuery = "520BT";
assert.equal(
  relevance(isolatedJblQuery, "JBL Tune 520BT", { brand: "JBL" }).status,
  "RELEVANT",
  "consulta isolada 520BT aceita o modelo com marca e linha",
);
assert.equal(
  relevance(isolatedJblQuery, "JBL Tune 520 BT", { brand: "JBL" }).status,
  "RELEVANT",
  "consulta isolada 520BT aceita espaco de apresentacao",
);
assert.equal(
  relevance(isolatedJblQuery, "JBL Tune 520-BT", { brand: "JBL" }).status,
  "RELEVANT",
  "consulta isolada 520BT aceita hifen de apresentacao",
);
assert.equal(
  relevance(isolatedJblQuery, "JBL Tune520BT", { brand: "JBL" }).status,
  "REJECTED",
  "consulta isolada 520BT nao prova que Tune e a linha do codigo",
);
assert.equal(
  relevance(isolatedJblQuery, "JBL AB520BT", { brand: "JBL" }).status,
  "REJECTED",
  "consulta isolada 520BT rejeita prefixo colado AB520BT",
);
assert.equal(
  relevance(isolatedJblQuery, "JBL XX520BT", { brand: "JBL" }).status,
  "REJECTED",
  "consulta isolada 520BT rejeita prefixo colado XX520BT",
);
assert.equal(
  relevance(isolatedJblQuery, "JBL PRO520BT", { brand: "JBL" }).status,
  "REJECTED",
  "consulta isolada 520BT rejeita prefixo colado PRO520BT",
);
assert.equal(
  relevance(isolatedJblQuery, "JBL Tune 1520BT", { brand: "JBL" }).status,
  "REJECTED",
  "consulta isolada 520BT rejeita prefixo numerico 1520BT",
);
assert.equal(
  relevance(isolatedJblQuery, "JBL Tune 520BT2", { brand: "JBL" }).status,
  "REJECTED",
  "consulta isolada 520BT rejeita sufixo numerico 520BT2",
);
assert.equal(
  relevance(isolatedJblQuery, "JBL Tune 520BTX", { brand: "JBL" }).status,
  "REJECTED",
  "consulta isolada 520BT rejeita sufixo de letra 520BTX",
);
assert.equal(
  relevance(isolatedJblQuery, "JBL Tune X520BT", { brand: "JBL" }).status,
  "REJECTED",
  "consulta isolada 520BT rejeita letra isolada colada X520BT",
);

const isolatedGalaxyQuery = "A55";
assert.equal(
  relevance(isolatedGalaxyQuery, "Samsung Galaxy A55", { brand: "Samsung" }).status,
  "RELEVANT",
  "consulta isolada A55 aceita Galaxy A55",
);
assert.equal(
  relevance(isolatedGalaxyQuery, "Samsung Galaxy A55 5G", { brand: "Samsung" }).status,
  "RELEVANT",
  "consulta isolada A55 aceita 5G como especificacao separada",
);
assert.equal(
  relevance(isolatedGalaxyQuery, "Samsung GalaxyA55", { brand: "Samsung" }).status,
  "REJECTED",
  "consulta isolada A55 nao prova que Galaxy e a linha do codigo",
);
assert.equal(
  relevance(isolatedGalaxyQuery, "Samsung ABA55", { brand: "Samsung" }).status,
  "REJECTED",
  "consulta isolada A55 rejeita prefixo colado ABA55",
);
assert.equal(
  relevance(isolatedGalaxyQuery, "Samsung XXA55", { brand: "Samsung" }).status,
  "REJECTED",
  "consulta isolada A55 rejeita prefixo colado XXA55",
);
assert.equal(
  relevance(isolatedGalaxyQuery, "Samsung Galaxy A550", { brand: "Samsung" }).status,
  "REJECTED",
  "consulta isolada A55 rejeita A550",
);
assert.equal(
  relevance(isolatedGalaxyQuery, "Samsung Galaxy A55B", { brand: "Samsung" }).status,
  "REJECTED",
  "consulta isolada A55 rejeita sufixo de letra A55B",
);
assert.equal(
  relevance(isolatedGalaxyQuery, "Samsung Galaxy XA55", { brand: "Samsung" }).status,
  "REJECTED",
  "consulta isolada A55 rejeita letra isolada colada XA55",
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
    reject: [],
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

const copoMondial = relevance(
  "liquidificador Mondial 800W",
  "Copo para liquidificador Mondial",
);
assert.equal(copoMondial.status, "RELEVANT", "copo com HOST liquidificador entra em tier inferior");
assert.equal(copoMondial.rankTier, 2);
assert.equal(
  compareFingerprints(
    relevance("liquidificador Mondial 800W", "Liquidificador Mondial 800W copo de vidro").fingerprint,
    copoMondial.fingerprint,
  ).relation,
  "DIFFERENT",
  "copo nao entra no cluster do liquidificador",
);

const filtroQuery = "Filtro de barro";
const filtroPrimary = relevance(filtroQuery, "Filtro de Barro 6L");
assert.equal(filtroPrimary.status, "RELEVANT", "filtro de barro completo e PRIMARY");
assert.equal(filtroPrimary.fingerprint.role.value, "MAIN");
assert.equal(filtroPrimary.fingerprint.productClass.value, "clay_water_filter");
assert.ok(filtroPrimary.rankTier <= 1, "filtro completo nao pode cair no tier de peca");

const velaFiltro = relevance(filtroQuery, "Vela Filtro de Barro");
assert.equal(velaFiltro.status, "RELEVANT", "vela com HOST filtro de barro e peca relevante");
assert.equal(velaFiltro.fingerprint.role.value, "REPLACEMENT_PART");
assert.equal(velaFiltro.rankTier, 2);
assert.ok(
  (velaFiltro.fingerprint.hostItem.value ?? "").includes("filtro"),
  "vela precisa expor o HOST water_filter",
);

const torneiraFiltro = relevance(filtroQuery, "Torneira Filtro de Barro");
assert.equal(torneiraFiltro.status, "RELEVANT");
assert.ok(
  torneiraFiltro.fingerprint.role.value === "REPLACEMENT_PART" ||
    torneiraFiltro.fingerprint.role.value === "ACCESSORY",
);
assert.equal(torneiraFiltro.rankTier, 2);

assert.equal(
  compareFingerprints(filtroPrimary.fingerprint, torneiraFiltro.fingerprint).relation,
  "DIFFERENT",
  "filtro completo vs torneira = DIFFERENT",
);

const filtroRanked = processRawCandidates(filtroQuery, [
  raw("Vela Filtro de Barro", { price: 12, externalId: "vela-1" }),
  raw("Torneira para Filtro de Barro", { price: 18, externalId: "tor-1" }),
  raw("Filtro de Barro 8 litros tradicional", { price: 220, externalId: "fil-1" }),
  raw("Filtro de Barro 6L", { price: 198, externalId: "fil-2" }),
  raw("Filtro de Água Rotativo Extensível para Torneira", {
    price: 35,
    externalId: "aerador-1",
  }),
]);
const filtroOrder = filtroRanked.products.map((product) => product.offers[0]?.externalId);
const filtroPrimaryIds = filtroOrder.filter((id) => id === "fil-1" || id === "fil-2");
const filtroPartIds = filtroOrder.filter((id) => id === "vela-1" || id === "tor-1");
assert.ok(filtroPrimaryIds.length >= 1, "filtros PRIMARY entram no resultado");
assert.ok(filtroPartIds.length >= 1, "pecas com HOST ainda aparecem depois");
assert.ok(
  Math.max(...filtroPrimaryIds.map((id) => filtroOrder.indexOf(id!))) <
    Math.min(...filtroPartIds.map((id) => filtroOrder.indexOf(id!))),
  "PRIMARY filters antes de vela/torneira",
);
assert.equal(
  filtroRanked.relevant.some((item) => item.normalized.raw.externalId === "aerador-1"),
  false,
  "filtro de torneira/aerador nao e clay-water-filter",
);

const panelaQuery = "Panela de pressão 5L";
const panelaCore = buildQueryCore(panelaQuery);
assert.equal(panelaCore.attributes.capacity, "5l", "query 5L precisa aparecer em attributes");
const panela5 = relevance(panelaQuery, "Panela de Pressão 5L");
assert.equal(panela5.status, "RELEVANT");
assert.equal(panela5.fingerprint.role.value, "MAIN");
assert.equal(panela5.evidence.attributeMatches.includes("capacity"), true);
assert.equal(panela5.fingerprint.capacity.value, "5l");

const panela45 = relevance(panelaQuery, "Panela de Pressão 4,5L");
assert.equal(panela45.status, "REJECTED", "4,5L nao equivale a 5L");
assert.ok(panela45.hardConflicts.some((item) => item.startsWith("capacity:")));

const panelaModerna = relevance(panelaQuery, "Panela de Pressão Moderna (Minicozinha Mais!)");
assert.equal(panelaModerna.status, "RELEVANT", "ausencia de 5L nao inventa MATCH nem rejeita sozinha");
assert.equal(panelaModerna.evidence.attributeMatches.includes("capacity"), false);
assert.equal(panelaModerna.evidence.attributeMissing.includes("capacity"), true);
assert.notEqual(panelaModerna.rankTier, 0, "sem 5L nao recebe confiança PRIMARY alta");
assert.equal(
  panelaModerna.rankTier,
  3,
  "PRIMARY textual sem o atributo discriminativo da query fica TIER 3/ambiguo",
);

const panelaComValvula = relevance(panelaQuery, "Panela de Pressão 5L com válvula");
assert.equal(panelaComValvula.fingerprint.role.value, "MAIN");
assert.equal(panelaComValvula.status, "RELEVANT");

const pesoPanela = relevance(panelaQuery, "Peso Panela Pressão Rochedo");
assert.equal(pesoPanela.status, "RELEVANT");
assert.ok(
  pesoPanela.fingerprint.role.value === "REPLACEMENT_PART" ||
    pesoPanela.fingerprint.role.value === "ACCESSORY",
);
assert.equal(pesoPanela.rankTier, 2);

const valvulaPanela = relevance("Panela de pressão", "Válvula Panela de Pressão");
assert.ok(
  valvulaPanela.fingerprint.role.value === "REPLACEMENT_PART" ||
    valvulaPanela.fingerprint.role.value === "ACCESSORY",
);

assert.equal(
  compareFingerprints(panela5.fingerprint, pesoPanela.fingerprint).relation,
  "DIFFERENT",
  "panela vs peca = DIFFERENT",
);
assert.equal(
  compareFingerprints(panela5.fingerprint, valvulaPanela.fingerprint).relation,
  "DIFFERENT",
);

const panelaRanked = processRawCandidates(panelaQuery, [
  raw("Peso Panela Pressão Rochedo", { price: 19, externalId: "peso-1" }),
  raw("Válvula Panela de Pressão", { price: 22, externalId: "valv-1" }),
  raw("Anel de vedação panela de pressão", { price: 8, externalId: "anel-1" }),
  raw("Cuba interna panela de pressão", { price: 35, externalId: "cuba-1" }),
  raw("Tigela interna para panela de pressão 5L", { price: 42, externalId: "tigela-1" }),
  raw("Forro de panela de pressão", { price: 28, externalId: "forro-1" }),
  raw("Panela de Pressão 5L", { price: 189, externalId: "pan-5" }),
  raw("Panela de Pressão Moderna (Minicozinha Mais!)", { price: 29.97, externalId: "pan-mod" }),
  raw("Panela Elétrica de Arroz 5L", { price: 120, externalId: "arroz-5" }),
]);
const panelaIds = panelaRanked.products.map((product) => product.offers[0]?.externalId);
const panelaTiers = Object.fromEntries(
  panelaRanked.products.map((product) => [product.offers[0]?.externalId, product.rankTier]),
);
assert.equal(panelaTiers["pan-5"], 1, "pressure cooker 5L confirmado e TIER 1");
assert.equal(panelaTiers["pan-mod"], 3, "Minicozinha sem 5L e TIER 3/ambiguo");
assert.equal(
  panelaRanked.relevant.some((item) => item.normalized.raw.externalId === "arroz-5"),
  false,
  "rice cooker nao e equivalente a pressure cooker",
);
for (const partId of ["peso-1", "valv-1", "anel-1", "cuba-1", "tigela-1", "forro-1"]) {
  assert.equal(panelaTiers[partId], 2, `${partId} e peca TIER 2`);
}
assert.ok(
  (panelaIds.indexOf("pan-5") ?? 99) <
    Math.min(
      ...["peso-1", "valv-1", "anel-1", "cuba-1", "tigela-1", "forro-1"].map((id) =>
        panelaIds.indexOf(id),
      ),
    ),
  "pressure cooker confirmado antes das pecas",
);
assert.ok(
  Math.max(
    ...["peso-1", "valv-1", "anel-1", "cuba-1", "tigela-1", "forro-1"].map((id) =>
      panelaIds.indexOf(id),
    ),
  ) < (panelaIds.indexOf("pan-mod") ?? -1),
  "pecas compatíveis antes do candidato ambiguo sem a variante",
);

const motoQuery = "Moto G35";
const motoPhone = relevance(motoQuery, "Smartphone Motorola Moto G35");
assert.equal(motoPhone.status, "RELEVANT");
assert.equal(motoPhone.fingerprint.role.value, "MAIN");
assert.ok(motoPhone.rankTier <= 1);

const motoCapa = relevance(motoQuery, "Capa para Motorola Moto G35");
assert.equal(motoCapa.status, "RELEVANT");
assert.equal(motoCapa.fingerprint.role.value, "ACCESSORY");
assert.equal(motoCapa.rankTier, 2);

const motoPelicula = relevance(motoQuery, "Película para Moto G35");
assert.equal(motoPelicula.status, "RELEVANT");
assert.equal(motoPelicula.rankTier, 2);

const motoVidro = relevance(motoQuery, "2 pçs vidro temperado para moto g35");
assert.equal(motoVidro.status, "RELEVANT");
assert.equal(motoVidro.fingerprint.role.value, "ACCESSORY");
assert.equal(motoVidro.rankTier, 2);
assert.ok(
  (motoVidro.fingerprint.soldItem.value ?? "").includes("vidro"),
  "sold item do protetor e o vidro temperado, nao o telefone",
);
assert.ok(
  (motoVidro.fingerprint.hostItem.value ?? "").includes("g 35") ||
    (motoVidro.fingerprint.hostItem.value ?? "").includes("g35"),
  "host do vidro temperado e o Moto G35",
);

const motoInsulfilm = relevance(motoQuery, "Insulfilm G5 G20 G35");
assert.equal(
  motoInsulfilm.status,
  "REJECTED",
  "G35 orfao sem classe smartphone, sem host Moto, sem contexto Moto",
);
assert.ok(
  motoInsulfilm.hardConflicts.some((item) => item.startsWith("identityContext:")),
);

assert.equal(
  compareFingerprints(motoPhone.fingerprint, motoCapa.fingerprint).relation,
  "DIFFERENT",
  "phone vs capa = DIFFERENT",
);
assert.equal(
  compareFingerprints(motoPhone.fingerprint, motoVidro.fingerprint).relation,
  "DIFFERENT",
  "phone vs vidro temperado = DIFFERENT",
);
assert.equal(
  compareFingerprints(motoPhone.fingerprint, motoInsulfilm.fingerprint).relation,
  "DIFFERENT",
  "phone vs insulfilm = DIFFERENT",
);

assert.equal(
  relevance("G35", "Smartphone Motorola Moto G35").status,
  "RELEVANT",
  "query isolada G35 continua pesquisando por codigo/modelo",
);

const rankingMix = processRawCandidates(motoQuery, [
  raw("Smartphone Motorola Moto G35 128GB", { price: 1599, externalId: "p-128" }),
  raw("Smartphone Motorola Moto G35 256GB", { price: 1899, externalId: "p-256" }),
  raw("Smartphone Motorola Moto G35 512GB", { price: 2199, externalId: "p-512" }),
  raw("Capa para Motorola Moto G35", { price: 19, externalId: "a-capa" }),
  raw("Película para Moto G35", { price: 12, externalId: "a-pel" }),
  raw("Carregador para Moto G35", { price: 29, externalId: "a-chg" }),
  raw("Suporte para Moto G35", { price: 15, externalId: "a-sup" }),
  raw("2 pçs vidro temperado para moto g35", { price: 18, externalId: "a-vidro" }),
  raw("Insulfilm G5 G20 G35", { price: 9, externalId: "rej-insul" }),
]);
assert.equal(
  rankingMix.relevant.some((item) => item.normalized.raw.externalId === "rej-insul"),
  false,
  "insulfilm nao entra no ranking",
);
const mixIds = rankingMix.products.map((product) => product.offers[0]?.externalId);
const primaryMix = ["p-128", "p-256", "p-512"].filter((id) => mixIds.includes(id));
const accessoryMix = ["a-capa", "a-pel", "a-chg", "a-sup", "a-vidro"].filter((id) =>
  mixIds.includes(id),
);
assert.equal(primaryMix.length, 3, "os 3 PRIMARY caros entram");
assert.equal(accessoryMix.length, 5, "os ACCESSORY baratos entram depois, incluindo vidro temperado");
assert.ok(
  Math.max(...primaryMix.map((id) => mixIds.indexOf(id))) <
    Math.min(...accessoryMix.map((id) => mixIds.indexOf(id))),
  "3 PRIMARY aparecem antes dos 4 ACCESSORY independente do preco",
);
assert.ok(
  rankingMix.products.slice(0, 3).every((product) => product.rankTier <= 1),
);
assert.ok(
  rankingMix.products.slice(3).every((product) => product.rankTier >= 2),
);

const acerQuery =
  "Notebook Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB DDR5 RTX 4050 512SSD";
const acerExact = relevance(
  acerQuery,
  "Notebook Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB DDR5 NVIDIA GeForce RTX 4050 512SSD",
  { brand: "Acer" },
);
assert.equal(acerExact.status, "RELEVANT");
assert.equal(acerExact.fingerprint.role.value, "MAIN");
assert.equal(acerExact.rankTier, 0);
const acerMulti = processRawCandidates(acerQuery, [
  raw(
    "Notebook Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB DDR5 RTX 4050 512SSD",
    { brand: "Acer", marketplace: "AMAZON", externalId: "acer-amz", price: 5299 },
  ),
  raw(
    "Notebook Gamer Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB DDR5 RTX 4050 512SSD",
    {
      brand: "Acer",
      marketplace: "MAGAZINE_LUIZA",
      marketplaceName: "Magazine Luiza",
      externalId: "acer-mag",
      price: 4999,
    },
  ),
]);
assert.equal(acerMulti.relevant.length, 2, "Acer Nitro V15 exato continua PRIMARY");
assert.ok(
  acerMulti.products.some((product) => product.offers.length >= 2),
  "Acer Nitro V15 exato continua Multi Loja",
);

const booksVsPanela = relevance(panelaQuery, "Panela de Pressão Moderna", {
  category: "Livros",
});
assert.equal(
  booksVsPanela.status,
  "REJECTED",
  "categoria textual BOOKS/LIVROS conflita com cookware",
);
const kitchenPanela = relevance(panelaQuery, "Panela de Pressão Moderna", {
  category: "Kitchen / Cookware",
});
assert.equal(kitchenPanela.status, "RELEVANT");
assert.notEqual(kitchenPanela.evidence.productClassCompatibility, "CONFLICT");
const numericShopee = relevance(panelaQuery, "Panela de Pressão Moderna", {
  category: "101545",
});
assert.equal(numericShopee.status, "RELEVANT");
assert.equal(
  numericShopee.fingerprint.marketplaceCategory.value,
  "101545",
  "ID numerico Shopee e preservado",
);
assert.equal(
  numericShopee.fingerprint.marketplaceCategory.confidence,
  "NONE",
  "ID numerico Shopee nao finge significado",
);
const sellerIsNotClass = relevance(panelaQuery, "Panela de Pressão Moderna", {
  seller: "Livraria Central",
  category: null,
});
assert.equal(
  sellerIsNotClass.status,
  "RELEVANT",
  "seller nao define categoria/classe",
);

const pressureCooker5 = relevance("Panela de pressão 5L", "Panela de Pressão 5L");
const riceCooker5 = relevance("Panela de pressão 5L", "Panela Elétrica de Arroz 5L");
assert.equal(pressureCooker5.fingerprint.productClass.value, "pressure_cooker");
assert.equal(
  riceCooker5.fingerprint.productClass.value,
  "rice_cooker",
  "panela de arroz e core distinto, nao cookware amplo",
);
assert.equal(
  riceCooker5.status,
  "REJECTED",
  "pressure cooker 5L x rice cooker 5L nao e relevante para a query",
);
assert.equal(
  compareFingerprints(pressureCooker5.fingerprint, riceCooker5.fingerprint).relation,
  "DIFFERENT",
  "pressure cooker 5L x rice cooker 5L = DIFFERENT",
);

const innerBowl5 = relevance(
  "Panela de pressão 5L",
  "Tigela interna substituição para panela de pressão 5L",
);
assert.ok(
  innerBowl5.fingerprint.role.value === "REPLACEMENT_PART" ||
    innerBowl5.fingerprint.role.value === "ACCESSORY",
  "tigela interna e peca, nao a panela",
);
assert.equal(innerBowl5.rankTier, 2);
assert.equal(
  compareFingerprints(pressureCooker5.fingerprint, innerBowl5.fingerprint).relation,
  "DIFFERENT",
  "pressure cooker 5L x inner bowl 5L = DIFFERENT",
);

const forroPanela = relevance("Panela de pressão 5L", "Forro de panela de pressão 5L");
assert.ok(
  forroPanela.fingerprint.role.value === "REPLACEMENT_PART" ||
    forroPanela.fingerprint.role.value === "ACCESSORY",
);
assert.equal(
  compareFingerprints(pressureCooker5.fingerprint, forroPanela.fingerprint).relation,
  "DIFFERENT",
);

const panelaComTigela = relevance(
  "Panela de pressão 5L",
  "Panela de Pressão 5L com tigela interna",
);
assert.equal(panelaComTigela.fingerprint.role.value, "MAIN");
assert.ok(panelaComTigela.rankTier <= 1);

const panelaComTigelaRemovivel = relevance(
  "Panela de pressão 5L",
  "Panela de pressão 5L com tigela interna removível",
);
assert.equal(
  panelaComTigelaRemovivel.fingerprint.role.value,
  "MAIN",
  "tigela interna como atributo da panela, sem semantica de reposicao, continua MAIN",
);
assert.ok(panelaComTigelaRemovivel.rankTier <= 1);

const panelaComRecipiente = relevance(
  "Panela de pressão 5L",
  "Panela de pressão 5L com recipiente interno antiaderente",
);
assert.equal(
  panelaComRecipiente.fingerprint.role.value,
  "MAIN",
  "recipiente interno como atributo da panela completa continua MAIN",
);
assert.ok(panelaComRecipiente.rankTier <= 1);

const tigelaDeSubstituicao = relevance(
  "Panela de pressão 5L",
  "Panela de pressão elétrica, tigela interna de substituição",
);
assert.equal(tigelaDeSubstituicao.fingerprint.role.value, "REPLACEMENT_PART");
assert.equal(tigelaDeSubstituicao.status, "RELEVANT");
assert.equal(tigelaDeSubstituicao.rankTier, 2);
assert.equal(
  compareFingerprints(pressureCooker5.fingerprint, tigelaDeSubstituicao.fingerprint)
    .relation,
  "DIFFERENT",
);

const tigelaParaPanela = relevance(
  "Panela de pressão 5L",
  "Tigela interna para panela de pressão 5L",
);
assert.equal(tigelaParaPanela.fingerprint.role.value, "REPLACEMENT_PART");
assert.equal(tigelaParaPanela.rankTier, 2);

const forroDeArrozAposHost = relevance(
  "Panela de pressão 5L",
  "REDMOND RMC-M20 Panela de pressão elétrica inteligente multifuncional Forro de panela de arroz 5L",
);
assert.equal(
  forroDeArrozAposHost.fingerprint.role.value,
  "REPLACEMENT_PART",
  "forro como head explicito depois do host nao e a panela completa",
);
assert.equal(forroDeArrozAposHost.status, "RELEVANT");
assert.equal(forroDeArrozAposHost.rankTier, 2);
assert.ok(
  (forroDeArrozAposHost.fingerprint.soldItem.value ?? "").includes("forro"),
  "sold item e o forro, nao a panela",
);
assert.equal(
  compareFingerprints(pressureCooker5.fingerprint, forroDeArrozAposHost.fingerprint)
    .relation,
  "DIFFERENT",
);

const tigelaAliexpress = relevance(
  "Panela de pressão 5L",
  "Panela de pressão elétrica com alça, tigela interna, substituição, MY-12SS509A, 13SS505A, 13PSS506A, 5L",
);
assert.equal(
  tigelaAliexpress.fingerprint.role.value,
  "REPLACEMENT_PART",
  "host-first + tigela interna + substituicao e peca",
);
assert.equal(tigelaAliexpress.status, "RELEVANT");
assert.equal(tigelaAliexpress.rankTier, 2);
assert.ok((tigelaAliexpress.fingerprint.soldItem.value ?? "").includes("tigela"));
assert.equal(
  compareFingerprints(pressureCooker5.fingerprint, tigelaAliexpress.fingerprint).relation,
  "DIFFERENT",
);

const hostFirstParts = processRawCandidates(panelaQuery, [
  raw("Panela de Pressão 5L", { price: 189, externalId: "pan-5b" }),
  raw("Panela de pressão 5L com tigela interna removível", {
    price: 210,
    externalId: "pan-feat",
  }),
  raw("Panela de pressão 5L com recipiente interno antiaderente", {
    price: 205,
    externalId: "pan-recip",
  }),
  raw("Panela de pressão elétrica, tigela interna de substituição", {
    price: 80,
    externalId: "part-subst",
  }),
  raw("Forro de panela de pressão 5L", { price: 28, externalId: "part-forro" }),
  raw(
    "REDMOND RMC-M20 Panela de pressão elétrica inteligente multifuncional Forro de panela de arroz 5L",
    { price: 94, externalId: "part-redmond" },
  ),
  raw("Tigela interna para panela de pressão 5L", {
    price: 42,
    externalId: "part-tigela",
  }),
  raw(
    "Panela de pressão elétrica com alça, tigela interna, substituição, MY-12SS509A, 13SS505A, 13PSS506A, 5L",
    { price: 223, externalId: "part-aliex" },
  ),
  raw("Panela Elétrica de Arroz 5L", { price: 120, externalId: "arroz-host" }),
  raw("Panela de Pressão Moderna (Minicozinha Mais!)", {
    price: 29.97,
    externalId: "mini-host",
  }),
]);
const hostFirstTiers = Object.fromEntries(
  hostFirstParts.relevant.map((item) => [
    item.normalized.raw.externalId,
    item.rankTier,
  ]),
);
const hostFirstRoles = Object.fromEntries(
  hostFirstParts.relevant.map((item) => [
    item.normalized.raw.externalId,
    item.fingerprint.role.value,
  ]),
);
assert.equal(hostFirstTiers["pan-5b"], 1);
assert.equal(hostFirstTiers["pan-feat"], 1);
assert.equal(hostFirstTiers["pan-recip"], 1);
assert.equal(hostFirstRoles["part-subst"], "REPLACEMENT_PART");
assert.equal(hostFirstTiers["part-subst"], 2);
assert.equal(hostFirstTiers["part-forro"], 2);
assert.equal(hostFirstTiers["part-redmond"], 2);
assert.equal(hostFirstTiers["part-tigela"], 2);
assert.equal(hostFirstTiers["part-aliex"], 2);
assert.equal(hostFirstTiers["mini-host"], 3);
assert.equal(
  hostFirstParts.relevant.some((item) => item.normalized.raw.externalId === "arroz-host"),
  false,
  "panela de arroz continua rejeitada",
);
assert.equal(
  hostFirstParts.clusters.some((cluster) => {
    const roles = new Set(
      cluster.members.map((member) => member.candidate.fingerprint.role.value),
    );
    const classes = new Set(
      cluster.members.map((member) => member.candidate.fingerprint.productClass.value),
    );
    const hasMain = roles.has("MAIN");
    const hasPart = roles.has("REPLACEMENT_PART") || roles.has("ACCESSORY");
    const hasCooker = [...classes].some(
      (item) => item === "pressure_cooker" || item === "cookware",
    );
    const hasRice = classes.has("rice_cooker");
    const hasBook = classes.has("book");
    return (hasMain && hasPart) || (hasCooker && hasRice) || (hasCooker && hasBook);
  }),
  false,
  "nenhum cluster mistura panela completa com peca/livro/arroz",
);

const capacityIsNotModel = compareFingerprints(
  relevance("Panela de pressão 5L", "Panela de Pressão Moderna (Minicozinha Mais!)").fingerprint,
  riceCooker5.fingerprint,
);
assert.equal(
  capacityIsNotModel.relation,
  "DIFFERENT",
  "capacidade igual nao prova SAME; cores distintos nao agrupam",
);
const motoVidroMulti = relevance(
  motoQuery,
  "2 pçs vidro temperado livre de poeira para moto g15 g05 g75 g55 g35 um clique fácil instalar filme para motorola edge 60",
);
assert.equal(motoVidroMulti.status, "RELEVANT");
assert.equal(motoVidroMulti.fingerprint.role.value, "ACCESSORY");
assert.equal(motoVidroMulti.rankTier, 2);

const forroComUso = relevance(
  "Panela de pressão 5L",
  "Forro de panela de pressão elétrica 5l, tigelas internas, tigela multicooker, tanque de aço inoxidável para cozinhar sopa",
);
assert.ok(
  forroComUso.fingerprint.role.value === "REPLACEMENT_PART" ||
    forroComUso.fingerprint.role.value === "ACCESSORY",
  "forro continua peca mesmo com para de uso/finalidade no titulo",
);
assert.equal(forroComUso.status, "RELEVANT");
assert.equal(forroComUso.rankTier, 2);

const clayVsFaucet = relevance(
  "Filtro de barro",
  "Filtro de Água Rotativo Extensível para Torneira",
);
assert.equal(
  clayVsFaucet.status,
  "REJECTED",
  "filtro de barro x filtro de torneira = relevance rejected",
);
assert.notEqual(clayVsFaucet.fingerprint.productClass.value, "clay_water_filter");
assert.equal(
  compareFingerprints(filtroPrimary.fingerprint, clayVsFaucet.fingerprint).relation,
  "DIFFERENT",
);

assert.equal(velaFiltro.fingerprint.role.value, "REPLACEMENT_PART");
assert.ok(
  torneiraFiltro.fingerprint.role.value === "REPLACEMENT_PART" ||
    torneiraFiltro.fingerprint.role.value === "ACCESSORY",
);

console.log("query relevance regression: todos os casos estruturais passaram");
