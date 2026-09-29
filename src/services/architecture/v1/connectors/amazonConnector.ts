/**
 * CATALOG_ARCHITECTURE_V1 — AMAZON CONNECTOR (FASE 11).
 *
 * Conector que reutiliza o discovery/importer legado (buscarAmazon + carregarPaginaAmazon +
 * parseAmazonProduct) e mapeia para NormalizedMarketplaceListingV1.
 *
 * Capacidades declaradas — só o que a fonte REALMENTE entrega via SerpApi/HTML:
 *   catalog            = true   (title, brand, category, image, attributes)
 *   inventory          = true   (price, oldPrice)
 *   stock              = false  (HTML parser devolve stock fixo/indisponível, não tempo real)
 *   shipping           = false  (não exposto na product page de forma estruturada)
 *   seller             = true   (parser extrai seller name)
 *   variants           = false  (cada variante tem ASIN diferente; não há eixos estruturados)
 *   gtin               = false  (Amazon não expõe GTIN/EAN na product page pública)
 *   incrementalUpdates = false  (coleta por palavra-chave/ASIN, sem delta)
 *   fullSnapshot       = false  (busca por ranking não é snapshot confiável)
 *   webhook            = false  (polling apenas)
 *   pixPrice           = false  (específico do Brasil/ML)
 *
 * Identidade da listing: marketplaceId = "amazon", externalListingId = ASIN.
 * ASIN válido: ^[A-Z0-9]{10}$
 *
 * Affiliate link: o discovery legado já monta o link com tag (env AMAZON_ASSOCIATE_TAG
 * ou fallback "ofertano-20"). O conector PRESERVA o que a fonte devolveu — não inventa,
 * não remove.
 *
 * Dois caminhos de coleta:
 *   1. collect() — descoberta por palavra-chave via SerpApi/HTML (ranking, não determinístico)
 *   2. fetchByExternalId(ASIN) — refresh determinístico de binding certificada via product page
 */

import { buscarAmazon } from "@/services/discovery/amazon";
import type { DiscoveryQuery, DiscoveryCandidate } from "@/services/discovery/core/types";
import { carregarPaginaAmazon } from "@/services/importers/amazon/api";
import { parseAmazonProduct } from "@/services/importers/amazon/parser";
import type {
  CollectedListingBatch,
  ConnectorCapabilities,
  MarketplaceConnector,
} from "../types/connector";
import {
  NORMALIZED_LISTING_V1,
  UNKNOWN,
  type NormalizedMarketplaceListingV1,
} from "../types/normalizedListingV1";
import { computeRawHash } from "../hashing";
import { toSafeExternalUrl } from "../security/safeUrl";

export const AMAZON_MARKETPLACE_ID = "amazon";
export const AMAZON_CONNECTOR_ID = "amazon-v1";

/** Opções de configuração do conector (para testes/canários). */
export interface AmazonConnectorOptions {
  /** Palavras-chave de busca para descoberta (SerpApi/HTML). */
  keywords?: readonly string[];
  /** Limite de resultados por busca. */
  limit?: number;
  /** Agora injetável (determinismo em teste). */
  now?: () => string;
  /** Fetch injetável (testes de contrato não tocam a rede). */
  fetchImpl?: typeof fetch;
}

/** Capacidades REAIS — marcar mais que isto seria mentira operacional. */
export const AMAZON_CAPABILITIES: ConnectorCapabilities = {
  catalog: true,
  inventory: true,
  stock: false,
  shipping: false,
  seller: true,
  variants: false,
  gtin: false,
  incrementalUpdates: false,
  fullSnapshot: false,
  webhook: false,
  pixPrice: false,
};

/** Payload bruto preservado por externalListingId para extração de links. */
interface AmazonRawPayload {
  externalListingId: string;
  asin: string;
  title: string;
  price: number | null;
  oldPrice: number | null;
  image: string | null;
  brand: string | null;
  seller: string | null;
  category: string | null;
  affiliateLink: string | null;
  sourceUrl: string;
  html: string;
  collectedAt: string;
}

/** Cache em memória do payload bruto (válido por execução do runner). */
const rawPayloadCache = new Map<string, AmazonRawPayload>();

/** Cursor de descoberta por palavra-chave. */
interface AmazonDiscoveryCursor {
  keywordIndex: number;
  page: number;
}

/** Extrai ASIN de URL Amazon. */
function extrairAsinDaUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    return match?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

/** Valida formato ASIN. */
function asinValido(valor: string | null): string | null {
  if (!valor) return null;
  const asin = valor.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : null;
}

/** Normaliza preço vindo do discovery/parser. */
function normalizarPreco(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor) && valor > 0) return valor;
  if (typeof valor !== "string") return null;
  const raw = valor.replace(/[^0-9,.-]/g, "").trim();
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  const normalized = lastComma > lastDot
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Normaliza imagem para HTTPS em domínios Amazon permitidos. */
function normalizarImagem(valor: string | null): string | null {
  if (!valor) return null;
  let url = valor.trim().replace(/&/g, "&");
  if (url.startsWith("//")) url = `https:${url}`;
  if (!url.startsWith("https://") && !url.startsWith("http://")) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const ok = host === "media-amazon.com" ||
      host.endsWith(".media-amazon.com") ||
      host === "images-amazon.com" ||
      host.endsWith(".images-amazon.com") ||
      host === "ssl-images-amazon.com" ||
      host.endsWith(".ssl-images-amazon.com");
    return ok ? url : null;
  } catch {
    return null;
  }
}

/** Mapeia status de disponibilidade do discovery para AvailabilityValue. */
function mapearDisponibilidade(price: number | null, hasStockSignal: boolean): "IN_STOCK" | "OUT_OF_STOCK" | typeof UNKNOWN {
  if (price !== null && price > 0 && hasStockSignal) return "IN_STOCK";
  if (price !== null && price > 0 && !hasStockSignal) return UNKNOWN;
  return "OUT_OF_STOCK";
}

/** Converte oferta do discovery legado para NormalizedMarketplaceListingV1. */
function discoveryParaNormalizado(
  candidate: Awaited<ReturnType<typeof buscarAmazon>>["candidates"][number],
  html: string,
): NormalizedMarketplaceListingV1 {
  const asin = asinValido(candidate.externalId);
  if (!asin) throw new Error(`ASIN inválido no candidate: ${candidate.externalId}`);

  const price = normalizarPreco(candidate.price);
  const oldPrice = normalizarPreco(candidate.oldPrice);
  const image = normalizarImagem(candidate.image);
  const brand = candidate.brand?.trim() ?? null;
  const seller = candidate.seller?.trim() ?? null;
  const category = candidate.category?.trim() ?? null;
  const affiliateLink = candidate.affiliateLink?.trim() ?? null;
  const sourceUrl = candidate.sourceUrl?.trim() ?? `https://www.amazon.com.br/dp/${asin}`;

  // O discovery não expõe estoque real; usa sinal de disponibilidade do SerpApi/HTML
  const hasStockSignal = candidate.status === "FOUND";

  return {
    contractVersion: NORMALIZED_LISTING_V1,
    source: AMAZON_CONNECTOR_ID,
    marketplaceId: AMAZON_MARKETPLACE_ID,
    externalListingId: asin,
    seller: {
      externalSellerId: null,
      name: seller,
    },
    identity: {
      gtin: [],
      mpn: null,
      manufacturerModel: null,
      brand,
      model: null,
    },
    catalog: {
      title: candidate.title?.trim() ?? "",
      description: null,
      category,
      images: image ? [image] : [],
      attributes: {},
      primaryImageUrl: image,
    },
    variant: {
      color: UNKNOWN,
      storage: UNKNOWN,
      memory: UNKNOWN,
      voltage: UNKNOWN,
      size: UNKNOWN,
      otherAttributes: {},
    },
    commerce: {
      price: price ?? 1,
      oldPrice,
      pixPrice: UNKNOWN,
      installments: UNKNOWN,
      stock: UNKNOWN,
      availability: mapearDisponibilidade(price, hasStockSignal),
      shippingHint: UNKNOWN,
      promotion: oldPrice !== null && oldPrice > (price ?? 0) ? `${Math.round(((oldPrice - (price ?? 0)) / oldPrice) * 100)}%` : null,
    },
    metadata: {
      sourceUpdatedAt: null,
      collectedAt: new Date().toISOString(),
      rawHash: computeRawHash({ asin, title: candidate.title, price, htmlLength: html.length }),
      payloadVersion: "amazon-discovery/v1",
    },
  };
}

/** Converte oferta do parser de product page para NormalizedMarketplaceListingV1. */
function parserParaNormalizado(
  legacy: ReturnType<typeof parseAmazonProduct>,
  html: string,
  requestedUrl: string,
  finalUrl: string,
): NormalizedMarketplaceListingV1 {
  const asin = asinValido(legacy.asin);
  if (!asin) throw new Error(`ASIN inválido no parser: ${legacy.asin}`);

  const price = legacy.price > 0 ? legacy.price : 1;
  const oldPrice = legacy.oldPrice ?? null;
  const image = normalizarImagem(legacy.image);
  const images = legacy.images?.map(normalizarImagem).filter((v): v is string => Boolean(v)) ?? (image ? [image] : []);
  const brand = legacy.brand?.trim() ?? null;
  const seller = legacy.seller?.trim() ?? null;
  const category = legacy.category?.trim() ?? null;

  // O parser já devolve o affiliateLink montado (com tag do env/fallback)
  const affiliateLink = legacy.affiliateLink?.trim() ?? null;
  const sourceUrl = legacy.productUrl?.trim() ?? finalUrl;

  // Stock do parser: null = desconhecido, 0 = indisponível, >0 = quantidade
  const availability = legacy.stock === null ? UNKNOWN : legacy.stock > 0 ? "IN_STOCK" : "OUT_OF_STOCK";

  return {
    contractVersion: NORMALIZED_LISTING_V1,
    source: AMAZON_CONNECTOR_ID,
    marketplaceId: AMAZON_MARKETPLACE_ID,
    externalListingId: asin,
    seller: {
      externalSellerId: null,
      name: seller,
    },
    identity: {
      gtin: [],
      mpn: null,
      manufacturerModel: null,
      brand,
      model: null,
    },
    catalog: {
      title: legacy.title?.trim() ?? "",
      description: legacy.description?.trim() ?? null,
      category,
      images,
      attributes: legacy.attributes ?? {},
      primaryImageUrl: images[0] ?? null,
    },
    variant: {
      color: UNKNOWN,
      storage: UNKNOWN,
      memory: UNKNOWN,
      voltage: UNKNOWN,
      size: UNKNOWN,
      otherAttributes: {},
    },
    commerce: {
      price,
      oldPrice,
      pixPrice: UNKNOWN,
      installments: UNKNOWN,
      stock: typeof legacy.stock === "number" && legacy.stock > 0 ? legacy.stock : UNKNOWN,
      availability,
      shippingHint: UNKNOWN,
      promotion: oldPrice !== null && oldPrice > price ? `${Math.round(((oldPrice - price) / oldPrice) * 100)}%` : null,
    },
    metadata: {
      sourceUpdatedAt: null,
      collectedAt: new Date().toISOString(),
      rawHash: computeRawHash({ asin, title: legacy.title, price, htmlLength: html.length }),
      payloadVersion: "amazon-parser/v1",
    },
  };
}

/** Conector Amazon V1 */
export class AmazonMarketplaceConnector implements MarketplaceConnector {
  readonly id = AMAZON_CONNECTOR_ID;
  readonly marketplaceId = AMAZON_MARKETPLACE_ID;
  readonly capabilities = AMAZON_CAPABILITIES;

  private cursor: AmazonDiscoveryCursor | null = null;
  private readonly keywords: readonly string[];
  private readonly limit: number;
  private readonly now: () => string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AmazonConnectorOptions = {}) {
    this.keywords = options.keywords?.map((k) => k.trim()).filter((k) => k.length > 0) ?? [];
    this.limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    this.now = options.now ?? (() => new Date().toISOString());
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Coleta por palavra-chave (descoberta). Uma keyword por chamada. */
  async collect(fromCursor?: string | null): Promise<CollectedListingBatch> {
    if (this.keywords.length === 0) {
      return { items: [], nextCursor: null, snapshotComplete: true };
    }

    let position: AmazonDiscoveryCursor;
    if (!fromCursor) {
      position = { keywordIndex: 0, page: 1 };
    } else {
      try {
        position = JSON.parse(fromCursor) as AmazonDiscoveryCursor;
      } catch {
        position = { keywordIndex: 0, page: 1 };
      }
    }

    const keywordIndex = Math.min(position.keywordIndex, this.keywords.length - 1);
    const keyword = this.keywords[keywordIndex];

    const query: DiscoveryQuery = {
      query: keyword,
      normalizedQuery: keyword.toLowerCase(),
      limit: this.limit,
      mode: "DEFAULT",
    };

    const result = await buscarAmazon(query);
    const html = ""; // buscarAmazon não devolve HTML bruto; usamos string vazia para hash

    const items: NormalizedMarketplaceListingV1[] = [];
    for (const candidate of result.candidates) {
      if (candidate.status !== "FOUND") continue;
      try {
        const normalized = discoveryParaNormalizado(candidate, html);
        // Preserva payload bruto para extração de links
        rawPayloadCache.set(normalized.externalListingId, {
          externalListingId: normalized.externalListingId,
          asin: normalized.externalListingId,
          title: candidate.title,
          price: candidate.price ?? null,
          oldPrice: candidate.oldPrice ?? null,
          image: candidate.image ?? null,
          brand: candidate.brand ?? null,
          seller: candidate.seller ?? null,
          category: candidate.category ?? null,
          affiliateLink: candidate.affiliateLink ?? null,
          sourceUrl: candidate.sourceUrl ?? `https://www.amazon.com.br/dp/${normalized.externalListingId}`,
          html,
          collectedAt: normalized.metadata.collectedAt,
        });
        items.push(normalized);
      } catch (e) {
        console.warn(`[amazon-connector] falha ao normalizar candidate ${candidate.externalId}:`, e);
      }
    }

    // Próximo cursor: mesma keyword (SerpApi não pagina de forma confiável), então avança keyword
    const isLastKeyword = keywordIndex >= this.keywords.length - 1;
    let nextCursor: string | null = null;
    if (!isLastKeyword) {
      nextCursor = JSON.stringify({ keywordIndex: keywordIndex + 1, page: 1 });
    }

    this.cursor = nextCursor ? JSON.parse(nextCursor) as AmazonDiscoveryCursor : null;

    return {
      items,
      nextCursor,
      snapshotComplete: nextCursor === null,
    };
  }

  /** Coleta incremental = mesma lógica (a fonte não tem delta real). */
  async collectIncremental?(fromCursor?: string | null): Promise<CollectedListingBatch> {
    return this.collect(fromCursor);
  }

  /** Normaliza payload bruto (usado pelo runner para fetchByExternalId). */
  normalize(raw: unknown): NormalizedMarketplaceListingV1 {
    const { pagina, urlOriginal, urlFinal } = raw as {
      pagina: { $: ReturnType<typeof import("cheerio").load>; html: string };
      urlOriginal: string;
      urlFinal: string;
    };
    const legacy = parseAmazonProduct(pagina.$, urlOriginal, urlFinal);
    return parserParaNormalizado(legacy, pagina.html, urlOriginal, urlFinal);
  }

  /** Validação de payload normalizado. */
  validate(listing: NormalizedMarketplaceListingV1): string[] {
    const errors: string[] = [];
    if (!listing.externalListingId?.trim()) errors.push("externalListingId vazio");
    if (!asinValido(listing.externalListingId)) errors.push("externalListingId não é ASIN válido");
    if (!listing.catalog.title?.trim()) errors.push("title vazio");
    if (!Number.isFinite(listing.commerce.price) || listing.commerce.price <= 0) errors.push("preco invalido");
    if (!listing.seller?.name?.trim()) errors.push("seller ausente");
    return errors;
  }

  getCursor(): string | null {
    return this.cursor ? JSON.stringify(this.cursor) : null;
  }

  /** Health check: verifica se SerpApi ou HTML fetch estão configurados/acessíveis. */
  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    const hasSerpApi = Boolean(process.env.SERPAPI_API_KEY?.trim());
    if (!hasSerpApi) {
      return { ok: false, detail: "SERPAPI_API_KEY ausente" };
    }
    try {
      // Probe mínimo: busca um termo genérico
      const result = await buscarAmazon({
        query: "smartphone",
        normalizedQuery: "smartphone",
        limit: 1,
        mode: "DEFAULT",
      });
      if (result.searchOutcome === "BLOCKED") {
        return { ok: false, detail: "BLOCKED" };
      }
      return { ok: true, detail: "amazon-discovery reachable" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN";
      return { ok: false, detail: message.slice(0, 100) };
    }
  }

  /**
   * BUSCA DETERMINÍSTICA por ASIN (externalListingId).
   *
   * Carrega a product page da Amazon e usa o parser legado.
   * Usado pelo KNOWN_BINDING_REFRESH (modelo B).
   */
  async fetchByExternalId(externalListingId: string): Promise<NormalizedMarketplaceListingV1 | null> {
    const asin = asinValido(externalListingId);
    if (!asin) return null;

    const url = `https://www.amazon.com.br/dp/${asin}`;
    try {
      const pagina = await carregarPaginaAmazon(url);
      const legacy = parseAmazonProduct(pagina.$, pagina.originalUrl, pagina.finalUrl);
      const norm = parserParaNormalizado(legacy, pagina.html, pagina.originalUrl, pagina.finalUrl);

      // Cachear payload bruto para extração de links
      rawPayloadCache.set(asin, {
        externalListingId: asin,
        asin,
        title: legacy.title,
        price: legacy.price,
        oldPrice: legacy.oldPrice ?? null,
        image: legacy.image ?? null,
        brand: legacy.brand ?? null,
        seller: legacy.seller ?? null,
        category: legacy.category ?? null,
        affiliateLink: legacy.affiliateLink ?? null,
        sourceUrl: legacy.productUrl ?? `https://www.amazon.com.br/dp/${asin}`,
        html: pagina.html,
        collectedAt: norm.metadata.collectedAt,
      });

      return norm;
    } catch (e) {
      console.warn(`[amazon-connector] fetchByExternalId falhou para ${asin}:`, e);
      return null;
    }
  }

  /**
   * Retorna o payload bruto preservado para extração de links.
   * Chamado pelo runner via `rawPayloadReader`.
   */
  rawPayloadFor(externalListingId: string): unknown | null {
    return rawPayloadCache.get(externalListingId) ?? null;
  }
}

/** Factory para o runner */
export function createAmazonConnector(options?: AmazonConnectorOptions): AmazonMarketplaceConnector {
  return new AmazonMarketplaceConnector(options);
}