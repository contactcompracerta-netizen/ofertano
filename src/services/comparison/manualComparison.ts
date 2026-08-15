import prisma from "@/lib/prisma";
import { mercadoLivreFetch } from "@/lib/mercadolivre";

import { saveProduct } from "@/services/database/saveProduct";
import { importarMercadoLivre } from "@/services/importers/mercadolivre";

import type {
  MarketplaceName,
  ProductImport,
} from "@/services/importers/core/types";

const MARKETPLACES: MarketplaceName[] = [
  "Mercado Livre",
  "Amazon",
  "Shopee",
  "Magazine Luiza",
  "AliExpress",
];

const MAX_MERCADO_LIVRE_CANDIDATES = 8;

type MercadoLivreSearchResult = {
  id?: string;
  name?: string;
  domain_id?: string;
};

type MercadoLivreSearchResponse = {
  keywords?: string;
  product_identifier?: string;
  domain_id?: string;

  paging?: {
    total?: number;
    offset?: number;
    limit?: number;
  };

  results?: MercadoLivreSearchResult[];
};

type MercadoLivreDomainAttribute = {
  id?: string;
  value_id?: string | null;
  value_name?: string | null;
};

type MercadoLivreDomainPrediction = {
  domain_id?: string;
  domain_name?: string;
  category_id?: string;
  category_name?: string;
  attributes?: MercadoLivreDomainAttribute[];
};

export type ManualComparisonSummary = {
  query: string;

  searchedMarketplaces: string[];
  pendingMarketplaces: string[];

  scanned: number;
  importedCandidates: number;
  rejectedCandidates: number;

  found: number;

  offers: Array<{
    marketplace: MarketplaceName;
    externalId: string;
    productId: string;
    name: string;
    price: number;
    affiliateLink: string | null;
    reason: string;
  }>;

  rejections: Array<{
    marketplace: MarketplaceName;
    catalogId: string;
    name: string;
    reason: string;
  }>;

  errors: string[];
};

type ProductIdentity = {
  brand: string | null;
  gtin: string | null;
  model: string | null;
  modelTokens: string[];

  variants: {
    voltage: string | null;
    storage: string | null;
    ram: string | null;
    network: string | null;
    color: string | null;
    size: string | null;
  };
};

type MatchResult = {
  exact: boolean;
  reason: string;
};

type CapacityCandidate = {
  value: string;
  megabytes: number;
  index: number;
};

const BRAND_ALIASES: Array<{
  canonical: string;
  aliases: string[];
}> = [
  { canonical: "samsung", aliases: ["samsung"] },
  { canonical: "apple", aliases: ["apple"] },
  { canonical: "motorola", aliases: ["motorola"] },
  { canonical: "xiaomi", aliases: ["xiaomi", "redmi", "poco"] },
  { canonical: "realme", aliases: ["realme"] },
  { canonical: "jbl", aliases: ["jbl"] },
  { canonical: "kingston", aliases: ["kingston"] },
  { canonical: "acer", aliases: ["acer"] },
  { canonical: "lenovo", aliases: ["lenovo"] },
  { canonical: "asus", aliases: ["asus"] },
  { canonical: "dell", aliases: ["dell"] },
  { canonical: "hp", aliases: ["hp"] },
  { canonical: "lg", aliases: ["lg"] },
  { canonical: "sony", aliases: ["sony"] },
  { canonical: "philips", aliases: ["philips"] },
  { canonical: "mondial", aliases: ["mondial"] },
  { canonical: "electrolux", aliases: ["electrolux"] },
  { canonical: "brastemp", aliases: ["brastemp"] },
  { canonical: "consul", aliases: ["consul"] },
  { canonical: "midea", aliases: ["midea"] },
  { canonical: "intelbras", aliases: ["intelbras"] },
  { canonical: "logitech", aliases: ["logitech"] },
  { canonical: "hyperx", aliases: ["hyperx"] },
  { canonical: "corsair", aliases: ["corsair"] },
  { canonical: "seagate", aliases: ["seagate"] },
  { canonical: "sandisk", aliases: ["sandisk"] },
  {
    canonical: "western digital",
    aliases: ["western digital", "wd"],
  },
];

const CORES_CONHECIDAS = [
  "preto",
  "preta",
  "branco",
  "branca",
  "azul",
  "verde",
  "vermelho",
  "vermelha",
  "rosa",
  "dourado",
  "dourada",
  "prata",
  "prateado",
  "prateada",
  "cinza",
  "grafite",
  "bege",
  "roxo",
  "roxa",
  "lilas",
] as const;

function normalizarTexto(
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

function normalizarChave(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizarCodigo(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();

  return normalized || null;
}

function normalizarValorVariante(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizarTexto(value)
    .replace(
      /(\d)\s+(gb|tb|mb|mah|w|v|hz)\b/g,
      "$1$2",
    )
    .trim();

  return normalized || null;
}

function buscarAtributo(
  product: ProductImport,
  aliases: readonly string[],
): string | null {
  const normalizedAliases = aliases.map(normalizarChave);

  for (const [rawKey, rawValue] of Object.entries(product.attributes ?? {})) {
    const key = normalizarChave(rawKey);

    const matched = normalizedAliases.some(
      (alias) => key === alias || key.endsWith(`_${alias}`),
    );

    if (
      matched &&
      typeof rawValue === "string" &&
      rawValue.trim()
    ) {
      return rawValue.trim();
    }
  }

  return null;
}

function normalizarMarca(
  value: string | null | undefined,
): string | null {
  const normalized = normalizarTexto(value);

  if (!normalized) {
    return null;
  }

  const padded = ` ${normalized} `;

  for (const brand of BRAND_ALIASES) {
    for (const alias of brand.aliases) {
      const aliasNormalizado = normalizarTexto(alias);

      if (padded.includes(` ${aliasNormalizado} `)) {
        return brand.canonical;
      }
    }
  }

  return normalized;
}

function inferirMarcaPeloTitulo(
  title: string,
): string | null {
  const normalized = normalizarTexto(title);

  if (!normalized) {
    return null;
  }

  const padded = ` ${normalized} `;

  for (const brand of BRAND_ALIASES) {
    for (const alias of brand.aliases) {
      const aliasNormalizado = normalizarTexto(alias);

      if (padded.includes(` ${aliasNormalizado} `)) {
        return brand.canonical;
      }
    }
  }

  return null;
}

function buscarMarcaEstruturada(
  product: ProductImport,
): string | null {
  return (
    product.brand?.trim() ||
    buscarAtributo(product, ["BRAND", "MARCA"])
  );
}

function buscarModeloEstruturado(
  product: ProductImport,
): string | null {
  return buscarAtributo(product, [
    "MODEL",
    "MODELO",
    "MODEL_NUMBER",
    "NUMERO_DO_MODELO",
    "MPN",
    "PART_NUMBER",
    "MANUFACTURER_PART_NUMBER",
  ]);
}

function extrairModeloDescritivoDoTitulo(
  title: string,
): string | null {
  const texto = normalizarTexto(title);

  const patterns = [
    /\bgalaxy\s+[a-z]\d{2,3}(?:\s+(?:fe|plus|ultra))?\b/i,
    /\biphone\s+\d{1,2}(?:\s+(?:pro max|pro|plus|max|e))?\b/i,
    /\bedge\s+\d{1,3}(?:\s+(?:pro|fusion|neo|ultra))?\b/i,
    /\bmoto\s+g\s*\d{1,3}\b/i,
    /\bredmi\s+note\s*\d{1,3}(?:\s+(?:pro plus|pro|plus))?\b/i,
    /\bpoco\s+[xmfc]\d{1,3}(?:\s+pro)?\b/i,
    /\bnitro\s+v?\s*\d{1,2}\b/i,
    /\btune\s+\d{3,4}[a-z]*\b/i,
  ];

  for (const pattern of patterns) {
    const match = texto.match(pattern);

    if (match?.[0]) {
      return match[0].trim();
    }
  }

  return null;
}

function ehTokenModeloUtil(rawToken: string): boolean {
  const token = normalizarCodigo(rawToken);

  if (!token) {
    return false;
  }

  if (token.length < 3 || token.length > 30) {
    return false;
  }

  if (!/[A-Z]/.test(token) || !/\d/.test(token)) {
    return false;
  }

  if (
    /^\d+(?:GB|TB|MB|KB|MP|MPX|MAH|W|V|HZ|KHZ|MHZ|GHZ|CM|MM)$/.test(
      token,
    )
  ) {
    return false;
  }

  if (/^(?:3G|4G|5G|6G)$/.test(token)) {
    return false;
  }

  if (/^(?:DDR|LPDDR)\d+[A-Z]*$/.test(token)) {
    return false;
  }

  if (/^WIFI\d*[A-Z]*$/.test(token)) {
    return false;
  }

  if (/^USB\d+[A-Z]*$/.test(token)) {
    return false;
  }

  if (/^HDMI\d+[A-Z]*$/.test(token)) {
    return false;
  }

  if (/^(?:FHD|UHD|QHD)\d*$/.test(token)) {
    return false;
  }

  return true;
}

function extrairTokensModeloTexto(value: string): string[] {
  const semAcentos = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  const rawTokens =
    semAcentos.match(/[A-Z0-9]+(?:-[A-Z0-9]+)*/g) ?? [];

  return Array.from(
    new Set(
      rawTokens
        .filter(ehTokenModeloUtil)
        .map((token) => normalizarCodigo(token))
        .filter((token): token is string => Boolean(token)),
    ),
  );
}

function extrairTokensModelo(
  product: ProductImport,
  modelStructured: string | null,
): string[] {
  const encontrados: string[] = [];

  const modeloDescritivo = extrairModeloDescritivoDoTitulo(
    product.title,
  );

  if (modeloDescritivo) {
    const codigo = normalizarCodigo(modeloDescritivo);

    if (codigo) {
      encontrados.push(codigo);
    }
  }

  encontrados.push(...extrairTokensModeloTexto(product.title));

  if (modelStructured) {
    const modeloCompleto = normalizarCodigo(modelStructured);

    if (modeloCompleto) {
      encontrados.push(modeloCompleto);
    }

    encontrados.push(...extrairTokensModeloTexto(modelStructured));
  }

  return Array.from(new Set(encontrados));
}

function normalizarCapacidade(
  rawNumber: string,
  rawUnit: string,
): {
  value: string;
  megabytes: number;
} | null {
  const numero = Number(rawNumber.replace(",", "."));

  if (!Number.isFinite(numero) || numero <= 0) {
    return null;
  }

  const unit = rawUnit.trim().toLowerCase();

  let multiplicador = 0;

  if (unit === "tb") {
    multiplicador = 1024 * 1024;
  } else if (unit === "gb") {
    multiplicador = 1024;
  } else if (unit === "mb") {
    multiplicador = 1;
  } else {
    return null;
  }

  const numeroFormatado = Number.isInteger(numero)
    ? String(numero)
    : String(numero).replace(".", ",");

  return {
    value: `${numeroFormatado}${unit}`,
    megabytes: numero * multiplicador,
  };
}

function extrairCapacidadesTitulo(
  title: string,
): CapacityCandidate[] {
  const texto = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const regex = /(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)\b/gi;
  const encontrados: CapacityCandidate[] = [];

  let match: RegExpExecArray | null;

  while ((match = regex.exec(texto)) !== null) {
    if (!match[1] || !match[2]) {
      continue;
    }

    const capacidade = normalizarCapacidade(match[1], match[2]);

    if (!capacidade) {
      continue;
    }

    encontrados.push({
      value: capacidade.value,
      megabytes: capacidade.megabytes,
      index: match.index,
    });
  }

  return encontrados;
}

function inferirRamPeloTitulo(
  title: string,
): string | null {
  const texto = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*(gb|mb)\s*(?:de\s*)?(?:ram|memoria\s+ram)\b/i,
    /(?:ram|memoria\s+ram)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*(gb|mb)\b/i,
  ];

  for (const pattern of patterns) {
    const match = texto.match(pattern);

    if (!match?.[1] || !match?.[2]) {
      continue;
    }

    const capacidade = normalizarCapacidade(match[1], match[2]);

    if (capacidade) {
      return capacidade.value;
    }
  }

  return null;
}

function inferirArmazenamentoPeloTitulo(
  title: string,
): string | null {
  const texto = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const candidatos = extrairCapacidadesTitulo(title);

  if (candidatos.length === 0) {
    return null;
  }

  const naoRam = candidatos.filter((candidate) => {
    const inicio = Math.max(0, candidate.index - 16);
    const fim = Math.min(texto.length, candidate.index + 18);
    const contexto = texto.slice(inicio, fim);

    return !/\b(?:ram|memoria\s+ram)\b/i.test(contexto);
  });

  if (naoRam.length === 0) {
    return null;
  }

  const armazenamentoExplicito = naoRam.find((candidate) => {
    const inicio = Math.max(0, candidate.index - 22);
    const fim = Math.min(texto.length, candidate.index + 28);
    const contexto = texto.slice(inicio, fim);

    return /\b(?:ssd|rom|armazenamento|memoria\s+interna|storage)\b/i.test(
      contexto,
    );
  });

  if (armazenamentoExplicito) {
    return armazenamentoExplicito.value;
  }

  const maior = [...naoRam].sort(
    (a, b) => b.megabytes - a.megabytes,
  )[0];

  if (!maior) {
    return null;
  }

  /*
   * Sem um rótulo explícito, só tratamos como armazenamento
   * capacidades a partir de 64 GB. Isso reduz o risco de
   * interpretar RAM como armazenamento.
   */
  if (maior.megabytes < 64 * 1024) {
    return null;
  }

  return maior.value;
}

function inferirRedePeloTitulo(
  title: string,
): string | null {
  const texto = normalizarTexto(title);
  const match = texto.match(/\b(3g|4g|5g|6g)\b/i);

  return match?.[1]?.toLowerCase() ?? null;
}

function inferirVoltagemPeloTitulo(
  title: string,
): string | null {
  const texto = normalizarTexto(title);

  if (/\bbivolt\b/.test(texto)) {
    return "bivolt";
  }

  const match = texto.match(/\b(110|127|220)\s*v\b/i);

  return match?.[1] ? `${match[1]}v` : null;
}

function normalizarCor(color: string): string {
  const normalized = normalizarTexto(color);

  const mapa: Record<string, string> = {
    preta: "preto",
    preto: "preto",
    branca: "branco",
    branco: "branco",
    vermelha: "vermelho",
    vermelho: "vermelho",
    dourada: "dourado",
    dourado: "dourado",
    prateada: "prata",
    prateado: "prata",
    prata: "prata",
    roxa: "roxo",
    roxo: "roxo",
    lilas: "lilas",
  };

  return mapa[normalized] ?? normalized;
}

function inferirCorPeloTitulo(
  title: string,
): string | null {
  const texto = ` ${normalizarTexto(title)} `;

  const encontradas = Array.from(
    new Set(
      CORES_CONHECIDAS
        .filter((cor) => texto.includes(` ${normalizarTexto(cor)} `))
        .map(normalizarCor),
    ),
  );

  if (encontradas.length !== 1) {
    return null;
  }

  return encontradas[0] ?? null;
}

function extrairIdentidade(
  product: ProductImport,
): ProductIdentity {
  const brandStructured = buscarMarcaEstruturada(product);
  const modelStructured = buscarModeloEstruturado(product);

  const brand =
    normalizarMarca(brandStructured) ??
    inferirMarcaPeloTitulo(product.title);

  const gtin = buscarAtributo(product, [
    "GTIN",
    "GTIN_8",
    "GTIN_12",
    "GTIN_13",
    "GTIN_14",
    "EAN",
    "UPC",
    "BARCODE",
    "CODIGO_EAN",
    "CODIGO_DE_BARRAS",
  ]);

  const voltageStructured = buscarAtributo(product, [
    "VOLTAGE",
    "VOLTAGEM",
    "TENSAO",
    "TENSAO_ELETRICA",
  ]);

  const storageStructured = buscarAtributo(product, [
    "INTERNAL_MEMORY",
    "MEMORIA_INTERNA",
    "STORAGE_CAPACITY",
    "CAPACIDADE_DE_ARMAZENAMENTO",
    "ARMAZENAMENTO",
  ]);

  const ramStructured = buscarAtributo(product, [
    "RAM",
    "MEMORIA_RAM",
  ]);

  const networkStructured = buscarAtributo(product, [
    "MOBILE_NETWORK",
    "NETWORK",
    "REDE_MOVEL",
    "TECNOLOGIA_DE_REDE",
  ]);

  const colorStructured = buscarAtributo(product, [
    "COLOR",
    "COR",
  ]);

  const sizeStructured = buscarAtributo(product, [
    "SIZE",
    "TAMANHO",
  ]);

  return {
    brand,
    gtin: normalizarCodigo(gtin),
    model: normalizarCodigo(modelStructured),
    modelTokens: extrairTokensModelo(product, modelStructured),

    variants: {
      voltage:
        normalizarValorVariante(voltageStructured) ??
        normalizarValorVariante(
          inferirVoltagemPeloTitulo(product.title),
        ),

      storage:
        normalizarValorVariante(storageStructured) ??
        normalizarValorVariante(
          inferirArmazenamentoPeloTitulo(product.title),
        ),

      ram:
        normalizarValorVariante(ramStructured) ??
        normalizarValorVariante(inferirRamPeloTitulo(product.title)),

      network:
        normalizarValorVariante(networkStructured) ??
        normalizarValorVariante(inferirRedePeloTitulo(product.title)),

      color: colorStructured
        ? normalizarCor(colorStructured)
        : inferirCorPeloTitulo(product.title),

      size: normalizarValorVariante(sizeStructured),
    },
  };
}

function encontrarModeloEmComum(
  a: ProductIdentity,
  b: ProductIdentity,
): string | null {
  if (a.model && b.model) {
    return a.model === b.model ? a.model : null;
  }

  const tokensB = new Set(b.modelTokens);

  for (const token of a.modelTokens) {
    if (tokensB.has(token)) {
      return token;
    }
  }

  return null;
}

function compararProdutoEstritamente(
  original: ProductImport,
  candidate: ProductImport,
): MatchResult {
  const a = extrairIdentidade(original);
  const b = extrairIdentidade(candidate);

  if (a.gtin && b.gtin) {
    if (a.gtin === b.gtin) {
      return {
        exact: true,
        reason: "GTIN/EAN idêntico.",
      };
    }

    return {
      exact: false,
      reason: "GTIN/EAN diferente.",
    };
  }

  if (a.brand && b.brand && a.brand !== b.brand) {
    return {
      exact: false,
      reason: `Marca diferente: ${a.brand} x ${b.brand}.`,
    };
  }

  if (!a.brand || !b.brand) {
    return {
      exact: false,
      reason: "Marca insuficiente para confirmação automática.",
    };
  }

  if (a.model && b.model && a.model !== b.model) {
    return {
      exact: false,
      reason: `Modelo/MPN diferente: ${a.model} x ${b.model}.`,
    };
  }

  const modeloEmComum = encontrarModeloEmComum(a, b);

  if (!modeloEmComum) {
    return {
      exact: false,
      reason: "Modelo/código insuficiente para confirmação automática.",
    };
  }

  const variantKeys = [
    "voltage",
    "storage",
    "ram",
    "network",
    "color",
    "size",
  ] as const;

  let agreements = 0;
  const acordos: string[] = [];

  for (const key of variantKeys) {
    const first = a.variants[key];
    const second = b.variants[key];

    if (first && second) {
      if (first !== second) {
        return {
          exact: false,
          reason: `Variante ${key} diferente: ${first} x ${second}.`,
        };
      }

      agreements += 1;
      acordos.push(`${key}=${first}`);
    }
  }

  if (agreements === 0) {
    return {
      exact: false,
      reason:
        `Marca e modelo/código ${modeloEmComum} coincidem, ` +
        "mas falta uma variante forte para confirmar automaticamente.",
    };
  }

  return {
    exact: true,
    reason:
      `Marca ${a.brand}, modelo/código ${modeloEmComum} e ` +
      `variante(s) forte(s) ${acordos.join(", ")} coincidem.`,
  };
}

function criarTermoBusca(
  product: ProductImport,
): string {
  const identity = extrairIdentidade(product);

  const modeloBusca =
    extrairModeloDescritivoDoTitulo(product.title) ??
    buscarModeloEstruturado(product) ??
    identity.modelTokens[0] ??
    null;

  const partes = [
    identity.brand,
    modeloBusca,
    identity.variants.network,
    identity.variants.storage,
    identity.variants.ram,
    identity.variants.voltage,
    identity.variants.color,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());

  const unique = Array.from(
    new Set(partes.map((value) => normalizarTexto(value))),
  ).filter(Boolean);

  if (unique.length >= 2) {
    return unique.join(" ").slice(0, 180);
  }

  return product.title.trim().slice(0, 180);
}

async function preverDominioMercadoLivre(
  product: ProductImport,
): Promise<MercadoLivreDomainPrediction | null> {
  const query = product.title.trim().slice(0, 180);

  if (!query) {
    return null;
  }

  try {
    const endpoint =
      "/sites/MLB/domain_discovery/search" +
      "?limit=1" +
      `&q=${encodeURIComponent(query)}`;

    const response = (await mercadoLivreFetch(
      endpoint,
    )) as MercadoLivreDomainPrediction[];

    if (!Array.isArray(response) || response.length === 0) {
      return null;
    }

    return response[0] ?? null;
  } catch (error) {
    console.warn(
      "Não foi possível prever o domínio do Mercado Livre. A busca continuará sem domínio.",
      error,
    );

    return null;
  }
}

function prepararAtributosPreditos(
  prediction: MercadoLivreDomainPrediction | null,
): Array<{
  id: string;
  value_id?: string;
  value_name?: string;
}> {
  if (!prediction?.attributes) {
    return [];
  }

  const prioridade = [
    "BRAND",
    "LINE",
    "MODEL",
    "INTERNAL_MEMORY",
    "RAM",
    "COLOR",
  ];

  const validos = prediction.attributes
    .filter(
      (attribute) =>
        typeof attribute.id === "string" &&
        attribute.id.trim() &&
        (attribute.value_id || attribute.value_name),
    )
    .sort((a, b) => {
      const indexA = prioridade.indexOf(a.id ?? "");
      const indexB = prioridade.indexOf(b.id ?? "");

      const rankA = indexA === -1 ? 999 : indexA;
      const rankB = indexB === -1 ? 999 : indexB;

      return rankA - rankB;
    })
    .slice(0, 5)
    .map((attribute) => {
      const item: {
        id: string;
        value_id?: string;
        value_name?: string;
      } = {
        id: attribute.id!.trim(),
      };

      if (attribute.value_id) {
        item.value_id = attribute.value_id;
      } else if (attribute.value_name) {
        item.value_name = attribute.value_name;
      }

      return item;
    });

  return validos;
}

function adicionarResultadosSemDuplicar(
  destino: MercadoLivreSearchResult[],
  response: MercadoLivreSearchResponse | null,
) {
  const results = Array.isArray(response?.results)
    ? response.results
    : [];

  const idsExistentes = new Set(
    destino
      .map((item) => item.id?.trim())
      .filter((id): id is string => Boolean(id)),
  );

  for (const result of results) {
    const id = result.id?.trim();

    if (!id || idsExistentes.has(id)) {
      continue;
    }

    destino.push(result);
    idsExistentes.add(id);

    if (destino.length >= MAX_MERCADO_LIVRE_CANDIDATES) {
      return;
    }
  }
}

async function pesquisarCatalogoMercadoLivre(
  product: ProductImport,
): Promise<MercadoLivreSearchResult[]> {
  const identity = extrairIdentidade(product);

  if (identity.gtin) {
    const endpoint =
      "/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      "&limit=5" +
      `&product_identifier=${encodeURIComponent(identity.gtin)}`;

    const response = (await mercadoLivreFetch(
      endpoint,
    )) as MercadoLivreSearchResponse;

    return Array.isArray(response.results)
      ? response.results.slice(0, 5)
      : [];
  }

  const query = criarTermoBusca(product);
  const prediction = await preverDominioMercadoLivre(product);
  const domainId = prediction?.domain_id?.trim() || null;
  const resultados: MercadoLivreSearchResult[] = [];

  /*
   * Primeira tentativa: busca por atributos previstos pelo próprio
   * Mercado Livre. A documentação exige ao menos três atributos.
   */
  const atributos = prepararAtributosPreditos(prediction);

  if (domainId && atributos.length >= 3) {
    try {
      const response = (await mercadoLivreFetch(
        "/products/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            domain_id: domainId,
            site_id: "MLB",
            status: "active",
            attributes: atributos,
          }),
        },
      )) as MercadoLivreSearchResponse;

      adicionarResultadosSemDuplicar(resultados, response);
    } catch (error) {
      console.warn(
        "Busca por atributos do Mercado Livre falhou. A busca continuará por texto.",
        error,
      );
    }
  }

  /*
   * Segunda tentativa: consulta curta e objetiva, restringida ao
   * domínio previsto quando ele estiver disponível.
   */
  if (resultados.length < MAX_MERCADO_LIVRE_CANDIDATES) {
    const endpoint =
      "/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      "&limit=10" +
      "&offset=0" +
      `&q=${encodeURIComponent(query)}` +
      (domainId
        ? `&domain_id=${encodeURIComponent(domainId)}`
        : "");

    const response = (await mercadoLivreFetch(
      endpoint,
    )) as MercadoLivreSearchResponse;

    adicionarResultadosSemDuplicar(resultados, response);
  }

  /*
   * Fallback: se o domínio previsto trouxe poucos candidatos,
   * repetimos a mesma consulta sem restringir o domínio.
   * O matcher estrito continua sendo a barreira de segurança.
   */
  if (
    domainId &&
    resultados.length < Math.min(5, MAX_MERCADO_LIVRE_CANDIDATES)
  ) {
    const endpoint =
      "/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      "&limit=10" +
      "&offset=0" +
      `&q=${encodeURIComponent(query)}`;

    const response = (await mercadoLivreFetch(
      endpoint,
    )) as MercadoLivreSearchResponse;

    adicionarResultadosSemDuplicar(resultados, response);
  }

  return resultados.slice(0, MAX_MERCADO_LIVRE_CANDIDATES);
}

export async function buscarComparacaoManual(
  original: ProductImport,
  targetProductId: string,
): Promise<ManualComparisonSummary> {
  /*
   * O produto importado manualmente é a referência.
   *
   * A descoberta das outras lojas usa o mesmo
   * Marketplace Discovery da busca pública.
   *
   * Antes de anexar qualquer oferta ao Product
   * principal, mantemos uma validação estrita de
   * identidade e variante.
   */
  const query =
    criarTermoBusca(original);

  const {
    descobrirProdutos,
  } = await import(
    "@/services/discovery"
  );

  const resultado =
    await descobrirProdutos(
      query,
      5,
    );

  const marketplacesDisponiveis = [
    "Mercado Livre",
    "Amazon",
    "Shopee",
    "Magazine Luiza",
    "AliExpress",
  ];

  const searchedMarketplaces =
    marketplacesDisponiveis.filter(
      (marketplace) =>
        marketplace !==
        original.marketplace,
    );

  const pendingMarketplaces:
    string[] = [];

  const errors =
    resultado.marketplaces
      .filter(
        (marketplace) =>
          Boolean(
            marketplace.error,
          ),
      )
      .map(
        (marketplace) =>
          `${marketplace.marketplace}: ${marketplace.error}`,
      );

  const offers:
    ManualComparisonSummary["offers"] =
      [];

  const rejections:
    ManualComparisonSummary["rejections"] =
      [];

  const marketplacesEncontrados =
    new Set<string>();

  let importedCandidates = 0;
  let rejectedCandidates = 0;

  const scanned =
    resultado.marketplaces.reduce(
      (total, marketplace) =>
        total +
        marketplace.scanned,
      0,
    );

  /*
   * Processamos primeiro as ofertas de menor preço.
   *
   * Como o schema mantém uma oferta por
   * marketplace/Product, a primeira oferta EXACT
   * de cada loja será a mais barata encontrada.
   */
  const candidatos =
    [...resultado.candidates].sort(
      (primeiro, segundo) =>
        (
          primeiro.price ??
          Number.POSITIVE_INFINITY
        ) -
        (
          segundo.price ??
          Number.POSITIVE_INFINITY
        ),
    );

  const identidadeOriginal =
    extrairIdentidade(
      original,
    );

  for (const candidato of candidatos) {
    if (
      candidato.marketplaceName ===
      original.marketplace
    ) {
      /*
       * A oferta original já foi salva pela rota.
       * Não permitimos que o Discovery substitua
       * o link manual/afiliado informado.
       */
      continue;
    }

    if (
      marketplacesEncontrados.has(
        candidato.marketplaceName,
      )
    ) {
      continue;
    }

    if (
      candidato.status !== "FOUND" ||
      candidato.price === null ||
      !Number.isFinite(
        candidato.price,
      ) ||
      candidato.price <= 0
    ) {
      continue;
    }

    const image =
      candidato.image?.trim();

    if (!image) {
      continue;
    }

    importedCandidates += 1;

    const oldPrice =
      candidato.oldPrice !== null &&
      Number.isFinite(
        candidato.oldPrice,
      ) &&
      candidato.oldPrice >
        candidato.price
        ? candidato.oldPrice
        : null;

    const candidateProduct:
      ProductImport = {
      marketplace:
        candidato.marketplaceName,

      externalId:
        candidato.externalId.trim(),

      url:
        candidato.sourceUrl.trim(),

      affiliateLink:
        candidato.affiliateLink
          ?.trim() ||
        null,

      title:
        candidato.title.trim(),

      description:
        null,

      brand:
        candidato.brand?.trim() ||
        null,

      category:
        candidato.category?.trim() ||
        null,

      image,

      images: [
        image,
      ],

      price:
        candidato.price,

      oldPrice,

      discount:
        oldPrice
          ? Math.round(
              (
                (
                  oldPrice -
                  candidato.price
                ) /
                oldPrice
              ) *
                100,
            )
          : null,

      installments:
        null,

      rating:
        null,

      reviews:
        null,

      sales:
        null,

      stock:
        null,

      seller:
        candidato.seller?.trim() ||
        null,

      attributes:
        {},
    };

    const identidadeCandidata =
      extrairIdentidade(
        candidateProduct,
      );

    /*
     * Para variantes críticas, ausência de
     * informação de apenas um lado também impede
     * agrupamento automático.
     *
     * Exemplo:
     * - iPhone Azul não pode receber oferta sem cor;
     * - 128 GB não pode receber oferta sem capacidade;
     * - eletrodoméstico 127V não pode receber 220V
     *   ou tensão desconhecida.
     */
    const variantesCriticas = [
      "color",
      "storage",
      "voltage",
      "size",
    ] as const;

    let varianteInsegura:
      string | null = null;

    for (
      const chave
      of variantesCriticas
    ) {
      const originalValor =
        identidadeOriginal
          .variants[chave];

      const candidataValor =
        identidadeCandidata
          .variants[chave];

      if (
        Boolean(originalValor) !==
        Boolean(candidataValor)
      ) {
        varianteInsegura =
          `Variante ${chave} insuficiente para confirmação automática.`;

        break;
      }
    }

    if (varianteInsegura) {
      rejectedCandidates += 1;

      rejections.push({
        marketplace:
          candidato.marketplaceName,

        catalogId:
          candidato.externalId,

        name:
          candidato.title,

        reason:
          varianteInsegura,
      });

      continue;
    }

    const match =
      compararProdutoEstritamente(
        original,
        candidateProduct,
      );

    if (!match.exact) {
      rejectedCandidates += 1;

      rejections.push({
        marketplace:
          candidato.marketplaceName,

        catalogId:
          candidato.externalId,

        name:
          candidato.title,

        reason:
          match.reason,
      });

      continue;
    }

    try {
      const saved =
        await saveProduct(
          candidateProduct,
          candidateProduct
            .affiliateLink ??
            null,
          {
            targetProductId,
            discoverySource:
              "ON_DEMAND_SEARCH",
            sourceQuery:
              query,
            autoCreated:
              false,
          },
        );

      if (
        saved.id !==
        targetProductId
      ) {
        errors.push(
          `${candidato.marketplaceName}: a oferta pertence a outro Product do Ofertano.`,
        );

        continue;
      }

      await prisma
        .marketplaceOffer
        .updateMany({
          where: {
            productId:
              targetProductId,

            marketplace:
              candidato.marketplace,

            externalId:
              candidato.externalId,
          },

          data: {
            matchStatus:
              "EXACT",
          },
        });

      marketplacesEncontrados.add(
        candidato.marketplaceName,
      );

      offers.push({
        marketplace:
          candidato.marketplaceName,

        externalId:
          candidato.externalId,

        productId:
          targetProductId,

        name:
          candidato.title,

        price:
          candidato.price,

        affiliateLink:
          candidato.affiliateLink ??
          null,

        reason:
          match.reason,
      });
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `${candidato.marketplaceName}: ${error.message}`
          : `${candidato.marketplaceName}: erro ao salvar oferta.`,
      );
    }
  }

  try {
    await prisma.product.update({
      where: {
        id:
          targetProductId,
      },

      data: {
        sourceQuery:
          query,

        lastSearchedAt:
          new Date(),
      },
    });
  } catch (error) {
    console.error(
      "Erro ao registrar comparação manual:",
      error,
    );
  }

  return {
    query,
    searchedMarketplaces,
    pendingMarketplaces,
    scanned,
    importedCandidates,
    rejectedCandidates,
    found:
      offers.length,
    offers,
    rejections,
    errors,
  };
}
