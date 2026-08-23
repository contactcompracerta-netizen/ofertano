import assert from "node:assert/strict";

import { avaliarCompatibilidadeExataEntreImports } from "./exactMatcher";
import { pontuarEspecificidadeDaConsulta, criarConsultasGlobaisDeIdentidade, avaliarCompatibilidadeComConsulta, candidatoPodeSeguirNoDiscovery, tokensDistintivosDaConsulta } from "./queryMatcher";
import { criarCanonicalKeyDaIdentidade, papelDaIdentidade, resolverIdentidadeProduto, codigosDeIdentidadeDoItemVendido } from "./resolver";

function listing(
  title: string,
  brand: string | null = null,
  attributes: Record<string, string> = {},
) {
  return {
    title,
    brand,
    attributes,
  };
}

function mustBeExact(firstTitle: string, secondTitle: string, brand: string) {
  const result = avaliarCompatibilidadeExataEntreImports(
    listing(firstTitle, brand),
    listing(secondTitle, brand),
  );

  assert.equal(
    result.exact,
    true,
    `Expected EXACT:\n${firstTitle}\n${secondTitle}\n${result.reason}`,
  );
}

function mustBeDifferent(firstTitle: string, secondTitle: string, brand: string) {
  const result = avaliarCompatibilidadeExataEntreImports(
    listing(firstTitle, brand),
    listing(secondTitle, brand),
  );

  assert.equal(
    result.exact,
    false,
    `Expected DIFFERENT:\n${firstTitle}\n${secondTitle}\n${result.reason}`,
  );
}

mustBeExact(
  "Smartphone Samsung Galaxy A55 256GB Preto 5G",
  "Samsung Galaxy A55 5G 256 GB Dual Chip",
  "Samsung",
);

mustBeExact(
  "WAP W100 Bivolt",
  "Lavadora de Alta Pressao WAP W100",
  "WAP",
);

mustBeDifferent(
  "Samsung Galaxy A16 4G 128GB",
  "Samsung Galaxy A16 5G 128GB",
  "Samsung",
);

mustBeDifferent(
  "Motorola Moto G75 256GB",
  "Motorola Moto G77 256GB",
  "Motorola",
);

mustBeDifferent(
  "Samsung Galaxy A55 128GB",
  "Samsung Galaxy A55 256GB",
  "Samsung",
);

mustBeDifferent(
  "Aspirador de Po 127V Mondial",
  "Aspirador de Po 220V Mondial",
  "Mondial",
);

mustBeDifferent(
  "Smart TV Samsung 55 polegadas 4K",
  "Smart TV Samsung 65 polegadas 4K",
  "Samsung",
);

mustBeDifferent(
  "Samsung Galaxy A55 256GB",
  "Capa para Samsung Galaxy A55 256GB",
  "Samsung",
);

mustBeDifferent(
  "Fone JBL Tune 510BT",
  "Kit Fone JBL Tune 510BT + Capa",
  "JBL",
);

mustBeDifferent(
  "Motorola Edge 60 Fusion 256GB",
  "Motorola Edge 60 Pro 256GB",
  "Motorola",
);

mustBeExact(
  "Smartphone NovaTech Pulse NTX20‑41‑8C3 128GB 5G",
  "Smartphone NovaTech Pulse NTX20-41-8C3 128GB 5G Dual Chip",
  "NovaTech",
);

mustBeDifferent(
  "Smartphone NovaTech Pulse NTX20-41-8C3 128GB 5G",
  "Smartphone NovaTech Pulse NTX20-41-9D1 128GB 5G",
  "NovaTech",
);

mustBeDifferent(
  "Notebook Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB DDR5 RTX 4050 512SSD",
  "Notebook Gamer Acer Nitro V15 Intel Core i5 512GB SSD 16GB RAM NVIDIA RTX 4050 Linux ANV15-52-52X",
  "Acer",
);

mustBeExact(
  "Notebook Acer Nitro V15 ANV15‑52‑51E4 Intel Core i5-13420H 16GB DDR5 RTX 4050",
  "Notebook Gamer Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB RTX 4050",
  "Acer",
);

const queryAcer =
  "Notebook Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB DDR5 RTX 4050 512SSD";

assert.ok(
  pontuarEspecificidadeDaConsulta(queryAcer, {
    title:
      "Notebook Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB DDR5 NVIDIA GeForce RTX 4050 512SSD",
    brand: "Acer",
    attributes: {},
  }) >
    pontuarEspecificidadeDaConsulta(queryAcer, {
      title:
        "Notebook Gamer Acer Nitro V15 Intel Core i5 512GB SSD 16GB RAM NVIDIA RTX 4050 Linux ANV15-52-52X",
      brand: "Acer",
      attributes: {},
    }),
  "O SKU pedido na consulta deve pontuar mais que um submodelo vizinho da mesma linha.",
);

assert.ok(
  criarConsultasGlobaisDeIdentidade(queryAcer).some((consulta) =>
    /ANV15-52-51E4/i.test(consulta),
  ),
  "O plano global de busca deve usar o SKU especifico, nao so a linha V15.",
);

function identityOf(title: string, brand: string | null = null) {
  return resolverIdentidadeProduto({
    title,
    brand,
    attributes: {},
  });
}

assert.equal(
  identityOf("Capa Aurora Pulse AX90").kind,
  "ACCESSORY",
  "Capa no inicio do titulo e acessorio mesmo sem a preposicao para.",
);
assert.equal(
  identityOf("Pelicula Aurora Pulse AX90").kind,
  "ACCESSORY",
  "Pelicula no inicio do titulo e acessorio.",
);
assert.equal(
  identityOf("Cabo carregador Aurora Pulse AX90").kind,
  "ACCESSORY",
  "Cabo/carregador no inicio do titulo e acessorio.",
);
assert.equal(
  identityOf("Smartphone Aurora Pulse AX90 256GB", "Aurora").kind,
  "GENERIC",
  "Smartphone e o produto principal.",
);
assert.equal(
  identityOf("Fone de Ouvido Aurora Tune ZX20 Bluetooth", "Aurora").kind,
  "GENERIC",
  "Fone e categoria de produto principal, nao envelopador.",
);

const replacementPads = identityOf(
  "Almofadas de gel de resfriamento de substituicao para fone de ouvido Aurora Tune ZX90 ZX100 ZX200 ZX300 JR10 JR20",
  "Aurora",
);
assert.equal(
  replacementPads.kind,
  "REPLACEMENT_PART",
  "Almofada de substituicao e peca, mesmo quando o titulo cita fone depois de para.",
);
assert.equal(replacementPads.role, "REPLACEMENT_PART");
assert.equal(
  replacementPads.multiModelCompatibility,
  true,
  "Varios modelos no titulo sao lista de compatibilidade, nao identidade MAIN.",
);
assert.equal(
  replacementPads.model,
  null,
  "Nenhum modelo da lista de compatibilidade pode virar o modelo principal.",
);
assert.equal(
  criarCanonicalKeyDaIdentidade(replacementPads),
  null,
  "Lista de compatibilidade nao fabrica canonicalKey de aparelho.",
);

assert.equal(
  avaliarCompatibilidadeComConsulta(
    "Headphone Aurora ZX100",
    listing(replacementPads.title, "Aurora"),
  ).compatible,
  false,
  "Consulta MAIN rejeita peca de reposicao mesmo com o modelo no titulo.",
);
assert.equal(
  avaliarCompatibilidadeComConsulta(
    "Headphone Aurora ZX100",
    listing(replacementPads.title, "Aurora"),
  ).roleCompatible,
  false,
);
assert.ok(
  avaliarCompatibilidadeComConsulta(
    "Headphone Aurora ZX100",
    listing(replacementPads.title, "Aurora"),
  ).textRelevance > 0,
  "Relevancia textual pode ser alta; papel continua incompativel.",
);

assert.equal(
  avaliarCompatibilidadeComConsulta(
    "almofada Aurora ZX100",
    listing(replacementPads.title, "Aurora"),
  ).compatible,
  true,
  "Consulta explicita de peca deve aceitar a peca de reposicao.",
);

mustBeDifferent(
  "Headphone Aurora ZX100 Bluetooth",
  replacementPads.title,
  "Aurora",
);
assert.equal(
  papelDaIdentidade(identityOf("Aurora Pulse AX90 256GB", "Aurora")),
  "MAIN",
);
assert.equal(
  papelDaIdentidade(identityOf("Capa Aurora Pulse AX90", "Aurora")),
  "ACCESSORY",
);

mustBeDifferent(
  "Smartphone Aurora Pulse AX90 256GB",
  "Capa Aurora Pulse AX90",
  "Aurora",
);

mustBeDifferent(
  "Smartphone Aurora Pulse AX90 256GB",
  "Pelicula Aurora Pulse AX90",
  "Aurora",
);

mustBeDifferent(
  "Smartphone Aurora Pulse AX90 256GB",
  "Cabo carregador Aurora Pulse AX90",
  "Aurora",
);

mustBeExact(
  "Fone de Ouvido Aurora Tune ZX20 Bluetooth",
  "Aurora Tune ZX20 Headset Bluetooth",
  "Aurora",
);

mustBeExact(
  "Lanterna Tatica LED Aurora 1200lm Recarregavel",
  "Lanterna Tatica LED Recarregavel Aurora 1200lm",
  "Aurora",
);

assert.equal(
  avaliarCompatibilidadeComConsulta(
    "Smartphone Aurora Pulse AX90",
    listing("Capa Aurora Pulse AX90", "Aurora"),
  ).compatible,
  false,
  "Consulta do produto principal deve recusar capa sem a preposicao para.",
);

assert.equal(
  avaliarCompatibilidadeComConsulta(
    "Pendrive",
    listing("Pen Drive 128GB USB 2.0 Metalico", null),
  ).compatible,
  true,
  "Pen Drive e Pendrive sao a mesma classe comercial.",
);

const phoneKey = criarCanonicalKeyDaIdentidade(
  identityOf("Smartphone Aurora Pulse AX90 256GB", "Aurora"),
);
const caseKey = criarCanonicalKeyDaIdentidade(
  identityOf("Capa Aurora Pulse AX90", "Aurora"),
);

assert.ok(phoneKey && caseKey);
assert.notEqual(
  phoneKey,
  caseKey,
  "Produto principal e acessorio nao podem compartilhar canonicalKey.",
);

const STORAGE_CASE =
  "Estojo de armazenamento de headphone para MarcaX ZX100 ZX200 ZX300 bolsa rigida de transporte";
const HEADPHONE_MAIN = "Headphone MarcaX ZX100 Bluetooth";
const CAMERA_BAG = "Bolsa para camera MarcaX C100 C200 C300";
const PHONE_WITH_EXTRAS =
  "Smartphone MarcaX A10 256GB com capa e carregador";
const SPEAKER = "Caixa de som MarcaX Boom100";
const CASE_FOR_HEADPHONE = "Estojo de transporte para Headphone MarcaX ZX100";
const HEADPHONE_WITH_CASE = "Headphone MarcaX ZX100 com estojo de transporte";

const storageCase = identityOf(STORAGE_CASE, "MarcaX");
const headphoneMain = identityOf(HEADPHONE_MAIN, "MarcaX");

assert.equal(headphoneMain.role, "MAIN");
assert.equal(headphoneMain.soldItemType, "PRIMARY");
assert.equal(headphoneMain.model, "ZX100");
assert.equal(headphoneMain.multiModelCompatibility, false);

assert.equal(storageCase.role, "ACCESSORY");
assert.equal(storageCase.soldItemType, "ACCESSORY");
assert.equal(storageCase.multiModelCompatibility, true);
assert.equal(storageCase.model, null);
assert.ok(storageCase.hostModelCandidates.includes("ZX100"));
assert.ok(storageCase.hostModelCandidates.length >= 3);
assert.equal(storageCase.identityModelCandidates.length, 0);
assert.equal(
  criarCanonicalKeyDaIdentidade(storageCase),
  null,
  "Lista de hospedeiros nao vira canonicalKey do aparelho.",
);
assert.equal(
  avaliarCompatibilidadeComConsulta(
    "Headphone MarcaX ZX100",
    listing(STORAGE_CASE, "MarcaX"),
  ).roleCompatible,
  false,
);

const cameraBag = identityOf(CAMERA_BAG, "MarcaX");
assert.equal(cameraBag.role, "ACCESSORY");
assert.equal(cameraBag.multiModelCompatibility, true);
assert.equal(cameraBag.model, null);
assert.ok(cameraBag.hostModelCandidates.includes("C100"));
assert.ok(!cameraBag.identityModelCandidates.includes("C100"));

const phoneWithExtras = identityOf(PHONE_WITH_EXTRAS, "MarcaX");
assert.equal(phoneWithExtras.role, "MAIN");
assert.equal(phoneWithExtras.soldItemType, "PRIMARY");
assert.ok(
  phoneWithExtras.model === "A10" || phoneWithExtras.model?.includes("A10"),
);

const speaker = identityOf(SPEAKER, "MarcaX");
assert.equal(
  speaker.role,
  "MAIN",
  "Caixa de som e produto principal, nao envelope de transporte.",
);
assert.equal(speaker.soldItemType, "PRIMARY");
assert.ok(
  speaker.model === "BOOM100" || speaker.model?.includes("BOOM100"),
  "Modelo da caixa de som deve permanecer no item vendido.",
);

assert.equal(identityOf(CASE_FOR_HEADPHONE, "MarcaX").role, "ACCESSORY");
assert.equal(identityOf(HEADPHONE_WITH_CASE, "MarcaX").role, "MAIN");
assert.equal(identityOf(HEADPHONE_WITH_CASE, "MarcaX").model, "ZX100");

assert.ok(
  !codigosDeIdentidadeDoItemVendido(headphoneMain).includes("ZX200"),
);
assert.ok(
  !codigosDeIdentidadeDoItemVendido(storageCase).includes("ZX200"),
  "Matcher/resolver nao podem promover modelo de hospedeiro a identidade vendida.",
);
assert.equal(
  avaliarCompatibilidadeExataEntreImports(
    listing(HEADPHONE_MAIN, "MarcaX"),
    listing(STORAGE_CASE, "MarcaX"),
  ).exact,
  false,
);

const matcherReason = avaliarCompatibilidadeExataEntreImports(
  listing(HEADPHONE_MAIN, "MarcaX"),
  listing(STORAGE_CASE, "MarcaX"),
).reason;
assert.ok(
  !/ZX200|ZX300/.test(matcherReason) || /acessorio|hospedeiro|compatibilidade|principal/i.test(matcherReason),
  "O matcher deve recusar pelo papel/hospedeiro, nao fabricando SKU Y da lista.",
);
assert.equal(headphoneMain.model, "ZX100");

const MODEL_PLUS_SKU = "Headphone MarcaX ZX100 MXZX100 Branco";
const modelPlusSku = identityOf(MODEL_PLUS_SKU, "MarcaX");
assert.equal(
  modelPlusSku.commercialModel,
  "ZX100",
  "Modelo comercial explicito nao pode ser substituido pelo SKU composto.",
);
assert.equal(modelPlusSku.model, "ZX100");
assert.equal(modelPlusSku.manufacturerSku, "MXZX100");
assert.ok(
  criarCanonicalKeyDaIdentidade(modelPlusSku)?.includes(":ZX100:"),
  "canonicalKey deve usar o modelo comercial, nao o part number.",
);

mustBeExact(HEADPHONE_MAIN, MODEL_PLUS_SKU, "MarcaX");

assert.equal(
  avaliarCompatibilidadeExataEntreImports(
    listing(HEADPHONE_MAIN, "MarcaX"),
    listing(MODEL_PLUS_SKU, "MarcaX"),
  ).exact,
  true,
  "SKU presente so em um lado nao rejeita equivalencia comercial.",
);

mustBeDifferent(
  "Headphone MarcaX ZX100 MXZX100",
  "Headphone MarcaX ZX100 QXZX100",
  "MarcaX",
);

const skuA = identityOf("Headphone MarcaX ZX100 MXZX100", "MarcaX");
const skuB = identityOf("Headphone MarcaX ZX100 QXZX100", "MarcaX");
assert.equal(skuA.commercialModel, "ZX100");
assert.equal(skuB.commercialModel, "ZX100");
assert.equal(skuA.manufacturerSku, "MXZX100");
assert.equal(skuB.manufacturerSku, "QXZX100");

mustBeDifferent(
  "Headphone MarcaX ZX100",
  "Headphone MarcaX ZX100PRO",
  "MarcaX",
);
mustBeDifferent(
  "Headphone MarcaX ZX100",
  "Headphone MarcaX ZX100S",
  "MarcaX",
);
mustBeDifferent(
  "Headphone MarcaX ZX100",
  "Headphone MarcaX ZX200",
  "MarcaX",
);

const repackaged = identityOf(
  "Headphone MarcaX ZX100 REEMBALADO",
  "MarcaX",
);
assert.equal(repackaged.commercialModel, "ZX100");
assert.equal(repackaged.variants.condition, "repackaged");
assert.equal(
  avaliarCompatibilidadeExataEntreImports(
    listing(HEADPHONE_MAIN, "MarcaX"),
    listing("Headphone MarcaX ZX100 REEMBALADO", "MarcaX"),
  ).exact,
  true,
  "Condicao reembalado nao fragmenta o Product; so nao deve virar ancora.",
);

const longExactQuery =
  "Headphone MarcaR Wave Wireless Rosa Resistente à Água";
const longExactTitle =
  "Headphone MarcaR Wave Wireless Rosa Resistente à Água";
const longExactShorterTitle =
  "Headphone MarcaR Wave Wireless Rosa";

assert.equal(
  candidatoPodeSeguirNoDiscovery(longExactQuery, longExactTitle).keep,
  true,
  "Titulo quase exato nao pode ser eliminado no Discovery.",
);
assert.equal(
  candidatoPodeSeguirNoDiscovery(longExactQuery, longExactShorterTitle).keep,
  true,
  "Faltar adjetivo generico nao pode eliminar o produto distintivo antes do Identity.",
);
assert.equal(
  avaliarCompatibilidadeComConsulta(
    longExactQuery,
    listing(longExactTitle),
  ).compatible,
  true,
);

const distinctiveQuery = "Headphone MarcaR Wireless Rosa";
const matchSameBrand = avaliarCompatibilidadeComConsulta(
  distinctiveQuery,
  listing("Headphone MarcaR Wireless Rosa"),
);
const matchOtherBrand = avaliarCompatibilidadeComConsulta(
  distinctiveQuery,
  listing("Headphone MarcaS Wireless Rosa"),
);
const matchGenericCode = avaliarCompatibilidadeComConsulta(
  distinctiveQuery,
  listing("Headphone Wireless Rosa P47"),
);

assert.equal(matchSameBrand.compatible, true);
assert.ok(
  matchSameBrand.score > matchOtherBrand.score,
  "A mesma entidade distintiva deve ser claramente superior.",
);
assert.equal(matchOtherBrand.compatible, false);
assert.ok(
  matchOtherBrand.conflicts.some((item) => item.startsWith("brand:")),
  "Marca/entidade distinta deve gerar conflito de marca.",
);
assert.equal(matchGenericCode.compatible, false);
assert.ok(
  matchGenericCode.textRelevance < 0.8,
  "Termos genericos nao podem produzir relevancia 0.8.",
);

const missingBrandQuery = "Headphone MarcaR Wireless";
const missingBrandCandidate = listing("Headphone Wireless modelo X");
const missingBrandMatch = avaliarCompatibilidadeComConsulta(
  missingBrandQuery,
  missingBrandCandidate,
);
assert.equal(missingBrandMatch.compatible, false);
assert.equal(
  resolverIdentidadeProduto(missingBrandCandidate).brand,
  null,
  "Nao inventar marca quando o candidato nao traz evidencia.",
);

const genericQuery = "Headphone Wireless Rosa";
assert.equal(
  avaliarCompatibilidadeComConsulta(
    genericQuery,
    listing("Headphone MarcaR Wireless Rosa"),
  ).compatible,
  true,
  "Consulta generica nao torna marca obrigatoria.",
);
assert.equal(
  avaliarCompatibilidadeComConsulta(
    genericQuery,
    listing("Headphone MarcaS Wireless Rosa"),
  ).compatible,
  true,
  "Marcas diferentes podem ser relevantes quando a consulta nao pede marca.",
);

const progressivePlan = criarConsultasGlobaisDeIdentidade(longExactQuery);
assert.equal(progressivePlan[0], longExactQuery);
assert.ok(
  tokensDistintivosDaConsulta(longExactQuery).includes("marcar"),
);
assert.ok(
  tokensDistintivosDaConsulta(longExactQuery).includes("wave"),
);
assert.ok(
  progressivePlan.some(
    (consulta) =>
      consulta.length < longExactQuery.length &&
      /marcar/.test(consulta) &&
      /wave/.test(consulta),
  ),
  "Consulta longa deve gerar fallback progressivo com termos distintivos.",
);

const missingColor = avaliarCompatibilidadeComConsulta(
  "Headphone MarcaX Rosa",
  listing("Headphone MarcaX"),
);
assert.equal(
  missingColor.compatible,
  true,
  "Cor nao informada nao e conflito de identidade.",
);
assert.equal(
  missingColor.conflicts.some((item) => item.includes("nao-informado")),
  false,
);

const conflictingColor = avaliarCompatibilidadeComConsulta(
  "Headphone MarcaX Rosa",
  listing("Headphone MarcaX Azul"),
);
assert.equal(conflictingColor.compatible, false);
assert.ok(
  conflictingColor.conflicts.some((item) => item.startsWith("color:")),
  "Cores explicitamente diferentes sao conflito.",
);

const otherEntity = avaliarCompatibilidadeComConsulta(
  "Headphone MarcaX Rosa",
  listing("Headphone MarcaY Rosa"),
);
assert.equal(otherEntity.compatible, false);
assert.ok(
  otherEntity.conflicts.some((item) => item.startsWith("brand:")) ||
    otherEntity.reason.includes("distintivo"),
);

console.log("identity exact matcher: todos os casos globais passaram");
