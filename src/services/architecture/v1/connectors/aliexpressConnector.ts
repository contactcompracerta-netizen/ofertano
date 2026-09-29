/**
 * CATALOG_ARCHITECTURE_V1 — ALIEXPRESS CONNECTOR (FASE 12).
 *
 * Conector que REUTILIZA o cliente HTTP e o parser legados:
 *   - `buscarAliExpress`        (descoberta por palavra-chave)
 *   - `buscarProdutoApi`        (refresh determinístico por product_id)
 * e mapeia o payload para `NormalizedMarketplaceListingV1`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ALIEXPRESS EXIGE MAIS CUIDADO QUE SHOPEE/MAGALU/AMAZON
 * ---------------------------------------------------------------------------
 *
 * Um anúncio no AliExpress é uma FAMÍLIA. O mesmo `product_id` reúne cor,
 * capacidade, voltagem, tamanho e kit diferentes. Publicar "Fone Bluetooth
 * 128GB" como se fosse o produto do catálogo seria um erro de identidade —
 * o pior tipo de erro deste sistema, porque é silencioso: o preço baixa, o
 * anúncio parece correto e o usuário recebe algo diferente do que pensou.
 *
 * SEMÂNTICA DE IDENTIDADE (medida, não assumida):
 *
 *   `product_id`  = FAMÍLIA de anúncio. É o que a API e o `@@unique` da
 *                   oferta tratam como unidade, e é o que o importador legado
 *                   já grava. Nenhuma variante é colapsada em cima dele pelo
 *                   CONECTOR: uma listagem V1 = uma oferta = um product_id.
 *
 *   `sku_id`      = VARIANTE. A API o devolve como um ÚNICO valor por consulta,
 *                   sem eixos (cor/tamanho/capacidade) e sem lista. Ele NÃO é
 *                   identidade de anúncio e NÃO entra em `externalListingId`:
 *                   usá-lo trocaria a chave `@@unique` de ofertas já
 *                   certificadas e faria refresh reescrever identidade.
 *
 * O que a API de fato entrega (lista `fields` medida em `api.ts`):
 *   product_id, product_title, product_main_image_url, product_small_image_urls,
 *   product_detail_url, promotion_link, sale_price, original_price,
 *   target_sale_price, target_original_price, app_sale_price,
 *   target_app_sale_price, discount, commission_rate, evaluate_rate,
 *   lastest_volume, category (1º e 2º nível), shop_id, shop_name, shop_url,
 *   sku_id, tax_rate
 *
 * O que ela NÃO entrega (e por isso vira `false`/`UNKNOWN`, nunca invenção):
 *   estoque, frete, GTIN/EAN, MPN, eixos estruturados de variante, snapshot,
 *   delta incremental, webhook, preço PIX.
 *
 * ---------------------------------------------------------------------------
 * GATE DE VARIANTE: POR QUE NÃO HÁ REGEX NESTE ARQUIVO
 * ---------------------------------------------------------------------------
 *
 * A tentação aqui é escrever um extrator de variante por título (128GB, 110V,
 * Pro Max, kit 2un) e compará-lo com o Product. NÃO foi feito, e é deliberado.
 *
 * Esse gate já existe, é central e é mais forte: `identity/identityConfidence`
 * + `matching/crossMarketMatching` comparam eixo por eixo e emitem HARD
 * CONFLICT, que tem precedência sobre toda evidência forte. Um segundo
 * extrator aqui seria um motor de matching paralelo — passaria nos testes
 * deste arquivo e não mudaria o caminho de escrita, que é exatamente o tipo de
 * garantia falsa que o gate existe para impedir.
 *
 * E há uma razão mais forte: a API não devolve GTIN, MPN, manufacturerModel
 * nem brand. `collectStrongEvidence` depende EXCLUSIVAMENTE desses quatro
 * campos. Logo o caminho EXACT é INALCANÇÁVEL para esta fonte — por
 * construção, não por sorte. Toda listagem AliExpress termina em REJECT por
 * NO_SHARED_EVIDENCE, ou antes por HARD CONFLICT. Título parecido nunca vira
 * publicação, porque a condição de elegibilidade não existe.
 *
 * Ver a seção "GATE DE VARIANTE: ONDE ELE REALMENTE ACONTECE" abaixo, e os
 * casos 8 e 9 de `aliexpressConnector.contract.test.ts`, que exercitam o
 * `evaluateIdentityConfidence` real — não um helper local.
 */

import {
  buscarAliExpress,
  obterPreco,
  obterPrecoAnterior,
} from "@/services/discovery/aliexpress";
import { buscarProdutoApi, type ProdutoAliExpressApi } from "@/services/importers/aliexpress/api";
import type { DiscoveryQuery } from "@/services/discovery/core/types";
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
import { filterSafeExternalUrls, toSafeExternalUrl } from "../security/safeUrl";

export const ALIEXPRESS_MARKETPLACE_ID = "aliexpress";
export const ALIEXPRESS_CONNECTOR_ID = "aliexpress-v1";

/** Opções de configuração do conector (testes/canários). */
export interface AliExpressConnectorOptions {
  /** Palavras-chave de busca para descoberta. */
  keywords?: readonly string[];
  /** Limite de resultados por busca. */
  limit?: number;
}

/**
 * CAPACIDADES REAIS — medidas contra a lista `fields` real da API.
 *
 * `variants = false` é a afirmação mais importante deste arquivo: a API
 * devolve UM `sku_id` opaco, sem eixos, então o conector NÃO consegue
 * normalizar variante estruturada. Declarar `true` seria afirmar que sabemos
 * separar "128GB" de "256GB" quando na verdade só temos o título — e o gate de
 * variante abaixo existe justamente porque NÃO sabemos.
 */
export const ALIEXPRESS_CAPABILITIES: ConnectorCapabilities = {
  catalog: true,           // title, category, image, shop
  inventory: true,          // sale_price, original_price
  stock: false,             // API não expõe estoque
  shipping: false,          // API não expõe frete
  seller: true,             // shop_id, shop_name
  variants: false,          // só há sku_id opaco, sem eixos estruturados
  gtin: false,              // sem EAN/UPC
  incrementalUpdates: false, // consulta por palavra-chave, sem delta
  fullSnapshot: false,       // paginação por keyword, não é snapshot do catálogo
  webhook: false,
  pixPrice: false,
};

/* ------------------------------------------------------------------ */
/* GATE DE VARIANTE: ONDE ELE REALMENTE ACONTECE                      */
/* ------------------------------------------------------------------ */

/*
 * NAO existe extrator de variante proprio neste conector. Isso e deliberado.
 *
 * O gate de variante NAO e responsabilidade do conector: ele ja existe, e
 * central, e e mais forte do que qualquer regex que este arquivo pudesse
 * escrever. `identity/identityConfidence` + `matching/crossMarketMatching`
 * comparam eixo por eixo e emitem HARD CONFLICT, que tem precedencia sobre
 * toda evidencia forte (a decisao e REJECT na hora).
 *
 * Um segundo extrator aqui seria um motor de matching paralelo: passaria nos
 * testes deste arquivo e continuaria sem efeito no caminho de escrita, que e
 * exatamente o tipo de garantia falsa que o gate existe para impedir.
 *
 * O QUE A API ENTREGA E O QUE ISSO PRODUZ
 *
 *   A API devolve UM `sku_id` opaco, sem eixos. O conector portanto declara
 *   `variants: false` e deixa TODOS os eixos de `variant` como UNKNOWN.
 *
 *   UNKNOWN nao e um valor: e "a fonte nao coletou". O core trata isso no
 *   sentido fail-closed:
 *
 *     - `readAxis` nao encontra valor estruturado e cai para o TITULO;
 *     - `detectHardConflicts` (crossMarketMatching) compara as MEDIDAS do
 *       titulo dos dois lados (128GB vs 256GB => STORAGE_MISMATCH);
 *     - divergencia vira HARD CONFLICT => REJECT.
 *
 *   Some-se a isso o fato estrutural mais forte: a API nao devolve GTIN, MPN,
 *   manufacturerModel nem brand. `collectStrongEvidence` depende EXCLUSIVAMENTE
 *   desses quatro campos. Logo, uma listagem AliExpress NUNCA atinge EXACT e
 *   sempre termina em REJECT por NO_SHARED_EVIDENCE (ou antes, por
 *   HARD_CONFLICT). Titulo parecido nunca vira publicacao — a condicao de
 *   elegibilidade nao existe, por construcao.
 *
 * Alem do gate central, ha a Discovery legada (`buscarAliExpress`), que ja
 * descarta acessorio nao pedido, condicao nao-nova, bundle nao pedido, marca
 * incompativel e variante incompativel ANTES de devolver candidato. O
 * conector herda esse filtro por reutiliza-la.
 *
 * `fetchByExternalId` (known binding) NAO entra neste gate de proposito: a
 * binding ja foi certificada no passado, e o refresh so atualiza preco.
 *
 * ACHADO PRE-EXISTENTE (nao corrigido nesta fase)
 *
 *   `identity/identityConfidence.normalizeAxisValue` normaliza para minusculo
 *   e DEPOIS compara com o sentinela `UNKNOWN`, que e MAIUSCULO ("__UNKNOWN__").
 *   A comparacao nunca casa, entao um eixo marcado UNKNOWN vira o valor
 *   LITERAL "__unknown__" — que e diferente de qualquer valor real e portanto
 *   conflita com ele.
 *
 *   Efeito: e MAIS restritivo (UNKNOWN x 256gb => HARD CONFLICT), nunca menos.
 *   Nao ha risco de publicacao errada; ha perda de oportunidades de match e um
 *   `hardConflicts` poluido. Afeta Shopee, Magalu e Amazon de forma identica,
 *   pois os tres tambem marcam eixos como UNKNOWN. Fica para uma fase propria:
 *   corrigir aqui mudaria o comportamento de marketplaces ja em producao.
 */

/* ------------------------------------------------------------------ */
/* IDENTIDADE DE LISTING                                              */
/* ------------------------------------------------------------------ */

/**
 * `product_id` do AliExpress é uma sequência numérica longa.
 * `extrairIdProdutoAliExpress` no legado já usa `^\d{8,}$`; o conector repete
 * o MESMO critério para que uma listagem inválida nunca chegue ao writer.
 */
export function productIdValido(valor: unknown): string | null {
  if (typeof valor === "number" && Number.isFinite(valor)) {
    const texto = String(Math.trunc(valor));
    return /^\d{8,}$/.test(texto) ? texto : null;
  }
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  return /^\d{8,}$/.test(texto) ? texto : null;
}

/** Converte string numérica da API (aceita "12.99") em número. */
function normalizarNumero(valor: unknown): number | null {
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : null;
  }
  if (typeof valor !== "string") return null;
  const texto = valor.trim().replace(/[^\d,.-]/g, "");
  if (texto === "") return null;
  const ultimaVirgula = texto.lastIndexOf(",");
  const ultimoPonto = texto.lastIndexOf(".");
  let normalizado = texto;
  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    normalizado =
      ultimaVirgula > ultimoPonto
        ? texto.replace(/\./g, "").replace(",", ".")
        : texto.replace(/,/g, "");
  } else if (ultimaVirgula >= 0) {
    normalizado = texto.replace(",", ".");
  }
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Só persiste imagens de domínio AliExpress/AliCDN.
 *
 * A URL vem da fonte externa: sem allowlist de domínio, um payload de
 * marketplace apontaria para qualquer host e a UI pública passaria a exibir
 * imagem de terceiros.
 */
function normalizarImagens(
  principal: unknown,
  pequenas: unknown,
): string[] {
  const candidatas: string[] = [];
  if (typeof principal === "string") candidatas.push(principal);

  if (Array.isArray(pequenas)) {
    for (const item of pequenas) {
      if (typeof item === "string") candidatas.push(item);
    }
  } else if (pequenas && typeof pequenas === "object") {
    const lista = (pequenas as { string?: unknown }).string;
    if (Array.isArray(lista)) {
      for (const item of lista) {
        if (typeof item === "string") candidatas.push(item);
      }
    }
  }

  const seguras = filterSafeExternalUrls(candidatas).filter((url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return (
        host === "alicdn.com" ||
        host.endsWith(".alicdn.com") ||
        host === "aliexpress.com" ||
        host.endsWith(".aliexpress.com")
      );
    } catch {
      return false;
    }
  });

  return [...new Set(seguras)];
}

/** URL canônica do anúncio, sem montar link de afiliado. */
function normalizarSourceUrl(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  if (texto === "") return null;
  const safe = toSafeExternalUrl(texto);
  return safe.ok ? safe.url : null;
}
/**
 * `promotion_link` é o link de afiliado oficial (host `s.click.aliexpress.com`
 * ou `*.aliexpress.com`). NUNCA é construído por concatenação: a API entrega
 * pronto, e fabricar um seria inventar um link de afiliado.
 */
function normalizarAffiliateLink(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  if (texto === "") return null;
  const safe = toSafeExternalUrl(texto);
  if (!safe.ok || safe.url === null) return null;
  try {
    const host = new URL(safe.url).hostname.toLowerCase();
    const isAliExpress =
      host === "aliexpress.com" || host.endsWith(".aliexpress.com");
    return isAliExpress ? safe.url : null;
  } catch {
    return null;
  }
}

/** Preço: reutiliza a MESMA resolução do discovery legado (moeda-alvo + pdp_npi). */
function precoDoProduto(produto: ProdutoAliExpressApi): number | null {
  return obterPreco(produto);
}

/**
 * Disponibilidade SEMPRE derivada do que a fonte disse.
 * A API não expõe estoque; preço positivo é indício de anúncio ativo, mas
 * "sem estoque" nunca é afirmável. Então: preço>0 => IN_STOCK, senão UNKNOWN
 * (nunca OUT_OF_STOCK — isso causaria desassociação indevida).
 */
function mapearDisponibilidade(preco: number | null): "IN_STOCK" | typeof UNKNOWN {
  return preco !== null && preco > 0 ? "IN_STOCK" : UNKNOWN;
}

/* ------------------------------------------------------------------ */
/* PAYLOAD BRUTO PRESERVADO                                           */
/* ------------------------------------------------------------------ */

/**
 * O que o `purchaseLinks` adapter lê. `promotionLink` e `productDetailUrl` são
 * os campos que a API devolveu — o adapter nunca os fabrica.
 */
export interface AliExpressRawPayload {
  externalListingId: string;
  productId: string;
  title: string;
  price: number | null;
  oldPrice: number | null;
  image: string | null;
  shopId: string | null;
  shopName: string | null;
  skuId: string | null;
  category: string | null;
  promotionLink: string | null;
  productDetailUrl: string | null;
  collectedAt: string;
}

/** Cache por execução do runner. */
const rawPayloadCache = new Map<string, AliExpressRawPayload>();

/** Limpa o cache bruto (usado por testes e entre ciclos de canário). */
export function clearAliExpressRawPayloadCache(): void {
  rawPayloadCache.clear();
}

/* ------------------------------------------------------------------ */
/* NORMALIZAÇÃO                                                       */
/* ------------------------------------------------------------------ */

/**
 * Converte um produto da API em listing normalizada.
 *
 * `ProdutoAliExpressApi` é o tipo canônico aqui porque é a FORMA MAIS RICA que
 * a API já devolve (a do `productdetail.get`). A do `product.query` é um
 * subconjunto dela, então o discovery cabe aqui sem cast.
 *
 * Ausência real vira `null`/`UNKNOWN`. Nada é inventado: sem estoque ->
 * UNKNOWN, sem GTIN -> [], sem eixos de variante -> todos UNKNOWN, marca é
 * `null` porque a API não devolve campo de marca (o discovery legado também
 * seta `brand: null` pelo mesmo motivo).
 */
function produtoParaNormalizado(
  produto: ProdutoAliExpressApi,
  agora: string,
): NormalizedMarketplaceListingV1 | null {
  const productId = productIdValido(produto.product_id);
  if (!productId) return null;

  const title = produto.product_title?.trim() ?? "";
  if (title === "") return null;

  const price = precoDoProduto(produto);
  if (price === null || price <= 0) return null;

  const oldPrice = obterPrecoAnterior(produto, price);
  const images = normalizarImagens(
    produto.product_main_image_url,
    produto.product_small_image_urls,
  );
  const shopId =
    produto.shop_id === undefined || produto.shop_id === null
      ? null
      : String(produto.shop_id).trim() || null;
  const shopName = produto.shop_name?.trim() ?? null;
  const skuId =
    produto.sku_id === undefined || produto.sku_id === null
      ? null
      : String(produto.sku_id).trim() || null;
  const category =
    produto.second_level_category_name?.trim() ||
    produto.first_level_category_name?.trim() ||
    null;

  return {
    contractVersion: NORMALIZED_LISTING_V1,
    source: ALIEXPRESS_CONNECTOR_ID,
    marketplaceId: ALIEXPRESS_MARKETPLACE_ID,
    externalListingId: productId,
    seller: {
      externalSellerId: shopId,
      name: shopName,
    },
    identity: {
      gtin: [],
      mpn: null,
      manufacturerModel: null,
      brand: null,   // API não devolve campo de marca
      model: null,
    },
    catalog: {
      title,
      description: null,
      category,
      images,
      attributes: {},
      primaryImageUrl: images[0] ?? null,
    },
    /*
     * A API devolve UM sku_id opaco, sem eixos. Preencher `variant.storage`
     * a partir dele seria inventar estrutura. Todos os eixos ficam UNKNOWN
     * e a variante é tratada como evidência de TÍTULO (variantConflicts).
     */
    variant: {
      color: UNKNOWN,
      storage: UNKNOWN,
      memory: UNKNOWN,
      voltage: UNKNOWN,
      size: UNKNOWN,
      otherAttributes: skuId ? { sku_id: skuId } : {},
    },
    commerce: {
      price,
      oldPrice,
      pixPrice: UNKNOWN,
      installments: UNKNOWN,
      stock: UNKNOWN,
      availability: mapearDisponibilidade(price),
      shippingHint: UNKNOWN,
      promotion: null,
    },
    metadata: {
      sourceUpdatedAt: null,
      collectedAt: agora,
      rawHash: computeRawHash({ productId, title, price }),
      payloadVersion: "aliexpress-affiliate/v1",
    },
  };
}

function rememberRaw(
  produto: ProdutoAliExpressApi,
  listing: NormalizedMarketplaceListingV1,
): void {
  const productId = listing.externalListingId;
  rawPayloadCache.set(productId, {
    externalListingId: productId,
    productId,
    title: listing.catalog.title as string,
    price: listing.commerce.price,
    oldPrice: listing.commerce.oldPrice as number | null,
    image: listing.catalog.primaryImageUrl as string | null,
    shopId:
      typeof listing.seller.externalSellerId === "string"
        ? listing.seller.externalSellerId
        : null,
    shopName: typeof listing.seller.name === "string" ? listing.seller.name : null,
    skuId: (listing.variant.otherAttributes.sku_id as string) ?? null,
    category: typeof listing.catalog.category === "string" ? listing.catalog.category : null,
    promotionLink: normalizarAffiliateLink(produto.promotion_link),
    productDetailUrl: normalizarSourceUrl(produto.product_detail_url),
    collectedAt: listing.metadata.collectedAt,
  });
}

/* ------------------------------------------------------------------ */
/* CONECTOR                                                           */
/* ------------------------------------------------------------------ */

export class AliExpressMarketplaceConnector implements MarketplaceConnector {
  readonly id = ALIEXPRESS_CONNECTOR_ID;
  readonly marketplaceId = ALIEXPRESS_MARKETPLACE_ID;
  readonly capabilities = ALIEXPRESS_CAPABILITIES;

  private cursor: number | null = null;
  private readonly keywords: readonly string[];
  private readonly limit: number;
  private readonly now: () => string;

  constructor(options: AliExpressConnectorOptions = {}) {
    this.keywords =
      options.keywords?.map((k) => k.trim()).filter((k) => k.length > 0) ?? [];
    this.limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    this.now = () => new Date().toISOString();
  }

  /**
   * Coleta por palavra-chave (descoberta). Uma keyword por chamada, com cursor
   * de índice — o runner itera até o cursor acabar.
   *
   * Reutiliza `buscarAliExpress`, que já aplica os filtros legacy de
   * acessório/condição/variante antes de devolver candidatos. Não duplicamos
   * esses filtros aqui: eles são a política já auditada do discovery.
   */
  async collect(fromCursor?: string | null): Promise<CollectedListingBatch> {
    if (this.keywords.length === 0) {
      return { items: [], nextCursor: null, snapshotComplete: true };
    }

    let index = 0;
    if (fromCursor) {
      const parsed = Number.parseInt(fromCursor, 10);
      if (Number.isFinite(parsed)) index = parsed;
    }
    index = Math.min(Math.max(index, 0), this.keywords.length - 1);
    const keyword = this.keywords[index];

    const query: DiscoveryQuery = {
      query: keyword,
      normalizedQuery: keyword.toLowerCase(),
      limit: this.limit,
      mode: "DEFAULT",
    };

    const result = await buscarAliExpress(query);
    const agora = this.now();
    const items: NormalizedMarketplaceListingV1[] = [];

    /*
     * `buscarAliExpress` NÃO LANÇA: fonte bloqueada, indisponível ou com erro
     * volta como resultado com `searchOutcome` e `candidates: []`. Sem esta
     * checagem, uma API fora do ar (ou sem permissão) seria reportada como
     * "zero anúncios coletados" — indistinguível de uma busca que realmente
     * não achou nada, e o canário passaria verde sobre uma coleta morta.
     *
     * `EMPTY_VALID` NÃO é falha: a API respondeu e não tinha o que devolver.
     */
    const outcome = result.searchOutcome;
    if (outcome === "BLOCKED" || outcome === "UNUSABLE" || outcome === "ERROR") {
      const erro = new Error(
        `ALIEXPRESS_SOURCE_${outcome}: ${
          (result.error ?? "sem detalhe").slice(0, 200)
        } (scanned=${result.scanned}, blocked=${(result.blockedSources ?? []).join(",") || "-"}, unusable=${(result.unusableSources ?? []).join(",") || "-"})`,
      );
      erro.name = `AliExpressSource${outcome.charAt(0) + outcome.slice(1).toLowerCase()}Error`;
      throw erro;
    }

    for (const candidate of result.candidates) {
      if (candidate.status !== "FOUND") continue;
      // Reconstrói o payload do discovery em forma de produto da API, para
      // que produtoParaNormalizado seja o ÚNICO tradutor.
      const produto: ProdutoAliExpressApi = {
        product_id: candidate.externalId,
        product_title: candidate.title,
        product_main_image_url: candidate.image ?? undefined,
        product_detail_url: candidate.sourceUrl,
        promotion_link: candidate.affiliateLink ?? undefined,
        target_sale_price: candidate.price ?? undefined,
        target_sale_price_currency: "BRL",
        target_original_price: candidate.oldPrice ?? undefined,
        target_original_price_currency: candidate.oldPrice ? "BRL" : undefined,
        second_level_category_name: candidate.category ?? undefined,
        shop_name: candidate.seller ?? undefined,
      };
      const normalized = produtoParaNormalizado(produto, agora);
      if (normalized === null) continue;
      rememberRaw(produto, normalized);
      items.push(normalized);
    }

    const isLastKeyword = index >= this.keywords.length - 1;
    const nextCursor = isLastKeyword ? null : String(index + 1);
    this.cursor = nextCursor === null ? null : Number.parseInt(nextCursor, 10);

    return {
      items,
      nextCursor,
      snapshotComplete: nextCursor === null,
    };
  }

  async collectIncremental(fromCursor?: string | null): Promise<CollectedListingBatch> {
    return this.collect(fromCursor);
  }

  /** Normaliza payload bruto (usado por replay e por fetchByExternalId). */
  normalize(raw: unknown): NormalizedMarketplaceListingV1 {
    const produto = raw as ProdutoAliExpressApi;
    const normalized = produtoParaNormalizado(produto, this.now());
    if (normalized === null) {
      throw new Error("ALIEXPRESS_PAYLOAD_INVALID: product_id, título ou preço ausentes.");
    }
    rememberRaw(produto, normalized);
    return normalized;
  }

  /**
   * Validação de payload normalizado.
   *
   * `product_id` precisa ser a sequência numérica que a API emite; preço
   * precisa ser positivo e finito. Não exige seller nem imagem: o discovery
   * pode devolver produto sem loja preenchida e a ausência vira UNKNOWN, não
   * motivo para descartar o anúncio.
   */
  validate(listing: NormalizedMarketplaceListingV1): string[] {
    const errors: string[] = [];
    if (!listing.externalListingId?.trim()) {
      errors.push("MISSING_EXTERNAL_LISTING_ID");
    } else if (!productIdValido(listing.externalListingId)) {
      errors.push("INVALID_PRODUCT_ID");
    }
    if (!Number.isFinite(listing.commerce.price) || listing.commerce.price <= 0) {
      errors.push("INVALID_PRICE");
    }
    if (!listing.catalog.title?.trim() && !listing.catalog.category?.trim()) {
      errors.push("MISSING_CATALOG_SIGNAL");
    }
    return errors;
  }

  getCursor(): string | null {
    return this.cursor === null ? null : String(this.cursor);
  }

  /**
   * Health check: credenciais presentes + uma consulta real mínima.
   * Não imprime valores de credencial.
   */
  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    const appKey = process.env.ALIEXPRESS_APP_KEY?.trim();
    const appSecret = process.env.ALIEXPRESS_APP_SECRET?.trim();
    if (!appKey || !appSecret) {
      return { ok: false, detail: "CREDENTIALS_MISSING" };
    }
    try {
      const result = await buscarAliExpress({
        query: "smartphone",
        normalizedQuery: "smartphone",
        limit: 1,
        mode: "DEFAULT",
      });
      if (result.searchOutcome === "BLOCKED") {
        return { ok: false, detail: "BLOCKED" };
      }
      return {
        ok: true,
        detail: `aliexpress-reachable candidates=${result.candidates.length}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN";
      return { ok: false, detail: message.slice(0, 120) };
    }
  }

  /**
   * REFRESH DETERMINÍSTICO por product_id (known-binding).
   *
   * Usa `buscarProdutoApi` — a MESMA função que o importador manual usa — então
   * preço e link vêm da mesma fonte de verdade, sem uma segunda implementação
   * de HMAC. Devolve `null` em falha: isso vira NOT_SEEN no runner, que
   * preserva o estado anterior em vez de apagar a oferta.
   */
  async fetchByExternalId(externalListingId: string): Promise<NormalizedMarketplaceListingV1 | null> {
    const productId = productIdValido(externalListingId);
    if (!productId) return null;
    try {
      const produto = await buscarProdutoApi(productId);
      const normalized = produtoParaNormalizado(produto, this.now());
      if (normalized === null) return null;
      rememberRaw(produto, normalized);
      return normalized;
    } catch (error) {
      const name = error instanceof Error ? error.name : "UNKNOWN";
      console.warn(`[aliexpress-connector] fetchByExternalId falhou para ${productId}:`, name);
      return null;
    }
  }

  /** Payload bruto preservado para resolução de links. */
  rawPayloadFor(externalListingId: string): unknown | null {
    return rawPayloadCache.get(externalListingId) ?? null;
  }
}

/** Factory para o runner. */
export function createAliExpressConnector(
  options?: AliExpressConnectorOptions,
): AliExpressMarketplaceConnector {
  return new AliExpressMarketplaceConnector(options);
}
