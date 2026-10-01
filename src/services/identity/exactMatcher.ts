import type {
  ProductImport,
} from "@/services/importers/core/types";

import {
  codigosDeIdentidadeDoItemVendido,
  ehPapelNaoPrincipal,
  normalizarCodigoIdentidade,
  normalizarTextoIdentidade,
  resolverIdentidadeProduto,
} from "./resolver";

import type {
  IdentityVariantKey,
  ProductIdentity,
} from "./resolver";

export type ExactMatchResult = {
  exact: boolean;
  score: number | null;
  reason: string;
  matchedBy:
    | "GTIN"
    | "MODEL"
    | "TITLE"
    | "FURNITURE"
    | "FOOTWEAR"
    | null;
};

const HARD_VARIANT_KEYS: IdentityVariantKey[] = [
  "voltage",
  "storage",
  "ram",
  "network",
  "size",
  "capacity",
  "kitQuantity",
  /*
   * Catalog Release 01: cor explicita diferente (Cinza x Azul) e conflito
   * de EXACT. Ambos os lados precisam declarar a cor; ausencia passa.
   */
  "color",
];

const ASYMMETRIC_VARIANT_KEYS: IdentityVariantKey[] = [
  "bundle",
];

/*
 * Cor e tratada como variante EXPLICITA desde o Catalog Release 01:
 * quando os DOIS anuncios declaram cores canonicas diferentes
 * (ex.: Cinza x Azul), o par NAO pode ser EXACT.
 * Ausencia de cor em um dos lados NAO e conflito (M170 x M170 Cinza
 * continua compativel). A extracao e conservadora (extrairCorCanonica):
 * apenas cores do vocabulario canonico, com fronteira de palavra, viram
 * variante; "sortido"/multicor e ambiguidade retornam null.
 * canonicalKey (indice de busca) continua sem cor; o Exact Matcher e a
 * autorizacao de merge.
 */

const FURNITURE_GENERIC_TOKENS = new Set([
  "armario",
  "guarda",
  "roupa",
  "balcao",
  "buffet",
  "aparador",
  "comoda",
  "rack",
  "painel",
  "estante",
  "mesa",
  "cabeceira",
  "criado",
  "mudo",
  "sapateira",
  "cozinha",
  "cama",
  "sofa",
  "poltrona",
  "escrivaninha",
  "para",
  "com",
  "sem",
  "de",
  "da",
  "do",
  "dos",
  "das",
  "e",
  "em",
  "kit",
  "novo",
  "nova",
  "moderno",
  "moderna",
  "moveis",
  "mais",
  "mdp",
  "mdf",
  "gaveta",
  "gavetas",
]);

const FOOTWEAR_GENERIC_TOKENS = new Set([
  "tenis",
  "sapato",
  "sandalia",
  "chinelo",
  "bota",
  "sapatilha",
  "masculino",
  "feminino",
  "infantil",
  "adulto",
  "adultos",
  "para",
  "com",
  "sem",
  "de",
  "da",
  "do",
  "dos",
  "das",
  "e",
  "em",
]);

const COMMERCIAL_STOP_WORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "para",
  "com",
  "sem",
  "e",
  "em",
  "um",
  "uma",
  "novo",
  "nova",
  "original",
  "oficial",
  "premium",
  "profissional",
  "gamer",
  "oferta",
  "promocao",
  "frete",
  "gratis",
]);

function reject(
  reason: string,
): ExactMatchResult {
  return {
    exact: false,
    score: null,
    reason,
    matchedBy: null,
  };
}

function exact(
  matchedBy: Exclude<
    ExactMatchResult["matchedBy"],
    null
  >,
  reason: string,
): ExactMatchResult {
  return {
    exact: true,
    score: 1,
    reason,
    matchedBy,
  };
}

function globalCode(
  identity: ProductIdentity,
): string | null {
  return identity.gtin ?? identity.ean;
}

function codigoModeloEmComum(
  first: ProductIdentity,
  second: ProductIdentity,
): string | null {
  const secondCodes = new Set(codigosDeIdentidadeDoItemVendido(second));

  return (
    codigosDeIdentidadeDoItemVendido(first).find((code) =>
      secondCodes.has(code),
    ) ?? null
  );
}

function modeloEstruturado(
  identity: ProductIdentity,
): string | null {
  return identity.mpn ?? identity.modelNumber;
}

function conflitoDeSubmodelo(
  first: ProductIdentity,
  second: ProductIdentity,
): string | null {
  const firstCodes = Array.from(new Set(codigosDeIdentidadeDoItemVendido(first)));
  const secondCodes = Array.from(new Set(codigosDeIdentidadeDoItemVendido(second)));
  const secondSet = new Set(secondCodes);

  const commonBases = firstCodes
    .filter((code) => secondSet.has(code))
    .sort((a, b) => b.length - a.length);

  for (const base of commonBases) {
    const firstExtensions = firstCodes.filter(
      (code) =>
        code !== base &&
        code.startsWith(base) &&
        code.length > base.length,
    );
    const secondExtensions = secondCodes.filter(
      (code) =>
        code !== base &&
        code.startsWith(base) &&
        code.length > base.length,
    );

    if (
      firstExtensions.length === 0 &&
      secondExtensions.length === 0
    ) {
      continue;
    }

    if (
      firstExtensions.length === 0 ||
      secondExtensions.length === 0
    ) {
      return `Submodelo insuficiente para confirmar ${base}: ${firstExtensions.join("/") || "nao informado"} x ${secondExtensions.join("/") || "nao informado"}.`;
    }

    const secondExtensionSet = new Set(secondExtensions);
    const commonExtension = firstExtensions.find((code) =>
      secondExtensionSet.has(code),
    );

    if (!commonExtension) {
      return `Submodelo diferente para ${base}: ${firstExtensions.join("/")} x ${secondExtensions.join("/")}.`;
    }
  }

  return null;
}

/**
 * Capacidade em GB (ou fracao de GB), normalizando unidade. `1TB` e
 * `1024GB` sao a MESMA capacidade: tratá-las como dimensao diferente seria
 * um falso conflito, ou seja, EXTRACTION_NOISE.
 */
function capacidadeEmGb(valor: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)/i.exec(valor);

  if (!m) {
    return null;
  }

  const amount = Number(m[1].replace(",", "."));
  const unit = m[2].toLowerCase();

  if (!Number.isFinite(amount)) {
    return null;
  }

  if (unit === "tb") return amount * 1024;
  if (unit === "mb") return amount / 1024;
  return amount;
}

/**
 * Eixos cujo valor e uma GRANDEZA: comparacao dimensional, nao textual.
 */
const DIMENSIONAL_HARD_KEYS: IdentityVariantKey[] = [
  "storage",
  "ram",
  "capacity",
];

/**
 * Dois valores de variante sao compativeis?
 *
 * Ausência NAO e conflito: a fonte que nao deklaro o atributo esta se
 * calando, nao afirmando o contrario (§2 da missao). Para eixos
 * dimensionais, `1tb` x `1024gb` e a MESMA grandeza (EXTRACTION_NOISE),
 * enquanto `128gb` x `256gb` sao grandezas DIMENSIONALMENTE diferentes
 * (REAL_STRUCTURAL_CONFLICT).
 */
function variantesCompativeis(
  key: IdentityVariantKey,
  firstValue: string,
  secondValue: string,
): { compat: boolean; ruido: boolean } {
  if (firstValue === secondValue) {
    return { compat: true, ruido: false };
  }

  if (DIMENSIONAL_HARD_KEYS.includes(key)) {
    const firstCapacity = capacidadeEmGb(firstValue);
    const secondCapacity = capacidadeEmGb(secondValue);

    if (firstCapacity !== null && secondCapacity !== null) {
      return Math.abs(firstCapacity - secondCapacity) <= 0.5
        ? { compat: true, ruido: true }
        : { compat: false, ruido: false };
    }
  }

  return { compat: false, ruido: false };
}

function conflitoDeVariantes(
  first: ProductIdentity,
  second: ProductIdentity,
): string | null {
  for (const key of HARD_VARIANT_KEYS) {
    const firstValue = first.variants[key];
    const secondValue = second.variants[key];

    if (
      firstValue &&
      secondValue &&
      firstValue !== secondValue
    ) {
      return `Variante ${key} diferente: ${firstValue} x ${secondValue}.`;
    }
  }

  for (const key of ASYMMETRIC_VARIANT_KEYS) {
    const firstValue = first.variants[key];
    const secondValue = second.variants[key];

    if (firstValue && secondValue && firstValue !== secondValue) {
      return `Variante ${key} diferente: ${firstValue} x ${secondValue}.`;
    }

    if (Boolean(firstValue) !== Boolean(secondValue)) {
      return `Variante ${key} incompativel: ${firstValue ?? "padrao"} x ${secondValue ?? "padrao"}.`;
    }
  }

  return null;
}

function skusDoFabricante(
  identity: ProductIdentity,
): string[] {
  const commercial = normalizarCodigoIdentidade(
    identity.commercialModel ?? identity.model,
  );
  return Array.from(
    new Set(
      [identity.manufacturerSku, identity.mpn]
        .map((code) => normalizarCodigoIdentidade(code))
        .filter((code): code is string => Boolean(code))
        .filter((code) => code !== commercial),
    ),
  ).sort((first, second) => second.length - first.length);
}

function skusEspecificosCompativeis(
  first: string,
  second: string,
): boolean {
  return (
    first === second ||
    first.startsWith(second) ||
    second.startsWith(first)
  );
}

function conflitoDeSkuEspecifico(
  first: ProductIdentity,
  second: ProductIdentity,
): {
  conflict: string | null;
  missingOnly: boolean;
} {
  const firstSkus = skusDoFabricante(first);
  const secondSkus = skusDoFabricante(second);

  if (firstSkus.length === 0 && secondSkus.length === 0) {
    return { conflict: null, missingOnly: false };
  }

  if (firstSkus.length > 0 && secondSkus.length > 0) {
    const compatible = firstSkus.some((firstSku) =>
      secondSkus.some((secondSku) =>
        skusEspecificosCompativeis(firstSku, secondSku),
      ),
    );

    if (!compatible) {
      return {
        conflict: `SKU especifico diferente: ${firstSkus[0]} x ${secondSkus[0]}.`,
        missingOnly: false,
      };
    }

    return { conflict: null, missingOnly: false };
  }

  /*
   * SKU presente em um lado e ausente no outro nao prova produto diferente.
   * So ha conflito quando os dois anuncios declaram part numbers incompativeis.
   */
  return { conflict: null, missingOnly: true };
}



function tokensFortes(
  identity: ProductIdentity,
  genericTokens: Set<string>,
): string[] {
  const brandTokens = new Set(
    normalizarTextoIdentidade(identity.brand)
      .split(" ")
      .filter(Boolean),
  );

  return identity.normalizedTitle
    .split(" ")
    .filter(
      (token) =>
        token.length >= 3 &&
        !genericTokens.has(token) &&
        !COMMERCIAL_STOP_WORDS.has(token) &&
        !brandTokens.has(token) &&
        !/^\d+(?:gb|tb|mb|mah|w|v|hz|mm|cm|ml|kg|g)$/.test(token),
    );
}

function intersection(
  first: string[],
  second: string[],
): string[] {
  const secondSet = new Set(second);

  return Array.from(
    new Set(
      first.filter((token) => secondSet.has(token)),
    ),
  );
}

function numeroPorExtenso(
  value: string,
): number | null {
  const normalized = normalizarTextoIdentidade(value);
  const map: Record<string, number> = {
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
  };

  return map[normalized] ?? null;
}

function extrairContagem(
  title: string,
  labels: string[],
): number | null {
  const normalized = normalizarTextoIdentidade(title);
  const labelsRegex = labels.join("|");
  const numberMatch = normalized.match(
    new RegExp(`\\b(\\d{1,2})\\s*(?:${labelsRegex})\\b`, "i"),
  );

  if (numberMatch?.[1]) {
    return Number(numberMatch[1]);
  }

  const wordMatch = normalized.match(
    new RegExp(
      `\\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\\s*(?:${labelsRegex})\\b`,
      "i",
    ),
  );

  return wordMatch?.[1]
    ? numeroPorExtenso(wordMatch[1])
    : null;
}

function compararMoveis(
  first: ProductIdentity,
  second: ProductIdentity,
): ExactMatchResult | null {
  if (
    first.kind !== "FURNITURE" ||
    second.kind !== "FURNITURE"
  ) {
    return null;
  }

  const portasFirst = extrairContagem(
    first.title,
    ["portas?"],
  );
  const portasSecond = extrairContagem(
    second.title,
    ["portas?"],
  );
  const gavetasFirst = extrairContagem(
    first.title,
    ["gavetas?"],
  );
  const gavetasSecond = extrairContagem(
    second.title,
    ["gavetas?"],
  );

  if (
    portasFirst !== null &&
    portasSecond !== null &&
    portasFirst !== portasSecond
  ) {
    return reject(
      `Movel com quantidade de portas diferente: ${portasFirst} x ${portasSecond}.`,
    );
  }

  if (
    gavetasFirst !== null &&
    gavetasSecond !== null &&
    gavetasFirst !== gavetasSecond
  ) {
    return reject(
      `Movel com quantidade de gavetas diferente: ${gavetasFirst} x ${gavetasSecond}.`,
    );
  }

  const commonModel = codigoModeloEmComum(first, second);

  if (commonModel) {
    return exact(
      "FURNITURE",
      `Movel confirmado por modelo/codigo ${commonModel} e estrutura compativel.`,
    );
  }

  const commonStrongTokens = intersection(
    tokensFortes(first, FURNITURE_GENERIC_TOKENS),
    tokensFortes(second, FURNITURE_GENERIC_TOKENS),
  );

  if (first.brand && second.brand && commonStrongTokens.length >= 1) {
    return exact(
      "FURNITURE",
      `Movel confirmado por marca, linha ${commonStrongTokens.join(" ")} e estrutura compativel.`,
    );
  }

  return null;
}

function extrairGeneroCalcado(
  title: string,
): string | null {
  const normalized = normalizarTextoIdentidade(title);

  if (/\b(?:masculino|masc)\b/.test(normalized)) {
    return "masculino";
  }

  if (/\b(?:feminino|fem)\b/.test(normalized)) {
    return "feminino";
  }

  if (/\b(?:infantil|kids?)\b/.test(normalized)) {
    return "infantil";
  }

  return null;
}

function compararCalcados(
  first: ProductIdentity,
  second: ProductIdentity,
): ExactMatchResult | null {
  if (
    first.kind !== "FOOTWEAR" ||
    second.kind !== "FOOTWEAR"
  ) {
    return null;
  }

  const genderFirst = extrairGeneroCalcado(first.title);
  const genderSecond = extrairGeneroCalcado(second.title);

  if (
    genderFirst &&
    genderSecond &&
    genderFirst !== genderSecond
  ) {
    return reject(
      `Calcado de genero diferente: ${genderFirst} x ${genderSecond}.`,
    );
  }

  const commonModel = codigoModeloEmComum(first, second);

  if (commonModel) {
    return exact(
      "FOOTWEAR",
      `Calcado confirmado por marca/linha ${commonModel} e variantes compativeis.`,
    );
  }

  const commonStrongTokens = intersection(
    tokensFortes(first, FOOTWEAR_GENERIC_TOKENS),
    tokensFortes(second, FOOTWEAR_GENERIC_TOKENS),
  );

  if (first.brand && second.brand && commonStrongTokens.length >= 1) {
    return exact(
      "FOOTWEAR",
      `Calcado confirmado por marca e linha ${commonStrongTokens.join(" ")}.`,
    );
  }

  return null;
}

function tokensComerciais(
  identity: ProductIdentity,
): string[] {
  return identity.normalizedTitle
    .split(" ")
    .filter(
      (token) =>
        Boolean(token) &&
        token.length >= 2 &&
        !COMMERCIAL_STOP_WORDS.has(token),
    );
}

function titulosComerciaisEquivalentes(
  first: ProductIdentity,
  second: ProductIdentity,
): boolean {
  const firstTitle = first.normalizedTitle;
  const secondTitle = second.normalizedTitle;

  if (!firstTitle || !secondTitle) {
    return false;
  }

  if (firstTitle === secondTitle) {
    return firstTitle.split(" ").length >= 3;
  }

  const firstTokens = tokensComerciais(first);
  const secondTokens = tokensComerciais(second);

  if (firstTokens.length < 3 || secondTokens.length < 3) {
    return false;
  }

  const [shorter, longer] =
    firstTokens.length <= secondTokens.length
      ? [firstTokens, secondTokens]
      : [secondTokens, firstTokens];
  const longerSet = new Set(longer);
  const covered = shorter.filter((token) => longerSet.has(token)).length;
  const coverage = covered / shorter.length;
  const sizeRatio = shorter.length / longer.length;

  /*
   * Equivalencia estrutural de titulo: o anuncio mais curto precisa ter
   * quase todos os tokens comerciais presentes no mais longo, sem exigir
   * substring literal. Isso une "Lanterna Tatica LED X" e
   * "Lanterna Tatica LED Recarregavel X" sem juntar produtos que so
   * compartilham uma palavra isolada.
   */
  return coverage >= 0.8 && sizeRatio >= 0.5;
}

/**
 * AUDITORIA DE CONFLITO ESTRUTURAL (FASE 2 / CROSS-MARKET MATCHING).
 *
 * Um GTIN/EAN identico e valido e evidencia EXTREMAMENTE forte de que as
 * duas ofertas sao o MESMO objeto fisico. Mas forca fisica nao anula uma
 * contradicao comprovada: um anunciante pode publicar o codigo de barras do
 * item principal junto com o titulo/planilha de outra variante.
 *
 * Por isso o GTIN NAO faz mais `return exact(...)` imediato. Ele passa
 * PRIMEIRO por esta auditoria, que separa:
 *
 *   REAL_STRUCTURAL_CONFLICT — as DUAS fontes AFIRMARAM valores diferentes
 *     no mesmo eixo estrutural (capacidade, voltagem, tamanho, kit x
 *     unidade, marca, modelo/MPN, submodelo, SKU do fabricante). Isso e
 *     o fabricante se contradizendo: o par nao pode virar EXACT.
 *
 *   EXTRACTION_NOISE — ruido de extracao, nao contradicao: mesma grandeza
 *     escrita de formas diferentes (`1tb` x `1024gb`), submodelo
 *     informado de um lado e omissao do outro, SKU do fabricante presente
 *     de um lado e ausente do outro. Nao bloqueia a promocao.
 *
 * AUSENCIA de atributo nunca vira conflito: `missing` e a fonte se calando.
 */
export type StructuralConflictKind =
  | "REAL_STRUCTURAL_CONFLICT"
  | "EXTRACTION_NOISE";

export interface StructuralConflictV1 {
  kind: StructuralConflictKind;
  /** Eixo estrutural observado (brand, storage, voltage, model...). */
  axis: string;
  detail: string;
}

export interface StructuralAuditV1 {
  conflicts: StructuralConflictV1[];
  noise: StructuralConflictV1[];
}

function conflito(
  axis: string,
  detail: string,
): StructuralConflictV1 {
  return { kind: "REAL_STRUCTURAL_CONFLICT", axis, detail };
}

function ruido(axis: string, detail: string): StructuralConflictV1 {
  return { kind: "EXTRACTION_NOISE", axis, detail };
}

/**
 * Auditoria estrutural completa. Usada pelo caminho do GTIN igual para NAO
 * deixar evidencia forte mascarar conflito comprovado. Nao altera o caminho
 * sem GTIN, que continua usando `conflitoDeVariantes`/`conflitoDeSubmodelo`/
 * `conflitoDeSkuEspecifico` na ordem original.
 */
export function auditarConflitosEstruturais(
  first: ProductIdentity,
  second: ProductIdentity,
): StructuralAuditV1 {
  const conflicts: StructuralConflictV1[] = [];
  const noise: StructuralConflictV1[] = [];

  // 1. Marca: as duas fontes AFIRMARAM marcas diferentes.
  if (first.brand && second.brand && first.brand !== second.brand) {
    conflicts.push(
      conflito("brand", `Marca diferente: ${first.brand} x ${second.brand}.`),
    );
  }

  // 2. Eixos estruturais HARD: so conflita com valor nos DOIS lados.
  for (const key of HARD_VARIANT_KEYS) {
    const firstValue = first.variants[key];
    const secondValue = second.variants[key];

    if (!firstValue || !secondValue) {
      continue;
    }

    const verdict = variantesCompativeis(key, firstValue, secondValue);

    if (verdict.compat) {
      if (verdict.ruido) {
        noise.push(
          ruido(
            key,
            `Variante ${key} declarada em notacao diferente para a mesma grandeza: ${firstValue} x ${secondValue}.`,
          ),
        );
      }
      continue;
    }

    conflicts.push(
      conflito(key, `Variante ${key} diferente: ${firstValue} x ${secondValue}.`),
    );
  }

  // 3. Eixos assimetricos (kit x unidade): ausencia de um lado tambem e
  //    contradicao estrutural, porque "kit" e "unidade" sao unidades
  //    comerciais diferentes — nao um atributo que a fonte esqueceu.
  for (const key of ASYMMETRIC_VARIANT_KEYS) {
    const firstValue = first.variants[key];
    const secondValue = second.variants[key];

    if (firstValue && secondValue && firstValue !== secondValue) {
      conflicts.push(
        conflito(key, `Variante ${key} diferente: ${firstValue} x ${secondValue}.`),
      );
      continue;
    }

    if (Boolean(firstValue) !== Boolean(secondValue)) {
      conflicts.push(
        conflito(
          key,
          `Variante ${key} incompativel: ${firstValue ?? "padrao"} x ${secondValue ?? "padrao"}.`,
        ),
      );
    }
  }

  // 4. Submodelo: base comum com extensoes divergentes e conflito; base
  //    comum com um lado sem extensao e ruido (a fonte nao detalhou).
  const submodelConflict = conflitoDeSubmodelo(first, second);

  if (submodelConflict) {
    const missingSide = /insuficiente para confirmar/.test(submodelConflict);
    (missingSide ? noise : conflicts).push(
      missingSide
        ? ruido("submodel", submodelConflict)
        : conflito("submodel", submodelConflict),
    );
  }

  // 5. SKU especifico do fabricante.
  const skuCheck = conflitoDeSkuEspecifico(first, second);

  if (skuCheck.conflict) {
    (skuCheck.missingOnly ? noise : conflicts).push(
      skuCheck.missingOnly
        ? ruido("manufacturerSku", skuCheck.conflict)
        : conflito("manufacturerSku", skuCheck.conflict),
    );
  }

  // 6. Modelo comercial: um codigo que CONTEM o outro nao e modelo
  //    diferente, e sim o mesmo modelo com mais/menos detalhe de extracao.
  const firstCommercial = first.commercialModel ?? first.model;
  const secondCommercial = second.commercialModel ?? second.model;

  if (firstCommercial && secondCommercial && firstCommercial !== secondCommercial) {
    const prefixCompatible =
      firstCommercial.startsWith(secondCommercial) ||
      secondCommercial.startsWith(firstCommercial);

    (prefixCompatible ? noise : conflicts).push(
      prefixCompatible
        ? ruido(
            "commercialModel",
            `Modelo comercial em grau de detalhe diferente: ${firstCommercial} x ${secondCommercial}.`,
          )
        : conflito(
            "commercialModel",
            `Modelo comercial diferente: ${firstCommercial} x ${secondCommercial}.`,
          ),
    );
  }

  // 7. MPN / modelo estruturado: so e conflito quando nao existe modelo
  //    comercial em comum para explicar a divergencia.
  const commonModel =
    firstCommercial && secondCommercial
      ? firstCommercial
      : codigoModeloEmComum(first, second);
  const firstStructured = modeloEstruturado(first);
  const secondStructured = modeloEstruturado(second);

  if (
    firstStructured &&
    secondStructured &&
    firstStructured !== secondStructured &&
    !commonModel
  ) {
    conflicts.push(
      conflito(
        "mpn",
        `Modelo/MPN diferente: ${firstStructured} x ${secondStructured}.`,
      ),
    );
  }

  return { conflicts, noise };
}

export function avaliarIdentidadesExatas(
  first: ProductIdentity,
  second: ProductIdentity,
): ExactMatchResult {
  const firstAccessoryLike = ehPapelNaoPrincipal(first.kind);
  const secondAccessoryLike = ehPapelNaoPrincipal(second.kind);

  if (firstAccessoryLike !== secondAccessoryLike) {
    return reject(
      "Produto principal e acessorio/peca de reposicao nao podem ser agrupados automaticamente.",
    );
  }

  if (
    firstAccessoryLike &&
    secondAccessoryLike &&
    first.kind !== second.kind
  ) {
    return reject(
      "Acessorio e peca de reposicao nao podem ser agrupados automaticamente.",
    );
  }

  if (first.multiModelCompatibility || second.multiModelCompatibility) {
    if (!firstAccessoryLike || !secondAccessoryLike) {
      return reject(
        "Lista de compatibilidade com varios modelos nao pode identificar o produto principal.",
      );
    }
  }

  if (
    (first.hostModelCandidates.length > 0 &&
      first.identityModelCandidates.length === 0) ||
    (second.hostModelCandidates.length > 0 &&
      second.identityModelCandidates.length === 0)
  ) {
    if (!firstAccessoryLike || !secondAccessoryLike) {
      return reject(
        "Modelos de hospedeiro nao podem identificar o item vendido.",
      );
    }
  }

  const firstGlobalCode = globalCode(first);
  const secondGlobalCode = globalCode(second);

  if (firstGlobalCode && secondGlobalCode) {
    /*
     * GTIN/EAN DIFERENTE e conflito de identidade mais forte que existe:
     * dois codigos de barras para o mesmo objeto. Rejeita sempre.
     *
     * GTIN/EAN IDENTICO e evidencia fortissima, mas nao e prova ciega.
     * Antes de promover, a auditoria estrutural roda: se as DUAS fontes
     * AFIRMARAM valores divergentes em um eixo estrutural (capacidade,
     * voltagem, tamanho, kit x unidade, marca, modelo/MPN), o par e
     * REJECT — o anuncio esta contradizendo a si mesmo. Se a divergencia
     * for apenas ruido de extracao (1tb x 1024gb, submodelo detalhado de
     * um lado, SKU do fabricante omitido pelo outro), o GTIN ainda promove,
     * porque evidencia forte e corroborada nao pode ser rebaixada por
     * diferenca de detalhe de preenchimento.
     */
    if (firstGlobalCode !== secondGlobalCode) {
      return reject("GTIN/EAN diferente.");
    }

    const audit = auditarConflitosEstruturais(first, second);

    if (audit.conflicts.length > 0) {
      return reject(
        `${audit.conflicts[0].detail} GTIN/EAN identico nao anula conflito estrutural comprovado.`,
      );
    }

    const noiseSuffix =
      audit.noise.length > 0
        ? ` Ruido de extracao absorvido: ${Array.from(
            new Set(audit.noise.map((item) => item.axis)),
          ).join(", ")}.`
        : "";

    return exact(
      "GTIN",
      `GTIN/EAN identico e nenhum conflito estrutural comprovado.${noiseSuffix}`,
    );
  }

  if (
    first.brand &&
    second.brand &&
    first.brand !== second.brand
  ) {
    return reject(
      `Marca diferente: ${first.brand} x ${second.brand}.`,
    );
  }

  const conflictingVariant = conflitoDeVariantes(
    first,
    second,
  );

  if (conflictingVariant) {
    return reject(conflictingVariant);
  }

  /*
   * Ausencia de evidencia nao e conflito. Marketplaces diferentes quase
   * nunca expõem a mesma quantidade de atributos. Se uma loja informa
   * voltagem/RAM/capacidade e outra omite, o matcher nao deve fragmentar
   * automaticamente o mesmo modelo. Divergencia explicita entre valores
   * continua sendo bloqueada por conflitoDeVariantes acima.
   */

  const submodelConflict = conflitoDeSubmodelo(
    first,
    second,
  );

  if (submodelConflict) {
    return reject(submodelConflict);
  }

  const skuCheck = conflitoDeSkuEspecifico(first, second);

  if (skuCheck.conflict) {
    return reject(skuCheck.conflict);
  }

  const firstCommercial =
    first.commercialModel ?? first.model;
  const secondCommercial =
    second.commercialModel ?? second.model;

  if (
    firstCommercial &&
    secondCommercial &&
    firstCommercial !== secondCommercial
  ) {
    return reject(
      `Modelo comercial diferente: ${firstCommercial} x ${secondCommercial}.`,
    );
  }

  const commonModel =
    firstCommercial && secondCommercial
      ? firstCommercial
      : codigoModeloEmComum(first, second);
  const firstStructuredModel = modeloEstruturado(first);
  const secondStructuredModel = modeloEstruturado(second);

  if (
    firstStructuredModel &&
    secondStructuredModel &&
    firstStructuredModel !== secondStructuredModel &&
    !commonModel
  ) {
    return reject(
      `Modelo/MPN diferente: ${firstStructuredModel} x ${secondStructuredModel}.`,
    );
  }

  const furnitureResult = compararMoveis(first, second);

  if (furnitureResult) {
    return furnitureResult;
  }

  const footwearResult = compararCalcados(first, second);

  if (footwearResult) {
    return footwearResult;
  }

  if (commonModel) {
    const marcasIguais = Boolean(
      first.brand &&
      second.brand &&
      first.brand === second.brand,
    );

    const marcaConhecida = first.brand ?? second.brand;
    const identidadeSemMarca = first.brand ? second : first;

    const marcaConfirmadaNoTitulo = Boolean(
      marcaConhecida &&
      !identidadeSemMarca.brand &&
      ` ${identidadeSemMarca.normalizedTitle} `.includes(
        ` ${normalizarTextoIdentidade(marcaConhecida)} `,
      ),
    );

    if (marcasIguais || marcaConfirmadaNoTitulo) {
      return exact(
        "MODEL",
        `Modelo/codigo ${commonModel} e marca compativeis sem variante conflitante.`,
      );
    }
  }

  if (
    titulosComerciaisEquivalentes(first, second) &&
    (Boolean(first.brand && second.brand) ||
      first.normalizedTitle.split(" ").length >= 6)
  ) {
    return exact(
      "TITLE",
      "Titulo comercial equivalente e variantes compativeis.",
    );
  }

  if (!first.brand || !second.brand) {
    return reject(
      "Marca insuficiente para confirmacao automatica.",
    );
  }

  return reject(
    "Modelo/codigo insuficiente para confirmacao automatica.",
  );
}

export function avaliarCompatibilidadeExataEntreImports(
  first: Pick<ProductImport, "title" | "brand" | "attributes">,
  second: Pick<ProductImport, "title" | "brand" | "attributes">,
): ExactMatchResult {
  return avaliarIdentidadesExatas(
    resolverIdentidadeProduto(first),
    resolverIdentidadeProduto(second),
  );
}
