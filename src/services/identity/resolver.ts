import type {
  ProductImport,
} from "@/services/importers/core/types";

import {
  classificarClasseProduto,
  classeEhProdutoPrincipal,
  type ProductClassId,
} from "./productClass";

/*
 * Identity Resolver
 *
 * This is the only place that converts a marketplace payload into product
 * identity evidence.  Callers must never infer model, brand or variants with
 * their own regular expressions before asking the Exact Matcher.
 */

export type IdentityVariantKey =
  | "voltage"
  | "storage"
  | "ram"
  | "network"
  | "color"
  | "size"
  | "capacity"
  | "kitQuantity"
  | "condition"
  | "bundle";

export type ProductKind =
  | "ACCESSORY"
  | "REPLACEMENT_PART"
  | "FURNITURE"
  | "FOOTWEAR"
  | "GENERIC";

export type ProductRole =
  | "MAIN"
  | "ACCESSORY"
  | "REPLACEMENT_PART"
  | "UNKNOWN";

export type ProductIdentity = {
  title: string;
  normalizedTitle: string;
  brand: string | null;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  modelNumber: string | null;
  model: string | null;
  commercialModel: string | null;
  manufacturerSku: string | null;
  variantCodes: string[];
  modelTokens: string[];
  searchCodes: string[];
  kind: ProductKind;
  role: ProductRole;
  roleReason: string;
  soldItemType: "ACCESSORY" | "REPLACEMENT_PART" | "PRIMARY" | null;
  hostItemType: "ACCESSORY" | "REPLACEMENT_PART" | "PRIMARY" | null;
  compatibilityRelation: string | null;
  productClass: ProductClassId;
  hostModelCandidates: string[];
  identityModelCandidates: string[];
  modelAmbiguous: boolean;
  identityConfidence: number;
  multiModelCompatibility: boolean;
  compatibleModels: string[];
  variants: Record<IdentityVariantKey, string | null>;
};

type BrandAlias = {
  canonical: string;
  aliases: string[];
};

const BRAND_ALIASES: BrandAlias[] = [
  { canonical: "samsung", aliases: ["samsung", "galaxy"] },
  { canonical: "apple", aliases: ["apple", "iphone"] },
  { canonical: "motorola", aliases: ["motorola", "moto"] },
  { canonical: "xiaomi", aliases: ["xiaomi", "redmi", "poco"] },
  { canonical: "oppo", aliases: ["oppo"] },
  { canonical: "vivo", aliases: ["vivo"] },
  { canonical: "realme", aliases: ["realme"] },
  { canonical: "jbl", aliases: ["jbl"] },
  { canonical: "sony", aliases: ["sony"] },
  { canonical: "lg", aliases: ["lg"] },
  { canonical: "philips", aliases: ["philips"] },
  { canonical: "tcl", aliases: ["tcl"] },
  { canonical: "hisense", aliases: ["hisense"] },
  { canonical: "lenovo", aliases: ["lenovo"] },
  { canonical: "acer", aliases: ["acer"] },
  { canonical: "asus", aliases: ["asus"] },
  { canonical: "dell", aliases: ["dell"] },
  { canonical: "hp", aliases: ["hp"] },
  { canonical: "intelbras", aliases: ["intelbras"] },
  { canonical: "logitech", aliases: ["logitech"] },
  { canonical: "hyperx", aliases: ["hyperx"] },
  { canonical: "kingston", aliases: ["kingston"] },
  { canonical: "corsair", aliases: ["corsair"] },
  { canonical: "seagate", aliases: ["seagate"] },
  { canonical: "sandisk", aliases: ["sandisk"] },
  { canonical: "western digital", aliases: ["western digital", "wd"] },
  { canonical: "electrolux", aliases: ["electrolux"] },
  { canonical: "brastemp", aliases: ["brastemp"] },
  { canonical: "consul", aliases: ["consul"] },
  { canonical: "midea", aliases: ["midea"] },
  { canonical: "mondial", aliases: ["mondial"] },
  { canonical: "philco", aliases: ["philco"] },
  { canonical: "notavel", aliases: ["notavel"] },
  { canonical: "aramoveis", aliases: ["aramoveis"] },
];

const INVALID_BRANDS = new Set([
  "generico",
  "generica",
  "generic",
  "sem marca",
  "nao definido",
  "nao definida",
  "nao informado",
  "nao informada",
  "unknown",
  "not defined",
  "unbranded",
  "n a",
]);

const FURNITURE_TERMS = [
  "armario",
  "guarda roupa",
  "balcao",
  "buffet",
  "aparador",
  "comoda",
  "rack",
  "painel para tv",
  "estante",
  "mesa de cabeceira",
  "criado mudo",
  "sapateira",
  "cozinha",
  "cama",
  "sofa",
  "poltrona",
  "escrivaninha",
  "mesa",
];

const FOOTWEAR_TERMS = [
  "tenis",
  "sapato",
  "sandalia",
  "chinelo",
  "bota",
  "sapatilha",
];

/*
 * Papel estrutural do anuncio. Estas palavras descrevem o TIPO do item
 * vendido (capa, cabo, pelicula), nunca uma marca ou modelo concreto.
 * Fone, smartphone, pendrive e lanterna ficam de fora de proposito:
 * sao categorias de produto principal, nao envelopadores de outro item.
 */
const ACCESSORY_HEAD_TOKENS = new Set([
  "capa",
  "capas",
  "capinha",
  "capinhas",
  "case",
  "cases",
  "cover",
  "covers",
  "pelicula",
  "peliculas",
  "cabo",
  "cabos",
  "cable",
  "cables",
  "carregador",
  "carregadores",
  "charger",
  "chargers",
  "adaptador",
  "adaptadores",
  "adapter",
  "adapters",
  "suporte",
  "suportes",
  "stand",
  "stands",
  "holder",
  "holders",
  "mount",
  "mounts",
  "protetor",
  "protetores",
  "estojo",
  "estojos",
  "bolsa",
  "bolsas",
  "bumper",
  "skin",
  "skins",
  "adesivo",
  "adesivos",
  "pulseira",
  "pulseiras",
  "correia",
  "alca",
  "alcas",
  "peca",
  "pecas",
  "refil",
  "refis",
  "reposicao",
  "earpad",
  "earpads",
  "dock",
  "docks",
  "fonte",
  "fontes",
  "tampa",
  "tampas",
  "controle",
  "controles",
]);

const PRIMARY_PHRASES = [
  "caixa de som",
  "caixa de audio",
  "sound box",
  "fone de ouvido",
];

const CONTAINER_PHRASES = [
  "estojo de armazenamento",
  "estojo de transporte",
  "bolsa de transporte",
  "bolsa de armazenamento",
  "caixa de transporte",
  "caixa de armazenamento",
  "caixa protetora",
  "saco rigido",
  "hard case",
  "carrying case",
  "storage case",
];

const CONTAINER_CONTEXT = new Set([
  "armazenamento",
  "transporte",
  "protetor",
  "protetora",
  "protetores",
  "rigido",
  "rigida",
  "storage",
  "carrying",
  "travel",
]);

const PRIMARY_HEAD_TOKENS = new Set([
  "smartphone",
  "celular",
  "telefone",
  "iphone",
  "fone",
  "fones",
  "headphone",
  "headphones",
  "headset",
  "earbuds",
  "earphone",
  "earphones",
  "auricular",
  "notebook",
  "laptop",
  "tablet",
  "televisao",
  "tv",
  "monitor",
  "mouse",
  "teclado",
  "keyboard",
  "pendrive",
  "lanterna",
  "camera",
  "relogio",
  "smartwatch",
  "console",
  "videogame",
  "microfone",
  "speaker",
]);

const REPLACEMENT_HEAD_TOKENS = new Set([
  "almofada",
  "almofadas",
  "earpad",
  "earpads",
  "cushion",
  "cushions",
  "espuma",
  "espumas",
  "foam",
  "substituicao",
  "replacement",
  "reposicao",
  "peca",
  "pecas",
  "refil",
  "refis",
  "saco",
  "sacos",
  "roda",
  "rodas",
  "filtro",
  "filtros",
]);

const ACCESSORY_RELATIONAL_PATTERNS = [
  /\balmofad(?:a|as)\b/,
  /\bear\s*pad(?:s)?\b/,
  /\bearpad(?:s)?\b/,
  /\bespuma(?:s)?\b/,
  /\bfoam\b/,
  /\bcushion(?:s)?\b/,
  /\bsubstituicao\b/,
  /\breplacement\b/,
  /\breposicao\b/,
  /\bpeca(?:s)?\s+de\s+reposicao\b/,
  /\bkit\s+de\s+reposicao\b/,
  /\brefil(?:s)?\b/,
  /\bmop(?:s)?\s+para\b/,
  /\bpano(?:s)?\s+para\b/,
  /\bfiltro(?:s)?\s+para\b/,
  /\bescova(?:s)?\s+para\b/,
  /\bscreen\s+protector\b/,
  /\bvidro\s+temperado\b/,
  /\bcompative(?:l|is)\s+com\b/,
  /\bcompatible(?:s)?\s+with\b/,
  /\bfits\b/,
  /\b(?:capa|capinha|case|cover|estojo|pelicula|protetor|cabo|cable|carregador|charger|adaptador|adapter|suporte|stand|holder|pulseira|acessorio|acessorios|bolsa|controle)\s+(?:para|for)\b/,
];

const SPECIFIC_HOST_RELATION_PATTERN =
  /\s+((?:compative(?:l|is)\s+com)|(?:compatible(?:s)?\s+with)|(?:de\s+substituicao(?:\s+para)?)|(?:de\s+reposicao(?:\s+para)?)|(?:replacement(?:s)?(?:\s+for)?)|(?:fits))\s+/g;

const GENERIC_HOST_RELATION_PATTERN = /\s+(para|for)\s+/g;

const TITLE_STOP_WORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "com",
  "sem",
  "para",
  "por",
  "um",
  "uma",
  "the",
  "and",
  "for",
]);

const TECHNICAL_MODEL_TOKENS = new Set([
  "WIFI",
  "WI-FI",
  "USB",
  "USBC",
  "TYPEC",
  "HDMI",
  "BLUETOOTH",
  "OLED",
  "AMOLED",
  "QLED",
  "FHD",
  "UHD",
  "QHD",
  "RAM",
  "ROM",
  "SSD",
  "HDD",
  "NVME",
  "LTE",
  "5G",
  "4G",
  "3G",
]);

const TECHNICAL_MODEL_PREFIXES = [
  "DDR",
  "LPDDR",
  "GDDR",
  "USB",
  "HDMI",
  "WIFI",
  "BT",
  "HDR",
  "IP",
  "RTX",
  "GTX",
  "NVME",
];

export function canonizarHifensModelo(value: string): string {
  return value.replace(
    /[\u00AD\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u2043\uFE58\uFE63\uFF0D]/g,
    "-",
  );
}

export function normalizarTextoIdentidade(
  value: string | null | undefined,
): string {
  return canonizarHifensModelo(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bpen\s+drive\b/g, "pendrive")
    .replace(/\bsmart\s+phone\b/g, "smartphone")
    .replace(/\bnote\s+book\b/g, "notebook")
    .replace(/\bscreen\s+protector\b/g, "pelicula")
    .replace(/\bear\s+pads?\b/g, "earpad")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizarCodigoIdentidade(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\+/g, "PLUS")
    .replace(/[^A-Z0-9]+/g, "")
    .trim();

  return normalized || null;
}

/*
 * Codigo de linha/familia (V15, A55, G75) nao e o mesmo que SKU.
 * Um SKU especifico mistura letras e numeros com comprimento suficiente
 * para identificar a variante, nao so a familia comercial.
 */
export function ehCodigoSkuEspecifico(
  value: string | null | undefined,
): boolean {
  const code = normalizarCodigoIdentidade(value);

  if (!code || !/[A-Z]/.test(code) || !/\d/.test(code)) {
    return false;
  }

  return code.length >= 8;
}

export function codigoModeloMaisEspecificoQue(
  candidate: string,
  base: string,
): boolean {
  const specific = normalizarCodigoIdentidade(candidate);
  const family = normalizarCodigoIdentidade(base);

  if (!specific || !family || specific === family) {
    return false;
  }

  if (specific.startsWith(family) && specific.length > family.length) {
    return true;
  }

  return (
    family.length >= 3 &&
    specific.length >= family.length + 3 &&
    specific.includes(family)
  );
}

export function selecionarCodigosModeloMaisEspecificos(
  codes: string[],
): string[] {
  const normalized = Array.from(
    new Set(
      codes
        .map((code) => normalizarCodigoIdentidade(code))
        .filter((code): code is string => Boolean(code)),
    ),
  );

  return normalized.filter(
    (code) =>
      !normalized.some((other) =>
        codigoModeloMaisEspecificoQue(other, code),
      ),
  );
}

export function extrairGtinDaConsulta(
  query: string,
): string | null {
  const matches = query.match(/\b(\d{8,14})\b/g) ?? [];

  for (const match of matches) {
    if (match.length >= 8 && match.length <= 14) {
      return match;
    }
  }

  return null;
}

function normalizarChaveAtributo(
  value: string,
): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function obterAtributo(
  attributes: Record<string, string> | null | undefined,
  aliases: readonly string[],
): string | null {
  const entries = Object.entries(attributes ?? {})
    .map(([key, value]) => ({
      key: normalizarChaveAtributo(key),
      value: String(value ?? "").trim(),
    }))
    .filter((entry) => Boolean(entry.value));

  const normalizedAliases = aliases.map(
    normalizarChaveAtributo,
  );

  for (const alias of normalizedAliases) {
    const exact = entries.find(
      (entry) => entry.key === alias,
    );

    if (exact) {
      return exact.value;
    }
  }

  for (const alias of normalizedAliases) {
    const partial = entries.find(
      (entry) =>
        entry.key.startsWith(`${alias}_`) ||
        entry.key.endsWith(`_${alias}`) ||
        entry.key.includes(`_${alias}_`),
    );

    if (partial) {
      return partial.value;
    }
  }

  return null;
}

function containsPhrase(
  text: string,
  phrase: string,
): boolean {
  return ` ${text} `.includes(
    ` ${normalizarTextoIdentidade(phrase)} `,
  );
}

export function normalizarMarcaIdentidade(
  value: string | null | undefined,
): string | null {
  const normalized = normalizarTextoIdentidade(value)
    .replace(/^visite a loja\s+/, "")
    .replace(/^marca\s+/, "")
    .trim();

  if (!normalized || INVALID_BRANDS.has(normalized)) {
    return null;
  }

  for (const brand of BRAND_ALIASES) {
    if (
      brand.aliases.some((alias) =>
        containsPhrase(normalized, alias),
      )
    ) {
      return brand.canonical;
    }
  }

  return normalized;
}

function inferirMarcaPeloTitulo(
  title: string,
): string | null {
  const normalized = normalizarTextoIdentidade(title);

  for (const brand of BRAND_ALIASES) {
    if (
      brand.aliases.some((alias) =>
        containsPhrase(normalized, alias),
      )
    ) {
      return brand.canonical;
    }
  }

  return null;
}

function aliasesDaMarca(
  brand: string | null,
): string[] {
  if (!brand) {
    return [];
  }

  return (
    BRAND_ALIASES.find(
      (item) => item.canonical === brand,
    )?.aliases ?? [brand]
  );
}

function normalizarCodigoGlobal(
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");

  return digits.length >= 8 && digits.length <= 14
    ? digits
    : null;
}

function normalizarVariante(
  value: string | null | undefined,
): string | null {
  const normalized = normalizarTextoIdentidade(value)
    .replace(
      /(\d)\s+(gb|tb|mb|mah|w|v|hz|khz|mhz|ghz|mm|cm|ml|l|kg|g)\b/g,
      "$1$2",
    )
    .trim();

  return normalized || null;
}

function normalizarCapacidadeDigital(
  value: string | null | undefined,
): string | null {
  const normalized = normalizarTextoIdentidade(value);
  const match = normalized.match(
    /\b(\d+(?:[.,]\d+)?)\s*(mb|gb|tb)\b/i,
  );

  if (!match?.[1] || !match[2]) {
    return null;
  }

  const amount = match[1]
    .replace(",", ".")
    .replace(/\.0+$/, "");

  return `${amount}${match[2].toLowerCase()}`;
}

/*
 * O titulo representa o SKU que o consumidor esta vendo naquele anuncio.
 * Alguns importadores reaproveitam atributos estruturados de uma variacao ou
 * de uma ficha de catalogo; quando os dois sao explicitos e discordam, o
 * titulo e a evidencia mais segura para nao agrupar uma variacao errada.
 */
function reconciliarCapacidadeDigital(
  fromStructured: string | null,
  fromTitle: string | null,
): string | null {
  if (
    fromStructured &&
    fromTitle &&
    fromStructured !== fromTitle
  ) {
    return fromTitle;
  }

  return fromStructured ?? fromTitle;
}

const BUNDLE_PRODUCT_CLASSES: Array<[string, RegExp]> = [
  ["smartphone", /\b(?:smartphone|celular|iphone)\b/i],
  ["smartwatch", /\b(?:smartwatch|smart watch|relogio inteligente|galaxy watch|apple watch)\b/i],
  ["headphone", /\b(?:fone|headphone|headset|earbuds?|auricular)\b/i],
  ["charger", /\b(?:carregador|charger)\b/i],
  ["case", /\b(?:capa|case|estojo)\b/i],
  ["screen-protector", /\b(?:pelicula|protetor de tela)\b/i],
  ["keyboard", /\b(?:teclado|keyboard)\b/i],
  ["mouse", /\b(?:mouse)\b/i],
  ["controller", /\b(?:controle|controlador|gamepad|joystick)\b/i],
  ["speaker", /\b(?:caixa de som|speaker)\b/i],
  ["microphone", /\b(?:microfone|microphone)\b/i],
  ["bag", /\b(?:bolsa|mochila|case de transporte)\b/i],
  ["stand", /\b(?:suporte|base|stand)\b/i],
];

function classesProdutoNoTrecho(
  value: string,
): string[] {
  const normalized = normalizarTextoIdentidade(value);

  return BUNDLE_PRODUCT_CLASSES
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([name]) => name);
}

function extrairBundleSignature(
  title: string,
): string | null {
  const normalized = normalizarTextoIdentidade(title);
  const detected = new Set<string>();

  /*
   * Marcadores comerciais de bundle. A regra olha para classes de produto,
   * nao para modelos concretos. Assim A55 + smartwatch, notebook + mouse,
   * console + controle etc. seguem a mesma politica.
   */
  const rawSegments = title.split(/\s*\+\s*/g);

  if (rawSegments.length > 1) {
    for (const segment of rawSegments.slice(1)) {
      for (const item of classesProdutoNoTrecho(segment)) {
        detected.add(item);
      }
    }
  }

  const companionPattern =
    /\b(?:acompanha|inclui|com|brinde|gratis)\s+([^,;|]{2,90})/gi;
  let companionMatch: RegExpExecArray | null;

  while ((companionMatch = companionPattern.exec(normalized)) !== null) {
    for (const item of classesProdutoNoTrecho(companionMatch[1] ?? "")) {
      detected.add(item);
    }
  }

  if (/\b(?:kit|combo|conjunto)\b/i.test(normalized)) {
    const allClasses = classesProdutoNoTrecho(normalized);

    if (allClasses.length >= 2) {
      for (const item of allClasses) {
        detected.add(item);
      }
    }

    if (rawSegments.length > 1) {
      detected.add("kit");
    }
  }

  return detected.size > 0
    ? Array.from(detected).sort().join("+")
    : null;
}

function extrairCondicao(
  title: string,
  structured: string | null,
): string | null {
  const normalized = normalizarTextoIdentidade(
    `${structured ?? ""} ${title}`,
  );

  if (/\b(?:recondicionado|remanufaturado|refurbished|renewed)\b/.test(normalized)) {
    return "refurbished";
  }

  if (
    /\b(?:reembalad[oa]|re\s+embalad[oa]|repackaged|repack)\b/.test(
      normalized,
    )
  ) {
    return "repackaged";
  }

  if (/\b(?:caixa aberta|open box|openbox)\b/.test(normalized)) {
    return "open-box";
  }

  if (/\b(?:seminovo|semi novo|usado|used)\b/.test(normalized)) {
    return "used";
  }

  if (/\boutlet\b/.test(normalized)) {
    return "outlet";
  }

  /* Produto novo e o estado padrao do catalogo; ausencia nao vira conflito. */
  return null;
}

function extrairVoltagem(
  title: string,
  structured: string | null,
): string | null {
  const value = normalizarTextoIdentidade(structured);

  if (value.includes("bivolt")) {
    return "bivolt";
  }

  const structuredMatch = value.match(
    /\b(110|127|220|240)\s*(?:v|volts?)?\b/,
  );

  if (structuredMatch?.[1]) {
    return `${structuredMatch[1]}v`;
  }

  const normalizedTitle = normalizarTextoIdentidade(title);

  if (normalizedTitle.includes("bivolt")) {
    return "bivolt";
  }

  const titleMatch = normalizedTitle.match(
    /\b(110|127|220|240)\s*(?:v|volts?)\b/,
  );

  return titleMatch?.[1]
    ? `${titleMatch[1]}v`
    : null;
}

function extrairRamFisicaComMemoriaVirtual(
  normalizedTitle: string,
): string | null {
  /*
   * Lojas frequentemente anunciam algo como:
   * "12GB RAM (6GB + 6GB RAM Virtual)".
   * A identidade deve usar a RAM fisica (6GB), nao a soma promocional.
   */
  const match = normalizedTitle.match(
    /\b(\d+(?:[.,]\d+)?)\s*(gb|mb)\s*(?:de\s*)?ram\b(?:\s*\(?\s*)?(?:(\d+(?:[.,]\d+)?)\s*(gb|mb)\s*(?:\+\s*)?)?(\d+(?:[.,]\d+)?)\s*(gb|mb)\s*(?:de\s*)?(?:ram\s*)?(?:virtual|expandida|expandivel|extendida|boost)\b/i,
  );

  if (!match?.[1] || !match[2]) {
    return null;
  }

  const physical =
    match[3] && match[4]
      ? normalizarCapacidadeDigital(
          `${match[3]}${match[4]}`,
        )
      : null;

  if (physical) {
    return physical;
  }

  if (!match[5] || !match[6] || match[2] !== match[6]) {
    return null;
  }

  const total = Number(match[1].replace(",", "."));
  const virtual = Number(match[5].replace(",", "."));

  if (
    !Number.isFinite(total) ||
    !Number.isFinite(virtual) ||
    total <= virtual
  ) {
    return null;
  }

  return normalizarCapacidadeDigital(
    `${total - virtual}${match[2]}`,
  );
}

function extrairRamDoTitulo(
  title: string,
): string | null {
  const normalizedTitle = normalizarTextoIdentidade(title);
  const physicalRam =
    extrairRamFisicaComMemoriaVirtual(normalizedTitle);

  if (physicalRam) {
    return physicalRam;
  }

  const patterns = [
    /\b(\d+(?:[.,]\d+)?)\s*(gb|mb)\s*(?:de\s*)?(?:ram|memoria ram|ddr\d*)\b/i,
    /\b(?:ram|memoria ram)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*(gb|mb)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalizedTitle.match(pattern);

    if (match?.[1] && match[2]) {
      return normalizarCapacidadeDigital(
        `${match[1]}${match[2]}`,
      );
    }
  }

  return null;
}

function extrairRam(
  title: string,
  structured: string | null,
): string | null {
  return reconciliarCapacidadeDigital(
    normalizarCapacidadeDigital(structured),
    extrairRamDoTitulo(title),
  );
}

type DigitalCapacity = {
  value: string;
  megabytes: number;
  index: number;
};

function extrairCapacidadesDigitais(
  title: string,
): DigitalCapacity[] {
  const normalized = normalizarTextoIdentidade(title);
  const pattern = /(\d+(?:[.,]\d+)?)\s*(mb|gb|tb)\b/gi;
  const capacities: DigitalCapacity[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(normalized)) !== null) {
    const value = normalizarCapacidadeDigital(match[0]);

    if (!value || !match[1] || !match[2]) {
      continue;
    }

    const amount = Number(match[1].replace(",", "."));
    const unit = match[2].toLowerCase();

    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    capacities.push({
      value,
      megabytes:
        unit === "tb"
          ? amount * 1024 * 1024
          : unit === "gb"
            ? amount * 1024
            : amount,
      index: match.index,
    });
  }

  return capacities;
}

function capacidadeEhRam(
  normalizedTitle: string,
  capacity: DigitalCapacity,
): boolean {
  const after = normalizedTitle.slice(
    capacity.index,
    capacity.index + 42,
  );
  const before = normalizedTitle.slice(
    Math.max(0, capacity.index - 32),
    capacity.index,
  );

  return (
    /^\d+(?:[.,]\d+)?\s*(?:gb|mb)\s*(?:de\s*)?(?:ram|memoria ram|ddr\d*)\b/i.test(
      after,
    ) ||
    /(?:ram|memoria ram|ddr\d*)\s*(?:de\s*)?$/i.test(before)
  );
}

function pareceProdutoDigital(
  title: string,
): boolean {
  return /\b(?:celular|smartphone|telefone|iphone|galaxy|oppo|xiaomi|redmi|poco|notebook|laptop|tablet|smartwatch|watch|relogio|console|ssd|hd externo|camera)\b/i.test(
    normalizarTextoIdentidade(title),
  );
}

function extrairArmazenamentoAntesDeRamMalFormatado(
  title: string,
): string | null {
  const normalized = normalizarTextoIdentidade(title);
  const match = normalized.match(
    /\b(\d+(?:[.,]\d+)?)\s*(gb|tb)\s+ram\s+(\d+(?:[.,]\d+)?)\s*(gb|mb)\b/i,
  );

  if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
    return null;
  }

  const first = normalizarCapacidadeDigital(`${match[1]}${match[2]}`);
  const second = normalizarCapacidadeDigital(`${match[3]}${match[4]}`);

  if (!first || !second) {
    return null;
  }

  const firstGb =
    match[2].toLowerCase() === "tb"
      ? Number(match[1].replace(",", ".")) * 1024
      : Number(match[1].replace(",", "."));
  const secondGb =
    match[4].toLowerCase() === "mb"
      ? Number(match[3].replace(",", ".")) / 1024
      : Number(match[3].replace(",", "."));

  /*
   * Alguns feeds removem a pontuacao de "256GB, RAM 8GB" e produzem
   * "256GB RAM 8GB". Se o primeiro numero tem perfil de armazenamento e
   * e muito maior que a RAM seguinte, preservamos 256GB como storage.
   * Isso nao transforma "12GB RAM (6GB + 6GB virtual)" em storage.
   */
  if (
    Number.isFinite(firstGb) &&
    Number.isFinite(secondGb) &&
    firstGb >= 64 &&
    secondGb > 0 &&
    secondGb <= 32 &&
    firstGb / secondGb >= 4
  ) {
    return first;
  }

  return null;
}

function extrairArmazenamento(
  title: string,
  structured: string | null,
): string | null {
  const fromStructured = normalizarCapacidadeDigital(structured);

  const normalizedTitle = normalizarTextoIdentidade(title);
  const malformedStorage =
    extrairArmazenamentoAntesDeRamMalFormatado(title);

  if (malformedStorage) {
    return reconciliarCapacidadeDigital(
      fromStructured,
      malformedStorage,
    );
  }

  const capacities = extrairCapacidadesDigitais(title)
    .filter(
      (capacity) =>
        !capacidadeEhRam(normalizedTitle, capacity),
    );

  const explicit = capacities.find((capacity) => {
    const context = normalizedTitle.slice(
      Math.max(0, capacity.index - 24),
      capacity.index + 36,
    );

    return /\b(?:ssd|nvme|hdd|rom|armazenamento|memoria interna|storage)\b/i.test(
      context,
    );
  });

  if (explicit) {
    return reconciliarCapacidadeDigital(
      fromStructured,
      explicit.value,
    );
  }

  /*
   * GB/TB/MB fora de contexto de RAM ja sao evidencia digital suficiente.
   * A consulta do usuario frequentemente omite palavras como "smartphone"
   * (ex.: "Moto G75 256GB"), portanto nao dependemos da classe textual para
   * reconhecer armazenamento.
   */
  const fromTitle = [...capacities].sort(
    (first, second) => second.megabytes - first.megabytes,
  )[0]?.value ?? null;

  return reconciliarCapacidadeDigital(
    fromStructured,
    fromTitle,
  );
}

function extrairRede(
  title: string,
  structured: string | null,
): string | null {
  const normalizedTitle = normalizarTextoIdentidade(title);
  const normalizedStructured = normalizarTextoIdentidade(structured);
  const isWatch = /\b(?:smartwatch|watch|relogio)\b/.test(
    normalizedTitle,
  );
  const isPhone = /\b(?:celular|smartphone|telefone|iphone|galaxy|oppo|xiaomi|redmi|poco|motorola|moto|realme|vivo)\b/.test(
    normalizedTitle,
  );

  if (!isWatch && !isPhone) {
    return null;
  }

  const source = `${normalizedStructured} ${normalizedTitle}`;

  if (isPhone) {
    if (/\b5g\b/.test(source)) {
      return "5g";
    }

    if (/\b(?:4g|lte)\b/.test(source)) {
      return "4g";
    }

    return null;
  }

  if (/\b(?:lte|4g)\b/.test(source)) {
    return "lte";
  }

  if (/\b(?:bluetooth|bt)\b/.test(source)) {
    return "bluetooth";
  }

  return null;
}

const COLOR_ALIASES: Array<[string, string[]]> = [
  ["azul marinho", ["azul marinho", "navy blue"]],
  ["preto", ["preto", "preta", "black"]],
  ["branco", ["branco", "branca", "white"]],
  ["cinza", ["cinza", "gray", "grey"]],
  ["grafite", ["grafite", "graphite"]],
  ["prata", ["prata", "prateado", "prateada", "silver"]],
  ["azul", ["azul", "blue"]],
  ["verde", ["verde", "green"]],
  ["vermelho", ["vermelho", "vermelha", "red"]],
  ["rosa", ["rosa", "pink"]],
  ["roxo", ["roxo", "roxa", "purple"]],
  ["dourado", ["dourado", "dourada", "gold"]],
  ["bege", ["bege", "beige"]],
  ["marrom", ["marrom", "brown"]],
  ["amarelo", ["amarelo", "amarela", "yellow"]],
  ["laranja", ["laranja", "orange"]],
];

function extrairCorCanonica(
  value: string | null | undefined,
): string | null {
  const normalized = normalizarTextoIdentidade(value);

  if (!normalized) {
    return null;
  }

  if (/\b(?:sortido|multicor|multicolor|cores variadas)\b/.test(normalized)) {
    return null;
  }

  const found = COLOR_ALIASES.filter(([, aliases]) =>
    aliases.some((alias) => containsPhrase(normalized, alias)),
  ).map(([canonical]) => canonical);

  return found.length === 1
    ? found[0] ?? null
    : null;
}

function extrairTamanho(
  title: string,
  structured: string | null,
): string | null {
  const normalizedTitle = normalizarTextoIdentidade(title);
  const hasFootwear = FOOTWEAR_TERMS.some((term) =>
    containsPhrase(normalizedTitle, term),
  );

  const screenContext = /\b(?:tela|monitor|tv|televisao|notebook|display)\b/.test(
    normalizedTitle,
  );

  const parseInches = (
    value: string | null | undefined,
    allowBareNumber = false,
  ): string | null => {
    if (!value) {
      return null;
    }

    const source = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    const explicit = source.match(
      /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:["”″]|polegadas?|pol|inch(?:es)?)(?=\s|$|[^a-z0-9])/i,
    );

    const bare = allowBareNumber
      ? source.trim().match(/^(\d{1,3}(?:[.,]\d{1,2})?)$/)
      : null;

    const amount = explicit?.[1] ?? bare?.[1] ?? null;

    return amount
      ? `${amount.replace(",", ".").replace(/\.0+$/, "")}pol`
      : null;
  };

  /*
   * Tela decimal deve ser lida antes da normalizacao que remove pontuacao.
   * Evita interpretar 6,7" como 7".
   */
  if (screenContext) {
    const structuredScreen = parseInches(structured, true);
    const titleScreen = parseInches(title);

    if (
      structuredScreen &&
      titleScreen &&
      structuredScreen !== titleScreen
    ) {
      return titleScreen;
    }

    if (structuredScreen || titleScreen) {
      return structuredScreen ?? titleScreen;
    }
  }

  const structuredSize = normalizarVariante(structured);

  if (structuredSize) {
    return structuredSize;
  }

  const clothing = normalizedTitle.match(
    /\b(?:tamanho|tam)\s*(rn|xpp|pp|p|m|g|gg|xg|xgg|xxg|xxxg)\b/i,
  );

  if (clothing?.[1]) {
    return clothing[1].toLowerCase();
  }

  if (hasFootwear) {
    const shoe = normalizedTitle.match(
      /\b(?:tam(?:anho)?\s*)?(\d{2})\b/,
    );

    if (shoe?.[1]) {
      return shoe[1];
    }
  }

  const isWatch = /\b(?:smartwatch|watch|relogio)\b/.test(
    normalizedTitle,
  );
  const millimeters = normalizedTitle.match(
    /\b(\d{2})\s*mm\b/i,
  );

  return isWatch && millimeters?.[1]
    ? `${millimeters[1]}mm`
    : null;
}

function extrairCapacidadeGenerica(
  title: string,
  structured: string | null,
): string | null {
  /*
   * Em celulares e outros itens digitais, "capacidade" pode significar
   * rede, armazenamento ou RAM. Esses eixos possuem resolvedores proprios.
   */
  if (
    pareceProdutoDigital(title) ||
    extrairRede(title, null) !== null
  ) {
    return null;
  }

  const parsePhysicalCapacity = (
    value: string | null | undefined,
  ): string | null => {
    if (!value) {
      return null;
    }

    /*
     * Preservamos virgula/ponto decimal antes da normalizacao textual.
     * Sem isso, 4,5 L poderia virar tokens "4 5 l" e ser lido como 5 L.
     */
    const source = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    const match = source.match(
      /\b(\d+(?:[.,]\d+)?)\s*(l|litros?|ml|kg|g)\b/i,
    );

    if (!match?.[1] || !match[2]) {
      return null;
    }

    const amount = match[1]
      .replace(",", ".")
      .replace(/\.0+$/, "");

    const rawUnit = match[2].toLowerCase();
    const unit = rawUnit.startsWith("litro")
      ? "l"
      : rawUnit;

    return `${amount}${unit}`;
  };

  const fromStructured =
    parsePhysicalCapacity(structured);
  const fromTitle =
    parsePhysicalCapacity(title);

  if (
    fromStructured &&
    fromTitle &&
    fromStructured !== fromTitle
  ) {
    return fromTitle;
  }

  return fromStructured ?? fromTitle;
}

function extrairQuantidadeKit(
  title: string,
  structured: string | null,
): string | null {
  const fromStructured = normalizarTextoIdentidade(structured);

  if (/^\d{1,4}$/.test(fromStructured)) {
    return fromStructured;
  }

  const normalizedTitle = normalizarTextoIdentidade(title);
  const match = normalizedTitle.match(
    /\b(?:kit\s+)?(\d{1,4})\s*(?:unidades?|unid|unds?|pecas?|pares?)\b/i,
  );

  return match?.[1] ?? null;
}

function ehTokenModeloValido(
  value: string,
  allowShort: boolean,
): boolean {
  const token = normalizarCodigoIdentidade(value);

  if (!token || !/[A-Z]/.test(token) || !/\d/.test(token)) {
    return false;
  }

  if (token.length < (allowShort ? 2 : 3) || token.length > 40) {
    return false;
  }

  if (
    /^(?:\d+(?:GB|TB|MB|MAH|W|V|HZ|KHZ|MHZ|GHZ|CM|MM|MP))+$/.test(token) ||
    /^[A-Z]+\d+(?:GB|TB|MB|MAH|W|V|HZ|KHZ|MHZ|GHZ|CM|MM|MP)$/.test(token) ||
    TECHNICAL_MODEL_TOKENS.has(token) ||
    TECHNICAL_MODEL_PREFIXES.some((prefix) =>
      prefix === "IP"
        ? /^IP\d{1,3}$/.test(token)
        : token.startsWith(prefix),
    )
  ) {
    return false;
  }

  return true;
}

function adicionarModelo(
  destination: Set<string>,
  value: string | null | undefined,
  allowShort = false,
): void {
  const code = normalizarCodigoIdentidade(value);

  if (code && ehTokenModeloValido(code, allowShort)) {
    destination.add(code);
  }
}

function extrairTokensModelo(
  title: string,
  structuredModel: string | null,
  brand: string | null,
  options?: {
    concatenarMarca?: boolean;
  },
): string[] {
  const concatenarMarca = options?.concatenarMarca !== false;
  const tokens = new Set<string>();
  const normalizedTitle = normalizarTextoIdentidade(title);

  adicionarModelo(tokens, structuredModel, true);

  const structuredWords = structuredModel
    ? canonizarHifensModelo(structuredModel).match(
        /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g,
      ) ?? []
    : [];

  for (const word of structuredWords) {
    adicionarModelo(tokens, word, true);
  }

  /*
   * Codigos curtos como A5, G8 e X3 so sao confiaveis quando aparecem
   * imediatamente apos uma marca reconhecida. Essa gramatica generica deve
   * ter prioridade sobre numeros tecnicos do titulo, como 45W ou 50MP.
   */
  for (const alias of aliasesDaMarca(brand)) {
    const escapedAlias = alias.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const pattern = new RegExp(
      `\\b${escapedAlias}\\s+([a-z]{1,3}\\d{1,5}[a-z0-9+]*)\\b`,
      "i",
    );
    const match = normalizedTitle.match(pattern);

    if (match?.[1]) {
      adicionarModelo(tokens, match[1], true);
      if (concatenarMarca) {
        adicionarModelo(tokens, `${brand}${match[1]}`, true);
      }
    }
  }

  /*
   * Alguns marketplaces colocam a marca no fim do titulo, por exemplo
   * "Smartphone A5 ... OPPO". Se a marca reconhecida existe em qualquer
   * posicao, um codigo curto alfanumerico continua sendo uma evidencia de
   * modelo valida. A regra depende da gramatica do titulo, nunca de um
   * produto especifico.
   */
  if (brand) {
    for (const word of normalizedTitle.split(" ")) {
      if (!/^[a-z]{1,3}\d{1,5}[a-z0-9+]*$/i.test(word)) {
        continue;
      }

      adicionarModelo(tokens, word, true);
      if (concatenarMarca) {
        adicionarModelo(tokens, `${brand}${word}`, true);
      }
    }
  }

  const rawTitleTokens =
    canonizarHifensModelo(title).match(
      /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g,
    ) ?? [];

  for (const rawToken of rawTitleTokens) {
    adicionarModelo(tokens, rawToken);
  }

  const words = normalizedTitle.split(" ").filter(Boolean);

  /*
   * Modelos comerciais com numero separado, como "Edge 60 Fusion" e
   * "iPhone 15 Pro", nao podem depender de regras por produto. Quando ha
   * uma marca reconhecida, capturamos familia + numero e, se existir, um
   * sufixo comercial alfabetico. Contextos tecnicos (camera 50 MP, tela
   * 120 Hz, bateria 5000 mAh) sao bloqueados genericamente.
   */
  const contextosTecnicos = new Set([
    "camera",
    "tela",
    "display",
    "bateria",
    "memoria",
    "ram",
    "rom",
    "ssd",
    "hdd",
    "potencia",
    "voltagem",
    "tensao",
    "frequencia",
    "peso",
    "capacidade",
  ]);

  const unidadesTecnicas = new Set([
    "gb",
    "tb",
    "mb",
    "mah",
    "mp",
    "hz",
    "khz",
    "mhz",
    "ghz",
    "w",
    "kw",
    "v",
    "mm",
    "cm",
    "ml",
    "kg",
    "pol",
    "polegada",
    "polegadas",
    "inch",
    "inches",
    "litro",
    "litros",
  ]);

  function ehSufixoDeSubmodelo(value: string): boolean {
    if (
      !value ||
      unidadesTecnicas.has(value) ||
      contextosTecnicos.has(value) ||
      aliasesMarcaSet.has(value) ||
      /^(?:de|da|do|com|para|por|e|em|intel|amd|nvidia|windows|linux|macos|core|geracao)$/.test(
        value,
      )
    ) {
      return false;
    }

    return (
      /^[a-z][a-z0-9+]{1,20}$/.test(value) ||
      /^\d{1,4}[a-z][a-z0-9]{0,8}$/.test(value)
    );
  }

  const aliasesMarcaSet = new Set(
    aliasesDaMarca(brand)
      .flatMap((alias) =>
        normalizarTextoIdentidade(alias)
          .split(" ")
          .filter(Boolean),
      ),
  );

  const contextoTelaGrande =
    /\b(?:tv|televisao|monitor|display)\b/.test(
      normalizedTitle,
    );

  if (brand) {
    for (let index = 0; index < words.length - 1; index += 1) {
      const family = words[index] ?? "";
      const number = words[index + 1] ?? "";
      const suffix = words[index + 2] ?? "";
      const suffix2 = words[index + 3] ?? "";

      if (
        !/^[a-z][a-z0-9+]{1,20}$/.test(family) ||
        !/^\d{2,4}$/.test(number) ||
        contextosTecnicos.has(family) ||
        /\d/.test(family)
      ) {
        continue;
      }

      /*
       * "AX90 256 GB" e capacidade, nao submodelo AX90256. A familia
       * comercial so recebe o numero seguinte quando ele nao e unidade
       * tecnica (Edge 60, iPhone 15).
       */
      if (unidadesTecnicas.has(suffix)) {
        continue;
      }

      /*
       * Em TVs/monitores, "Samsung 55", "LG 65" etc. normalmente descreve
       * o tamanho da tela, nao o codigo do modelo. Fora desse contexto,
       * marca + numero continua valido para familias como Realme 14/Xiaomi 14.
       */
      const numeroComoTamanhoDeTela =
        contextoTelaGrande &&
        aliasesMarcaSet.has(family) &&
        Number(number) >= 15 &&
        Number(number) <= 120;

      if (numeroComoTamanhoDeTela) {
        continue;
      }

      adicionarModelo(tokens, `${family}${number}`, true);

      if (ehSufixoDeSubmodelo(suffix)) {
        adicionarModelo(
          tokens,
          `${family}${number}${suffix}`,
          true,
        );

        if (ehSufixoDeSubmodelo(suffix2)) {
          adicionarModelo(
            tokens,
            `${family}${number}${suffix}${suffix2}`,
            true,
          );
        }
      }
    }
  }

  const iphone = normalizedTitle.match(
    /\biphone\s*(\d{1,2})(?:\s+(pro max|pro|plus|max|mini|air|e))?\b/i,
  );

  if (iphone?.[1]) {
    adicionarModelo(
      tokens,
      `iphone${iphone[1]}${iphone[2] ?? ""}`,
      true,
    );
  }

  const galaxy = normalizedTitle.match(
    /\bgalaxy\s+([a-z]{1,3}\d{1,4})(?:\s+(fe|plus|ultra|classic))?\b/i,
  );

  if (galaxy?.[1]) {
    adicionarModelo(
      tokens,
      `galaxy${galaxy[1]}${galaxy[2] ?? ""}`,
      true,
    );
    adicionarModelo(
      tokens,
      `${galaxy[1]}${galaxy[2] ?? ""}`,
      true,
    );
    adicionarModelo(tokens, galaxy[1], true);
  }

  return Array.from(tokens);
}

export function familiasModeloDistintas(
  codes: string[],
  brand?: string | null,
): string[] {
  const brandCode = normalizarCodigoIdentidade(brand);
  const normalized = Array.from(
    new Set(
      codes
        .map((code) => normalizarCodigoIdentidade(code))
        .filter((code): code is string => Boolean(code))
        .filter(
          (code) =>
            code.length >= 3 &&
            /[A-Z]/.test(code) &&
            /\d/.test(code),
        ),
    ),
  );
  const stripped = normalized.map((code) => {
    if (
      !brandCode ||
      !code.startsWith(brandCode) ||
      code.length <= brandCode.length + 2
    ) {
      return code;
    }

    const remainder = code.slice(brandCode.length);
    return normalized.includes(remainder) ? remainder : code;
  });
  const unique = Array.from(new Set(stripped));

  return unique.filter(
    (code) =>
      !unique.some(
        (other) =>
          other !== code &&
          other.length > code.length &&
          (other.startsWith(code) || other.endsWith(code)),
      ),
  );
}

function ehEnvelopeDeSku(
  longer: string,
  shorter: string,
): boolean {
  const specific = normalizarCodigoIdentidade(longer);
  const model = normalizarCodigoIdentidade(shorter);

  if (!specific || !model || specific === model || model.length < 3) {
    return false;
  }

  /*
   * ZX100PRO comeca com ZX100: submodelo comercial, nao SKU envelopado.
   * MXZX100 contem ZX100 sem ser prefixo: part number composto.
   */
  if (specific.startsWith(model)) {
    return false;
  }

  return specific.includes(model);
}

function classificarModelosESkus(
  commercialTokens: string[],
  allTokens: string[],
  brand: string | null,
  structuredMpn: string | null,
): {
  commercialModels: string[];
  manufacturerSku: string | null;
  variantCodes: string[];
} {
  const brandCode = normalizarCodigoIdentidade(brand);
  const explicit = Array.from(
    new Set(
      commercialTokens
        .map((code) => normalizarCodigoIdentidade(code))
        .filter((code): code is string => Boolean(code)),
    ),
  );
  const extras = Array.from(
    new Set(
      [
        ...allTokens,
        structuredMpn,
      ]
        .map((code) => normalizarCodigoIdentidade(code))
        .filter((code): code is string => Boolean(code)),
    ),
  );
  const skuCodes = extras.filter((code) => {
    const remainder =
      brandCode &&
      code.startsWith(brandCode) &&
      code.length > brandCode.length + 2
        ? code.slice(brandCode.length)
        : null;
    const remainderNaoEhModeloExplicito =
      remainder !== null && !explicit.includes(remainder);
    const envolveModeloExplicito = explicit.some((model) =>
      ehEnvelopeDeSku(code, model),
    );

    return remainderNaoEhModeloExplicito || envolveModeloExplicito;
  });
  const commercial = selecionarCodigosModeloMaisEspecificos(
    familiasModeloDistintas(
      explicit.filter((code) => !skuCodes.includes(code)),
      null,
    ),
  );
  const manufacturerSku =
    skuCodes
      .filter((code) => explicit.includes(code))
      .sort((first, second) => second.length - first.length)[0] ??
    null;
  const variantCodes = extras.filter(
    (code) =>
      code !== manufacturerSku &&
      !commercial.includes(code),
  );

  return {
    commercialModels: commercial,
    manufacturerSku,
    variantCodes,
  };
}

type SoldClass = "ACCESSORY" | "REPLACEMENT_PART" | "PRIMARY";

type ClassHit = {
  cls: SoldClass;
  token: string;
  index: number;
};

function findPhraseHits(
  normalizedTitle: string,
  phrases: string[],
  cls: SoldClass,
): ClassHit[] {
  return phrases.flatMap((phrase) => {
    const index = normalizedTitle.indexOf(phrase);

    if (index < 0) {
      return [];
    }

    return [
      {
        cls,
        token: phrase,
        index,
      },
    ];
  });
}

function findTokenHits(
  normalizedTitle: string,
  tokens: Set<string>,
  cls: SoldClass,
): ClassHit[] {
  const hits: ClassHit[] = [];
  let cursor = 0;

  for (const token of normalizedTitle.split(" ")) {
    if (tokens.has(token)) {
      hits.push({
        cls,
        token,
        index: cursor,
      });
    }

    cursor += token.length + 1;
  }

  return hits;
}

function primeiraClasseDoTrecho(
  normalizedTitle: string,
): ClassHit | null {
  const hits = [
    ...findPhraseHits(normalizedTitle, PRIMARY_PHRASES, "PRIMARY"),
    ...findPhraseHits(normalizedTitle, CONTAINER_PHRASES, "ACCESSORY"),
    ...findTokenHits(normalizedTitle, REPLACEMENT_HEAD_TOKENS, "REPLACEMENT_PART"),
    ...findTokenHits(normalizedTitle, ACCESSORY_HEAD_TOKENS, "ACCESSORY"),
    ...findTokenHits(normalizedTitle, PRIMARY_HEAD_TOKENS, "PRIMARY"),
  ]
    .filter((hit) => {
      if (hit.token !== "caixa") {
        return true;
      }

      const after = normalizedTitle.slice(hit.index + hit.token.length);
      return /^(?:\s+(?:de\s+)?(?:transporte|armazenamento|protetor|protetora|rigid[oa]))|\s+para\s+/.test(
        after,
      );
    })
    .sort(
      (first, second) =>
        first.index - second.index ||
        second.token.length - first.token.length,
    );

  return hits[0] ?? null;
}

function textoComHifensPreservados(value: string): string {
  return canonizarHifensModelo(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function firstRegexMatch(
  text: string,
  pattern: RegExp,
): RegExpExecArray | null {
  pattern.lastIndex = 0;
  return pattern.exec(text);
}

function detectarRelacaoDeHospedeiro(
  normalizedTitle: string,
): {
  sold: string;
  host: string | null;
  relation: string | null;
} {
  const specific = firstRegexMatch(
    normalizedTitle,
    SPECIFIC_HOST_RELATION_PATTERN,
  );

  if (specific && specific.index !== undefined) {
    return {
      sold: normalizedTitle.slice(0, specific.index).trim() || normalizedTitle,
      host:
        normalizedTitle.slice(specific.index + specific[0].length).trim() ||
        null,
      relation: specific[0].trim(),
    };
  }

  GENERIC_HOST_RELATION_PATTERN.lastIndex = 0;
  let generic: RegExpExecArray | null;

  while ((generic = GENERIC_HOST_RELATION_PATTERN.exec(normalizedTitle))) {
    if (generic.index === undefined) {
      continue;
    }

    const sold = normalizedTitle.slice(0, generic.index).trim();
    const host = normalizedTitle.slice(generic.index + generic[0].length).trim();
    const soldClass = classificarClasseProduto(sold);
    const hostClass = classificarClasseProduto(host);

    /*
     * "para"/"for" so viram relacao de hospedeiro quando o item vendido
     * nao e o mesmo tipo do trecho seguinte, ou quando o vendido ja e
     * acessorio/consumivel mesmo que o hospedeiro ainda nao tenha classe.
     * "headphone para academia" permanece MAIN.
     */
    if (
      !classeEhProdutoPrincipal(soldClass) ||
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

type RoleAnalysis = {
  kind: ProductKind;
  role: ProductRole;
  reason: string;
  soldItemType: SoldClass | null;
  hostItemType: SoldClass | null;
  compatibilityRelation: string | null;
  soldText: string;
  hostText: string | null;
};

function analisarPapelDoTitulo(
  normalizedTitle: string,
): RoleAnalysis {
  const structure = detectarRelacaoDeHospedeiro(normalizedTitle);
  const soldHit = primeiraClasseDoTrecho(structure.sold);
  const hostHit = structure.host
    ? primeiraClasseDoTrecho(structure.host)
    : null;
  const hostPrimaryHit = structure.host
    ? [
        ...findPhraseHits(structure.host, PRIMARY_PHRASES, "PRIMARY"),
        ...findTokenHits(structure.host, PRIMARY_HEAD_TOKENS, "PRIMARY"),
      ].sort((first, second) => first.index - second.index)[0] ?? null
    : null;
  const soldItemType = soldHit?.cls ?? null;
  const hostItemType =
    hostPrimaryHit?.cls ??
    (structure.host && hostHit?.cls !== "ACCESSORY" && hostHit?.cls !== "REPLACEMENT_PART"
      ? hostHit?.cls
      : null) ??
    (structure.host ? "PRIMARY" : null);

  if (soldItemType === "REPLACEMENT_PART") {
    return {
      kind: "REPLACEMENT_PART",
      role: "REPLACEMENT_PART",
      reason:
        "O nucleo do titulo e uma peca de reposicao; categorias MAIN posteriores sao hospedeiro.",
      soldItemType,
      hostItemType: hostItemType ?? (structure.host ? "PRIMARY" : null),
      compatibilityRelation: structure.relation,
      soldText: structure.sold,
      hostText: structure.host,
    };
  }

  if (soldItemType === "ACCESSORY") {
    return {
      kind: "ACCESSORY",
      role: "ACCESSORY",
      reason: structure.relation
        ? "Nucleo do item vendido e acessorio/continente; o trecho apos a relacao e o hospedeiro."
        : "O primeiro tipo estrutural do titulo e um acessorio/continente, nao o produto principal.",
      soldItemType,
      hostItemType: hostItemType ?? (structure.host ? "PRIMARY" : null),
      compatibilityRelation: structure.relation,
      soldText: structure.sold,
      hostText: structure.host,
    };
  }

  if (
    structure.relation &&
    (
      !soldItemType ||
      !classeEhProdutoPrincipal(classificarClasseProduto(structure.sold))
    ) &&
    soldItemType !== "PRIMARY"
  ) {
    const soldClass = classificarClasseProduto(structure.sold);
    const inferredSold: SoldClass =
      soldItemType ??
      (soldClass === "CONSUMABLE" ? "REPLACEMENT_PART" : "ACCESSORY");
    const inferredKind =
      inferredSold === "REPLACEMENT_PART"
        ? "REPLACEMENT_PART"
        : "ACCESSORY";

    return {
      kind: inferredKind,
      role: inferredKind,
      reason:
        "Relacao de hospedeiro: o item vendido nao e o equipamento citado depois da relacao.",
      soldItemType: inferredSold,
      hostItemType: hostItemType ?? "PRIMARY",
      compatibilityRelation: structure.relation,
      soldText: structure.sold,
      hostText: structure.host,
    };
  }

  if (
    FURNITURE_TERMS.some((term) =>
      containsPhrase(normalizedTitle, term),
    )
  ) {
    return {
      kind: "FURNITURE",
      role: "MAIN",
      reason: "Categoria estrutural de movel.",
      soldItemType: soldItemType ?? "PRIMARY",
      hostItemType: hostItemType ?? (structure.host ? "PRIMARY" : null),
      compatibilityRelation: structure.relation,
      soldText: structure.sold,
      hostText: structure.host,
    };
  }

  if (
    FOOTWEAR_TERMS.some((term) =>
      containsPhrase(normalizedTitle, term),
    )
  ) {
    return {
      kind: "FOOTWEAR",
      role: "MAIN",
      reason: "Categoria estrutural de calcado.",
      soldItemType: soldItemType ?? "PRIMARY",
      hostItemType: hostItemType ?? (structure.host ? "PRIMARY" : null),
      compatibilityRelation: structure.relation,
      soldText: structure.sold,
      hostText: structure.host,
    };
  }

  return {
    kind: "GENERIC",
    role: "MAIN",
    reason: soldItemType === "PRIMARY"
      ? "O nucleo do titulo e o produto principal; acessorios depois de 'com' nao mudam o papel."
      : "Sem sinal estrutural de acessorio ou peca no nucleo vendido.",
    soldItemType: soldItemType ?? "PRIMARY",
    hostItemType: hostItemType ?? (structure.host ? "PRIMARY" : null),
    compatibilityRelation: structure.relation,
    soldText: structure.sold,
    hostText: structure.host,
  };
}

function resolverTipoProduto(
  normalizedTitle: string,
): ProductKind {
  return analisarPapelDoTitulo(normalizedTitle).kind;
}

export function ehPapelNaoPrincipal(
  kind: ProductKind | ProductRole,
): boolean {
  return kind === "ACCESSORY" || kind === "REPLACEMENT_PART";
}

export function codigosDeIdentidadeDoItemVendido(
  identity: Pick<
    ProductIdentity,
    | "mpn"
    | "modelNumber"
    | "model"
    | "identityModelCandidates"
    | "searchCodes"
  >,
): string[] {
  return Array.from(
    new Set(
      [
        identity.mpn,
        identity.modelNumber,
        identity.model,
        ...identity.identityModelCandidates,
        ...identity.searchCodes,
      ]
        .map((code) => normalizarCodigoIdentidade(code))
        .filter((code): code is string => Boolean(code)),
    ),
  );
}

function modelosDoTrecho(
  text: string | null,
  structuredModel: string | null,
  brand: string | null,
): string[] {
  if (!text?.trim()) {
    return [];
  }

  return familiasModeloDistintas(
    extrairTokensModelo(text, structuredModel, brand),
    brand,
  );
}

function calcularConfiancaIdentidade(input: {
  kind: ProductKind;
  selectedModel: string | null;
  identityModelCandidates: string[];
  hostModelCandidates: string[];
  multiModelCompatibility: boolean;
  modelAmbiguous: boolean;
  modelsBelongToHost: boolean;
  brand: string | null;
}): number {
  if (input.multiModelCompatibility || input.modelsBelongToHost) {
    return 0.15;
  }

  if (ehPapelNaoPrincipal(input.kind)) {
    return 0.3;
  }

  if (input.modelAmbiguous) {
    return 0.35;
  }

  if (
    input.selectedModel &&
    input.identityModelCandidates.length <= 1
  ) {
    return input.brand ? 0.92 : 0.8;
  }

  if (input.selectedModel) {
    return 0.7;
  }

  return input.brand ? 0.45 : 0.3;
}

export function papelDaIdentidade(
  identity: Pick<
    ProductIdentity,
    "kind" | "role" | "normalizedTitle"
  >,
): ProductRole {
  if (!identity.normalizedTitle.trim()) {
    return "UNKNOWN";
  }

  return identity.role;
}

export function ehAcessorioNaoSolicitadoPelaConsulta(
  query: string,
  title: string,
): boolean {
  const queryIdentity = resolverIdentidadeProduto({
    title: query,
    brand: null,
    attributes: {},
  });
  const candidateIdentity = resolverIdentidadeProduto({
    title,
    brand: null,
    attributes: {},
  });

  return (
    !ehPapelNaoPrincipal(queryIdentity.kind) &&
    ehPapelNaoPrincipal(candidateIdentity.kind)
  );
}

export function ehProdutoMovel(
  title: string,
): boolean {
  return resolverTipoProduto(
    normalizarTextoIdentidade(title),
  ) === "FURNITURE";
}

export function ehProdutoCalcado(
  title: string,
): boolean {
  return resolverTipoProduto(
    normalizarTextoIdentidade(title),
  ) === "FOOTWEAR";
}

export function resolverIdentidadeProduto(
  product: Pick<
    ProductImport,
    "title" | "brand" | "attributes"
  >,
): ProductIdentity {
  const title = product.title.trim();
  const normalizedTitle = normalizarTextoIdentidade(title);
  const brandStructured =
    product.brand?.trim() ||
    obterAtributo(product.attributes, ["BRAND", "MARCA"]);
  const brand =
    normalizarMarcaIdentidade(brandStructured) ??
    inferirMarcaPeloTitulo(title);

  const modelStructured = obterAtributo(product.attributes, [
    "MODEL",
    "MODELO",
    "MODEL_NUMBER",
    "NUMERO_DO_MODELO",
    "CODIGO_DO_MODELO",
    "NOME_DO_MODELO",
    "MPN",
    "PART_NUMBER",
    "MANUFACTURER_PART_NUMBER",
  ]);
  const mpn = normalizarCodigoIdentidade(
    obterAtributo(product.attributes, [
      "MPN",
      "PART_NUMBER",
      "NUMERO_DA_PECA",
      "CODIGO_DO_FABRICANTE",
      "REFERENCIA_DO_FABRICANTE",
    ]),
  );
  const modelNumber = normalizarCodigoIdentidade(modelStructured);
  const roleAnalysis = analisarPapelDoTitulo(normalizedTitle);
  const structuredPertenceAoVendido =
    Boolean(modelStructured) &&
    (
      !roleAnalysis.hostText ||
      roleAnalysis.soldText.includes(
        normalizarTextoIdentidade(modelStructured),
      )
    );
  const modelSlices = detectarRelacaoDeHospedeiro(
    textoComHifensPreservados(title),
  );
  const soldTitleForModels = modelSlices.host ? modelSlices.sold : title;
  const hostTitleForModels = modelSlices.host;
  const soldModelTokens = extrairTokensModelo(
    soldTitleForModels,
    structuredPertenceAoVendido ? modelStructured : null,
    brand,
  );
  const commercialTokens = extrairTokensModelo(
    soldTitleForModels,
    structuredPertenceAoVendido ? modelStructured : null,
    brand,
    { concatenarMarca: false },
  );
  const classified = classificarModelosESkus(
    commercialTokens,
    soldModelTokens,
    brand,
    roleAnalysis.compatibilityRelation ? null : (mpn ?? modelNumber),
  );
  const identityModelCandidates = classified.commercialModels;
  const hostModelCandidates = modelosDoTrecho(
    hostTitleForModels,
    null,
    brand,
  ).filter((code) => !identityModelCandidates.includes(code));
  const modelsBelongToHost =
    Boolean(roleAnalysis.compatibilityRelation) &&
    hostModelCandidates.length > 0 &&
    identityModelCandidates.length === 0;
  const multiModelCompatibility = hostModelCandidates.length >= 2;
  const commercialModel =
    multiModelCompatibility || modelsBelongToHost
      ? null
      : identityModelCandidates[0] ?? null;
  const manufacturerSku =
    modelsBelongToHost || multiModelCompatibility
      ? null
      : classified.manufacturerSku &&
          classified.manufacturerSku !== commercialModel
        ? classified.manufacturerSku
        : null;
  const variantCodes = modelsBelongToHost ? [] : classified.variantCodes;
  const selectedModel = commercialModel;
  const modelAmbiguous =
    modelsBelongToHost ||
    multiModelCompatibility ||
    (
      identityModelCandidates.length > 1 &&
      !identityModelCandidates.some(
        (code) =>
          selectedModel &&
          (code === selectedModel ||
            code.startsWith(selectedModel) ||
            selectedModel.startsWith(code)),
      )
    );
  const identityConfidence = calcularConfiancaIdentidade({
    kind: roleAnalysis.kind,
    selectedModel,
    identityModelCandidates,
    hostModelCandidates,
    multiModelCompatibility,
    modelAmbiguous,
    modelsBelongToHost,
    brand,
  });
  const soldSearchCodes = Array.from(
    new Set(
      [
        commercialModel,
        manufacturerSku,
        ...identityModelCandidates,
        ...soldModelTokens,
      ].filter((value): value is string => Boolean(value)),
    ),
  );

  const ean = normalizarCodigoGlobal(
    obterAtributo(product.attributes, [
      "EAN",
      "CODIGO_EAN",
      "CODIGO_DE_BARRAS",
      "BARCODE",
    ]),
  );
  const gtin = normalizarCodigoGlobal(
    obterAtributo(product.attributes, [
      "GTIN",
      "GTIN_8",
      "GTIN_12",
      "GTIN_13",
      "GTIN_14",
      "UPC",
      "ISBN",
    ]),
  );

  const variants: ProductIdentity["variants"] = {
    voltage: extrairVoltagem(
      title,
      obterAtributo(product.attributes, [
        "VOLTAGEM",
        "TENSAO",
        "VOLTAGE",
        "TENSAO_ELETRICA",
      ]),
    ),
    storage: extrairArmazenamento(
      title,
      obterAtributo(product.attributes, [
        "INTERNAL_MEMORY",
        "MEMORIA_INTERNA",
        "STORAGE_CAPACITY",
        "CAPACIDADE_DE_ARMAZENAMENTO",
        "ARMAZENAMENTO",
      ]),
    ),
    ram: extrairRam(
      title,
      obterAtributo(product.attributes, [
        "RAM",
        "MEMORIA_RAM",
        "CAPACIDADE_DE_MEMORIA_RAM",
        "MEMORY_SIZE",
      ]),
    ),
    network: extrairRede(
      title,
      obterAtributo(product.attributes, [
        "MOBILE_NETWORK",
        "NETWORK",
        "REDE_MOVEL",
        "TECNOLOGIA_DE_REDE",
      ]),
    ),
    color:
      extrairCorCanonica(
        obterAtributo(product.attributes, [
          "COLOR",
          "COR",
          "COR_PRINCIPAL",
        ]),
      ) ?? extrairCorCanonica(title),
    size: extrairTamanho(
      title,
      obterAtributo(product.attributes, [
        "SIZE",
        "TAMANHO",
        "TAMANHO_DO_COLCHAO",
        "TAMANHO_DA_TELA",
      ]),
    ),
    capacity: extrairCapacidadeGenerica(
      title,
      obterAtributo(product.attributes, [
        "CAPACIDADE",
        "CAPACIDADE_EM_VOLUME",
        "VOLUME_DA_UNIDADE",
        "PESO_LIQUIDO",
      ]),
    ),
    kitQuantity: extrairQuantidadeKit(
      title,
      obterAtributo(product.attributes, [
        "UNIDADES_POR_EMBALAGEM",
        "QUANTIDADE_DE_PECAS",
        "QUANTIDADE_DE_UNIDADES",
        "QUANTIDADE_DE_MESAS_DE_CABECEIRA",
        "UNIDADES_POR_KIT",
      ]),
    ),
    condition: extrairCondicao(
      title,
      obterAtributo(product.attributes, [
        "CONDITION",
        "CONDICAO",
        "ESTADO",
      ]),
    ),
    bundle: extrairBundleSignature(title),
  };

  const identityMpn = modelsBelongToHost ? null : mpn;
  const identityModelNumber = modelsBelongToHost ? null : modelNumber;

  return {
    title,
    normalizedTitle,
    brand,
    ean,
    gtin,
    mpn: identityMpn,
    modelNumber: identityModelNumber,
    model: selectedModel,
    commercialModel: selectedModel,
    manufacturerSku,
    variantCodes,
    modelTokens: soldModelTokens,
    searchCodes: soldSearchCodes,
    kind: roleAnalysis.kind,
    role: roleAnalysis.role,
    roleReason: multiModelCompatibility
      ? `${roleAnalysis.reason} Lista de compatibilidade de hospedeiro com ${hostModelCandidates.length} modelos.`
      : roleAnalysis.reason,
    soldItemType: roleAnalysis.soldItemType,
    hostItemType: roleAnalysis.hostItemType,
    compatibilityRelation: roleAnalysis.compatibilityRelation,
    productClass: classificarClasseProduto(roleAnalysis.soldText),
    hostModelCandidates,
    identityModelCandidates,
    modelAmbiguous,
    identityConfidence,
    multiModelCompatibility,
    compatibleModels: hostModelCandidates.length > 0
      ? hostModelCandidates
      : identityModelCandidates,
    variants,
  };
}

export function criarCanonicalKeyDaIdentidade(
  identity: ProductIdentity,
): string | null {
  if (
    identity.multiModelCompatibility ||
    (
      identity.hostModelCandidates.length > 0 &&
      identity.identityModelCandidates.length === 0
    )
  ) {
    return null;
  }

  const globalCode = identity.gtin ?? identity.ean;

  if (globalCode) {
    return `gtin:${globalCode}`;
  }

  const baseModel =
    normalizarCodigoIdentidade(identity.commercialModel ?? identity.model);

  const code = baseModel;

  if (!identity.brand || !code) {
    return null;
  }

  const variantEntries =
    Object.entries(identity.variants) as Array<
      [IdentityVariantKey, string | null]
    >;

  const variantParts = variantEntries
    .filter(
      (entry): entry is [IdentityVariantKey, string] =>
        Boolean(entry[1]) &&
        entry[0] !== "color" &&
        entry[0] !== "condition",
    )
    .map(([key, value]) => `${key}=${value}`);

  /*
   * canonicalKey e apenas indice de busca. O Exact Matcher continua sendo
   * a autorizacao de merge, portanto brand + modelo pode ter uma chave-base
   * mesmo quando nenhuma variante dura foi declarada. Isso e importante
   * para produtos como fones, onde cor nao deve fragmentar o catalogo.
   */
  return [
    "brand-model-v6",
    normalizarCodigoIdentidade(identity.brand),
    code,
    `role=${identity.kind}`,
    ...variantParts.sort(),
  ].join(":");
}
