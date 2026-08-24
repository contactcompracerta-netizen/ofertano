import * as cheerio from "cheerio";

import { traceMultiloja } from "@/services/multiloja/trace";

export type MercadoLivreListingItem = {
  id?: string;
  title?: string;
  price?: number;
  original_price?: number | null;
  permalink?: string;
  thumbnail?: string;
  condition?: string;
  currency_id?: string;
  category_id?: string;
  available_quantity?: number;
  status?: string;
  seller?: {
    id?: number;
    nickname?: string;
  };
  attributes?: Array<{
    id?: string;
    name?: string;
    value_name?: string;
  }>;
  tags?: string[];
  shipping?: {
    logistic_type?: string;
    tags?: string[];
  };
};

export type MercadoLivreSourceStatus =
  | "SUCCESS"
  | "EMPTY"
  | "BLOCKED"
  | "UNUSABLE"
  | "ERROR";

export type PublicSearchPageDiagnostics = {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  contentType: string;
  bodyLength: number;
  pageTitle: string;
  containsMlbItemIds: boolean;
  containsProductLinks: boolean;
  containsJsonLd: boolean;
  containsStructuredState: boolean;
  challengeDetected: boolean;
  loginDetected: boolean;
  noResultsDetected: boolean;
  parserStrategy: string;
  extractedIdsCount: number;
};

export type MercadoLivreSourceFetch<T> = {
  status: MercadoLivreSourceStatus;
  httpStatus: number | null;
  data: T;
  reason?: string;
  diagnostics?: PublicSearchPageDiagnostics;
  catalogIds?: string[];
};

export type PublicSearchStrategyId = "public-search-lista" | "public-search-jm";

const ITEM_ID_PATTERN = /\bMLB-?(\d{8,})\b/gi;
const PRODUCT_URL_PATTERN =
  /https?:\/\/(?:www\.)?produto\.mercadolivre\.com\.br\/MLB-(\d+)/gi;
const ITEM_PATH_PATTERN =
  /https?:\/\/(?:www\.)?mercadolivre\.com\.br\/[^"'\\\s]*MLB-(\d+)/gi;
const CATALOG_PATH_PATTERN = /\/p\/MLB-?(\d{8,})/gi;
const WID_ITEM_PATTERN = /[?&#]wid=MLB-?(\d{8,})/gi;

const CHALLENGE_MARKERS = [
  "captcha",
  "recaptcha",
  "challenge-running",
  "cf-browser-verification",
  "cf-challenge",
  "akamai",
  "access denied",
  "pardon our interruption",
  "security check",
  "verifique que voce e humano",
  "um momento",
];

const LOGIN_MARKERS = [
  "/jms/lgz",
  "entre na sua conta",
  "iniciar sesion",
  "login.mercadolivre",
  "form-login",
];

const NO_RESULTS_MARKERS = [
  "nao encontramos resultados",
  "nao ha anuncios",
  "nao ha publicacoes",
  "sua busca nao encontrou",
  "nenhum resultado",
  "no hay publicaciones",
  "no encontramos resultados",
];

const SEARCH_PAGE_MARKERS = [
  "ui-search",
  "poly-card",
  "ui-search-result",
  "andes-pagination",
  "ui-search-layout",
  "search-results",
  "itemlist",
];

function normalizeItemId(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");

  if (digits.length < 8) {
    return null;
  }

  return `MLB${digits}`;
}

function registerItem(
  items: Map<string, MercadoLivreListingItem>,
  rawId: string,
  extra: Partial<MercadoLivreListingItem> = {},
): void {
  const id = normalizeItemId(rawId);

  if (!id) {
    return;
  }

  const current = items.get(id) ?? { id };
  const next: MercadoLivreListingItem = {
    ...current,
    id,
  };

  if (extra.title?.trim()) {
    next.title = extra.title.trim();
  }
  if (typeof extra.price === "number" && extra.price > 0) {
    next.price = extra.price;
  }
  if (extra.permalink?.trim()) {
    next.permalink = extra.permalink.trim();
  }
  if (extra.thumbnail?.trim()) {
    next.thumbnail = extra.thumbnail.trim();
  }
  if (extra.condition?.trim()) {
    next.condition = extra.condition.trim();
  }
  if (extra.currency_id?.trim()) {
    next.currency_id = extra.currency_id.trim();
  }
  if (extra.status?.trim()) {
    next.status = extra.status.trim();
  }

  if (!next.permalink) {
    next.permalink = `https://produto.mercadolivre.com.br/MLB-${id.replace("MLB", "")}`;
  }

  items.set(id, next);
}

function decodeJsonString(value: string): string {
  return value
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .trim();
}

function parsePrice(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(
      value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""),
    );

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function looksLikeCatalogOnlyContext(around: string, itemId?: string): boolean {
  if (!/\/p\//i.test(around)) {
    return false;
  }

  if (/produto\.mercadolivre/i.test(around)) {
    return false;
  }

  if (/\bwid=/i.test(around)) {
    return false;
  }

  if (itemId) {
    const digits = itemId.replace(/\D/g, "");
    return new RegExp(`/p/MLB-?${digits}\\b`, "i").test(around);
  }

  return true;
}

function extractFromJsonLd(
  html: string,
  items: Map<string, MercadoLivreListingItem>,
): boolean {
  const jsonLdBlocks = Array.from(
    html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  );

  let used = false;

  for (const block of jsonLdBlocks) {
    const raw = block[1]?.trim();
    if (!raw) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];

      for (const node of nodes) {
        if (!node || typeof node !== "object") {
          continue;
        }

        const record = node as Record<string, unknown>;
        const type = String(record["@type"] ?? "");

        if (type.includes("ItemList")) {
          const elements = Array.isArray(record.itemListElement)
            ? record.itemListElement
            : [];

          for (const element of elements) {
            if (!element || typeof element !== "object") {
              continue;
            }

            const listItem = element as Record<string, unknown>;
            const product =
              listItem.item && typeof listItem.item === "object"
                ? (listItem.item as Record<string, unknown>)
                : listItem;
            const url = String(product.url ?? listItem.url ?? "");
            const sku = String(product.sku ?? product.productID ?? "");
            const idMatch =
              url.match(/MLB-?(\d{8,})/i) ??
              sku.match(/MLB-?(\d{8,})/i);

            if (!idMatch?.[1]) {
              continue;
            }

            const offers = product.offers as Record<string, unknown> | undefined;
            used = true;
            registerItem(items, idMatch[1], {
              title: String(product.name ?? "").trim() || undefined,
              price: parsePrice(offers?.price),
              permalink: url || undefined,
              status: String(offers?.availability ?? ""),
            });
          }
        }

        if (type.includes("Product")) {
          const url = String(record.url ?? "");
          const sku = String(record.sku ?? record.productID ?? "");
          const idMatch =
            url.match(/MLB-?(\d{8,})/i) ??
            sku.match(/MLB-?(\d{8,})/i);

          if (!idMatch?.[1]) {
            continue;
          }

          const offers = record.offers as Record<string, unknown> | undefined;
          used = true;
          registerItem(items, idMatch[1], {
            title: String(record.name ?? "").trim() || undefined,
            price: parsePrice(offers?.price),
            permalink: url || undefined,
            status: String(offers?.availability ?? ""),
          });
        }
      }
    } catch {
      continue;
    }
  }

  return used;
}

function walkForListings(
  value: unknown,
  items: Map<string, MercadoLivreListingItem>,
  depth = 0,
): boolean {
  if (depth > 8 || value == null) {
    return false;
  }

  let found = false;

  if (Array.isArray(value)) {
    for (const entry of value) {
      found = walkForListings(entry, items, depth + 1) || found;
    }
    return found;
  }

  if (typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const rawId = String(record.id ?? record.item_id ?? record.itemId ?? "");
  const id = /MLB-?\d{8,}/i.test(rawId) ? normalizeItemId(rawId) : null;

  if (id) {
    const title = String(record.title ?? record.name ?? "").trim();
    const permalink = String(
      record.permalink ?? record.url ?? record.permalink_url ?? "",
    );
    const price = parsePrice(
      record.price ??
        (record.price as { amount?: unknown } | undefined)?.amount ??
        record.amount,
    );

    registerItem(items, id, {
      title: title || undefined,
      permalink: permalink || undefined,
      price,
      available_quantity: parsePrice(record.available_quantity),
      status: String(record.status ?? ""),
    });
    found = true;
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      found = walkForListings(nested, items, depth + 1) || found;
    }
  }

  return found;
}

function extractFromEmbeddedState(
  html: string,
  items: Map<string, MercadoLivreListingItem>,
): boolean {
  const assignments = Array.from(
    html.matchAll(
      /(?:window\.__PRELOADED_STATE__|window\.__INITIAL_STATE__|window\.__PRELOADED_STATE_FN__)\s*=\s*(\{[\s\S]*?\});/g,
    ),
  );

  let used = false;

  for (const assignment of assignments) {
    const raw = assignment[1];
    if (!raw) {
      continue;
    }

    try {
      used = walkForListings(JSON.parse(raw), items) || used;
    } catch {
      continue;
    }
  }

  const inlineResults = Array.from(
    html.matchAll(
      /"id"\s*:\s*"(MLB-?\d+)"\s*,\s*"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g,
    ),
  );

  for (const match of inlineResults) {
    const rawId = match[1];
    const title = match[2] ? decodeJsonString(match[2]) : "";

    if (!rawId || !title) {
      continue;
    }

    used = true;
    registerItem(items, rawId, { title });
  }

  for (const match of html.matchAll(
    /"id"\s*:\s*"(MLB-?\d+)"[\s\S]{0,500}?"price"\s*:\s*(\d+(?:\.\d+)?)/g,
  )) {
    const rawId = match[1];
    const price = Number(match[2]);

    if (!rawId || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    used = true;
    registerItem(items, rawId, { price });
  }

  return used;
}

function extractFromProductLinks(
  html: string,
  items: Map<string, MercadoLivreListingItem>,
): boolean {
  let used = false;

  for (const match of html.matchAll(PRODUCT_URL_PATTERN)) {
    const id = match[1];
    if (!id) {
      continue;
    }

    used = true;
    registerItem(items, id, {
      permalink: `https://produto.mercadolivre.com.br/MLB-${id}`,
    });
  }

  for (const match of html.matchAll(ITEM_PATH_PATTERN)) {
    const id = match[1];
    const around = html.slice(
      Math.max(0, (match.index ?? 0) - 24),
      (match.index ?? 0) + 80,
    );

    if (!id || looksLikeCatalogOnlyContext(around, id)) {
      continue;
    }

    used = true;
    registerItem(items, id, {
      permalink: match[0],
    });
  }

  return used;
}

function extractFromMlbAnchors(
  html: string,
  items: Map<string, MercadoLivreListingItem>,
): boolean {
  let used = false;

  for (const match of html.matchAll(ITEM_ID_PATTERN)) {
    const digits = match[1];
    if (!digits) {
      continue;
    }

    const around = html.slice(
      Math.max(0, (match.index ?? 0) - 40),
      (match.index ?? 0) + 20,
    );

    if (looksLikeCatalogOnlyContext(around, digits)) {
      continue;
    }

    used = true;
    registerItem(items, digits);
  }

  return used;
}

function extractFromHtmlSelectors(
  html: string,
  items: Map<string, MercadoLivreListingItem>,
): boolean {
  const $ = cheerio.load(html);
  let used = false;

  const cards = $(
    [
      "li.ui-search-layout__item",
      ".ui-search-result",
      ".poly-card",
      "[data-item-id]",
      "a[href*='produto.mercadolivre.com.br/MLB']",
      "a[href*='/MLB-']",
    ].join(", "),
  );

  cards.each((_, element) => {
    const node = $(element);
    const href =
      node.attr("href") ??
      node.find("a[href]").first().attr("href") ??
      "";
    const dataId =
      node.attr("data-item-id") ??
      node.attr("id") ??
      "";
    const idMatch =
      href.match(/MLB-?(\d{8,})/i) ??
      dataId.match(/MLB-?(\d{8,})/i);

    if (!idMatch?.[1] || /\/p\//i.test(href)) {
      return;
    }

    const title = (
      node.find("h2, h3, .ui-search-item__title, .poly-component__title").first().text() ||
      node.attr("title") ||
      ""
    ).trim();
    const priceText = node
      .find(".andes-money-amount__fraction, .price-tag-fraction, .poly-price__current")
      .first()
      .text();
    const image =
      node.find("img").first().attr("data-src") ||
      node.find("img").first().attr("src") ||
      "";

    used = true;
    registerItem(items, idMatch[1], {
      title: title || undefined,
      price: parsePrice(priceText),
      permalink: href || undefined,
      thumbnail: image || undefined,
    });
  });

  return used;
}

export function extrairItensDaPaginaDeBuscaPublica(
  html: string,
): MercadoLivreListingItem[] {
  return analisarPaginaDeBuscaPublica(html).items;
}

export function analisarPaginaDeBuscaPublica(html: string): {
  items: MercadoLivreListingItem[];
  parserStrategy: string;
  catalogIds: string[];
} {
  const items = new Map<string, MercadoLivreListingItem>();
  const strategies: string[] = [];
  const catalogIds = new Set<string>();

  for (const match of html.matchAll(CATALOG_PATH_PATTERN)) {
    if (match[1]) {
      catalogIds.add(`MLB${match[1]}`);
    }
  }

  for (const match of html.matchAll(WID_ITEM_PATTERN)) {
    if (match[1]) {
      registerItem(items, match[1], {});
    }
  }

  if (extractFromJsonLd(html, items)) {
    strategies.push("json-ld");
  }

  if (extractFromEmbeddedState(html, items)) {
    strategies.push("embedded-state");
  }

  if (extractFromProductLinks(html, items)) {
    strategies.push("product-links");
  }

  if (extractFromMlbAnchors(html, items)) {
    strategies.push("mlb-anchors");
  }

  if (extractFromHtmlSelectors(html, items)) {
    strategies.push("html-selectors");
  }

  return {
    items: Array.from(items.values()),
    parserStrategy: strategies.join("+") || "none",
    catalogIds: Array.from(catalogIds),
  };
}

function normalizeProbe(html: string): string {
  return html
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractPageTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim().slice(0, 180) ?? "";
}

export function diagnosticarPaginaDeBuscaPublica(
  html: string,
  extra: {
    requestedUrl: string;
    finalUrl: string;
    httpStatus: number | null;
    contentType: string;
  },
): PublicSearchPageDiagnostics {
  const probe = normalizeProbe(`${extra.finalUrl} ${html.slice(0, 80_000)}`);
  const parsed = analisarPaginaDeBuscaPublica(html);

  return {
    requestedUrl: extra.requestedUrl,
    finalUrl: extra.finalUrl,
    httpStatus: extra.httpStatus,
    contentType: extra.contentType,
    bodyLength: html.length,
    pageTitle: extractPageTitle(html),
    containsMlbItemIds: /\bMLB-?\d{8,}\b/i.test(html),
    containsProductLinks:
      /produto\.mercadolivre\.com\.br\/MLB-\d+/i.test(html) ||
      /mercadolivre\.com\.br\/[^"'\\\s]*MLB-\d+/i.test(html),
    containsJsonLd: /application\/ld\+json/i.test(html),
    containsStructuredState:
      /__PRELOADED_STATE__|__INITIAL_STATE__|"itemListElement"/i.test(html),
    challengeDetected: CHALLENGE_MARKERS.some((marker) => probe.includes(marker)),
    loginDetected: LOGIN_MARKERS.some((marker) => probe.includes(marker)),
    noResultsDetected: NO_RESULTS_MARKERS.some((marker) => probe.includes(marker)),
    parserStrategy: parsed.parserStrategy,
    extractedIdsCount: parsed.items.length,
  };
}

function classifyPublicPage(
  html: string,
  httpStatus: number,
  diagnostics: PublicSearchPageDiagnostics,
  items: MercadoLivreListingItem[],
): Pick<MercadoLivreSourceFetch<MercadoLivreListingItem[]>, "status" | "reason"> {
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      status: "BLOCKED",
      reason: `Busca publica HTML retornou ${httpStatus}.`,
    };
  }

  if (!httpStatus || httpStatus >= 400) {
    return {
      status: "ERROR",
      reason: `Busca publica HTML retornou ${httpStatus}.`,
    };
  }

  if (items.length > 0) {
    return {
      status: "SUCCESS",
      reason: "Pagina publica entregou anuncios extraidos do HTML.",
    };
  }

  if (diagnostics.challengeDetected) {
    return {
      status: "BLOCKED",
      reason: "Pagina publica com marcador de desafio/anti-bot.",
    };
  }

  if (diagnostics.loginDetected) {
    return {
      status: "BLOCKED",
      reason: "Pagina publica redirecionou para login.",
    };
  }

  const probe = normalizeProbe(html.slice(0, 80_000));
  const validSearchPage = SEARCH_PAGE_MARKERS.some((marker) =>
    probe.includes(marker),
  );

  if (diagnostics.noResultsDetected && validSearchPage) {
    return {
      status: "EMPTY",
      reason: "Pagina publica valida de busca sem resultados.",
    };
  }

  return {
    status: "UNUSABLE",
    reason: validSearchPage
      ? "Pagina publica de busca sem estrutura de anuncios reconhecivel."
      : "HTTP 200 sem pagina de busca reconhecivel.",
  };
}

export function classificarErroFonteMercadoLivre(
  error: unknown,
): Pick<MercadoLivreSourceFetch<never>, "status" | "httpStatus" | "reason"> {
  const reason =
    error instanceof Error
      ? error.message
      : String(error);

  const codes = Array.from(
    reason.matchAll(
      /(?:retornou |autenticado \(|publico \(|HTTP )(\d{3})/gi,
    ),
    (match) => Number(match[1]),
  ).filter((code) => Number.isFinite(code));

  const httpStatus = codes[codes.length - 1] ?? null;

  if (httpStatus === 401 || httpStatus === 403) {
    return {
      status: "BLOCKED",
      httpStatus,
      reason: reason.slice(0, 500),
    };
  }

  return {
    status: "ERROR",
    httpStatus,
    reason: reason.slice(0, 500),
  };
}

function slugDaConsulta(query: string): string {
  return query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function fetchHtml(url: string): Promise<{
  status: number;
  html: string;
  finalUrl: string;
  contentType: string;
}> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    },
    cache: "no-store",
    redirect: "follow",
  });

  return {
    status: response.status,
    html: await response.text(),
    finalUrl: response.url || url,
    contentType: response.headers.get("content-type") ?? "",
  };
}

function tracePublicSearchDiagnostics(
  source: PublicSearchStrategyId,
  diagnostics: PublicSearchPageDiagnostics,
  status: MercadoLivreSourceStatus,
): void {
  traceMultiloja("ml-source", {
    source,
    requestedUrl: diagnostics.requestedUrl,
    finalUrl: diagnostics.finalUrl,
    httpStatus: diagnostics.httpStatus ?? "",
    contentType: diagnostics.contentType,
    bodyLength: diagnostics.bodyLength,
    pageTitle: diagnostics.pageTitle,
    containsMlbItemIds: diagnostics.containsMlbItemIds,
    containsProductLinks: diagnostics.containsProductLinks,
    containsJsonLd: diagnostics.containsJsonLd,
    containsStructuredState: diagnostics.containsStructuredState,
    challengeDetected: diagnostics.challengeDetected,
    loginDetected: diagnostics.loginDetected,
    noResultsDetected: diagnostics.noResultsDetected,
    parserStrategy: diagnostics.parserStrategy,
    extractedIdsCount: diagnostics.extractedIdsCount,
    status,
  });
}

export async function buscarEstrategiaPublicaMercadoLivre(
  query: string,
  strategy: PublicSearchStrategyId,
): Promise<MercadoLivreSourceFetch<MercadoLivreListingItem[]>> {
  const slug = slugDaConsulta(query);

  if (!slug) {
    return {
      status: "EMPTY",
      httpStatus: null,
      data: [],
      reason: "Consulta sem slug publico.",
    };
  }

  const requestedUrl =
    strategy === "public-search-lista"
      ? `https://lista.mercadolivre.com.br/${encodeURIComponent(slug)}`
      : `https://www.mercadolivre.com.br/jm/search?as_word=${encodeURIComponent(query)}`;

  try {
    const fetched = await fetchHtml(requestedUrl);
    const parsed = analisarPaginaDeBuscaPublica(fetched.html);
    const diagnostics = diagnosticarPaginaDeBuscaPublica(fetched.html, {
      requestedUrl,
      finalUrl: fetched.finalUrl,
      httpStatus: fetched.status,
      contentType: fetched.contentType,
    });
    diagnostics.parserStrategy = parsed.parserStrategy;
    diagnostics.extractedIdsCount = parsed.items.length;

    const classified = classifyPublicPage(
      fetched.html,
      fetched.status,
      diagnostics,
      parsed.items,
    );

    tracePublicSearchDiagnostics(strategy, diagnostics, classified.status);

    return {
      status: classified.status,
      httpStatus: fetched.status,
      data: parsed.items,
      reason: classified.reason,
      diagnostics,
      catalogIds: parsed.catalogIds,
    };
  } catch (error) {
    const classified = classificarErroFonteMercadoLivre(error);
    return {
      ...classified,
      data: [],
    };
  }
}

export async function buscarPaginaPublicaMercadoLivre(
  query: string,
): Promise<MercadoLivreSourceFetch<MercadoLivreListingItem[]>> {
  const lista = await buscarEstrategiaPublicaMercadoLivre(
    query,
    "public-search-lista",
  );
  const jm = await buscarEstrategiaPublicaMercadoLivre(
    query,
    "public-search-jm",
  );

  const merged = new Map<string, MercadoLivreListingItem>();

  for (const item of [...lista.data, ...jm.data]) {
    if (item.id) {
      merged.set(item.id, {
        ...merged.get(item.id),
        ...item,
      });
    }
  }

  const data = Array.from(merged.values());

  if (data.length > 0) {
    return {
      status: "SUCCESS",
      httpStatus: lista.httpStatus ?? jm.httpStatus,
      data,
      catalogIds: Array.from(
        new Set([...(lista.catalogIds ?? []), ...(jm.catalogIds ?? [])]),
      ),
    };
  }

  const preferred =
    lista.status === "EMPTY" || jm.status === "EMPTY"
      ? lista.status === "EMPTY"
        ? lista
        : jm
      : lista.status === "BLOCKED" || jm.status === "BLOCKED"
        ? lista.status === "BLOCKED"
          ? lista
          : jm
        : lista.status === "UNUSABLE"
          ? lista
          : jm;

  return {
    ...preferred,
    data: [],
  };
}

export function avaliarStatusDaPaginaPublica(
  html: string,
  httpStatus: number,
  extras: {
    requestedUrl?: string;
    finalUrl?: string;
    contentType?: string;
  } = {},
): MercadoLivreSourceStatus {
  const parsed = analisarPaginaDeBuscaPublica(html);
  const diagnostics = diagnosticarPaginaDeBuscaPublica(html, {
    requestedUrl: extras.requestedUrl ?? "",
    finalUrl: extras.finalUrl ?? extras.requestedUrl ?? "",
    httpStatus,
    contentType: extras.contentType ?? "text/html",
  });

  return classifyPublicPage(
    html,
    httpStatus,
    diagnostics,
    parsed.items,
  ).status;
}

export function anuncioPublicoEstaCompleto(
  item: MercadoLivreListingItem,
): boolean {
  const available = item.available_quantity;
  const availabilityOk =
    available == null ||
    (Number.isFinite(available) && available > 0);
  const statusOk =
    !item.status ||
    /in_?stock|active|available/i.test(item.status);

  return Boolean(
    item.id &&
      item.title?.trim() &&
      typeof item.price === "number" &&
      item.price > 0 &&
      item.permalink?.trim() &&
      availabilityOk &&
      statusOk,
  );
}
