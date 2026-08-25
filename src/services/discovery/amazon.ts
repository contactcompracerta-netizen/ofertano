/*
 * Descoberta de produtos Amazon pela busca ao vivo da SerpApi,
 * com validação de modelo exato, acessórios e disponibilidade.
 */

import type {
  DiscoveryCandidate,
  DiscoveryQuery,
  MarketplaceDiscoveryResult,
} from "./core/types";
import { ehAcessorioNaoSolicitadoPelaConsulta } from "@/services/identity";
import { abortableFetch, isSearchAborted } from "@/lib/searchAbort";
import {
  classificarMensagemAquisicao,
  montarDiscoveryResult,
  type AcquisitionStatus,
} from "./acquisitionOutcome";

const SERPAPI_ENDPOINT =
  "https://serpapi.com/search.json";

const AMAZON_SEARCH_ENDPOINT =
  "https://www.amazon.com.br/s";

const MARKETPLACE = "AMAZON" as const;
const MARKETPLACE_NAME = "Amazon" as const;
const TIMEOUT_MS = 25_000;
const MAX_RESULTS = 20;

export function criarLinkAfiliadoAmazon(
  asin: string,
): string | null {
  const tag =
    process.env.AMAZON_ASSOCIATE_TAG?.trim() ||
    "ofertano-20";

  if (!/^[A-Z0-9]{10}$/i.test(asin)) {
    return null;
  }

  return (
    `https://www.amazon.com.br/dp/${asin.toUpperCase()}` +
    `/ref=nosim?tag=${encodeURIComponent(tag)}`
  );
}

type SerpApiOrganicResult = {
  position?: number;
  asin?: string;
  title?: string;
  link?: string;
  link_clean?: string;
  thumbnail?: string;
  brand?: string;
  price?: string;
  extracted_price?: number;
  old_price?: string;
  extracted_old_price?: number;
  prime?: boolean;
  delivery?: string[];
  stock?: string;
  sponsored?: boolean;
};

type SerpApiSearchResponse = {
  search_metadata?: {
    status?: string;
  };
  organic_results?: SerpApiOrganicResult[];
  error?: string;
};

const STOP_WORDS = new Set([
  "a",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "para",
  "por",
  "produto",
  "amazon",
  "barata",
  "barato",
  "buscar",
  "comprar",
  "encontrar",
  "melhor",
  "oferta",
  "ofertas",
  "preco",
  "procuro",
  "promocao",
  "quero",
]);

const ACCESSORY_TOKENS = new Set([
  "adaptador",
  "adaptadores",
  "adesivo",
  "adesivos",
  "alca",
  "alcas",
  "bolsa",
  "bolsas",
  "cabo",
  "cabos",
  "capa",
  "capas",
  "carregador",
  "carregadores",
  "case",
  "cases",
  "dock",
  "docks",
  "estojo",
  "estojos",
  "gancho",
  "ganchos",
  "holder",
  "holders",
  "mount",
  "mounts",
  "pelicula",
  "peliculas",
  "protetor",
  "protetores",
  "pulseira",
  "pulseiras",
  "refil",
  "refis",
  "reposicao",
  "skin",
  "skins",
  "stand",
  "stands",
  "suporte",
  "suportes",
]);

function normalizarLimite(
  limit: number,
): number {
  const base = Number.isFinite(limit)
    ? Math.trunc(limit)
    : 5;

  return Math.min(
    MAX_RESULTS,
    Math.max(1, base),
  );
}

function normalizarTexto(
  value: string,
): string {
  return value
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9+]+/g,
      " ",
    )
    .replace(
      /\b([a-z])\s+(\d{1,4})\b/g,
      "$1$2",
    )
    .replace(
      /\b(\d{1,4})\s+(gb|tb|g)\b/g,
      "$1$2",
    )
    .trim()
    .replace(/\s+/g, " ");
}

function tokenizar(
  value: string,
): string[] {
  return normalizarTexto(value)
    .split(" ")
    .filter(
      (token) =>
        (
          token.length >= 2 ||
          /^\d$/.test(token)
        ) &&
        token !== "+" &&
        !STOP_WORDS.has(token),
    );
}

function extrairCapacidades(
  value: string,
): Set<string> {
  const normalized =
    normalizarTexto(value);

  const capacities =
    new Set<string>();

  for (
    const match of normalized.matchAll(
      /\b(\d{1,4})\s*(gb|tb)\b/g,
    )
  ) {
    capacities.add(
      `${match[1]}${match[2]}`,
    );
  }

  return capacities;
}

function possuiAcessorioNaoSolicitado(
  query: string,
  title: string,
): boolean {
  if (ehAcessorioNaoSolicitadoPelaConsulta(query, title)) {
    return true;
  }
  const queryTokens = new Set(
    tokenizar(query),
  );

  const querySolicitaAcessorio =
    Array.from(
      ACCESSORY_TOKENS,
    ).some(
      (token) =>
        queryTokens.has(token),
    );

  if (querySolicitaAcessorio) {
    return false;
  }

  /*
   * Acessórios normalmente se identificam logo no
   * começo do título: "Suporte para...", "Capa para..."
   * ou após a marca do fabricante do acessório.
   */
  const inicioDoTitulo =
    tokenizar(title).slice(0, 6);

  return inicioDoTitulo.some(
    (token) =>
      ACCESSORY_TOKENS.has(token),
  );
}

function possuiBundleNaoSolicitado(
  query: string,
  title: string,
): boolean {
  const bundlePattern =
    /(?:^|\s)\+(?:\s|$)|\b(?:kit|combo|conjunto|brinde)\b/i;

  return (
    bundlePattern.test(title) &&
    !bundlePattern.test(query)
  );
}


const TERMOS_CONDICAO_NAO_NOVA = new Set([
  "usado",
  "usada",
  "usados",
  "usadas",
  "seminovo",
  "seminova",
  "seminovos",
  "seminovas",
  "recondicionado",
  "recondicionada",
  "recondicionados",
  "recondicionadas",
  "refurbished",
  "renewed",
]);

const FAMILIAS_VARIANTE_ESTRITA = new Set([
  "galaxy",
  "iphone",
  "redmi",
  "poco",
  "pixel",
  "moto",
  "macbook",
  "ipad",
  "echo",
]);

const QUALIFICADORES_MODELO = new Set([
  "fe",
  "ultra",
  "plus",
  "pro",
  "max",
  "mini",
  "air",
  "lite",
]);

const MARCAS_CONHECIDAS = new Set([
  "samsung",
  "lg",
  "sony",
  "philips",
  "tcl",
  "hisense",
  "aoc",
  "philco",
  "panasonic",
  "xiaomi",
  "motorola",
  "apple",
  "lenovo",
  "asus",
  "acer",
  "dell",
  "hp",
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
]);

function marcaCompativel(
  query: string,
  title: string,
  resultBrand?: string,
): boolean {
  const queryTokens = new Set(
    tokenizar(query),
  );

  const marcaSolicitada =
    Array.from(
      MARCAS_CONHECIDAS,
    ).find(
      (marca) =>
        queryTokens.has(marca),
    );

  if (!marcaSolicitada) {
    return true;
  }

  const tituloTokens = new Set(
    tokenizar(title),
  );

  if (
    tituloTokens.has(
      marcaSolicitada,
    )
  ) {
    return true;
  }

  const brandTokens = new Set(
    tokenizar(
      resultBrand ?? "",
    ),
  );

  return brandTokens.has(
    marcaSolicitada,
  );
}

function possuiCondicaoNaoNova(
  title: string,
): boolean {
  const tokens = new Set(
    normalizarTexto(title)
      .replace(/\+/g, " plus ")
      .split(" ")
      .filter(Boolean),
  );

  const texto =
    normalizarTexto(title);

  if (texto.includes("open box")) {
    return true;
  }

  return Array.from(
    TERMOS_CONDICAO_NAO_NOVA,
  ).some(
    (termo) =>
      tokens.has(termo),
  );
}

function extrairQualificadoresModelo(
  value: string,
): Set<string> {
  const tokens = new Set(
    normalizarTexto(value)
      .replace(/\+/g, " plus ")
      .split(" ")
      .filter(Boolean),
  );

  return new Set(
    Array.from(
      QUALIFICADORES_MODELO,
    ).filter(
      (qualificador) =>
        tokens.has(qualificador),
    ),
  );
}

function conjuntosIguais(
  primeiro: Set<string>,
  segundo: Set<string>,
): boolean {
  if (
    primeiro.size !==
    segundo.size
  ) {
    return false;
  }

  for (const valor of primeiro) {
    if (!segundo.has(valor)) {
      return false;
    }
  }

  return true;
}

function varianteModeloCompativel(
  query: string,
  title: string,
): boolean {
  const queryTokens =
    tokenizar(query);

  const familiaEstrita =
    queryTokens.some(
      (token) =>
        FAMILIAS_VARIANTE_ESTRITA.has(
          token,
        ),
    );

  if (!familiaEstrita) {
    return true;
  }

  return conjuntosIguais(
    extrairQualificadoresModelo(query),
    extrairQualificadoresModelo(title),
  );
}

function tituloCompativel(
  query: string,
  title: string,
  resultBrand?: string,
): boolean {
  const queryTokens =
    tokenizar(query);

  const titleTokens = new Set(
    tokenizar(title),
  );

  if (
    queryTokens.length === 0 ||
    titleTokens.size === 0
  ) {
    return false;
  }

  if (
    !marcaCompativel(
      query,
      title,
      resultBrand,
    )
  ) {
    return false;
  }

  if (
    possuiBundleNaoSolicitado(
      query,
      title,
    )
  ) {
    return false;
  }

  if (
    possuiAcessorioNaoSolicitado(
      query,
      title,
    )
  ) {
    return false;
  }

  if (
    possuiCondicaoNaoNova(
      title,
    )
  ) {
    return false;
  }

  if (
    !varianteModeloCompativel(
      query,
      title,
    )
  ) {
    return false;
  }


  const queryCapacities =
    extrairCapacidades(query);

  const titleCapacities =
    extrairCapacidades(title);

  for (const capacity of queryCapacities) {
    if (!titleCapacities.has(capacity)) {
      return false;
    }
  }

  /*
   * Números e códigos mistos normalmente identificam
   * modelo, geração, tamanho ou versão. Todos eles
   * precisam aparecer no título retornado.
   */
  const modelTokens = queryTokens.filter(
    (token) =>
      /^\d+$/.test(token) ||
      (
        /[a-z]/.test(token) &&
        /\d/.test(token)
      ),
  );

  if (
    modelTokens.some(
      (token) =>
        !titleTokens.has(token),
    )
  ) {
    return false;
  }

  /*
   * Os dois primeiros termos úteis formam a âncora
   * principal do produto. Assim, "Echo Pop" não pode
   * aceitar "Echo Dot" nem "Echo Spot".
   */
  const identityTokens =
    queryTokens.slice(0, 2);

  if (
    identityTokens.some(
      (token) =>
        !titleTokens.has(token),
    )
  ) {
    return false;
  }

  const matches = queryTokens.filter(
    (token) =>
      titleTokens.has(token),
  ).length;

  const minimumMatches = Math.max(
    1,
    Math.ceil(
      queryTokens.length * 0.7,
    ),
  );

  return matches >= minimumMatches;
}

function limparTitulo(
  value: string | undefined,
): string {
  return (value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarAsin(
  value: string | undefined,
): string | null {
  const asin = (value ?? "")
    .trim()
    .toUpperCase();

  return /^[A-Z0-9]{10}$/.test(asin)
    ? asin
    : null;
}

function normalizarPreco(
  value: unknown,
): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  ) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const raw = value
    .replace(/[^0-9,.-]/g, "")
    .trim();

  if (!raw) {
    return null;
  }

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");

  const normalized =
    lastComma > lastDot
      ? raw
          .replace(/\./g, "")
          .replace(",", ".")
      : raw.replace(/,/g, "");

  const parsed = Number(normalized);

  return (
    Number.isFinite(parsed) &&
    parsed > 0
  )
    ? parsed
    : null;
}

function normalizarImagem(
  value: string | undefined,
): string | null {
  const text = value?.trim();

  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);
    const hostname =
      url.hostname.toLowerCase();

    const amazonImageHost =
      hostname === "media-amazon.com" ||
      hostname.endsWith(".media-amazon.com") ||
      hostname === "images-amazon.com" ||
      hostname.endsWith(".images-amazon.com") ||
      hostname ===
        "ssl-images-amazon.com" ||
      hostname.endsWith(
        ".ssl-images-amazon.com",
      );

    if (
      url.protocol !== "https:" ||
      !amazonImageHost
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function possuiSinalDeDisponibilidade(
  result: SerpApiOrganicResult,
): boolean {
  const delivery = Array.isArray(
    result.delivery,
  )
    ? result.delivery.filter(
        (value): value is string =>
          typeof value === "string" &&
          value.trim().length > 0,
      )
    : [];

  const stock =
    typeof result.stock === "string"
      ? result.stock.trim()
      : "";

  const availabilityText =
    normalizarTexto(
      [...delivery, stock].join(" "),
    );

  const unavailablePattern =
    /\b(?:nao disponivel|indisponivel|sem estoque|esgotado|temporariamente indisponivel|currently unavailable|out of stock)\b/i;

  if (
    availabilityText &&
    unavailablePattern.test(
      availabilityText,
    )
  ) {
    return false;
  }

  return true;
}

export function criarCandidatos(
  results: SerpApiOrganicResult[],
  query: string,
  limit: number,
  collectOnly = false,
): DiscoveryCandidate[] {
  const candidates = new Map<
    string,
    DiscoveryCandidate
  >();

  for (const result of results) {
    const asin = normalizarAsin(
      result.asin,
    );

    if (
      !asin ||
      candidates.has(asin)
    ) {
      continue;
    }

    const title = limparTitulo(
      result.title,
    );

    if (!title) {
      continue;
    }

    if (
      !collectOnly &&
      !tituloCompativel(
        query,
        title,
        result.brand,
      )
    ) {
      continue;
    }

    const price = normalizarPreco(
      result.extracted_price ??
        result.price,
    );

    const image = normalizarImagem(
      result.thumbnail,
    );

    if (
      price === null ||
      !possuiSinalDeDisponibilidade(
        result,
      )
    ) {
      continue;
    }

    const previousPrice = normalizarPreco(
      result.extracted_old_price ??
        result.old_price,
    );

    candidates.set(asin, {
      marketplace: MARKETPLACE,
      marketplaceName:
        MARKETPLACE_NAME,
      externalId: asin,
      sourceUrl:
        `https://www.amazon.com.br/dp/${asin}`,
      affiliateLink:
        criarLinkAfiliadoAmazon(
          asin,
        ),
      title,
      image,
      price,
      oldPrice:
        previousPrice !== null &&
        previousPrice > price
          ? previousPrice
          : null,
      category: null,
      brand:
        result.brand?.trim() ||
        null,
      seller: null,
      status: "FOUND",
      error: null,
    });

    if (candidates.size >= limit) {
      break;
    }
  }

  return Array.from(
    candidates.values(),
  );
}


function decodificarHtml(
  value: string,
): string {
  const entidades: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };

  return value
    .replace(
      /&#(\d+);/g,
      (_match, code: string) =>
        String.fromCharCode(
          Number(code),
        ),
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_match, code: string) =>
        String.fromCharCode(
          Number.parseInt(
            code,
            16,
          ),
        ),
    )
    .replace(
      /&([a-z]+);/gi,
      (match, name: string) =>
        entidades[
          name.toLowerCase()
        ] ?? match,
    );
}

function extrairAtributoHtml(
  tag: string,
  atributo: string,
): string | null {
  const escaped = atributo.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );

  const match = tag.match(
    new RegExp(
      `${escaped}\\s*=\\s*["']([^"']+)["']`,
      "i",
    ),
  );

  return match?.[1]
    ? decodificarHtml(
        match[1],
      ).trim()
    : null;
}

function extrairTextoHtml(
  html: string,
): string {
  return decodificarHtml(
    html
      .replace(
        /<script\b[\s\S]*?<\/script>/gi,
        " ",
      )
      .replace(
        /<style\b[\s\S]*?<\/style>/gi,
        " ",
      )
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extrairMarcaDoTitulo(
  title: string,
): string | undefined {
  const tokens = new Set(
    tokenizar(title),
  );

  const marca = Array.from(
    MARCAS_CONHECIDAS,
  ).find(
    (candidate) =>
      tokens.has(candidate),
  );

  if (!marca) {
    return undefined;
  }

  return marca.charAt(0).toUpperCase() +
    marca.slice(1);
}

function primeiroSrcset(
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim().split(/\s+/)[0];
  return first || null;
}

function extrairImagemAmazonDoBloco(
  block: string,
): string | undefined {
  const imageTag =
    block.match(
      /<img\b[^>]*class=["'][^"']*\bs-image\b[^"']*["'][^>]*>/i,
    )?.[0] ?? "";

  return (
    extrairAtributoHtml(imageTag, "src") ||
    extrairAtributoHtml(imageTag, "data-src") ||
    extrairAtributoHtml(imageTag, "data-a-hires") ||
    primeiroSrcset(extrairAtributoHtml(imageTag, "srcset")) ||
    undefined
  );
}

function extrairPrecoAmazonDoBloco(
  block: string,
): number | null {
  const priceBlock =
    block.match(
      /<span\b[^>]*class=["'][^"']*\ba-price\b[^"']*["'][^>]*>[\s\S]*?<\/span>\s*<\/span>/i,
    )?.[0] ?? "";

  const fromPriceClass = normalizarPreco(
    priceBlock.match(
      /R\$\s*[0-9.]+(?:,[0-9]{2})?/i,
    )?.[0] ?? null,
  );

  if (fromPriceClass) {
    return fromPriceClass;
  }

  for (const match of block.matchAll(
    /<span\b[^>]*class=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
  )) {
    const offscreen = normalizarPreco(
      extrairTextoHtml(match[1] ?? ""),
    );

    if (offscreen) {
      return offscreen;
    }
  }

  return normalizarPreco(
    block.match(
      /R\$\s*[0-9.]+(?:,[0-9]{2})?/i,
    )?.[0] ?? null,
  );
}

function extrairPrecoAnteriorAmazonDoBloco(
  block: string,
): number | null {
  const oldPriceBlock =
    block.match(
      /<span\b[^>]*class=["'][^"']*\ba-text-price\b[^"']*["'][^>]*>[\s\S]*?<\/span>/i,
    )?.[0] ?? "";

  const oldPriceText =
    oldPriceBlock.match(
      /R\$\s*[0-9.]+(?:,[0-9]{2})?/i,
    )?.[0] ?? null;

  return normalizarPreco(
    oldPriceText,
  );
}

export function extrairResultadosAmazonHtml(
  html: string,
): SerpApiOrganicResult[] {
  const markers = Array.from(
    html.matchAll(
      /<div\b[^>]*data-component-type=["']s-search-result["'][^>]*>/gi,
    ),
  );

  const results:
    SerpApiOrganicResult[] = [];

  for (
    let index = 0;
    index < markers.length;
    index += 1
  ) {
    const marker = markers[index];
    const start = marker.index ?? 0;
    const end =
      markers[index + 1]?.index ??
      Math.min(
        html.length,
        start + 90_000,
      );

    const openingTag =
      marker[0] ?? "";
    const asin = normalizarAsin(
      extrairAtributoHtml(
        openingTag,
        "data-asin",
      ) ?? undefined,
    );

    if (!asin) {
      continue;
    }

    const block = html.slice(
      start,
      end,
    );

    const h2 =
      block.match(
        /<h2\b[^>]*>([\s\S]*?)<\/h2>/i,
      )?.[1] ?? "";

    const title = extrairTextoHtml(
      h2,
    );

    if (!title) {
      continue;
    }

    const thumbnail =
      extrairImagemAmazonDoBloco(
        block,
      );

    const price =
      extrairPrecoAmazonDoBloco(
        block,
      );

    if (price === null) {
      continue;
    }

    const oldPrice =
      extrairPrecoAnteriorAmazonDoBloco(
        block,
      );

    results.push({
      asin,
      title,
      thumbnail,
      brand:
        extrairMarcaDoTitulo(
          title,
        ),
      extracted_price: price,
      extracted_old_price:
        oldPrice !== null &&
        oldPrice > price
          ? oldPrice
          : undefined,
      prime:
        /a-icon-prime|s-prime/i.test(
          block,
        ),
      stock: "Disponível",
      sponsored:
        /patrocinado|sponsored/i.test(
          extrairTextoHtml(
            block.slice(0, 5_000),
          ),
        ),
    });
  }

  return results;
}

export function classificarPaginaAmazon(
  html: string,
  httpStatus: number,
): AcquisitionStatus {
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
    return "BLOCKED";
  }

  if (httpStatus >= 500 && httpStatus !== 0) {
    return "ERROR";
  }

  const probe = normalizarTexto(html.slice(0, 250_000));

  if (
    probe.includes("digite os caracteres") ||
    probe.includes("enter the characters you see below") ||
    probe.includes("api services support amazon com") ||
    probe.includes("opfcaptcha") ||
    probe.includes("robot check") ||
    probe.includes("unusual traffic")
  ) {
    return "BLOCKED";
  }

  const results = extrairResultadosAmazonHtml(html);

  if (results.length > 0) {
    return "SUCCESS";
  }

  if (
    /nao encontramos|nenhum resultado|nao ha resultados|did not match any products|no results for/i.test(
      probe,
    )
  ) {
    return "EMPTY";
  }

  if (
    html.includes('data-component-type="s-search-result"') ||
    html.includes("s-main-slot")
  ) {
    return "EMPTY";
  }

  if (html.trim().length < 2_000) {
    return "UNUSABLE";
  }

  return "UNUSABLE";
}

type AmazonSourceFetch = {
  status: AcquisitionStatus;
  results: SerpApiOrganicResult[];
  error: string | null;
};

async function consultarAmazonDireta(
  query: string,
): Promise<AmazonSourceFetch> {
  const url = new URL(
    AMAZON_SEARCH_ENDPOINT,
  );

  url.searchParams.set(
    "k",
    query,
  );

  url.searchParams.set(
    "ref",
    "nb_sb_noss",
  );

  const tag =
    process.env.AMAZON_ASSOCIATE_TAG?.trim() ||
    "ofertano-20";

  url.searchParams.set(
    "tag",
    tag,
  );

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    18_000,
  );

  try {
    const response = await abortableFetch(url, {
      method: "GET",
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language":
          "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer:
          "https://www.amazon.com.br/",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    const html =
      await response.text();

    const pageStatus = classificarPaginaAmazon(
      html,
      response.status,
    );

    if (pageStatus === "BLOCKED") {
      return {
        status: "BLOCKED",
        results: [],
        error:
          `Amazon bloqueou temporariamente a busca HTML automatizada. HTTP ${response.status}.`,
      };
    }

    if (!response.ok && pageStatus !== "SUCCESS") {
      return {
        status: classificarMensagemAquisicao(
          `HTTP ${response.status}`,
          response.status,
        ),
        results: [],
        error: `Amazon busca direta respondeu HTTP ${response.status}.`,
      };
    }

    const results = extrairResultadosAmazonHtml(html);

    return {
      status: results.length > 0 ? "SUCCESS" : pageStatus === "UNUSABLE" ? "UNUSABLE" : "EMPTY",
      results,
      error:
        pageStatus === "UNUSABLE"
          ? "Amazon HTML sem estrutura de resultados interpretavel."
          : null,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      return {
        status: "TIMEOUT",
        results: [],
        error: "TIMEOUT: a busca direta da Amazon ultrapassou 18 segundos.",
      };
    }

    const message =
      error instanceof Error
        ? error.message
        : "Erro desconhecido na busca direta da Amazon.";

    return {
      status: classificarMensagemAquisicao(message),
      results: [],
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function consultarSerpApi(
  apiKey: string,
  query: string,
): Promise<SerpApiOrganicResult[]> {
  const url = new URL(SERPAPI_ENDPOINT);

  url.searchParams.set(
    "engine",
    "amazon",
  );

  url.searchParams.set(
    "amazon_domain",
    "amazon.com.br",
  );

  url.searchParams.set(
    "language",
    "pt_BR",
  );

  url.searchParams.set(
    "shipping_location",
    "br",
  );

  url.searchParams.set(
    "device",
    "desktop",
  );

  url.searchParams.set(
    "k",
    query,
  );

  const deliveryZip =
    process.env.AMAZON_DELIVERY_ZIP
      ?.replace(/\D/g, "")
      .trim();

  if (
    deliveryZip &&
    /^\d{8}$/.test(deliveryZip)
  ) {
    url.searchParams.set(
      "delivery_zip",
      deliveryZip,
    );
  }

  url.searchParams.set(
    "api_key",
    apiKey,
  );

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    TIMEOUT_MS,
  );

  try {
    const response = await abortableFetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const payload =
      (await response
        .json()
        .catch(
          () => ({}),
        )) as SerpApiSearchResponse;

    const apiError =
      payload.error?.trim();

    if (!response.ok || apiError) {
      throw new Error(
        apiError
          ? `SerpApi respondeu HTTP ${response.status}: ${apiError}`
          : `SerpApi respondeu HTTP ${response.status}.`,
      );
    }

    const status =
      payload.search_metadata
        ?.status
        ?.trim()
        .toLowerCase();

    if (
      status &&
      status !== "success" &&
      status !== "cached"
    ) {
      throw new Error(
        `A busca da SerpApi terminou com status ${status}.`,
      );
    }

    return Array.isArray(
      payload.organic_results,
    )
      ? payload.organic_results
      : [];
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        "A busca ao vivo da Amazon ultrapassou 25 segundos.",
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function buscarAmazon(
  request: DiscoveryQuery,
): Promise<MarketplaceDiscoveryResult> {
  const query = request.query.trim();

  if (!query) {
    return montarDiscoveryResult({
      marketplace: MARKETPLACE,
      query,
      candidates: [],
      scanned: 0,
      status: "ERROR",
      error: "Informe um produto para buscar na Amazon.",
    });
  }

  const collectOnly = request.mode === "MULTILOJA";
  const limit = normalizarLimite(request.limit);
  const sourcesTried: string[] = [];
  const blockedSources: string[] = [];
  const unusableSources: string[] = [];

  const htmlFetch = await consultarAmazonDireta(query);
  sourcesTried.push("amazon-html");

  if (htmlFetch.status === "BLOCKED") {
    blockedSources.push("amazon-html");
  }

  if (htmlFetch.status === "UNUSABLE") {
    unusableSources.push("amazon-html");
  }

  const htmlCandidates = criarCandidatos(
    htmlFetch.results,
    query,
    limit,
    collectOnly,
  );

  console.log(
    "[Amazon Discovery] Busca direta:",
    JSON.stringify({
      query,
      status: htmlFetch.status,
      scanned: htmlFetch.results.length,
      candidates: htmlCandidates.length,
      asins: htmlCandidates.map((candidate) => candidate.externalId),
    }),
  );

  if (htmlCandidates.length > 0) {
    return montarDiscoveryResult({
      marketplace: MARKETPLACE,
      query,
      candidates: htmlCandidates,
      scanned: htmlFetch.results.length,
      status: "SUCCESS",
      sourcesTried,
      blockedSources,
      unusableSources,
      degraded: blockedSources.length > 0,
    });
  }

  const apiKey = process.env.SERPAPI_API_KEY?.trim();

  if (isSearchAborted() || request.signal?.aborted) {
    return montarDiscoveryResult({
      marketplace: MARKETPLACE,
      query,
      candidates: htmlCandidates,
      scanned: htmlFetch.results.length,
      status: "TIMEOUT",
      error: htmlFetch.error ?? "TIMEOUT: orcamento de busca esgotado.",
      sourcesTried,
      blockedSources,
      unusableSources,
      degraded: blockedSources.length > 0,
    });
  }

  if (!apiKey) {
    const status: AcquisitionStatus =
      htmlFetch.status === "SUCCESS" || htmlFetch.status === "EMPTY"
        ? "EMPTY"
        : htmlFetch.status;

    return montarDiscoveryResult({
      marketplace: MARKETPLACE,
      query,
      candidates: [],
      scanned: htmlFetch.results.length,
      status,
      error:
        htmlFetch.error ??
        "A busca direta da Amazon terminou sem candidatos e a SerpApi nao esta configurada como fallback.",
      sourcesTried,
      blockedSources,
      unusableSources,
      degraded: blockedSources.length > 0,
    });
  }

  sourcesTried.push("amazon-serpapi");

  try {
    const serpResults = await consultarSerpApi(apiKey, query);
    const candidates = criarCandidatos(
      serpResults,
      query,
      limit,
      collectOnly,
    );

    console.log(
      "[Amazon Discovery] Fallback SerpApi:",
      JSON.stringify({
        query,
        scanned: serpResults.length,
        candidates: candidates.length,
        asins: candidates.map((candidate) => candidate.externalId),
      }),
    );

    const status: AcquisitionStatus =
      candidates.length > 0
        ? "SUCCESS"
        : serpResults.length > 0 || htmlFetch.status === "EMPTY"
          ? "EMPTY"
          : htmlFetch.status === "BLOCKED"
            ? "BLOCKED"
            : htmlFetch.status === "UNUSABLE"
              ? "UNUSABLE"
              : "EMPTY";

    return montarDiscoveryResult({
      marketplace: MARKETPLACE,
      query,
      candidates,
      scanned: htmlFetch.results.length + serpResults.length,
      status,
      error:
        candidates.length > 0
          ? null
          : htmlFetch.error ??
            "As fontes Amazon terminaram, mas nao encontraram ofertas com ASIN, preco, imagem e identidade compativeis.",
      sourcesTried,
      blockedSources,
      unusableSources,
      degraded: blockedSources.length > 0,
    });
  } catch (error) {
    const serpError =
      error instanceof Error
        ? error.message
        : "Erro desconhecido na descoberta da Amazon.";

    console.warn(
      "[Amazon Discovery] Fallback SerpApi indisponivel:",
      serpError,
    );

    const serpStatus = classificarMensagemAquisicao(serpError);
    if (serpStatus === "BLOCKED") {
      blockedSources.push("amazon-serpapi");
    }
    if (serpStatus === "UNUSABLE") {
      unusableSources.push("amazon-serpapi");
    }

    const status: AcquisitionStatus =
      htmlFetch.status === "BLOCKED" || serpStatus === "BLOCKED"
        ? "BLOCKED"
        : serpStatus === "TIMEOUT"
          ? "TIMEOUT"
          : htmlFetch.status === "EMPTY"
            ? serpStatus
            : htmlFetch.status;

    return montarDiscoveryResult({
      marketplace: MARKETPLACE,
      query,
      candidates: [],
      scanned: htmlFetch.results.length,
      status,
      error: [htmlFetch.error, serpError].filter(Boolean).join(" | ").slice(0, 1000),
      sourcesTried,
      blockedSources,
      unusableSources,
      degraded: blockedSources.length > 0,
    });
  }
}
