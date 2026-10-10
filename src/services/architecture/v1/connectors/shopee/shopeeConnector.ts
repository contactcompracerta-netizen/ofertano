/**
 * CATALOG_ARCHITECTURE_V1 — SEGUNDO MARKETPLACE REAL (FASE 8).
 *
 * CONECTOR UNIVERSAL para a Shopee (API oficial de afiliados).
 *
 * Este arquivo e um CONECTOR, nao core. Ele:
 *   - fala com a fonte autorizada (GraphQL oficial de afiliados);
 *   - mapeia o payload real para NormalizedMarketplaceListingV1;
 *   - declara SO as capacidades que a fonte realmente expõe.
 *
 * O nucleo do catalogo nao muda: marketplaceId entra como STRING e o
 * marketplace e registrado no registry (marketplaceRegistry.ts).
 *
 * CAPACIDADES DECLARADAS (FASE E) — derivadas do que a API de afiliados
 * realmente retorna no payload `productOfferV2`:
 *   catalog            = true   (productName, productCatIds, imageUrl, shopName)
 *   inventory          = true   (price, priceMin, priceMax, priceDiscountRate)
 *   stock              = FALSE  — a API de afiliados NAO devolve estoque
 *   shipping           = FALSE  — nao devolve frete/peso
 *   seller             = true   (shopId, shopName)
 *   variants           = FALSE  — productOfferV2 nao expoe eixos de variacao
 *   gtin               = FALSE  — nao expoe GTIN/EAN/UPC
 *   incrementalUpdates = FALSE  — GraphQL e por palavra-chave, sem delta
 *   fullSnapshot       = true   (pagina por scrollId ate o fim)
 *   webhook            = FALSE  — consulta por polling
 *   pixPrice           = FALSE  — preco PIX e especifico do Brasil/ML
 *
 * Regra de ausencia: o que a fonte nao devolve permanece UNKNOWN/NULL.
 * NUNCA inventamos GTIN, estoque, variante ou preco PIX que a fonte nao deu.
 */

import { createHash } from "node:crypto";
import type {
  CollectedListingBatch,
  ConnectorCapabilities,
  MarketplaceConnector,
} from "../../types/connector";
import {
  NORMALIZED_LISTING_V1,
  UNKNOWN,
  type AvailabilityValue,
  type NormalizedMarketplaceListingV1,
} from "../../types/normalizedListingV1";
import { computeRawHash } from "../../hashing";
import { toSafeExternalUrl } from "../../security/safeUrl";

/** Identificador canonico do marketplace (identidade interna estavel). */
export const SHOPEE_MARKETPLACE_ID = "shopee";

/** Endpoint oficial de afiliados. Somente GraphQL publico documentado. */
const SHOPEE_AFFILIATE_GRAPHQL_ENDPOINT =
  "https://open-api.affiliate.shopee.com.br/graphql";

const REQUEST_TIMEOUT_MS = 20_000;

/** Payload cru de um no `productOfferV2` da Shopee. */
export interface ShopeeOfferNodeV1 {
  itemId: number | string;
  shopId: number | string;
  productName: string;
  shopName?: string | null;
  price: number | string;
  priceMin?: number | string;
  priceMax?: number | string;
  imageUrl?: string | null;
  productLink?: string | null;
  offerLink?: string | null;
  ratingStar?: number | string | null;
  sales?: number | string | null;
  priceDiscountRate?: number | string | null;
  productCatIds?: number[] | string | null;
  periodStartTime?: number | null;
  periodEndTime?: number | null;
}

type ShopeeGraphqlResponse = {
  data?: {
    productOfferV2?: {
      nodes?: ShopeeOfferNodeV1[] | null;
      pageInfo?: {
        page?: number;
        limit?: number;
        hasNextPage?: boolean;
        scrollId?: string | null;
      } | null;
    } | null;
  } | null;
  errors?: Array<{
    message?: string;
    extensions?: { code?: number | string; message?: string };
  }>;
};

function trimmed(value: string | undefined | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/**
 * Converte um numero da Shopee (string decimal com ponto) em number.
 * Retorna null quando ausente/invalido — nunca 0 inventado.
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    if (normalized === "") return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/** Categoria da Shopee: a fonte entrega ids, nao nome legivel. */
function normalizeCategoryIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((id) => String(id ?? "").trim())
      .filter((id) => id.length > 0);
  }
  const single = trimmed(typeof value === "string" ? value : null);
  return single ? [single] : [];
}

/**
 * Disponibilidade: a Shopee nao expõe estoque. O preco}>0 + oferta presente
 * significa "aquisivel agora"; a ausencia de estoque e registrada como
 * UNKNOWN (capacidade stock=false), nunca como 0.
 */
function availabilityFromOffer(price: number | null): AvailabilityValue {
  return price !== null && price > 0 ? "IN_STOCK" : UNKNOWN;
}

export interface ShopeeConnectorOptions {
  /** palavras-chave usadas na coleta (a fonte e orientada a busca). */
  keywords: string[];
  /** limite de itens por pagina (a fonte aceita ate 50). */
  pageSize?: number;
  /** teto de paginas por execucao, como guarda de canario. */
  maxPages?: number;
  /** agora injetavel (determinismo em teste). */
  now?: () => string;
  /** fetch injetavel (testes de contrato nao tocam a rede). */
  fetchImpl?: typeof fetch;
}

/** Erro de coleta da fonte, com detalhe sanitizado (nunca credencial). */
export class ShopeeConnectorError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ShopeeConnectorError";
  }
}

function readCredentials(): { appId: string; secret: string } {
  const appId = trimmed(process.env.SHOPEE_AFFILIATE_APP_ID);
  const secret = trimmed(process.env.SHOPEE_AFFILIATE_SECRET);
  if (!appId) {
    throw new ShopeeConnectorError(
      "CREDENTIALS_MISSING",
      "SHOPEE_AFFILIATE_APP_ID nao foi configurado.",
    );
  }
  if (!secret) {
    throw new ShopeeConnectorError(
      "CREDENTIALS_MISSING",
      "SHOPEE_AFFILIATE_SECRET nao foi configurado.",
    );
  }
  return { appId, secret };
}

/**
 * Autorizacao SHA256 da Shopee: SHA256(appId + timestamp + payload + secret).
 * A assinatura NUNCA e logada nem devolvida por healthCheck.
 */
function buildAuthorization(payload: string): string {
  const { appId, secret } = readCredentials();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHash("sha256")
    .update(`${appId}${timestamp}${payload}${secret}`, "utf8")
    .digest("hex");
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

export class ShopeeMarketplaceConnector implements MarketplaceConnector {
  readonly id = "shopee-affiliate";
  readonly marketplaceId = SHOPEE_MARKETPLACE_ID;

  /**
   * Capacidades REAIS da API de afiliados (ver header deste arquivo).
   * Marcar mais que isto seria mentira operacional.
   */
  readonly capabilities: ConnectorCapabilities = {
    catalog: true,
    inventory: true,
    stock: false,
    shipping: false,
    seller: true,
    variants: false,
    gtin: false,
    incrementalUpdates: false,
    fullSnapshot: true,
    webhook: false,
    pixPrice: false,
  };

  private readonly keywords: string[];
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly now: () => string;
  private readonly fetchImpl: typeof fetch;
  private cursor: string | null = null;
  /*
   * FASE N (provenance) / FASE P (replay): o payload BRUTO que a fonte
   * devolveu, por externalListingId. Sem isso, um replay so teria a listing
   * ja normalizada e nao conseguiria re-normalizar pela fonte — que e
   * exatamente o que o replay precisa provar.
   */
  private readonly rawByExternalId = new Map<string, unknown>();

  constructor(options: ShopeeConnectorOptions) {
    this.keywords = options.keywords
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0);
    this.pageSize = clamp(options.pageSize ?? 20, 1, 50);
    this.maxPages = Math.max(1, options.maxPages ?? 1);
    this.now = options.now ?? (() => new Date().toISOString());
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async executeGraphql(
    query: string,
  ): Promise<ShopeeGraphqlResponse> {
    const payload = JSON.stringify({ query });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(
        SHOPEE_AFFILIATE_GRAPHQL_ENDPOINT,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: buildAuthorization(payload),
          },
          body: payload,
          cache: "no-store",
          signal: controller.signal,
        },
      );

      const text = await response.text();
      if (!response.ok) {
        throw new ShopeeConnectorError(
          "HTTP_ERROR",
          `API Shopee respondeu HTTP ${response.status}.`,
        );
      }
      try {
        return JSON.parse(text) as ShopeeGraphqlResponse;
      } catch {
        throw new ShopeeConnectorError(
          "INVALID_PAYLOAD",
          "API Shopee retornou payload nao-JSON.",
        );
      }
    } catch (error) {
      if (error instanceof ShopeeConnectorError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ShopeeConnectorError(
          "TIMEOUT",
          "API Shopee demorou demais para responder.",
        );
      }
      throw new ShopeeConnectorError(
        "NETWORK",
        "Falha de rede ao consultar a API Shopee.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Le a posicao (palavra-chave, pagina) do cursor.
   * Cursor ausente ou invalido comeca em (0, 1) — fail-closed para o inicio,
   * nunca para o fim: comecar no fim faria uma varredura parecer completa sem
   * ter lido nada.
   */
  private static positionOfCursor(
    cursor: string | null,
  ): { keywordIndex: number; page: number } {
    if (!cursor) return { keywordIndex: 0, page: 1 };
    try {
      const parsed = JSON.parse(cursor) as {
        keywordIndex?: number;
        page?: number;
      };
      const keywordIndex = Number(parsed.keywordIndex);
      const page = Number(parsed.page);
      return {
        keywordIndex:
          Number.isFinite(keywordIndex) && keywordIndex >= 0 ? keywordIndex : 0,
        page: Number.isFinite(page) && page >= 1 ? page : 1,
      };
    } catch {
      return { keywordIndex: 0, page: 1 };
    }
  }

  /**
   * Cursor opaco: par (indice da palavra-chave, pagina).
   *
   * A pagina precisa estar no cursor porque a API de afiliados e uma busca por
   * RANKING e uma offerta certificada pode estar varias paginas abaixo da
   * primeira. Medido: com `page: 1` fixo e `pageSize=50`, 0 das 3 bindings
   * certificadas eram alcancadas; a 5 paginas, 3/3.
   */
  private static cursorFor(keywordIndex: number, page: number): string {
    return JSON.stringify({ keywordIndex, page });
  }

  /**
   * Coleta paginada por (palavra-chave, pagina).
   *
   * Cada chamada devolve UMA pagina de UMA palavra-chave, e o proximo cursor
   * avanca a pagina; ao esgotar `maxPages`, avanca a palavra-chave. Isso torna
   * a profundidade de varredura um fato observavel no relatorio
   * (`COLLECT_CALLS`), em vez de um campo declarado e nunca usado.
   */
  async collect(fromCursor: string | null = null): Promise<CollectedListingBatch> {
    if (this.keywords.length === 0) {
      return { items: [], nextCursor: null, snapshotComplete: true };
    }

    const position = ShopeeMarketplaceConnector.positionOfCursor(fromCursor);
    const keywordIndex = Math.min(position.keywordIndex, this.keywords.length - 1);
    const page = position.page;
    const keyword = this.keywords[keywordIndex];

    const query = `{
      productOfferV2(
        keyword: ${JSON.stringify(keyword)},
        page: ${page},
        limit: ${this.pageSize}
      ) {
        nodes {
          itemId
          shopId
          productName
          shopName
          price
          priceMin
          priceMax
          imageUrl
          productLink
          offerLink
          ratingStar
          sales
          priceDiscountRate
          productCatIds
        }
        pageInfo { page limit hasNextPage scrollId }
      }
    }`;

    const response = await this.executeGraphql(query);
    if (response.errors?.length) {
      const first = response.errors[0];
      const message =
        first.extensions?.message?.trim() || first.message?.trim() || "";
      throw new ShopeeConnectorError(
        "GRAPHQL_ERROR",
        `API Shopee retornou erro: ${message.slice(0, 200)}`,
      );
    }

    const nodes = response.data?.productOfferV2?.nodes ?? [];
    const items: NormalizedMarketplaceListingV1[] = [];
    for (const node of nodes) {
      const normalized = this.tryNormalize(node);
      if (normalized === null) continue;
      // Preserva o bruto exato da fonte para replay/provenance.
      this.rawByExternalId.set(normalized.externalListingId, node);
      items.push(normalized);
    }

    // `hasNextPage` e a palavra da API sobre haver mais resultados; `maxPages`
    // e o nosso teto de varredura. Se a API diz que acabou, acreditamos nela e
    // passamos a proxima palavra-chave em vez de gastar chamada em paginas
    // vazias.
    const hasNextPage =
      response.data?.productOfferV2?.pageInfo?.hasNextPage === true;
    const morePages = hasNextPage && page < this.maxPages;
    const isLastKeyword = keywordIndex >= this.keywords.length - 1;

    if (morePages) {
      this.cursor = ShopeeMarketplaceConnector.cursorFor(keywordIndex, page + 1);
    } else if (!isLastKeyword) {
      this.cursor = ShopeeMarketplaceConnector.cursorFor(keywordIndex + 1, 1);
    } else {
      this.cursor = null;
    }

    return {
      items,
      nextCursor: this.cursor,
      snapshotComplete: this.cursor === null,
    };
  }

  /**
   * Normaliza o no cru da Shopee para o contrato V1.
   * Retorna null quando o no nao tem identidade minima (itemId + preco),
   * porque uma listing sem identidade nao pode ser persistida.
   */
  normalize(raw: unknown): NormalizedMarketplaceListingV1 {
    const node = this.toNode(raw);
    if (!node) {
      throw new ShopeeConnectorError(
        "INVALID_NODE",
        "No Shopee sem itemId nao pode ser normalizado.",
      );
    }
    const listing = this.tryNormalize(node);
    if (!listing) {
      throw new ShopeeConnectorError(
        "INVALID_NODE",
        "No Shopee sem preco valido nao pode ser normalizado.",
      );
    }
    return listing;
  }

  private toNode(raw: unknown): ShopeeOfferNodeV1 | null {
    if (!raw || typeof raw !== "object") return null;
    return raw as ShopeeOfferNodeV1;
  }

  private tryNormalize(
    node: ShopeeOfferNodeV1,
  ): NormalizedMarketplaceListingV1 | null {
    const itemId = String(node.itemId ?? "").trim();
    const shopId = String(node.shopId ?? "").trim();
    const price = toPositiveNumber(node.price);
    if (
      itemId === "" ||
      shopId === "" ||
      !/^\d+$/.test(itemId) ||
      !/^\d+$/.test(shopId) ||
      /^0+$/.test(itemId) ||
      /^0+$/.test(shopId) ||
      price === null
    ) {
      return null;
    }
    const externalListingId = `${shopId}.${itemId}`;

    // A URL do produto tambem passa pelo filtro de seguranca (FASE R): se a
    // fonte mandar um esquema perigoso, ele nunca chega a ser persistido.
    toSafeExternalUrl(node.productLink);
    const imageUrl = toSafeExternalUrl(node.imageUrl);
    const collectedAt = this.now();
    const title = trimmed(node.productName);

    return {
      contractVersion: NORMALIZED_LISTING_V1,
      source: this.id,
      marketplaceId: this.marketplaceId,
      // FASE G: identidade = (marketplaceId, externalListingId).
      // Seller SKU / URL / GTIN nunca entram aqui.
      externalListingId,
      seller: {
        externalSellerId: shopId,
        name: trimmed(node.shopName),
      },
      identity: {
        // A API de afiliados nao expoe GTIN: array vazio = "fonte reportou
        // nenhum". Nao e o mesmo que UNKNOWN, e nunca e inventado.
        gtin: [],
        mpn: null,
        manufacturerModel: null,
        // brand: a fonte nao devolve campo de marca estruturado. A marca pode
        // ser extraida do titulo como EVIDENCIA, mas nao e afirmada aqui
        // como dado canonico da fonte -> permanece null.
        brand: null,
        model: null,
      },
      catalog: {
        title,
        description: null,
        category: normalizeCategoryIds(node.productCatIds).join(",") || null,
        images: imageUrl.ok && imageUrl.url ? [imageUrl.url] : [],
        attributes: {
          ratingStar: toFiniteNumber(node.ratingStar),
          sales: toFiniteNumber(node.sales),
        },
        primaryImageUrl: imageUrl.ok ? imageUrl.url : null,
      },
      variant: {
        // productOfferV2 nao expoe eixos de variante.
        color: UNKNOWN,
        storage: UNKNOWN,
        memory: UNKNOWN,
        voltage: UNKNOWN,
        size: UNKNOWN,
        otherAttributes: {},
      },
      commerce: {
        price,
        oldPrice: null,
        pixPrice: UNKNOWN,
        installments: UNKNOWN,
        // estoque nao e exposto pela fonte -> UNKNOWN (nunca 0).
        stock: UNKNOWN,
        availability: availabilityFromOffer(price),
        shippingHint: UNKNOWN,
        promotion:
          toFiniteNumber(node.priceDiscountRate) !== null
            ? `discountRate=${String(node.priceDiscountRate)}`
            : null,
      },
      metadata: {
        sourceUpdatedAt: null,
        collectedAt,
        rawHash: computeRawHash(node),
        payloadVersion: "shopee-affiliate/v1",
      },
    };
  }

  /**
   * Validacao de payload normalizado. Rejeicoes viram reasonCodes
   * (nunca excecao de sistema) e a listing nao entra no repositorio.
   */
  validate(listing: NormalizedMarketplaceListingV1): string[] {
    const codes: string[] = [];
    if (!listing.marketplaceId) codes.push("MISSING_MARKETPLACE_ID");
    if (!listing.externalListingId) codes.push("MISSING_EXTERNAL_LISTING_ID");
    if (
      !Number.isFinite(listing.commerce.price) ||
      listing.commerce.price <= 0
    ) {
      codes.push("INVALID_PRICE");
    }
    if (!listing.catalog.title && !listing.catalog.category) {
      codes.push("MISSING_CATALOG_SIGNAL");
    }
    return codes;
  }

  getCursor(): string | null {
    return this.cursor;
  }

  /**
   * FASE N/P — payload BRUTO exato que a fonte devolveu para um
   * externalListingId desta coleta. Base do replay deterministico e da
   * proveniencia ("de onde veio esse dado?"). null quando desconhecido.
   */
  rawPayloadFor(externalListingId: string): unknown | null {
    return this.rawByExternalId.get(String(externalListingId)) ?? null;
  }

  /**
   * BUSCA DETERMINISTICA de UMA listagem ja conhecida.
   *
   * Este e o canal do caminho de REFRESH. Ele existe porque a busca por
   * palavra-chave e uma busca por RANKING, cuja ordem muda entre chamadas: uma
   * listagem certificada pode estar na pagina 1 numa execucao e na pagina 5 (ou
   * nao aparecer) na seguinte. Medido nesta conta: a varredura por palavra-chave
   * reencontrou as 3 bindings certificadas em uma execucao e nenhuma em outra,
   * com o MESMO codigo e a MESMA varredura.
   *
   * `productOfferV2` aceita `itemId` (e `shopId`) como argumento, o que
   * transforma a leitura em deterministica: 1 chamada, sem ranking, sem deriva.
   * Medido: `LOOKUP_DETERMINISTICO=3/3`.
   *
   * Devolve `null` quando a listagem nao existe mais na fonte. Isso e
   * NOT_SEEN, nao desassociacao: quem decide sobre desassociar ou rebaixar e o
   * gate central, nunca este metodo.
   */
  async fetchByExternalId(
    externalListingId: string,
  ): Promise<NormalizedMarketplaceListingV1 | null> {
    /*
     * O identificador PERSISTIDO e o itemId sozinho ("58215116714"), e nao o
     * par "<shopId>.<itemId>" que o conector usa como `externalListingId` na
     * varredura. Sao dois espacos de chave diferentes para a MESMA listagem, e a
     * busca determinista precisa aceitar a chave que esta no banco — senao o
     * refresh silenciosamente nunca encontra nada.
     *
     * Aceitamos as duas formas. Com shopId ele e um filtro a mais; sem ele a
     * API responde pelo itemId (medido: `ITEMID_ONLY=3/3`). Valor que nao for
     * um itemId devolve null, em vez de tentar adivinhar.
     */
    const raw = String(externalListingId).trim();
    const composite = /^(\d+)\.(\d+)$/.exec(raw);
    const bare = composite === null ? /^(\d+)$/.exec(raw) : null;
    if (composite === null && bare === null) return null;
    const itemId = composite === null ? bare![1] : composite[2];
    const shopFilter = composite === null ? "" : `, shopId: ${composite[1]}`;

    const query = `{
      productOfferV2(itemId: ${itemId}${shopFilter}, page: 1, limit: 5) {
        nodes {
          itemId
          shopId
          productName
          shopName
          price
          priceMin
          priceMax
          imageUrl
          productLink
          offerLink
          ratingStar
          sales
          priceDiscountRate
          productCatIds
        }
        pageInfo { page limit hasNextPage scrollId }
      }
    }`;

    const response = await this.executeGraphql(query);
    if (response.errors?.length) {
      const first = response.errors[0];
      const message =
        first.extensions?.message?.trim() || first.message?.trim() || "";
      throw new ShopeeConnectorError(
        "GRAPHQL_ERROR",
        `API Shopee retornou erro no lookup deterministico: ${message.slice(0, 200)}`,
      );
    }

    const nodes = response.data?.productOfferV2?.nodes ?? [];
    // A API pode devolver vizinhos; so aceitamos a listagem pedida.
    const node = nodes.find((n) => String(n.itemId ?? "").trim() === itemId);
    if (node === undefined) return null;

    const normalized = this.tryNormalize(node);
    if (normalized === null) return null;

    /*
     * Compatibilidade de refresh durante a migração:
     * bindings legadas persistiram somente itemId. O lookup aceita essa chave
     * e devolve a mesma identidade pedida para que o writer atualize a linha
     * existente, sem criar um segundo externalId. Coletas novas usam sempre
     * shopId.itemId, que é a identidade canônica da listing Shopee.
     */
    const result =
      composite === null && bare !== null
        ? { ...normalized, externalListingId: raw }
        : normalized;

    this.rawByExternalId.set(result.externalListingId, node);
    return result;
  }

  /**
   * Health check REAL: uma consulta minima contra a fonte autorizada.
   * Nao devolve credencial, assinatura nem payload.
   */
  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      readCredentials();
    } catch {
      return { ok: false, detail: "CREDENTIALS_MISSING" };
    }
    try {
      const response = await this.executeGraphql(
        `{ productOfferV2(keyword: "smartphone", page: 1, limit: 1) { nodes { itemId } pageInfo { hasNextPage } } }`,
      );
      if (response.errors?.length) {
        return { ok: false, detail: "GRAPHQL_ERROR" };
      }
      return { ok: true, detail: "shopee-affiliate reachable" };
    } catch (error) {
      const code =
        error instanceof ShopeeConnectorError ? error.code : "UNKNOWN";
      return { ok: false, detail: code };
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
