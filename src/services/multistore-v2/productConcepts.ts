export type ConceptCompatibility = "MATCH" | "UNKNOWN" | "CONFLICT";

export type ProductConceptId =
  | "headphone"
  | "speaker"
  | "microphone"
  | "smartphone"
  | "notebook"
  | "tablet"
  | "tv"
  | "monitor"
  | "camera"
  | "drill"
  | "vacuum"
  | "vacuum_part"
  | "scale"
  | "lighting"
  | "mirror"
  | "toy"
  | "book"
  | "apparel"
  | "cookware"
  | "pressure_cooker"
  | "rice_cooker"
  | "cutlery"
  | "remote"
  | "usb_drive"
  | "flashlight"
  | "mouse"
  | "keyboard"
  | "watch"
  | "console"
  | "blender"
  | "nightstand"
  | "suit"
  | "costume"
  | "dancewear"
  | "sleep_mask"
  | "respiratory_protection"
  | "swimwear"
  | "jewelry"
  | "laser_level"
  | "laser_measure"
  | "jump_rope"
  | "photography_backdrop"
  | "trousers"
  | "sportswear"
  | "furniture"
  | "furniture_part"
  | "lapis"
  | "water_filter"
  | "clay_water_filter"
  | "screen_protector"
  | "automotive_pulley_crankshaft"
  | "automotive_pulley_alternator"
  | "automotive_crankshaft"
  | "automotive_belt"
  | "automotive_pulley"
  | "automotive_part"
  | "case_accessory"
  | "consumable"
  | "shave"
  | "UNKNOWN";

type ConceptFamily = {
  id: Exclude<ProductConceptId, "UNKNOWN">;
  phrases: string[];
  tokens: string[];
  coreMode: "phrase" | "token";
  synonyms?: string[][];
  allOf?: string[][];
};

/*
 * Familias reutilizaveis de classe comercial.
 * Frases longas vencem tokens soltos. O nucleo composto na cabeca
 * (X de Y) vence a familia generica da cabeca quando Y registra outro
 * conceito. Sinonimos vivem nesta camada, nao nos adapters.
 */
const CONCEPT_FAMILIES: ConceptFamily[] = [
  {
    id: "headphone",
    phrases: [
      "fone de ouvido",
      "fones de ouvido",
      "fone sem fio",
      "fones sem fio",
      "in ear",
      "on ear",
      "over ear",
    ],
    tokens: [
      "fone",
      "fones",
      "headphone",
      "headphones",
      "headset",
      "earbuds",
      "earbud",
      "earphone",
      "earphones",
      "auricular",
      "auriculares",
    ],
    coreMode: "token",
    synonyms: [
      ["fone", "fones", "headphone", "headphones", "headset", "earbuds", "earphone"],
      ["ouvido", "ouvidos"],
    ],
  },
  {
    id: "speaker",
    phrases: [
      "caixa de som",
      "caixa de audio",
      "caixas de som",
      "alto falante",
      "alto falantes",
    ],
    tokens: ["speaker", "speakers", "altofalante", "soundbox", "soundbar"],
    coreMode: "token",
  },
  {
    id: "microphone",
    phrases: ["microfone condensador"],
    tokens: ["microfone", "microphone"],
    coreMode: "token",
  },
  {
    id: "smartphone",
    phrases: [],
    tokens: ["smartphone", "celular", "telefone", "iphone"],
    coreMode: "token",
  },
  {
    id: "notebook",
    phrases: [],
    tokens: ["notebook", "laptop", "ultrabook"],
    coreMode: "token",
  },
  {
    id: "tablet",
    phrases: [],
    tokens: ["tablet", "ipad"],
    coreMode: "token",
  },
  {
    id: "tv",
    phrases: ["smart tv"],
    tokens: ["tv", "televisao", "televisor"],
    coreMode: "token",
  },
  {
    id: "monitor",
    phrases: [],
    tokens: ["monitor"],
    coreMode: "token",
  },
  {
    id: "camera",
    phrases: ["camera digital", "camera fotografica"],
    tokens: ["camera", "webcam"],
    coreMode: "token",
  },
  {
    id: "drill",
    phrases: [],
    tokens: ["furadeira", "parafusadeira"],
    coreMode: "token",
  },
  {
    id: "vacuum_part",
    phrases: [
      "motor para aspirador",
      "motor de aspirador",
      "motor aspirador",
      "escova principal",
      "escova de aspirador",
      "escova para aspirador",
    ],
    tokens: [],
    coreMode: "phrase",
  },
  {
    id: "vacuum",
    phrases: ["aspirador de po"],
    tokens: ["aspirador"],
    coreMode: "token",
  },
  {
    id: "scale",
    phrases: ["balanca digital", "balanca corporal"],
    tokens: ["balanca", "scale"],
    coreMode: "token",
  },
  {
    id: "lighting",
    phrases: [],
    tokens: ["lustre", "luminaria", "abajur", "pendente"],
    coreMode: "token",
  },
  {
    id: "mirror",
    phrases: [],
    tokens: ["espelho"],
    coreMode: "token",
  },
  {
    id: "toy",
    phrases: ["brinquedo infantil", "jogo infantil", "roupa de boneca"],
    tokens: ["brinquedo", "brinquedos", "boneco", "boneca", "funko"],
    coreMode: "token",
  },
  {
    id: "book",
    phrases: [],
    tokens: ["livro", "livros", "ebook"],
    coreMode: "token",
  },
  {
    id: "suit",
    phrases: [
      "terno completo",
      "terno masculino",
      "terno social",
      "conjunto social",
      "paleto e calca",
      "paleto calca",
    ],
    tokens: ["terno", "ternos", "suit", "suits"],
    coreMode: "token",
    synonyms: [
      ["terno", "ternos", "suit", "suits"],
      ["conjunto social", "paleto e calca", "paleto calca"],
    ],
  },
  {
    id: "costume",
    phrases: [
      "traje de personagem",
      "fantasia de halloween",
      "vestido de danca",
      "uniforme de coro",
    ],
    tokens: ["cosplay", "fantasia", "halloween", "cheerleading"],
    coreMode: "token",
  },
  {
    id: "dancewear",
    phrases: [
      "terno de bale",
      "terno de ballet",
      "terno ballet",
      "terno de danca",
      "traje de danca",
      "roupa de danca",
      "figurino de danca",
      "collant de danca",
      "sapatilha de bale",
      "sapatilha de ballet",
      "sapatilha de danca",
      "macacao de bale",
      "macacao de ballet",
      "macacao ballet",
      "macacao de danca",
    ],
    tokens: ["collant", "leotard"],
    coreMode: "phrase",
  },
  {
    id: "respiratory_protection",
    phrases: [
      "mascara respiratoria",
      "mascara de protecao respiratoria",
      "mascara pff2",
      "mascara n95",
      "respirador pff2",
      "respirador n95",
    ],
    tokens: ["respirador"],
    coreMode: "phrase",
  },
  {
    id: "sleep_mask",
    phrases: [
      "mascara de dormir",
      "mascara para dormir",
      "sleep mask",
      "tapa olho",
      "tapa olhos",
    ],
    tokens: [],
    coreMode: "phrase",
  },
  {
    id: "photography_backdrop",
    phrases: ["cenario fotografico", "fundo fotografico"],
    tokens: [],
    coreMode: "phrase",
  },
  {
    id: "trousers",
    phrases: ["calca de terno", "calcas de terno"],
    tokens: [],
    coreMode: "phrase",
  },
  {
    id: "sportswear",
    phrases: ["secagem rapida"],
    tokens: ["ciclismo", "compressao"],
    coreMode: "token",
  },
  {
    id: "jump_rope",
    phrases: ["pular corda", "corda de pular", "jump rope"],
    tokens: [],
    coreMode: "phrase",
  },
  {
    id: "laser_level",
    phrases: [
      "nivel laser",
      "nivel a laser",
      "nivel de laser",
      "laser de linha",
      "line laser",
      "laser autonivelador",
    ],
    tokens: [],
    coreMode: "phrase",
    allOf: [["nivel", "laser"]],
  },
  {
    id: "laser_measure",
    phrases: [
      "trena laser",
      "trena a laser",
      "trena de laser",
      "medidor a laser",
      "medidor laser",
    ],
    tokens: [],
    coreMode: "phrase",
    allOf: [["trena", "laser"]],
  },
  {
    id: "swimwear",
    phrases: [
      "terno de biquini",
      "terno de banho",
      "roupa de banho",
    ],
    tokens: [
      "biquini",
      "bikini",
      "bandeau",
      "maio",
      "sunga",
      "croche",
    ],
    coreMode: "token",
  },
  {
    id: "jewelry",
    phrases: [],
    tokens: [
      "broche",
      "colar",
      "brinco",
      "brincos",
      "anel",
      "joia",
      "joias",
      "pingente",
    ],
    coreMode: "token",
  },
  {
    id: "apparel",
    phrases: ["kit calcinha"],
    tokens: [
      "calcinha",
      "sutia",
      "lingerie",
      "camiseta",
      "camisa",
      "calca",
      "vestido",
      "blusa",
      "cueca",
      "meia",
      "meias",
      "tenis",
      "sapato",
      "sapatos",
      "calcado",
      "calcados",
    ],
    coreMode: "token",
  },
  {
    id: "pressure_cooker",
    phrases: ["panela de pressao", "pressure cooker"],
    tokens: [],
    coreMode: "phrase",
    allOf: [["panela", "pressao"]],
  },
  {
    id: "rice_cooker",
    phrases: [
      "panela de arroz",
      "panela eletrica de arroz",
      "rice cooker",
      "electric rice cooker",
    ],
    tokens: [],
    coreMode: "phrase",
    allOf: [["panela", "arroz"]],
  },
  {
    id: "cookware",
    phrases: [],
    tokens: ["panela", "frigideira", "cacarola"],
    coreMode: "token",
  },
  {
    id: "cutlery",
    phrases: ["colher medidora", "colher de medida"],
    tokens: ["colher", "garfo"],
    coreMode: "phrase",
  },
  {
    id: "remote",
    phrases: ["controle remoto"],
    tokens: ["controle"],
    coreMode: "token",
  },
  {
    id: "usb_drive",
    phrases: ["pen drive", "pendrive", "flash drive"],
    tokens: ["pendrive", "flashdrive"],
    coreMode: "token",
  },
  {
    id: "flashlight",
    phrases: [],
    tokens: ["lanterna"],
    coreMode: "token",
  },
  {
    id: "mouse",
    phrases: [],
    tokens: ["mouse"],
    coreMode: "token",
  },
  {
    id: "keyboard",
    phrases: [],
    tokens: ["teclado", "keyboard"],
    coreMode: "token",
  },
  {
    id: "watch",
    phrases: [],
    tokens: ["relogio", "smartwatch"],
    coreMode: "token",
  },
  {
    id: "console",
    phrases: [],
    tokens: ["console", "videogame"],
    coreMode: "token",
  },
  {
    id: "blender",
    phrases: [],
    tokens: ["liquidificador"],
    coreMode: "token",
  },
  {
    id: "nightstand",
    phrases: [
      "mesa de cabeceira",
      "mesas de cabeceira",
      "criado mudo",
      "criado-mudo",
      "criados mudos",
    ],
    tokens: ["criado"],
    coreMode: "phrase",
    synonyms: [
      ["mesa de cabeceira", "criado mudo", "criado-mudo", "criado"],
    ],
  },
  {
    id: "furniture_part",
    phrases: [
      "pe palito",
      "pe para movel",
      "pe de movel",
      "puxador para movel",
    ],
    tokens: ["puxador", "puxadores", "ferragem", "dobradica", "dobradicas"],
    coreMode: "token",
  },
  {
    id: "furniture",
    phrases: ["guarda roupa", "mesa de jantar", "mesa de centro"],
    tokens: ["mesa", "comoda", "armario", "estante", "rack", "sofa", "cama"],
    coreMode: "token",
  },
  {
    id: "lapis",
    phrases: [],
    tokens: ["lapis", "caneta", "grafite"],
    coreMode: "token",
  },
  {
    id: "clay_water_filter",
    phrases: ["filtro de barro"],
    tokens: [],
    coreMode: "phrase",
    allOf: [["filtro", "barro"]],
  },
  {
    id: "water_filter",
    phrases: ["filtro de agua", "filtro de torneira"],
    tokens: [],
    coreMode: "phrase",
  },
  {
    id: "screen_protector",
    phrases: [
      "vidro temperado",
      "protetor de tela",
      "pelicula protetora",
      "pelicula de vidro",
      "screen protector",
      "tempered glass",
    ],
    tokens: [],
    coreMode: "phrase",
    allOf: [["vidro", "temperado"]],
  },
  {
    id: "automotive_pulley_crankshaft",
    phrases: [
      "polia virabrequim",
      "polia de virabrequim",
      "polia do virabrequim",
      "polia virabrequim",
    ],
    tokens: [],
    coreMode: "phrase",
  },
  {
    id: "automotive_pulley_alternator",
    phrases: [
      "polia alternador",
      "polia do alternador",
      "polia de alternador",
    ],
    tokens: [],
    coreMode: "phrase",
  },
  {
    id: "automotive_crankshaft",
    phrases: ["virabrequim completo"],
    tokens: ["virabrequim"],
    coreMode: "token",
  },
  {
    id: "automotive_belt",
    phrases: ["correia dentada", "correia de comando", "correia sincronizadora"],
    tokens: ["correia"],
    coreMode: "token",
  },
  {
    id: "automotive_pulley",
    phrases: [],
    tokens: ["polia"],
    coreMode: "token",
  },
  {
    id: "automotive_part",
    phrases: [],
    tokens: [
      "amortecedor",
      "pastilha",
      "bico",
      "injetor",
      "sensor",
      "coxim",
      "tensor",
      "biela",
    ],
    coreMode: "token",
  },
  {
    id: "case_accessory",
    phrases: [
      "estojo de armazenamento",
      "bolsa de transporte",
      "capa de notebook",
      "capa para notebook",
      "capa de laptop",
      "capa de celular",
      "capa para celular",
      "capa de tablet",
      "suporte de celular",
      "suporte para celular",
      "suporte de notebook",
    ],
    tokens: ["estojo", "estojos"],
    coreMode: "token",
  },
  {
    id: "consumable",
    phrases: ["saco de poeira", "sacos de poeira"],
    tokens: ["saco", "sacos", "refil", "refis"],
    coreMode: "token",
  },
  {
    id: "shave",
    phrases: [],
    tokens: ["barbeador", "aparador"],
    coreMode: "token",
  },
];

const VEHICLE_BRANDS = new Set([
  "fiat",
  "chevrolet",
  "gm",
  "volkswagen",
  "vw",
  "ford",
  "toyota",
  "honda",
  "hyundai",
  "renault",
  "nissan",
  "jeep",
  "peugeot",
  "citroen",
  "mitsubishi",
  "bmw",
  "mercedes",
  "audi",
  "kia",
  "volvo",
  "chery",
  "jac",
  "ram",
  "iveco",
  "yamaha",
  "suzuki",
  "subaru",
  "landrover",
  "porsche",
  "ferrari",
  "ducati",
]);

const AUTOMOTIVE_CONCEPTS = new Set<ProductConceptId>([
  "automotive_pulley_crankshaft",
  "automotive_pulley_alternator",
  "automotive_crankshaft",
  "automotive_belt",
  "automotive_pulley",
  "automotive_part",
]);

const CONCEPT_PARENTS: Partial<Record<ProductConceptId, ProductConceptId>> = {
  nightstand: "furniture",
  suit: "apparel",
  costume: "apparel",
  dancewear: "apparel",
  swimwear: "apparel",
  trousers: "apparel",
  sportswear: "apparel",
  clay_water_filter: "water_filter",
  pressure_cooker: "cookware",
  rice_cooker: "cookware",
  automotive_pulley_crankshaft: "automotive_pulley",
  automotive_pulley_alternator: "automotive_pulley",
  automotive_pulley: "automotive_part",
  automotive_crankshaft: "automotive_part",
  automotive_belt: "automotive_part",
};

const FUNCTION_WORDS = new Set([
  "a",
  "as",
  "o",
  "os",
  "um",
  "uma",
  "uns",
  "umas",
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
  "ao",
  "aos",
  "pela",
  "pelo",
  "pelas",
  "pelos",
  "para",
  "por",
  "com",
  "sem",
  "sobre",
  "entre",
  "ate",
  "apos",
  "ante",
  "apos",
  "perante",
  "contra",
  "desde",
  "durante",
  "mediante",
  "segundo",
  "conforme",
  "que",
  "se",
  "nem",
  "ou",
  "mas",
  "porem",
  "contudo",
  "todavia",
  "logo",
  "pois",
  "porque",
  "como",
  "quando",
  "onde",
  "the",
  "and",
  "for",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "from",
  "with",
  "without",
]);

const COMMERCIAL_FLUFF = new Set([
  "novo",
  "nova",
  "novos",
  "novas",
  "original",
  "oficial",
  "oferta",
  "promocao",
  "kit",
  "modelo",
  "mais",
  "produto",
  "produtos",
  "unidade",
  "unidades",
  "peca",
  "pecas",
  "item",
  "items",
  "super",
  "mega",
  "barato",
  "barata",
  "premium",
  "frete",
]);

export function normalizeConceptText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenBoundaryMatch(text: string, token: string): boolean {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return false;
  }

  return new RegExp(`(?:^|\\s)${escapeRegex(normalizedToken)}(?:\\s|$)`).test(
    ` ${text} `,
  );
}

function contentTokens(text: string): string[] {
  return normalizeConceptText(text)
    .split(" ")
    .filter((token) => token.length > 0 && !FUNCTION_WORDS.has(token));
}

function phraseAppears(normalized: string, phrase: string): boolean {
  const normalizedPhrase = normalizeConceptText(phrase);
  if (!normalizedPhrase) {
    return false;
  }

  if (tokenBoundaryMatch(normalized, normalizedPhrase)) {
    return true;
  }

  const phraseTokens = contentTokens(normalizedPhrase);
  if (phraseTokens.length === 0) {
    return false;
  }

  const textTokens = contentTokens(normalized);
  if (phraseTokens.length > textTokens.length) {
    return false;
  }

  for (let index = 0; index <= textTokens.length - phraseTokens.length; index += 1) {
    if (phraseTokens.every((token, offset) => textTokens[index + offset] === token)) {
      return true;
    }
  }

  return false;
}

export function lexicalTokenAppears(text: string, token: string): boolean {
  const normalizedText = normalizeConceptText(text);
  const normalizedToken = normalizeConceptText(token);
  if (!normalizedText || !normalizedToken) {
    return false;
  }

  return phraseAppears(normalizedText, normalizedToken);
}

export function conceptLexicalTokens(id: ProductConceptId): string[] {
  if (id === "UNKNOWN") {
    return [];
  }

  const family = familyById(id);
  if (!family) {
    return [];
  }

  return Array.from(
    new Set(
      [
        ...family.phrases,
        ...(family.synonyms ?? []).flat(),
        ...family.tokens,
        ...(family.allOf ?? []).flat(),
      ].flatMap((item) => contentTokens(item)),
    ),
  );
}

export function conceptIsA(
  child: ProductConceptId,
  ancestor: ProductConceptId,
): boolean {
  if (child === "UNKNOWN" || ancestor === "UNKNOWN") {
    return false;
  }

  let current: ProductConceptId | undefined = child;
  const seen = new Set<ProductConceptId>();
  while (current && !seen.has(current)) {
    if (current === ancestor) {
      return true;
    }

    seen.add(current);
    current = CONCEPT_PARENTS[current];
  }

  return false;
}

export function isWeakModifier(token: string): boolean {
  if (!token) {
    return true;
  }

  if (FUNCTION_WORDS.has(token) || COMMERCIAL_FLUFF.has(token)) {
    return true;
  }

  return token.length <= 2 && !/\d/.test(token);
}

const GENERIC_DESCRIPTORS = new Set([
  "gamer",
  "gaming",
  "slim",
  "fit",
  "profissional",
  "digital",
  "completo",
  "masculino",
  "masculina",
  "feminino",
  "feminina",
  "recarregavel",
  "automatico",
  "autonivelante",
  "impermeavel",
  "tatico",
  "universal",
  "mini",
  "indoor",
  "outdoor",
  "intel",
  "core",
  "amd",
  "ryzen",
  "nvidia",
  "geforce",
  "windows",
  "linux",
  "ssd",
  "hdd",
  "ddr",
  "wifi",
  "bluetooth",
  "wireless",
  "geracao",
  "tela",
  "full",
  "led",
  "ips",
  "home",
  "movel",
  "moveis",
  "quarto",
  "casa",
  "loja",
  "conjunto",
  "modelo",
  "compacto",
  "compacta",
  "corredicas",
  "corredica",
]);

export function isGenericDescriptor(token: string): boolean {
  return GENERIC_DESCRIPTORS.has(token) || isWeakModifier(token);
}

const LEADING_SURFACE = new Set([
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
  "primavera",
  "verao",
  "inverno",
  "outono",
  "spring",
  "summer",
  "winter",
  "autumn",
  "fall",
  "adulto",
  "adulta",
  "adultos",
  "adultas",
  "infantil",
  "crianca",
  "criancas",
  "menino",
  "menina",
  "meninos",
  "meninas",
  "kids",
  "bebe",
  "baby",
  "pcs",
  "pc",
  "pares",
  "par",
]);

const LEADING_BRANDS = new Set([
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
  "novatech",
  "marcax",
]);

export type SoldItemNucleus = {
  normalizedText: string;
  headToken: string | null;
  startTokenIndex: number;
};

function isSoldHeadPrefixToken(token: string): boolean {
  if (!token) {
    return true;
  }

  if (FUNCTION_WORDS.has(token) || COMMERCIAL_FLUFF.has(token)) {
    return true;
  }

  if (GENERIC_DESCRIPTORS.has(token) || LEADING_SURFACE.has(token)) {
    return true;
  }

  if (LEADING_BRANDS.has(token) || VEHICLE_BRANDS.has(token)) {
    return true;
  }

  if (/^\d/.test(token)) {
    return true;
  }

  return token.length <= 2 && !/\d/.test(token);
}

function familyHitAtContentStart(normalized: string): boolean {
  return CONCEPT_FAMILIES.some(
    (family) => firstHitTokenIndex(family, normalized) === 0,
  );
}

/*
 * Primeira cabeça semântica do item vendido: ignora modificadores
 * iniciais (grau, gênero, estação, cor, kit, marca, quantidade) e
 * aceita a classe mesmo quando ela não é o token 0 do título.
 * Não atravessa um substantivo desconhecido para alcançar uma classe
 * mencionada depois — isso seria host/contexto, não o sold item.
 */
export function extractSoldItemNucleus(text: string): SoldItemNucleus {
  const tokens = normalizeConceptText(text)
    .split(" ")
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return { normalizedText: "", headToken: null, startTokenIndex: 0 };
  }

  let start = 0;
  let found = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (FUNCTION_WORDS.has(token)) {
      continue;
    }

    const fromHere = tokens.slice(index).join(" ");
    if (familyHitAtContentStart(fromHere) || !isSoldHeadPrefixToken(token)) {
      start = index;
      found = true;
      break;
    }
  }

  if (!found) {
    const firstContent = tokens.findIndex((token) => !FUNCTION_WORDS.has(token));
    start = firstContent >= 0 ? firstContent : 0;
  }

  const sliced = tokens.slice(start);
  return {
    normalizedText: sliced.join(" "),
    headToken: sliced.find((token) => !FUNCTION_WORDS.has(token)) ?? null,
    startTokenIndex: start,
  };
}

export function isVehicleBrandToken(token: string): boolean {
  return VEHICLE_BRANDS.has(token);
}

export function isAutomotiveConcept(id: ProductConceptId): boolean {
  return AUTOMOTIVE_CONCEPTS.has(id);
}

function familyScore(
  family: ConceptFamily,
  normalized: string,
  headWidths?: Map<string, number>,
): {
  score: number;
  index: number;
} {
  let score = 0;
  let index = Number.POSITIVE_INFINITY;

  for (const phrase of family.phrases) {
    if (!phraseAppears(normalized, phrase)) {
      continue;
    }

    const position = normalized.indexOf(normalizeConceptText(phrase));
    score += Math.max(2, phrase.split(" ").length * 4);
    index = Math.min(index, position >= 0 ? position : 0);
  }

  for (const token of family.tokens) {
    if (tokenBoundaryMatch(normalized, token)) {
      score += 1;
      index = Math.min(index, normalized.indexOf(token));
    }
  }

  for (const group of family.allOf ?? []) {
    if (!allOfGroupHits(normalized, group)) {
      continue;
    }

    const first = group
      .map((token) => normalized.indexOf(token))
      .filter((position) => position >= 0);
    score += Math.max(2, group.length * 4);
    index = Math.min(index, first.length > 0 ? Math.min(...first) : 0);
  }

  if (firstHitTokenIndex(family, normalized) !== 0) {
    return { score: 0, index: Number.POSITIVE_INFINITY };
  }

  if (hasMoreSpecificChildHit(family, normalized)) {
    score = 0;
  }

  if (hasLongerHeadPhraseHit(family, normalized, headWidths)) {
    score = 0;
  }

  if (
    family.id === "automotive_crankshaft" &&
    /\bpolia\b/.test(normalized) &&
    /\bvirabrequim\b/.test(normalized)
  ) {
    score = 0;
  }

  if (
    family.id === "automotive_pulley" &&
    (/\bvirabrequim\b/.test(normalized) || /\balternador\b/.test(normalized))
  ) {
    score = 0;
  }

  if (
    family.id === "vacuum" &&
    (/\bmotor\b/.test(normalized) || /\bescova\b/.test(normalized)) &&
    /\baspirador\b/.test(normalized)
  ) {
    score = Math.max(0, score - 2);
  }

  if (family.id === "furniture" && /\bcabeceira\b|\bcriado mudo\b/.test(normalized)) {
    score = 0;
  }

  if (family.id === "apparel" && /\bterno\b|\bsuits?\b/.test(normalized)) {
    const suit = familyById("suit");
    const swimwear = familyById("swimwear");
    const jewelry = familyById("jewelry");
    const costume = familyById("costume");
    if (
      suit &&
      firstHitTokenIndex(suit, normalized) === 0 &&
      (!swimwear || !familyHasHit(swimwear, normalized)) &&
      (!jewelry || !familyHasHit(jewelry, normalized)) &&
      (!costume || !familyHasHit(costume, normalized))
    ) {
      score = 0;
    }
  }

  if (family.id === "suit") {
    const swimwear = familyById("swimwear");
    const jewelry = familyById("jewelry");
    const costume = familyById("costume");
    const jumpRope = familyById("jump_rope");
    const sportswear = familyById("sportswear");
    const trousers = familyById("trousers");
    const backdrop = familyById("photography_backdrop");
    if (swimwear && familyHasHit(swimwear, normalized)) {
      score = 0;
    } else if (costume && familyHasHit(costume, normalized)) {
      score = 0;
    } else if (jumpRope && familyHasHit(jumpRope, normalized)) {
      score = 0;
    } else if (sportswear && familyHasHit(sportswear, normalized)) {
      score = 0;
    } else if (trousers && familyHasHit(trousers, normalized)) {
      score = 0;
    } else if (backdrop && familyHasHit(backdrop, normalized)) {
      score = 0;
    } else if (jewelry && familyHasHit(jewelry, normalized)) {
      const jewelryIndex = firstHitTokenIndex(jewelry, normalized);
      const suitIndex = firstHitTokenIndex(family, normalized);
      if (jewelryIndex < suitIndex) {
        score = 0;
      }
    }
  }

  if (family.id === "nightstand") {
    const part = familyById("furniture_part");
    if (part && familyHasHit(part, normalized)) {
      const partIndex = firstHitTokenIndex(part, normalized);
      const standIndex = firstHitTokenIndex(family, normalized);
      if (partIndex < standIndex) {
        score = 0;
      }
    }
  }

  return { score, index };
}

export function classifyProductConcept(text: string): {
  id: ProductConceptId;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  matchedPhrase: string | null;
} {
  const normalized = extractSoldItemNucleus(text).normalizedText;
  if (!normalized) {
    return { id: "UNKNOWN", confidence: "NONE", matchedPhrase: null };
  }

  let best: {
    family: ConceptFamily;
    score: number;
    index: number;
  } | null = null;

  const headWidths = new Map<string, number>();
  for (const family of CONCEPT_FAMILIES) {
    headWidths.set(family.id, headEvidenceWidth(family, normalized));
  }

  for (const family of CONCEPT_FAMILIES) {
    const ranked = familyScore(family, normalized, headWidths);
    if (ranked.score === 0) {
      continue;
    }

    if (
      !best ||
      ranked.score > best.score ||
      (ranked.score === best.score && ranked.index < best.index)
    ) {
      best = { family, score: ranked.score, index: ranked.index };
    }
  }

  if (!best) {
    return { id: "UNKNOWN", confidence: "NONE", matchedPhrase: null };
  }

  const phrase =
    best.family.phrases.find((item) => phraseAppears(normalized, item)) ??
    (best.family.allOf ?? [])
      .find((group) => allOfGroupHits(normalized, group))
      ?.join(" ") ??
    null;
  const confidence =
    phrase || best.score >= 4
      ? "HIGH"
      : best.score >= 2
        ? "MEDIUM"
        : "LOW";

  return {
    id: best.family.id,
    confidence,
    matchedPhrase: phrase,
  };
}

function familyById(id: ProductConceptId): ConceptFamily | undefined {
  return CONCEPT_FAMILIES.find((family) => family.id === id);
}

function allOfGroupHits(normalized: string, group: string[]): boolean {
  return group.every((token) => tokenBoundaryMatch(normalized, token));
}

function familyHasHit(family: ConceptFamily, normalized: string): boolean {
  return (
    family.phrases.some((phrase) => phraseAppears(normalized, phrase)) ||
    family.tokens.some((token) => tokenBoundaryMatch(normalized, token)) ||
    (family.allOf ?? []).some((group) => allOfGroupHits(normalized, group))
  );
}

function hasMoreSpecificChildHit(family: ConceptFamily, normalized: string): boolean {
  return CONCEPT_FAMILIES.some(
    (candidate) =>
      CONCEPT_PARENTS[candidate.id] === family.id &&
      familyHasHit(candidate, normalized) &&
      firstHitTokenIndex(candidate, normalized) === 0,
  );
}

function headEvidenceWidth(family: ConceptFamily, normalized: string): number {
  const textTokens = contentTokens(normalized);
  if (textTokens.length === 0) {
    return 0;
  }

  let width = 0;
  for (const phrase of family.phrases) {
    const phraseTokens = contentTokens(phrase);
    if (
      phraseTokens.length === 0 ||
      phraseTokens.length > textTokens.length ||
      !phraseTokens.every((token, offset) => textTokens[offset] === token)
    ) {
      continue;
    }

    width = Math.max(width, phraseTokens.length);
  }

  for (const token of family.tokens) {
    if (textTokens[0] === normalizeConceptText(token)) {
      width = Math.max(width, 1);
    }
  }

  return width;
}

function hasLongerHeadPhraseHit(
  family: ConceptFamily,
  normalized: string,
  headWidths?: Map<string, number>,
): boolean {
  const width = headWidths?.get(family.id) ?? headEvidenceWidth(family, normalized);
  if (width === 0) {
    return false;
  }

  if (headWidths) {
    for (const [id, otherWidth] of headWidths) {
      if (id !== family.id && otherWidth > width) {
        return true;
      }
    }

    return false;
  }

  return CONCEPT_FAMILIES.some(
    (candidate) =>
      candidate.id !== family.id && headEvidenceWidth(candidate, normalized) > width,
  );
}

export function conceptFirstContentIndex(
  text: string,
  id: ProductConceptId,
): number {
  const family = familyById(id);
  if (!family || id === "UNKNOWN") {
    return Number.POSITIVE_INFINITY;
  }

  return firstHitTokenIndex(family, normalizeConceptText(text));
}

function firstHitTokenIndex(family: ConceptFamily, normalized: string): number {
  const textTokens = contentTokens(normalized);
  let best = Number.POSITIVE_INFINITY;

  for (const phrase of family.phrases) {
    const phraseTokens = contentTokens(phrase);
    if (phraseTokens.length === 0 || phraseTokens.length > textTokens.length) {
      continue;
    }

    for (let index = 0; index <= textTokens.length - phraseTokens.length; index += 1) {
      if (phraseTokens.every((token, offset) => textTokens[index + offset] === token)) {
        best = Math.min(best, index);
        break;
      }
    }
  }

  for (const token of family.tokens) {
    const normalizedToken = normalizeConceptText(token);
    const index = textTokens.indexOf(normalizedToken);
    if (index >= 0) {
      best = Math.min(best, index);
    }
  }

  for (const group of family.allOf ?? []) {
    const indexes = group
      .map((token) => textTokens.indexOf(normalizeConceptText(token)))
      .filter((index) => index >= 0);
    if (indexes.length === group.length) {
      best = Math.min(best, Math.min(...indexes));
    }
  }

  return best;
}

export function conceptSynonymPhrases(id: ProductConceptId): string[] {
  const family = familyById(id);
  if (!family) {
    return [];
  }

    return Array.from(
    new Set([
      ...family.phrases,
      ...(family.synonyms ?? []).flat(),
      ...family.tokens,
      ...(family.allOf ?? []).map((group) => group.join(" ")),
    ]),
  );
}

export function candidateCoversConcept(
  conceptId: ProductConceptId,
  candidateText: string,
): boolean {
  if (conceptId === "UNKNOWN") {
    return true;
  }

  const classified = classifyProductConcept(candidateText);
  if (classified.id === conceptId || conceptIsA(classified.id, conceptId)) {
    return true;
  }

  /*
   * Cobertura segue a classe do sold nucleus. Menção posterior, ou
   * token da classe zerado por uma família rival no mesmo texto,
   * nao recria a evidência da query.
   */
  return false;
}

export function compareProductConcepts(
  queryClass: ProductConceptId,
  candidateClass: ProductConceptId,
): ConceptCompatibility {
  if (queryClass === "UNKNOWN" && candidateClass === "UNKNOWN") {
    return "UNKNOWN";
  }

  if (queryClass === "UNKNOWN" || candidateClass === "UNKNOWN") {
    return "UNKNOWN";
  }

  if (queryClass === candidateClass || conceptIsA(candidateClass, queryClass)) {
    return "MATCH";
  }

  if (conceptIsA(queryClass, candidateClass)) {
    return "UNKNOWN";
  }

  return "CONFLICT";
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

  return true;
}

export function canonicalClassToken(id: ProductConceptId): string {
  if (id === "UNKNOWN") {
    return "";
  }

  if (id === "headphone") {
    return "fone";
  }

  if (id === "nightstand") {
    return "mesa de cabeceira";
  }

  if (id === "suit") {
    return "terno";
  }

  if (id === "costume") {
    return "fantasia";
  }

  if (id === "dancewear") {
    return "roupa de danca";
  }

  if (id === "respiratory_protection") {
    return "mascara respiratoria";
  }

  if (id === "sleep_mask") {
    return "mascara de dormir";
  }

  if (id === "laser_level") {
    return "nivel laser";
  }

  if (id === "laser_measure") {
    return "trena laser";
  }

  if (id === "jump_rope") {
    return "pular corda";
  }

  if (id === "photography_backdrop") {
    return "cenario fotografico";
  }

  if (id === "trousers") {
    return "calca de terno";
  }

  if (id === "sportswear") {
    return "roupa esportiva";
  }

  if (id === "clay_water_filter") {
    return "filtro de barro";
  }

  if (id === "water_filter") {
    return "filtro de agua";
  }

  if (id === "pressure_cooker") {
    return "panela de pressao";
  }

  if (id === "rice_cooker") {
    return "panela de arroz";
  }

  if (id === "screen_protector") {
    return "vidro temperado";
  }

  if (id === "automotive_pulley_crankshaft") {
    return "polia virabrequim";
  }

  if (id === "automotive_pulley_alternator") {
    return "polia alternador";
  }

  if (id === "automotive_crankshaft") {
    return "virabrequim";
  }

  return id.replace(/_/g, " ");
}

export function detectVehicleHostSplit(normalizedTitle: string): {
  sold: string;
  host: string | null;
} | null {
  const tokens = normalizedTitle.split(" ").filter(Boolean);
  const concept = classifyProductConcept(normalizedTitle);
  if (!isAutomotiveConcept(concept.id)) {
    return null;
  }

  const brandIndex = tokens.findIndex((token) => VEHICLE_BRANDS.has(token));
  if (brandIndex <= 0) {
    return null;
  }

  const sold = tokens.slice(0, brandIndex).join(" ").trim();
  const host = tokens.slice(brandIndex).join(" ").trim();
  if (!sold || !host) {
    return null;
  }

  return { sold, host };
}

export function conceptFamilies(): ConceptFamily[] {
  return CONCEPT_FAMILIES;
}
