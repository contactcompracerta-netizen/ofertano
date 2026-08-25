import { abortableFetch, isSearchAborted } from "@/lib/searchAbort";
import { traceMultiloja } from "@/services/multiloja/trace";
import { buildMarketplaceQueryVariants } from "@/services/multistore-v2/queryPlan";
import { extractMercadoLivreIdentitiesFromUrl, normalizeListingId } from "./mercadolivreIds";

import {
  anuncioPublicoEstaCompleto,
  type MercadoLivreListingItem,
  type MercadoLivreSourceFetch,
  type MercadoLivreSourceStatus,
} from "./mercadolivrePublicSearch";

function parsePrice(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (/^\d+[.,]\d{1,2}$/.test(trimmed)) {
      const parsed = Number(trimmed.replace(",", "."));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    const normalized = trimmed.includes(",")
      ? trimmed.replace(/\./g, "").replace(",", ".")
      : trimmed.replace(/[^\d.]/g, "");
    const parsed = Number(normalized.replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeItemId(raw: string | undefined): string | null {
  return normalizeListingId(raw ?? "");
}

export function mesclarItemParcial(
  base: MercadoLivreListingItem,
  extra: Partial<MercadoLivreListingItem> | null | undefined,
): MercadoLivreListingItem {
  const merged: MercadoLivreListingItem = { ...base };
  if (!extra) {
    return merged;
  }

  if (extra.id && !merged.id) {
    merged.id = extra.id;
  }
  if (extra.title?.trim() && !merged.title?.trim()) {
    merged.title = extra.title.trim();
  }
  if (
    typeof extra.price === "number" &&
    extra.price > 0 &&
    !(typeof merged.price === "number" && merged.price > 0)
  ) {
    merged.price = extra.price;
  }
  if (extra.permalink?.trim() && !merged.permalink?.trim()) {
    merged.permalink = extra.permalink.trim();
  }
  if (extra.thumbnail?.trim() && !merged.thumbnail?.trim()) {
    merged.thumbnail = extra.thumbnail.trim();
  }
  if (extra.condition?.trim() && !merged.condition?.trim()) {
    merged.condition = extra.condition.trim();
  }
  if (extra.currency_id?.trim() && !merged.currency_id?.trim()) {
    merged.currency_id = extra.currency_id.trim();
  }
  return merged;
}

export function gerarVariantesDeConsultaPublica(query: string): string[] {
  const original = query.replace(/\s+/g, " ").trim();
  if (!original) {
    return [];
  }

  const planned = buildMarketplaceQueryVariants(original);
  return Array.from(new Set([original, ...planned])).slice(0, 6);
}

export function rastrearAquisicaoMercadoLivre(
  fields: Record<string, unknown>,
): void {
  traceMultiloja("ml-acquisition", fields);
}

export function rastrearResumoAquisicaoMercadoLivre(
  fields: Record<string, unknown>,
): void {
  traceMultiloja("ml-acquisition-summary", fields);
}

function extractMeta(html: string, property: string): string {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  return (html.match(pattern)?.[1] ?? html.match(alt)?.[1] ?? "").trim();
}

export function extrairProdutoDaPaginaPublica(
  html: string,
  fallback: Partial<MercadoLivreListingItem> = {},
): MercadoLivreListingItem | null {
  let item: MercadoLivreListingItem = { ...fallback };

  const jsonLdBlocks = Array.from(
    html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  );

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
        if (!type.includes("Product")) {
          continue;
        }
        const offers = record.offers as Record<string, unknown> | undefined;
        const url = String(record.url ?? "");
        const sku = String(record.sku ?? record.productID ?? "");
        const image =
          typeof record.image === "string"
            ? record.image
            : Array.isArray(record.image)
              ? String(record.image[0] ?? "")
              : "";
        item = mesclarItemParcial(item, {
          id:
            extractMercadoLivreIdentitiesFromUrl(url).listingIds[0] ??
            normalizeItemId(sku) ??
            normalizeItemId(url) ??
            undefined,
          title: String(record.name ?? "").trim() || undefined,
          price: parsePrice(offers?.price),
          permalink: url || undefined,
          thumbnail: image || undefined,
          status: String(offers?.availability ?? ""),
        });
      }
    } catch {
      continue;
    }
  }

  const canonical =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
    extractMeta(html, "og:url");
  const ogTitle = extractMeta(html, "og:title");
  const ogImage = extractMeta(html, "og:image");
  const ogPrice =
    extractMeta(html, "product:price:amount") ||
    extractMeta(html, "og:price:amount");
  const fraction = html.match(
    /andes-money-amount__fraction[^>]*>([^<]+)/i,
  )?.[1];
  const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  item = mesclarItemParcial(item, {
    id:
      extractMercadoLivreIdentitiesFromUrl(canonical).listingIds[0] ??
      normalizeItemId(canonical) ??
      extractMercadoLivreIdentitiesFromUrl(html.match(/\bhttps?:\/\/[^\s"'<>]+/i)?.[0] ?? "").listingIds[0] ??
      normalizeItemId(html.match(/\bMLB(?!U)-?(\d{8,})\b/i)?.[0]) ??
      undefined,
    title: ogTitle || pageTitle?.replace(/\s+/g, " ").trim() || undefined,
    price: parsePrice(ogPrice) ?? parsePrice(fraction),
    permalink: canonical || undefined,
    thumbnail: ogImage || undefined,
  });

  if (!item.id && !item.permalink && !item.title) {
    return null;
  }

  if (item.id && !item.permalink) {
    item.permalink = `https://produto.mercadolivre.com.br/MLB-${item.id.replace("MLB", "")}`;
  }

  return item;
}

function classifyListingPage(
  html: string,
  httpStatus: number,
): MercadoLivreSourceStatus {
  if (httpStatus === 401 || httpStatus === 403) {
    return "BLOCKED";
  }
  if (!httpStatus || httpStatus >= 400) {
    return "ERROR";
  }
  const probe = html
    .slice(0, 80_000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    /captcha|challenge-running|cf-challenge|verifique que voce e humano/.test(
      probe,
    )
  ) {
    return "BLOCKED";
  }
  return "SUCCESS";
}

async function fetchHtml(url: string): Promise<{
  status: number;
  html: string;
  finalUrl: string;
  contentType: string;
}> {
  const response = await abortableFetch(url, {
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

export function urlPublicaDoAnuncio(
  item: Partial<MercadoLivreListingItem>,
): string | null {
  const permalink = item.permalink?.trim();
  if (permalink && /^https?:\/\//i.test(permalink)) {
    return permalink;
  }
  const id = normalizeItemId(item.id);
  if (!id) {
    return null;
  }
  return `https://produto.mercadolivre.com.br/MLB-${id.replace("MLB", "")}`;
}

export async function buscarPaginaPublicaDoAnuncio(
  item: Partial<MercadoLivreListingItem>,
): Promise<MercadoLivreSourceFetch<MercadoLivreListingItem | null>> {
  const requestedUrl = urlPublicaDoAnuncio(item);
  if (!requestedUrl) {
    return {
      status: "EMPTY",
      httpStatus: null,
      data: null,
      reason: "Anuncio parcial sem URL ou MLB ID.",
    };
  }

  try {
    const fetched = await fetchHtml(requestedUrl);
    const status = classifyListingPage(fetched.html, fetched.status);
    const extracted =
      status === "BLOCKED"
        ? null
        : extrairProdutoDaPaginaPublica(fetched.html, item);

    rastrearAquisicaoMercadoLivre({
      query: item.title ?? item.id ?? "",
      source: "public-item-page",
      requestedUrl,
      finalUrl: fetched.finalUrl,
      httpStatus: fetched.status,
      contentType: fetched.contentType,
      bodyLength: fetched.html.length,
      pageTitle: fetched.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ?.replace(/\s+/g, " ")
        .trim()
        .slice(0, 180),
      idsFound: extracted?.id ? 1 : 0,
      cardsFound: 0,
      jsonLdFound: /application\/ld\+json/i.test(fetched.html) ? 1 : 0,
      embeddedStateFound: /__PRELOADED_STATE__|__INITIAL_STATE__/i.test(
        fetched.html,
      )
        ? 1
        : 0,
      usableCandidates: extracted && anuncioPublicoEstaCompleto(extracted) ? 1 : 0,
      status,
      reason: status === "BLOCKED" ? "Pagina publica do anuncio bloqueada." : "",
    });

    return {
      status,
      httpStatus: fetched.status,
      data: extracted,
      reason:
        status === "BLOCKED"
          ? "Pagina publica do anuncio bloqueada."
          : extracted
            ? undefined
            : "Pagina publica do anuncio sem dados reconheciveis.",
    };
  } catch (error) {
    return {
      status: "ERROR",
      httpStatus: null,
      data: null,
      reason:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Falha ao buscar pagina publica do anuncio.",
    };
  }
}

export async function hidratarItensComPaginaPublica(
  items: MercadoLivreListingItem[],
  hydrateOne?: (
    item: MercadoLivreListingItem,
  ) => Promise<MercadoLivreListingItem | null>,
  limit = 8,
): Promise<{
  items: MercadoLivreListingItem[];
  pagesFetched: number;
  blockedPages: number;
}> {
  const next = items.map((item) => ({ ...item }));
  let pagesFetched = 0;
  let blockedPages = 0;

  for (const item of next) {
    if (isSearchAborted()) {
      break;
    }
    if (anuncioPublicoEstaCompleto(item)) {
      continue;
    }
    if (!item.id && !item.permalink) {
      continue;
    }
    if (pagesFetched >= limit) {
      break;
    }

    pagesFetched += 1;
    try {
      const page = hydrateOne
        ? { status: "SUCCESS" as const, data: await hydrateOne(item) }
        : await buscarPaginaPublicaDoAnuncio(item);
      if (page.status === "BLOCKED") {
        blockedPages += 1;
      }
      if (page.data) {
        const merged = mesclarItemParcial(item, page.data);
        item.id = merged.id;
        item.title = merged.title;
        item.price = merged.price;
        item.permalink = merged.permalink;
        item.thumbnail = merged.thumbnail;
        item.condition = merged.condition;
        item.currency_id = merged.currency_id;
        item.status = merged.status;
      }
    } catch {
      // Mantem o parcial. Hidratacao falha nao apaga ID/URL.
    }
  }

  return { items: next, pagesFetched, blockedPages };
}
