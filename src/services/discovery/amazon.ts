/*
 * Descoberta de produtos Amazon pela busca ao vivo da SerpApi,
 * com validaÃ§Ã£o de modelo exato, acessÃ³rios e disponibilidade.
 */

import type {
  DiscoveryCandidate,
  DiscoveryQuery,
  MarketplaceDiscoveryResult,
} from "./core/types";

const ENDPOINT =
  "https://serpapi.com/search.json";

const MARKETPLACE = "AMAZON" as const;
const MARKETPLACE_NAME = "Amazon" as const;
const TIMEOUT_MS = 25_000;
const MAX_RESULTS = 20;

function criarLinkAfiliadoAmazon(
  asin: string,
): string | null {
  const tag =
    process.env.AMAZON_ASSOCIATE_TAG
      ?.trim();

  if (!tag) {
    return null;
  }

  return (
    `https://www.amazon.com.br/dp/${asin}` +
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
   * AcessÃ³rios normalmente se identificam logo no
   * comeÃ§o do tÃ­tulo: "Suporte para...", "Capa para..."
   * ou apÃ³s a marca do fabricante do acessÃ³rio.
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
   * NÃºmeros e cÃ³digos mistos normalmente identificam
   * modelo, geraÃ§Ã£o, tamanho ou versÃ£o. Todos eles
   * precisam aparecer no tÃ­tulo retornado.
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
   * Os dois primeiros termos Ãºteis formam a Ã¢ncora
   * principal do produto. Assim, "Echo Pop" nÃ£o pode
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

  return (
    result.prime === true ||
    delivery.length > 0 ||
    stock.length > 0
  );
}

function criarCandidatos(
  results: SerpApiOrganicResult[],
  query: string,
  limit: number,
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

    if (
      !title ||
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
      image === null ||
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

async function consultarSerpApi(
  apiKey: string,
  query: string,
): Promise<SerpApiOrganicResult[]> {
  const url = new URL(ENDPOINT);

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
    const response = await fetch(url, {
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
    return {
      marketplace: MARKETPLACE,
      query,
      success: false,
      candidates: [],
      scanned: 0,
      error:
        "Informe um produto para buscar na Amazon.",
    };
  }

  const apiKey =
    process.env.SERPAPI_API_KEY
      ?.trim();

  if (!apiKey) {
    return {
      marketplace: MARKETPLACE,
      query,
      success: false,
      candidates: [],
      scanned: 0,
      error:
        "A variÃ¡vel SERPAPI_API_KEY nÃ£o estÃ¡ configurada.",
    };
  }

  try {
    const results =
      await consultarSerpApi(
        apiKey,
        query,
      );

    const candidates = criarCandidatos(
      results,
      query,
      normalizarLimite(
        request.limit,
      ),
    );

    return {
      marketplace: MARKETPLACE,
      query,
      success: true,
      candidates,
      scanned: results.length,
      error:
        candidates.length > 0
          ? null
          : "A busca ao vivo terminou, mas nÃ£o encontrou ofertas Amazon com ASIN, preÃ§o, imagem e disponibilidade confirmados.",
    };
  } catch (error) {
    console.error(
      "Erro na descoberta ao vivo da Amazon:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Erro desconhecido na descoberta da Amazon.";

    return {
      marketplace: MARKETPLACE,
      query,
      success: false,
      candidates: [],
      scanned: 0,
      error: message.slice(0, 1000),
    };
  }
}
