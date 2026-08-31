import type {
  NormalizedCandidate,
  ProductRole,
  RawCandidate,
} from "./types";
import {
  classifyProductConcept,
  classesAreIncompatible as conceptClassesAreIncompatible,
  conceptFirstContentIndex,
  detectVehicleHostSplit,
} from "./productConcepts";

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
  "tripe",
  "tripes",
  "bolsa",
  "protetor",
  "almofada",
  "almofadas",
  "reposicao",
  "substituicao",
  "filtro",
  "saco",
  "sacos",
  "refill",
  "puxador",
  "puxadores",
  "ferragem",
  "dobradica",
  "dobradicas",
  "broche",
  "colar",
  "brinco",
  "brincos",
  "pingente",
  "joia",
  "joias",
  "poster",
  "adesivo",
  "adesivos",
  "quadro",
  "gravata",
  "gravatas",
  "clipe",
  "clipes",
]);

const REPLACEMENT_HEADS = new Set([
  "reposicao",
  "substituicao",
  "refill",
  "filtro",
  "filtros",
  "saco",
  "sacos",
  "peso",
  "pesos",
  "valvula",
  "valvulas",
  "vela",
  "velas",
  "torneira",
  "torneiras",
  "anel",
  "aneis",
  "borracha",
  "borrachas",
  "recipiente",
  "recipientes",
  "cuba",
  "cubas",
  "forro",
  "forros",
  "tigela",
  "tigelas",
]);

const REPLACEMENT_PHRASES = [
  "tigela interna",
  "tigelas internas",
  "cuba interna",
  "cubas internas",
  "recipiente interno",
  "recipientes internos",
  "forro interno",
  "forros internos",
  "revestimento interno",
  "peca de reposicao",
  "pecas de reposicao",
  "peca de substituicao",
  "pecas de substituicao",
  "peca de replacement",
  "replacement part",
];

const REPLACEMENT_SEMANTICS = new Set([
  "substituicao",
  "substituicoes",
  "reposicao",
  "reposicoes",
  "replacement",
  "replacements",
  "substituto",
  "substituta",
  "substitutos",
  "substitutas",
]);

const HOST_LINK_WORDS = new Set(["para", "for", "p", "de", "da", "do", "das", "dos"]);

const ACCESSORY_PHRASES = [
  "vidro temperado",
  "protetor de tela",
  "pelicula protetora",
  "pelicula de vidro",
  "screen protector",
  "tempered glass",
];

const CLASS_GROUPS: string[][] = [
  ["headphone", "fone", "fones", "headset", "earbuds", "earphone", "auricular", "ouvido", "ouvidos"],
  ["speaker", "caixa", "som", "soundbar", "soundbox", "altofalante"],
  ["smartphone", "celular", "telefone", "iphone"],
  ["notebook", "laptop"],
  ["furadeira", "parafusadeira"],
  ["panela", "cacarola", "cafeteira"],
  ["nightstand", "mesa", "criado", "cabeceira", "comoda", "rack", "estante", "sofa", "moveis"],
  ["lapis", "caneta", "grafite"],
  ["estojo", "case", "capa"],
  ["barbeador", "aparador", "maquina"],
  ["liquidificador", "batedeira"],
  ["aspirador"],
  ["polia", "virabrequim", "correia"],
];

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
  "peca",
  "unidades",
  "unidade",
  "un",
  "und",
  "unid",
  "pc",
  "pcs",
  "litros",
]);

const VOLTAGE_VALUES = new Set(["110", "127", "220", "240"]);

const SIZE_HINTS = new Set([
  "tamanho",
  "tam",
  "size",
  "numero",
  "nr",
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
  "gb",
  "tb",
  "mb",
  "mah",
  "grama",
  "gramas",
  "litro",
  "litros",
  "kilo",
  "kilos",
  "quilograma",
  "quilogramas",
  "mililitro",
  "mililitros",
]);

const CAPACITY_UNIT_CANON: Record<string, string> = {
  l: "l",
  litro: "l",
  litros: "l",
  ml: "ml",
  mililitro: "ml",
  mililitros: "ml",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  quilograma: "kg",
  quilogramas: "kg",
  g: "g",
  grama: "g",
  gramas: "g",
  w: "w",
  v: "v",
  mm: "mm",
  cm: "cm",
  pol: "pol",
  gb: "gb",
  tb: "tb",
  mb: "mb",
  mah: "mah",
};

const HOST_RELATION_PATTERN =
  /\b(?:compative(?:l|is)\s+com|compatible(?:s)?\s+with|fits|reposicao\s+para|substituicao\s+para|de\s+substituicao\s+para)\b/;

const GENERIC_HOST_PATTERN = /\b(?:para|for|p)\b/;

export function collapseThousandsSeparators(value: string): string {
  return value.replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, (match) =>
    match.replace(/\./g, ""),
  );
}

export function normalizeMultistoreText(value: string): string {
  return collapseThousandsSeparators(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/(\d),(\d)/g, "$1.$2"),
  )
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

export function extractBrand(text: string): string | null {
  const words = wordsOf(text);

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
  return classifyProductConcept(text).id;
}

export function classesAreIncompatible(
  first: string,
  second: string,
): boolean {
  return conceptClassesAreIncompatible(first, second);
}

const ACCESSORY_LIKE_CLASSES = new Set([
  "case_accessory",
  "furniture_part",
  "vacuum_part",
  "consumable",
  "jewelry",
  "screen_protector",
]);

function primaryProductStartsAt(words: string[], index: number): boolean {
  const fromHere = words.slice(index).join(" ");
  const classified = classifyProductConcept(fromHere);
  if (classified.id === "UNKNOWN" || ACCESSORY_LIKE_CLASSES.has(classified.id)) {
    return false;
  }

  return conceptFirstContentIndex(fromHere, classified.id) === 0;
}

function phraseStartsAt(words: string[], index: number, phrase: string): boolean {
  const phraseTokens = normalizeMultistoreText(phrase).split(" ").filter(Boolean);
  if (phraseTokens.length === 0 || index + phraseTokens.length > words.length) {
    return false;
  }

  return phraseTokens.every((token, offset) => words[index + offset] === token);
}

function isBarePieceToken(token: string): boolean {
  return token === "peca" || token === "pecas";
}

function barePieceHasReplacementStructure(words: string[], index: number): boolean {
  const nearby = words.slice(Math.max(0, index - 3), Math.min(words.length, index + 6));
  if (nearby.some((item) => REPLACEMENT_SEMANTICS.has(item))) {
    return true;
  }

  const next = words[index + 1];
  return next === "para" || next === "for" || next === "p";
}

function partHeadAt(
  words: string[],
  index: number,
): { token: string; span: number; role: "REPLACEMENT_PART" | "ACCESSORY" } | null {
  for (const phrase of REPLACEMENT_PHRASES) {
    if (phraseStartsAt(words, index, phrase)) {
      return {
        token: words[index]!,
        span: normalizeMultistoreText(phrase).split(" ").filter(Boolean).length,
        role: "REPLACEMENT_PART",
      };
    }
  }

  for (const phrase of ACCESSORY_PHRASES) {
    if (phraseStartsAt(words, index, phrase)) {
      return {
        token: words[index]!,
        span: normalizeMultistoreText(phrase).split(" ").filter(Boolean).length,
        role: "ACCESSORY",
      };
    }
  }

  const token = words[index]!;
  if (isBarePieceToken(token)) {
    if (barePieceHasReplacementStructure(words, index)) {
      return { token, span: 1, role: "REPLACEMENT_PART" };
    }

    return null;
  }

  if (isReplacementHead(token)) {
    return { token, span: 1, role: "REPLACEMENT_PART" };
  }

  if (isAccessoryHead(token)) {
    return { token, span: 1, role: "ACCESSORY" };
  }

  return null;
}

function innerPieceAt(
  words: string[],
  index: number,
): { token: string; span: number; role: "REPLACEMENT_PART" } | null {
  for (const phrase of REPLACEMENT_PHRASES) {
    if (phraseStartsAt(words, index, phrase)) {
      return {
        token: words[index]!,
        span: normalizeMultistoreText(phrase).split(" ").filter(Boolean).length,
        role: "REPLACEMENT_PART",
      };
    }
  }

  return null;
}

function isReplacementSemanticsToken(token: string): boolean {
  return REPLACEMENT_SEMANTICS.has(token);
}

function isSkippableHostLink(token: string): boolean {
  if (isCapacityOrQuantityUnit(token)) {
    return true;
  }

  if (HOST_LINK_WORDS.has(token)) {
    return true;
  }

  return STOP_WORDS.has(token) && token !== "com" && token !== "sem";
}

function followingPrimaryProduct(words: string[], fromIndex: number): boolean {
  for (let index = fromIndex; index < words.length; index += 1) {
    const token = words[index]!;
    if (isSkippableHostLink(token)) {
      continue;
    }

    return primaryProductStartsAt(words, index);
  }

  return false;
}

function firstPrimaryProductIndex(
  words: string[],
  end = words.length,
): number | null {
  for (let index = 0; index < end; index += 1) {
    const token = words[index]!;
    if (STOP_WORDS.has(token) || isCapacityOrQuantityUnit(token)) {
      continue;
    }

    if (primaryProductStartsAt(words, index)) {
      return index;
    }
  }

  return null;
}

function firstUnabsorbedPartHead(
  words: string[],
): { token: string; index: number; span: number; role: "REPLACEMENT_PART" | "ACCESSORY" } | null {
  let seenPrimary = false;
  let innerPiece: {
    token: string;
    index: number;
    span: number;
    role: "REPLACEMENT_PART";
  } | null = null;
  let explicitPiece: {
    token: string;
    index: number;
    span: number;
    role: "REPLACEMENT_PART" | "ACCESSORY";
  } | null = null;
  const hasReplacementSemantics = words.some((token) =>
    isReplacementSemanticsToken(token),
  );

  for (let index = 0; index < words.length; index += 1) {
    const token = words[index]!;
    if (STOP_WORDS.has(token) || isCapacityOrQuantityUnit(token)) {
      const phraseHead = partHeadAt(words, index);
      if (!phraseHead || phraseHead.span <= 1) {
        continue;
      }
    }

    const head = partHeadAt(words, index);
    if (head && primaryProductStartsAt(words, index)) {
      if (!seenPrimary) {
        return null;
      }

      continue;
    }

    if (!seenPrimary) {
      if (head) {
        return { ...head, index };
      }

      if (primaryProductStartsAt(words, index)) {
        seenPrimary = true;
      }

      continue;
    }

    const inner = innerPieceAt(words, index);
    if (inner && !innerPiece) {
      innerPiece = { ...inner, index };
    }

    if (
      head &&
      head.role === "REPLACEMENT_PART" &&
      followingPrimaryProduct(words, index + head.span) &&
      !explicitPiece
    ) {
      explicitPiece = { ...head, index };
    }
  }

  if (innerPiece && hasReplacementSemantics) {
    return innerPiece;
  }

  return explicitPiece;
}

function hostHasIdentitySignal(host: string): boolean {
  const tokens = tokenize(host);
  return extractModelTokens(tokens).length > 0 || extractIdentityNumbers(tokens).length > 0;
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

  const vehicle = detectVehicleHostSplit(normalizedTitle);
  if (vehicle) {
    return {
      sold: vehicle.sold,
      host: vehicle.host,
      relation: "vehicle",
    };
  }

  const generic = normalizedTitle.match(GENERIC_HOST_PATTERN);

  if (generic && generic.index !== undefined) {
    const sold = normalizedTitle.slice(0, generic.index).trim();
    const host = normalizedTitle.slice(generic.index + generic[0].length).trim();
    const soldClass = classifyProductClass(sold);
    const hostClass = classifyProductClass(host);
    const soldIsAccessory =
      Boolean(firstUnabsorbedPartHead(wordsOf(sold))) ||
      ACCESSORY_LIKE_CLASSES.has(soldClass);
    const hostUsable =
      hostClass !== "UNKNOWN" || hostHasIdentitySignal(host);

    if (
      hostUsable &&
      (soldIsAccessory ||
        ACCESSORY_LIKE_CLASSES.has(soldClass) ||
        (hostClass !== "UNKNOWN" && soldClass !== hostClass))
    ) {
      return {
        sold: sold || normalizedTitle,
        host: host || null,
        relation: generic[0].trim(),
      };
    }
  }

  const implicit = detectImplicitHostSplit(normalizedTitle);
  if (implicit) {
    return implicit;
  }

  return {
    sold: normalizedTitle,
    host: null,
    relation: null,
  };
}

function detectImplicitHostSplit(normalizedTitle: string): {
  sold: string;
  host: string | null;
  relation: string | null;
} | null {
  const words = wordsOf(normalizedTitle);
  const head = firstUnabsorbedPartHead(words);
  if (!head) {
    return null;
  }

  const prefixHostIndex = firstPrimaryProductIndex(words, head.index);
  if (prefixHostIndex !== null) {
    const hostTokens = words.slice(prefixHostIndex, head.index);
    while (hostTokens.length > 0 && STOP_WORDS.has(hostTokens[hostTokens.length - 1]!)) {
      hostTokens.pop();
    }
    const sold = words.slice(head.index).join(" ").trim();
    const host = hostTokens.join(" ").trim();
    if (!sold || !host) {
      return null;
    }

    const hostClass = classifyProductClass(host);
    if (hostClass === "UNKNOWN" && !hostHasIdentitySignal(host)) {
      return null;
    }

    return {
      sold,
      host,
      relation: "host-context",
    };
  }

  const prefix = words.slice(0, head.index).join(" ");
  if (prefix) {
    const prefixClass = classifyProductClass(prefix);
    if (prefixClass !== "UNKNOWN" && !ACCESSORY_LIKE_CLASSES.has(prefixClass)) {
      return null;
    }
  }

  let hostStart = head.index + head.span;
  if (head.role === "REPLACEMENT_PART") {
    for (let index = head.index + head.span; index < words.length; index += 1) {
      const token = words[index]!;
      if (STOP_WORDS.has(token) || isCapacityOrQuantityUnit(token)) {
        continue;
      }

      if (primaryProductStartsAt(words, index)) {
        hostStart = index;
        break;
      }
    }
  }

  const sold = words.slice(0, hostStart).join(" ").trim();
  const host = words.slice(hostStart).join(" ").trim();
  if (!sold || !host) {
    return null;
  }

  const hostClass = classifyProductClass(host);
  const soldClass = classifyProductClass(sold);
  if (soldClass === hostClass && hostClass !== "UNKNOWN") {
    return null;
  }

  if (hostClass === "UNKNOWN" && !hostHasIdentitySignal(host)) {
    return null;
  }

  return {
    sold,
    host,
    relation: "host-context",
  };
}

export function inferRole(text: string): ProductRole {
  const normalized = normalizeMultistoreText(text);
  const split = detectHostSplit(normalized);
  const soldWords = wordsOf(split.sold);
  const soldClass = classifyProductClass(split.sold);
  const titleHead = firstUnabsorbedPartHead(wordsOf(normalized));
  const soldHead = firstUnabsorbedPartHead(soldWords);
  const head = titleHead ?? soldHead;

  if (
    split.relation &&
    /\b(?:reposicao|substituicao|replacement)\b/.test(split.relation)
  ) {
    return "REPLACEMENT_PART";
  }

  if (head) {
    return head.role;
  }

  if (ACCESSORY_LIKE_CLASSES.has(soldClass)) {
    return soldClass === "consumable" || soldClass === "vacuum_part"
      ? "REPLACEMENT_PART"
      : "ACCESSORY";
  }

  if (soldClass === "UNKNOWN" && split.host) {
    const hostClass = classifyProductClass(split.host);
    if (hostClass !== "UNKNOWN" || hostHasIdentitySignal(split.host)) {
      return "ACCESSORY";
    }
  }

  return soldWords.some((token) => !STOP_WORDS.has(token)) ? "MAIN" : "UNKNOWN";
}

function isVoltageReading(value: string, unit: string): boolean {
  if (unit !== "v") {
    return false;
  }

  const amount = value.replace(/\./g, "");
  return VOLTAGE_VALUES.has(amount);
}

export function extractVoltage(text: string): string | null {
  const normalized = normalizeMultistoreText(text);

  if (/\bbivolt\b/.test(normalized)) {
    return "bivolt";
  }

  const match = normalized.match(/\b(110|127|220|240)\s*v\b/);
  return match?.[1] ? `${match[1]}v` : null;
}

export function extractCapacity(tokens: string[]): string | null {
  const found: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const compact = token.replace(/\./g, "");
    const unitMatch = token.match(
      /^(\d+(?:\.\d+)?)(l|ml|kg|g|w|v|mm|cm|gb|tb|mb|mah)$/,
    );
    if (unitMatch) {
      if (isVoltageReading(unitMatch[1]!, unitMatch[2]!)) {
        continue;
      }

      const unit = CAPACITY_UNIT_CANON[unitMatch[2]] ?? unitMatch[2];
      found.push(`${unitMatch[1]}${unit}`);
      continue;
    }

    const next = tokens[index + 1];
    const nextCanon = next ? CAPACITY_UNIT_CANON[next] : undefined;
    if (/^\d+(?:\.\d+)?$/.test(token) && nextCanon) {
      if (isVoltageReading(token, nextCanon)) {
        continue;
      }

      found.push(`${token}${nextCanon}`);
      continue;
    }

    if (/^\d+$/.test(compact) && nextCanon) {
      if (isVoltageReading(compact, nextCanon)) {
        continue;
      }

      found.push(`${compact}${nextCanon}`);
    }
  }

  const storage = found.find((item) => /(gb|tb|mb)$/.test(item));
  return storage ?? found[0] ?? null;
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

export function extractSize(tokens: string[]): string | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1];
    if (SIZE_HINTS.has(token) && next && /^(?:\d{1,2}|[x]*[ppg]|gg|xg|xxg|xl|xxl)$/.test(next)) {
      return next;
    }
  }

  return null;
}

export function isCapacityOrQuantityUnit(token: string | undefined): boolean {
  if (!token) {
    return false;
  }

  return CAPACITY_UNITS.has(token) || QUANTITY_UNITS.has(token) || Boolean(CAPACITY_UNIT_CANON[token]);
}

export function isSizeHint(token: string | undefined): boolean {
  return Boolean(token && SIZE_HINTS.has(token));
}

export function extractColor(tokens: string[]): string | null {
  return tokens.find((token) => COLOR_WORDS.has(token)) ?? null;
}

const CHILD_AGE_TOKENS = new Set([
  "infantil",
  "crianca",
  "criancas",
  "menino",
  "menina",
  "meninos",
  "meninas",
  "pajem",
  "kids",
  "bebe",
  "baby",
]);

const ADULT_AGE_TOKENS = new Set([
  "adulto",
  "adulta",
  "adultos",
  "adultas",
]);

export function extractAge(tokens: string[]): string | null {
  if (tokens.some((token) => CHILD_AGE_TOKENS.has(token))) {
    return "infantil";
  }

  if (tokens.some((token) => ADULT_AGE_TOKENS.has(token))) {
    return "adulto";
  }

  return null;
}

export type YearCoverage = {
  explicit: boolean;
  contains: (year: number) => boolean;
  summary: string;
};

export function extractYearCoverage(text: string): YearCoverage {
  const normalized = normalizeMultistoreText(text);
  const ranges: Array<[number, number]> = [];
  const spanned = new Set<number>();
  const rangePattern = /\b((?:19|20)\d{2})\s*(?:a|ate|-|\/)\s*((?:19|20)\d{2})\b/g;

  for (const match of normalized.matchAll(rangePattern)) {
    const from = Number(match[1]);
    const to = Number(match[2]);
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    ranges.push([start, end]);
    spanned.add(from);
    spanned.add(to);
  }

  const years: number[] = [];
  for (const match of normalized.matchAll(/\b((?:19|20)\d{2})\b/g)) {
    const year = Number(match[1]);
    if (!spanned.has(year)) {
      years.push(year);
    }
  }

  const explicit = ranges.length > 0 || years.length > 0;
  return {
    explicit,
    contains: (year) =>
      ranges.some(([start, end]) => year >= start && year <= end) ||
      years.includes(year),
    summary: [
      ...ranges.map(([start, end]) => `${start}-${end}`),
      ...years.map(String),
    ].join(","),
  };
}

export function extractQueryYear(text: string): string | null {
  const coverage = extractYearCoverage(text);
  const match = normalizeMultistoreText(text).match(/\b((?:19|20)\d{2})\b/);
  if (!coverage.explicit || !match) {
    return null;
  }

  return match[1] ?? null;
}

export function extractMaterial(tokens: string[]): string | null {
  return tokens.find((token) => MATERIAL_WORDS.has(token)) ?? null;
}

export function isQuantitativeCompactToken(token: string | null | undefined): boolean {
  if (!token) {
    return false;
  }

  const compact = token.replace(/[\s.-]+/g, "");
  return /^(\d+(?:\.\d+)?)(l|ml|kg|g|w|v|mm|cm|pol|gb|tb|mb|mah|litros?|gramas?)$/.test(
    compact,
  );
}

export function extractModelTokens(tokens: string[]): string[] {
  const models: string[] = [];

  for (const token of tokens) {
    if (isCapacityOrQuantityUnit(token) || isQuantitativeCompactToken(token)) {
      continue;
    }

    if (/^(19|20)\d{2}$/.test(token)) {
      continue;
    }

    if (/^\d+(?:\.\d+)?(l|ml|kg|g|w|v|mm|cm|gb|tb|mb|mah)$/.test(token)) {
      continue;
    }

    if (
      /^(?=.*[a-z])(?=.*\d)[a-z0-9]{3,}$/.test(token) &&
      token.length >= 3 &&
      !ADULT_AGE_TOKENS.has(token) &&
      !CHILD_AGE_TOKENS.has(token)
    ) {
      models.push(token);
    }
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const current = tokens[index]!;
    const next = tokens[index + 1]!;
    if (/^(19|20)\d{2}$/.test(next)) {
      continue;
    }

    if (QUANTITY_UNITS.has(tokens[index + 2] ?? "")) {
      continue;
    }

    if (ADULT_AGE_TOKENS.has(current) || CHILD_AGE_TOKENS.has(current)) {
      continue;
    }

    if (QUANTITY_UNITS.has(next)) {
      continue;
    }

    if (/^[a-z]{1,}$/.test(current) && /^\d{2,}$/.test(next) && !QUANTITY_UNITS.has(tokens[index + 2] ?? "") && !CAPACITY_UNITS.has(tokens[index + 2] ?? "") && !isSizeHint(current)) {
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

    if (/^(19|20)\d{2}$/.test(token)) {
      continue;
    }

    if (next && (CAPACITY_UNITS.has(next) || QUANTITY_UNITS.has(next))) {
      continue;
    }

    const previous = tokens[index - 1];
    if (previous && (CAPACITY_UNITS.has(previous) || SIZE_HINTS.has(previous))) {
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
  attributes: Record<string, string> | null | undefined,
  keys: string[],
): string | null {
  if (!attributes) {
    return null;
  }

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

function normalizeStructuredVoltage(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeMultistoreText(value).replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }

  if (/^bivolt$/i.test(normalized) || /^bivolt$/i.test(value.trim())) {
    return "bivolt";
  }

  const match = normalized.match(/^(110|127|220|240)v?$/i);
  return match ? `${match[1].toLowerCase()}v` : null;
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
    structuredVoltage:
      normalizeStructuredVoltage(
        structuredAttribute(raw.attributes, [
          "VOLTAGE",
          "VOLTAGEM",
          "INPUTVOLTAGE",
          "INPUT_VOLTAGE",
          "VOLTAGE_RANGE",
        ]),
      ) || null,
    attributes: raw.attributes ?? {},
  };
}
