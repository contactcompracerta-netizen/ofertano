/**
 * CATALOG ARCHITECTURE V1 — MAGALU CONNECTOR (FASE 7).
 *
 * Conector que reutiliza o scraper/parser legado (carregarPaginaMagazineLuiza +
 * parseMagazineLuiza) e mapeia para NormalizedMarketplaceListingV1.
 *
 * Capacidades:
 *   - catalog: true  (estrutura: titulo/identidade/categoria/imagem)
 *   - inventory: true (preço/disponibilidade)
 *   - seller: true   (nome do vendedor)
 *   - variants: false (Magalu nao expõe variantes estruturadas na product page)
 *   - gtin: false    (JSON-LD tem sku, mas nao EAN/GTIN confiavel)
 *   - incrementalUpdates: false
 *   - fullSnapshot: false
 *   - webhook: false
 *
 * Identidade da listing: marketplaceId + externalListingId (o codigo do produto
 * no path da URL, ex.: "kjh21gkh2e"). NUNCA URL, seller, GTIN, title.
 *
 * Affiliate link: o parser legado ja devolve o link da vitrine Magazine Você
 * (magazineofertanobr). Nao inventar, nao remover.
 */
import { carregarPaginaMagazineLuiza } from "@/services/importers/magazineluiza/api";
import { parseMagazineLuiza } from "@/services/importers/magazineluiza/parser";
import type {
  MarketplaceConnector,
  ConnectorCapabilities,
  CollectedListingBatch,
} from "@/services/architecture/v1/types/connector";
import type { NormalizedMarketplaceListingV1, InstallmentsInfoV1 } from "@/services/architecture/v1/types/normalizedListingV1";
import { UNKNOWN, NORMALIZED_LISTING_V1 } from "@/services/architecture/v1/types/normalizedListingV1";
import { computeRawHash } from "@/services/architecture/v1/hashing";

export const MAGALU_MARKETPLACE_ID = "magazine_luiza";
export const MAGALU_CONNECTOR_ID = "magalu-v1";

/** Opções de configuração do conector (para testes/canários). */
export interface MagaluConnectorOptions {
  /** Palavras-chave de busca (FASE 15: rediscovery dirigida). */
  keywords?: readonly string[];
  /** Tamanho da página (compatibilidade com interface, nao usado no Magalu). */
  pageSize?: number;
  /** Máximo de páginas (compatibilidade, nao usado no Magalu). */
  maxPages?: number;
}

/** Capacidades declaradas — so o que a fonte REALMENTE entrega. */
export const MAGALU_CAPABILITIES: ConnectorCapabilities = {
  catalog: true,
  inventory: true,
  stock: false,          // parser devolve 1 fixo, nao estoque real
  shipping: false,       // nao exposto na product page
  seller: true,          // parser extrai (mas pode vir poluido com boilerplate)
  variants: false,       // nao ha variantes estruturadas na product page
  gtin: false,           // JSON-LD tem sku, nao GTIN/EAN confiavel
  incrementalUpdates: false,
  fullSnapshot: false,
  webhook: false,
  pixPrice: false,
};

/** Payload bruto preservado por externalListingId para extracao de links. */
interface MagaluRawPayload {
  externalListingId: string;
  html: string;
  requestedUrl: string;  // affiliateLink (Magazine Você)
  finalUrl: string;      // sourceUrl (produto na vitrine)
  collectedAt: string;
}

/** Cache em memoria do payload bruto (validado por execucao do runner). */
const rawPayloadCache = new Map<string, MagaluRawPayload>();

/**
 * Extrai o codigo do produto (externalListingId) da URL da Magazine Você.
 *
 * Formatos conhecidos:
 *   /p/{codigo}/...
 *   /produto/p/{codigo}/...
 */
function extrairCodigoProduto(url: string): string | null {
  try {
    const u = new URL(url);
    const partes = u.pathname.split("/").filter(Boolean);
    const idx = partes.findIndex((p) => p === "p");
    if (idx >= 0 && idx + 1 < partes.length) {
      return partes[idx + 1];
    }
    for (const p of partes) {
      if (/^[a-z0-9]{8,12}$/i.test(p)) return p;
    }
    return null;
  } catch {
    return null;
  }
}

/** Tenta parsear string de parcelamento ("2x de R$ 59,95 sem juros") em InstallmentsInfoV1. */
function parseInstallments(raw: string | null): InstallmentsInfoV1 | null | typeof UNKNOWN {
  if (!raw?.trim()) return UNKNOWN;
  // Formatos observados: "1x de R$ 89,99", "2x de R$ 59,95 sem juros"
  const m = raw.match(/^(\d+)x\s+de\s+R\$\s*([\d.,]+)\s*(sem\s+juros)?$/i);
  if (!m) return UNKNOWN;
  const count = Number.parseInt(m[1], 10);
  const value = Number.parseFloat(m[2].replace(".", "").replace(",", "."));
  const withoutInterest = !!m[3];
  return { count, value: Number.isFinite(value) ? value : undefined, withoutInterest };
}

/**
 * Converte a oferta legada para NormalizedMarketplaceListingV1.
 */
function legacyParaNormalizado(
  legacy: ReturnType<typeof parseMagazineLuiza>,
  html: string,
): NormalizedMarketplaceListingV1 {
  const externalListingId = legacy.externalId;

  let seller = legacy.seller?.trim() ?? null;
  if (seller && seller.length > 200 && seller.includes("CNPJ")) {
    const razao = seller.match(/Razao Social\s+([^.]+)/i);
    if (razao) seller = razao[1].trim();
    else seller = "Magalu (seller nao identificado)";
  }

  const brand = legacy.brand?.trim() ?? null;
  const category = legacy.category?.trim() ?? null;
  const price = legacy.price > 0 ? legacy.price : 1;
  const oldPrice = legacy.oldPrice ?? null;
  const availability = legacy.stock !== null && legacy.stock > 0 ? "IN_STOCK" : "OUT_OF_STOCK";
  const images = legacy.images?.length ? legacy.images : (legacy.image ? [legacy.image] : []);

  return {
    contractVersion: NORMALIZED_LISTING_V1,
    source: "magalu-connector",
    marketplaceId: MAGALU_MARKETPLACE_ID,
    externalListingId,
    seller: { externalSellerId: null, name: seller },
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
      attributes: {},
      primaryImageUrl: images[0] ?? null,
    },
    variant: {
      color: UNKNOWN, storage: UNKNOWN, memory: UNKNOWN,
      voltage: UNKNOWN, size: UNKNOWN, otherAttributes: {},
    },
    commerce: {
      price,
      oldPrice,
      pixPrice: UNKNOWN,
      installments: parseInstallments(legacy.installments),
      stock: typeof legacy.stock === "number" && legacy.stock > 0 ? legacy.stock : UNKNOWN,
      availability,
      shippingHint: UNKNOWN,
      promotion: legacy.discount !== null && legacy.discount > 0 ? `${legacy.discount}%` : null,
    },
    metadata: {
      sourceUpdatedAt: null,
      collectedAt: new Date().toISOString(),
      rawHash: computeRawHash({ htmlLength: html.length, externalListingId }),
      payloadVersion: "magalu-connector/v1",
    },
  };
}

/** Conector Magalu V1 */
export class MagaluConnector implements MarketplaceConnector {
  readonly id = MAGALU_CONNECTOR_ID;
  readonly marketplaceId = MAGALU_MARKETPLACE_ID;
  readonly capabilities = MAGALU_CAPABILITIES;

  private cursor: string | null = null;
  private readonly keywords: readonly string[];
  private readonly pageSize: number;
  private readonly maxPages: number;

  constructor(options: MagaluConnectorOptions = {}) {
    this.keywords = options.keywords ?? [];
    this.pageSize = options.pageSize ?? 50;
    this.maxPages = options.maxPages ?? 5;
  }

  async collect(fromCursor?: string | null): Promise<CollectedListingBatch> {
    if (!fromCursor) {
      return { items: [], nextCursor: null, snapshotComplete: true };
    }

    try {
      const pagina = await carregarPaginaMagazineLuiza(fromCursor);
      const legacy = parseMagazineLuiza(pagina, fromCursor);
      const externalListingId = legacy.externalId;

      // Preservar payload bruto para extracao de links (rawPayloadFor)
      rawPayloadCache.set(externalListingId, {
        externalListingId,
        html: pagina.html,
        requestedUrl: pagina.requestedUrl,
        finalUrl: pagina.finalUrl,
        collectedAt: new Date().toISOString(),
      });

      const normalized = legacyParaNormalizado(legacy, pagina.html);
      return { items: [normalized], nextCursor: null, snapshotComplete: true };
    } catch (e) {
      console.warn(`[magalu-connector] collect falhou para ${fromCursor}:`, e);
      return { items: [], nextCursor: null, snapshotComplete: true };
    }
  }

  async collectIncremental?(fromCursor?: string | null): Promise<CollectedListingBatch> {
    return this.collect(fromCursor);
  }

  normalize(raw: unknown): NormalizedMarketplaceListingV1 {
    const { pagina, urlOriginal } = raw as { pagina: { html: string; requestedUrl: string; finalUrl: string }; urlOriginal: string };
    const legacy = parseMagazineLuiza(pagina, urlOriginal);
    return legacyParaNormalizado(legacy, pagina.html);
  }

  validate(listing: NormalizedMarketplaceListingV1): string[] {
    const errors: string[] = [];
    if (!listing.externalListingId?.trim()) errors.push("externalListingId vazio");
    if (!listing.catalog.title?.trim()) errors.push("title vazio");
    if (!Number.isFinite(listing.commerce.price) || listing.commerce.price <= 0) errors.push("preco invalido");
    if (!listing.seller?.name?.trim()) errors.push("seller ausente");
    return errors;
  }

  getCursor(): string | null {
    return this.cursor;
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await fetch("https://www.magazinevoce.com.br/", { method: "HEAD", signal: AbortSignal.timeout(5000) });
      return { ok: true };
    } catch {
      return { ok: false, detail: "magazinevoce.com.br inacessivel" };
    }
  }

  /**
   * Busca deterministica por externalListingId (codigo do produto).
   *
   * Reconstroi a URL da Magazine Você a partir do codigo e faz a coleta.
   * Usado pelo KNOWN_BINDING_REFRESH (FASE 9 Modelo B).
   */
  async fetchByExternalId(externalListingId: string): Promise<NormalizedMarketplaceListingV1 | null> {
    const url = `https://www.magazinevoce.com.br/magazineofertanobr/produto/p/${externalListingId}/`;
    try {
      const pagina = await carregarPaginaMagazineLuiza(url);
      const legacy = parseMagazineLuiza(pagina, url);
      const norm = legacyParaNormalizado(legacy, pagina.html);

      // Cachear payload bruto
      rawPayloadCache.set(externalListingId, {
        externalListingId,
        html: pagina.html,
        requestedUrl: pagina.requestedUrl,
        finalUrl: pagina.finalUrl,
        collectedAt: new Date().toISOString(),
      });

      return norm;
    } catch (e) {
      console.warn(`[magalu-connector] fetchByExternalId falhou para ${externalListingId}:`, e);
      return null;
    }
  }

  /**
   * Retorna o payload bruto preservado para extracao de links.
   * Chamado pelo runner via `rawPayloadReader`.
   */
  rawPayloadFor(externalListingId: string): unknown | null {
    return rawPayloadCache.get(externalListingId) ?? null;
  }
}

/** Factory para o runner */
export function createMagaluConnector(options?: MagaluConnectorOptions): MagaluConnector {
  return new MagaluConnector(options);
}
