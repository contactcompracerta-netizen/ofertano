import type {
  NormalizedCandidate,
  ProductRole,
  RawCandidate,
} from "./types";

const STOP_WORDS = new Set([
  "a",
  "as",
  "o",
  "os",
  "de",
  "da",
  "das",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "nas",
  "no",
  "nos",
  "para",
  "por",
  "com",
  "sem",
  "um",
  "uma",
  "the",
  "and",
  "for",
  "novo",
  "nova",
  "original",
  "oficial",
  "oferta",
  "promocao",
  "kit",
  "modelo",
  "mais",
]);

const ACCESSORY_HEADS = new Set([
  "estojo",
  "estojos",
  "capa",
  "capas",
  "capinha",
  "case",
  "cases",
  "cover",
  "caso",
  "casos",
  "pelicula",
  "peliculas",
  "cabo",
  "cabos",
  "carregador",
  "adaptador",
  "suporte",
  "bolsa",
  "protetor",
  "almofada",
  "almofadas",
  "peca",
  "pecas",
  "reposicao",
  "substituicao",
  "filtro",
  "saco",
  "sacos",
  "refill",
]);

const REPLACEMENT_HEADS = new Set([
  "reposicao",
  "substituicao",
  "peca",
  "refill",
  "filtro",
  "saco",
  "sacos",
]);

const CLASS_GROUPS: string[][] = [
  ["headphone", "fone", "fones", "headset", "earbuds", "earphone", "auricular", "ouvido", "ouvidos"],
  ["speaker", "caixa", "som", "soundbar", "soundbox", "altofalante"],
  ["smartphone", "celular", "telefone", "iphone"],
  ["notebook", "laptop"],
  ["furadeira", "parafusadeira"],
  ["panela", "cacarola", "cafeteira"],
  ["mesa", "criado", "cabeceira", "comoda", "rack", "estante", "sofa", "moveis"],
  ["lapis", "caneta", "grafite"],
  ["estojo", "case", "capa"],
  ["barbeador", "aparador", "maquina"],
  ["liquidificador", "batedeira"],
  ["aspirador"],
];

const CLASS_INCOMPATIBLE = new Map<string, Set<string>>([
  ["headphone", new Set(["speaker", "smartphone", "furadeira", "panela", "mesa", "lapis", "estojo"])],
  ["speaker", new Set(["headphone", "smartphone", "furadeira", "panela", "mesa", "lapis"])],
  ["smartphone", new Set(["headphone", "speaker", "furadeira", "panela", "mesa", "lapis", "estojo"])],
  ["furadeira", new Set(["headphone", "speaker", "smartphone", "panela", "mesa", "lapis"])],
  ["panela", new Set(["headphone", "speaker", "smartphone", "furadeira", "mesa", "lapis"])],
  ["mesa", new Set(["headphone", "speaker", "smartphone", "furadeira", "panela", "lapis"])],
  ["lapis", new Set(["headphone", "speaker", "smartphone", "furadeira", "panela", "mesa"])],
  ["estojo", new Set(["headphone", "smartphone", "furadeira", "panela", "mesa"])],
  ["barbeador", new Set(["headphone", "smartphone", "furadeira", "panela", "mesa", "lapis"])],
]);

const COLOR_WORDS = new Set([
  "preto",
  "preta",
  "branco",
  "branca",
  "cinza",
  "prata",
  "azul",
  "verde",
  "vermelho",
  "vermelha",
  "rosa",
  "roxo",
  "dourado",
  "bege",
  "marrom",
  "amarelo",
  "laranja",
  "black",
  "white",
  "red",
  "blue",
  "green",
  "retro",
]);

const MATERIAL_WORDS = new Set([
  "inox",
  "aco",
  "madeira",
  "mdf",
  "mdp",
  "aluminio",
  "plastico",
  "vidro",
  "couro",
  "tecido",
  "silicone",
  "ceramica",
]);

const ATTRIBUTE_WORDS = new Set([
  "bluetooth",
  "wireless",
  "wifi",
  "usb",
  "profissional",
  "digital",
  "retratil",
  "pressao",
  "cor",
  "cores",
  "gavetas",
  "gaveta",
  "resistente",
  "resistentes",
  "prova",
  "agua",
  "waterproof",
]);

const QUANTITY_UNITS = new Set([
  "gavetas",
  "gaveta",
  "cores",
  "pecas",
  "unidades",
  "litros",
  "pcs",
]);

const CAPACITY_UNITS = new Set([
  "l",
  "ml",
  "kg",
  "g",
  "w",
  "v",
  "mm",
  "cm",
  "pol",
]);

const HOST_RELATION_PATTERN =
  /\b(?:compative(?:l|is)\s+com|compatible(?:s)?\s+with|fits|reposicao\s+para|substituicao\s+para|de\s+substituicao\s+para)\b/;

const GENERIC_HOST_PATTERN = /\b(?:para|for)\b/;

export function normalizeMultistoreText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokenize(value: string): string[] {
  return normalizeMultistoreText(value)
    .split(" ")
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

export function wordsOf(value: string): string[] {
  return normalizeMultistoreText(value)
    .split(" ")
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length > 0);
}

const BRAND_PHRASES: string[][] = [
  ["criado", "mais"],
  ["i", "home"],
];

const KNOWN_BRANDS = new Set([
  "ihome",
  "jbl",
  "samsung",
  "xiaomi",
  "motorola",
  "philips",
  "logitech",
  "sony",
  "lg",
  "dell",
  "lenovo",
  "acer",
  "positivo",
  "multilaser",
  "electrolux",
  "brastemp",
  "consul",
  "mondial",
  "arno",
  "oster",
  "bosch",
  "midea",
  "gree",
  "tramontina",
  "cadence",
  "britania",
]);

function containsPhrase(words: string[], phrase: string[]): boolean {
  if (phrase.length === 0 || words.length < phrase.length) {
    return false;
  }

  for (let index = 0; index <= words.length - phrase.length; index += 1) {
    const matched = phrase.every((token, offset) => words[index + offset] === token);
    if (matched) {
      return true;
    }
  }

  return false;
}

export function extractBrand(text: string): string | null {
  const words = wordsOf(text);

  for (const phrase of BRAND_PHRASES) {
    if (containsPhrase(words, phrase)) {
      return phrase.join(" ");
    }
  }

  for (const word of words) {
    if (KNOWN_BRANDS.has(word)) {
      return word;
    }
  }

  return null;
}

export function isStopWord(token: string): boolean {
  return STOP_WORDS.has(token);
}

export function isAccessoryHead(token: string): boolean {
  return ACCESSORY_HEADS.has(token);
}

export function isReplacementHead(token: string): boolean {
  return REPLACEMENT_HEADS.has(token);
}

export function isColorWord(token: string): boolean {
  return COLOR_WORDS.has(token);
}

export function isMaterialWord(token: string): boolean {
  return MATERIAL_WORDS.has(token);
}

export function isAttributeWord(token: string): boolean {
  return ATTRIBUTE_WORDS.has(token) || COLOR_WORDS.has(token) || MATERIAL_WORDS.has(token);
}

export function classGroupOf(token: string): string | null {
  const group = CLASS_GROUPS.find((items) => items.includes(token));
  return group?.[0] ?? null;
}

export function classifyProductClass(text: string): string {
  const tokens = tokenize(text);
  for (const token of tokens) {
    const group = classGroupOf(token);
    if (group) {
      return group;
    }
  }
  return "UNKNOWN";
}

export function classesAreIncompatible(
  first: string,
  second: string,
): boolean {
  if (!first || !second || first === "UNKNOWN" || second === "UNKNOWN") {
    return false;
  }

  if (first === second) {
    return false;
  }

  return CLASS_INCOMPATIBLE.get(first)?.has(second) ?? false;
}

export function detectHostSplit(normalizedTitle: string): {
  sold: string;
  host: string | null;
  relation: string | null;
} {
  const specific = normalizedTitle.match(HOST_RELATION_PATTERN);

  if (specific && specific.index !== undefined) {
    return {
      sold: normalizedTitle.slice(0, specific.index).trim() || normalizedTitle,
      host: normalizedTitle.slice(specific.index + specific[0].length).trim() || null,
      relation: specific[0].trim(),
    };
  }

  const generic = normalizedTitle.match(GENERIC_HOST_PATTERN);

  if (generic && generic.index !== undefined) {
    const sold = normalizedTitle.slice(0, generic.index).trim();
    const host = normalizedTitle.slice(generic.index + generic[0].length).trim();
    const soldTokens = tokenize(sold);
    const soldIsAccessory = soldTokens.some(isAccessoryHead) || soldTokens.some(isReplacementHead);
    const soldClass = classifyProductClass(sold);
    const hostClass = classifyProductClass(host);

    if (
      soldIsAccessory ||
      (soldClass !== "UNKNOWN" && hostClass !== "UNKNOWN" && soldClass !== hostClass)
    ) {
      return {
        sold: sold || normalizedTitle,
        host: host || null,
        relation: generic[0].trim(),
      };
    }
  }

  return {
    sold: normalizedTitle,
    host: null,
    relation: null,
  };
}

export function inferRole(text: string): ProductRole {
  const normalized = normalizeMultistoreText(text);
  const split = detectHostSplit(normalized);
  const soldTokens = tokenize(split.sold);

  if (soldTokens.some(isReplacementHead) || split.relation?.includes("reposicao") || split.relation?.includes("substituicao")) {
    return "REPLACEMENT_PART";
  }

  if (soldTokens.some(isAccessoryHead) || Boolean(split.relation)) {
    return "ACCESSORY";
  }

  return soldTokens.length > 0 ? "MAIN" : "UNKNOWN";
}

export function extractCapacity(tokens: string[]): string | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const compact = token.replace(/\./g, "");
    const unitMatch = token.match(/^(\d+(?:\.\d+)?)(l|ml|kg|g|w|v|mm|cm)$/);
    if (unitMatch) {
      return `${unitMatch[1]}${unitMatch[2]}`;
    }

    const next = tokens[index + 1];
    if (/^\d+(?:\.\d+)?$/.test(token) && next && CAPACITY_UNITS.has(next)) {
      return `${token}${next}`;
    }

    if (/^\d+$/.test(compact) && next && CAPACITY_UNITS.has(next)) {
      return `${token}${next}`;
    }
  }

  return null;
}

export function extractQuantity(tokens: string[]): string | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1];
    if (/^\d+$/.test(token) && next && QUANTITY_UNITS.has(next)) {
      return `${token}${next}`;
    }
  }

  return null;
}

export function extractColor(tokens: string[]): string | null {
  return tokens.find((token) => COLOR_WORDS.has(token)) ?? null;
}

export function extractMaterial(tokens: string[]): string | null {
  return tokens.find((token) => MATERIAL_WORDS.has(token)) ?? null;
}

export function extractModelTokens(tokens: string[]): string[] {
  const models: string[] = [];

  for (const token of tokens) {
    if (/^(?=.*[a-z])(?=.*\d)[a-z0-9]{3,}$/.test(token) && token.length >= 3) {
      models.push(token);
    }
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const current = tokens[index]!;
    const next = tokens[index + 1]!;
    if (/^[a-z]{2,}$/.test(current) && /^\d{2,}$/.test(next) && !QUANTITY_UNITS.has(tokens[index + 2] ?? "") && !CAPACITY_UNITS.has(tokens[index + 2] ?? "")) {
      if (!isAttributeWord(current) && !classGroupOf(current) && !isAccessoryHead(current)) {
        models.push(`${current}${next}`);
      }
    }
  }

  return Array.from(new Set(models));
}

export function extractIdentityNumbers(tokens: string[]): string[] {
  const numbers: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1];

    if (!/^\d{1,4}$/.test(token)) {
      continue;
    }

    if (next && (CAPACITY_UNITS.has(next) || QUANTITY_UNITS.has(next))) {
      continue;
    }

    const previous = tokens[index - 1];
    if (previous && CAPACITY_UNITS.has(previous)) {
      continue;
    }

    numbers.push(token);
  }

  return Array.from(new Set(numbers));
}

export function distinctiveTokensOf(tokens: string[]): string[] {
  return tokens.filter((token) => {
    if (token.length < 3) {
      return false;
    }

    if (classGroupOf(token) || isAttributeWord(token) || isAccessoryHead(token)) {
      return /^(?=.*\d)[a-z0-9]+$/.test(token);
    }

    if (isStopWord(token)) {
      return false;
    }

    if (/^\d+$/.test(token)) {
      return false;
    }

    return true;
  });
}

export function structuredAttribute(
  attributes: Record<string, string>,
  keys: string[],
): string | null {
  const entries = Object.entries(attributes);
  for (const key of keys) {
    const found = entries.find(
      ([name]) => name.replace(/[^a-z0-9]+/gi, "").toUpperCase() === key,
    );
    const value = found?.[1]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeStructuredBrand(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeMultistoreText(value);
  if (!normalized || /^(none|null|n a|sem marca|generic|generico)$/.test(normalized)) {
    return null;
  }

  return value.trim();
}

export function emptyField<T>(): {
  value: T | null;
  confidence: "NONE";
  source: "UNKNOWN";
} {
  return {
    value: null,
    confidence: "NONE",
    source: "UNKNOWN",
  };
}

export { ACCESSORY_HEADS };

export function normalizeCandidate(raw: RawCandidate): NormalizedCandidate {
  const rawText = raw.title;
  const normalizedText = normalizeMultistoreText(rawText);
  const tokens = tokenize(rawText);

  return {
    id: `${raw.marketplace}:${raw.externalId}`,
    raw,
    rawText,
    normalizedText,
    tokens,
    structuredBrand:
      normalizeStructuredBrand(
        raw.brand?.trim() ||
          structuredAttribute(raw.attributes, ["BRAND", "MARCA"]) ||
          null,
      ),
    structuredModel:
      structuredAttribute(raw.attributes, [
        "MODEL",
        "MODELO",
        "MODELNUMBER",
        "MODEL_NUMBER",
      ]) || null,
    structuredSku:
      structuredAttribute(raw.attributes, [
        "MPN",
        "SKU",
        "PARTNUMBER",
        "MANUFACTURER_PART_NUMBER",
      ]) || null,
    attributes: raw.attributes,
  };
}
