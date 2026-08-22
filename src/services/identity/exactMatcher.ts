import type {
  ProductImport,
} from "@/services/importers/core/types";

import {
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

const VARIANT_KEYS: IdentityVariantKey[] = [
  "voltage",
  "storage",
  "ram",
  "network",
  "color",
  "size",
  "capacity",
  "kitQuantity",
];

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
  const secondCodes = new Set(second.searchCodes);

  return (
    first.searchCodes.find((code) =>
      secondCodes.has(code),
    ) ?? null
  );
}

function modeloEstruturado(
  identity: ProductIdentity,
): string | null {
  return identity.mpn ?? identity.modelNumber;
}

function conflitoDeVariantes(
  first: ProductIdentity,
  second: ProductIdentity,
): string | null {
  for (const key of VARIANT_KEYS) {
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

  return null;
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

  const shorter =
    firstTitle.length <= secondTitle.length
      ? firstTitle
      : secondTitle;
  const longer =
    firstTitle.length > secondTitle.length
      ? firstTitle
      : secondTitle;
  const shorterTokens = shorter.split(" ").filter(Boolean);

  return (
    shorterTokens.length >= 5 &&
    shorter.length / longer.length >= 0.72 &&
    longer.includes(shorter)
  );
}

export function avaliarIdentidadesExatas(
  first: ProductIdentity,
  second: ProductIdentity,
): ExactMatchResult {
  const firstIsAccessory =
    first.kind === "ACCESSORY";
  const secondIsAccessory =
    second.kind === "ACCESSORY";

  if (firstIsAccessory !== secondIsAccessory) {
    return reject(
      "Produto principal e acessorio/peca de reposicao nao podem ser agrupados automaticamente.",
    );
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

  const commonModel = codigoModeloEmComum(first, second);
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

  if (commonModel && first.brand && second.brand) {
    return exact(
      "MODEL",
      `Marca e modelo/codigo ${commonModel} coincidem sem variante conflitante.`,
    );
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
