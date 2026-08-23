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
];

const ASYMMETRIC_VARIANT_KEYS: IdentityVariantKey[] = [
  "bundle",
];

/*
 * Cor e uma variante de apresentacao, nao de identidade-base.
 * Quando o cliente NAO pede uma cor, anuncios do mesmo modelo em cores
 * diferentes podem compartilhar o mesmo Product e competir por preco.
 * Se a consulta explicitar uma cor, queryMatcher continua exigindo-a.
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
    return firstGlobalCode === secondGlobalCode
      ? exact("GTIN", "GTIN/EAN identico.")
      : reject("GTIN/EAN diferente.");
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
