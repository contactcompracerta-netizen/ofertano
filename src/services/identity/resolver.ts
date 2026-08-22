import type {
  ProductImport,
} from "@/services/importers/core/types";

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
  | "kitQuantity";

export type ProductKind =
  | "ACCESSORY"
  | "FURNITURE"
  | "FOOTWEAR"
  | "GENERIC";

export type ProductIdentity = {
  title: string;
  normalizedTitle: string;
  brand: string | null;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  modelNumber: string | null;
  model: string | null;
  modelTokens: string[];
  searchCodes: string[];
  kind: ProductKind;
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

const ACCESSORY_PATTERNS = [
  /\balmofad(?:a|as)\s+(?:de\s+)?reposicao\b/,
  /\balmofad(?:a|as)\s+para\b/,
  /\bear\s*pad(?:s)?\b/,
  /\bearpad(?:s)?\b/,
  /\bsubstituicao\s+de\b/,
  /\breplacement\b/,
  /\bcapa\s+para\b/,
  /\bcase\s+para\b/,
  /\bestojo\s+para\b/,
  /\bprotetor(?:a)?\s+para\b/,
  /\bpelicula\s+para\b/,
  /\bpeca(?:s)?\s+de\s+reposicao\b/,
  /\bkit\s+de\s+reposicao\b/,
  /\badaptador\s+para\b/,
  /\bsuporte\s+para\b/,
  /\bpulseira\s+para\b/,
  /\bcorreia\s+para\b/,
];

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

export function normalizarTextoIdentidade(
  value: string | null | undefined,
): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
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

function extrairArmazenamento(
  title: string,
  structured: string | null,
): string | null {
  const fromStructured = normalizarCapacidadeDigital(structured);

  const normalizedTitle = normalizarTextoIdentidade(title);
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

  const fromTitle = pareceProdutoDigital(title)
    ? [...capacities].sort(
        (first, second) => second.megabytes - first.megabytes,
      )[0]?.value ?? null
    : null;

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
  const structuredSize = normalizarVariante(structured);

  if (structuredSize) {
    return structuredSize;
  }

  const normalizedTitle = normalizarTextoIdentidade(title);
  const hasFootwear = FOOTWEAR_TERMS.some((term) =>
    containsPhrase(normalizedTitle, term),
  );

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

  const screenContext = /\b(?:tela|monitor|tv|televisao|notebook|display)\b/.test(
    normalizedTitle,
  );
  const inches = normalizedTitle.match(
    /\b(\d{1,2}(?:[.,]\d)?)\s*(?:polegadas?|pol)\b/i,
  );

  if (screenContext && inches?.[1]) {
    return `${inches[1].replace(",", ".")}pol`;
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
   * Em celulares e outros itens digitais, "capacidade" pode vir do
   * marketplace com sentidos incompatíveis (4G, armazenamento, RAM etc.).
   * Storage e RAM ja possuem resolvedores proprios; este campo fica restrito
   * a produtos fisicos como litros, mililitros e peso.
   */
  if (pareceProdutoDigital(title)) {
    return null;
  }

  const fromStructured = normalizarVariante(structured);

  if (fromStructured) {
    return fromStructured;
  }

  const normalizedTitle = normalizarTextoIdentidade(title);
  const match = normalizedTitle.match(
    /\b(\d+(?:[.,]\d+)?)\s*(?:l|litros?|ml|kg|g)\b/i,
  );

  return match?.[0]
    ? normalizarVariante(match[0])
    : null;
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
      token.startsWith(prefix),
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
): string[] {
  const tokens = new Set<string>();
  const normalizedTitle = normalizarTextoIdentidade(title);

  adicionarModelo(tokens, structuredModel, true);

  const structuredWords = structuredModel
    ? structuredModel.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g) ?? []
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
      adicionarModelo(tokens, `${brand}${match[1]}`, true);
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
      adicionarModelo(tokens, `${brand}${word}`, true);
    }
  }

  const rawTitleTokens = title.match(
    /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g,
  ) ?? [];

  for (const rawToken of rawTitleTokens) {
    adicionarModelo(tokens, rawToken);
  }

  const words = normalizedTitle.split(" ").filter(Boolean);

  for (let index = 0; index < words.length - 1; index += 1) {
    const first = words[index] ?? "";
    const second = words[index + 1] ?? "";

    if (
      !first ||
      !second ||
      /^(?:de|com|para|por|ram|rom|ssd|hdd|tela|cor|modelo|versao|smartphone|celular|telefone|notebook|laptop|tablet|camera|tv|monitor|produto)$/.test(first) ||
      /^(?:\d+(?:gb|tb|mb|mah|w|v|hz|khz|mhz|ghz|mm|cm|mp|ml|kg|g)|\d+)$/.test(second)
    ) {
      continue;
    }

    if (/\d/.test(second)) {
      adicionarModelo(tokens, `${first}${second}`, true);
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
    adicionarModelo(tokens, galaxy[1], true);
  }

  return Array.from(tokens);
}

function resolverTipoProduto(
  normalizedTitle: string,
): ProductKind {
  if (
    ACCESSORY_PATTERNS.some((pattern) =>
      pattern.test(normalizedTitle),
    )
  ) {
    return "ACCESSORY";
  }

  if (
    FURNITURE_TERMS.some((term) =>
      containsPhrase(normalizedTitle, term),
    )
  ) {
    return "FURNITURE";
  }

  if (
    FOOTWEAR_TERMS.some((term) =>
      containsPhrase(normalizedTitle, term),
    )
  ) {
    return "FOOTWEAR";
  }

  return "GENERIC";
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
  const modelTokens = extrairTokensModelo(
    title,
    modelStructured,
    brand,
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

  const model =
    mpn ??
    modelNumber ??
    modelTokens[0] ??
    null;

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
  };

  return {
    title,
    normalizedTitle,
    brand,
    ean,
    gtin,
    mpn,
    modelNumber,
    model,
    modelTokens,
    searchCodes: Array.from(
      new Set(
        [mpn, modelNumber, model, ...modelTokens].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ),
    kind: resolverTipoProduto(normalizedTitle),
    variants,
  };
}

export function criarCanonicalKeyDaIdentidade(
  identity: ProductIdentity,
): string | null {
  const globalCode = identity.gtin ?? identity.ean;

  if (globalCode) {
    return `gtin:${globalCode}`;
  }

  const code =
    identity.mpn ??
    identity.modelNumber ??
    identity.modelTokens.find((token) => token.length >= 3) ??
    null;

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
        Boolean(entry[1]),
    )
    .map(([key, value]) => `${key}=${value}`);

  /*
   * Brand + model alone is not a safe database key: it can represent a
   * different voltage, storage or color SKU.  The matcher can still compare
   * such products, but automatic canonical grouping needs one stable variant.
   */
  if (variantParts.length === 0) {
    return null;
  }

  return [
    "brand-model-v4",
    normalizarCodigoIdentidade(identity.brand),
    code,
    ...variantParts.sort(),
  ].join(":");
}
