/**
 * LISTING-FIRST: contrato central de identidade de oferta Mercado Livre.
 *
 * CATALOG PRODUCT != MARKETPLACE OFFER
 *
 * Um `MarketplaceOffer` de MERCADO_LIVRE so pode nascer de um anuncio/listing
 * concreto, provado por um ITEM_ID real (`MLB` + digitos). Produto de catalogo
 * (`/products/search`, `/products/{id}`, `buy_box_winner`,
 * `/products/{id}/items`) pode continuar existindo como enriquecimento,
 * matching auxiliar, catalogo interno e atributos estruturais, mas NUNCA
 * vira oferta.
 *
 * Todo writer/importer de oferta ML tem que passar por
 * `isValidMercadoLivreListingIdentity()` antes de persistir.
 */

import {
  extractMercadoLivreIdentitiesFromUrl,
  isUserProductId,
} from "@/services/discovery/mercadolivreIds";

/** ITEM_ID concreto de anuncio do Mercado Livre. */
export const ML_LISTING_ITEM_ID_PATTERN = /^MLB\d{8,}$/;

/** Rota de catalogo do Mercado Livre. `/p/` nunca representa a listing escolhida. */
export const ML_CATALOG_URL_PATTERN = /\/p\/(MLB|MLBU)-?\d{8,}/i;

/** Qualquer rota /p/ e catalogo, mesmo sem o id colado no caminho. */
export const ML_CATALOG_PATH_PATTERN = /\/p\//i;

export const ML_PUBLIC_LISTING_URL_PREFIX =
  "https://produto.mercadolivre.com.br/MLB-";

export type MercadoLivreOfferOrigin = "listing" | "catalog" | "unknown";

export type MercadoLivreListingIdentityInput = {
  /** Identificador que o writer pretende gravar em `MarketplaceOffer.externalId`. */
  externalId?: string | null;
  /** ITEM_ID concreto, quando conhecido explicitamente. */
  listingItemId?: string | null;
  /** `sourceUrl`/permalink que o writer pretende gravar. */
  sourceUrl?: string | null;
  /** Proveniencia da oferta. `catalog` nunca pode virar oferta. */
  origin?: MercadoLivreOfferOrigin | null;
};

export type MercadoLivreListingIdentityRejection =
  | "MISSING_LISTING_ITEM_ID"
  | "INVALID_LISTING_ITEM_ID"
  | "CATALOG_PRODUCT_NOT_LISTING"
  | "CATALOG_SOURCE_URL"
  | "MISSING_SOURCE_URL"
  | "LISTING_URL_MISMATCH"
  | "MISSING_PRICE"
  | "INVALID_PRICE";

export type MercadoLivreListingIdentityVerdict = {
  /** `true` somente para listing concreta comprovada. */
  valid: boolean;
  rejection: MercadoLivreListingIdentityRejection | null;
  listingItemId: string | null;
  /** Metadado: nunca substitui o listingItemId em `externalId`. */
  catalogProductId: string | null;
  sourceUrl: string | null;
  /** `true` quando a sourceUrl e uma pagina compravel da listing concreta. */
  purchasable: boolean;
};

export type MercadoLivreOfferContractInput =
  MercadoLivreListingIdentityInput & {
    price?: number | null;
    sellerId?: string | number | null;
  };

export type MercadoLivreOfferContractVerdict =
  MercadoLivreListingIdentityVerdict & {
    price: number | null;
    sellerId: string | null;
  };

function compactId(raw: string | null | undefined): string {
  if (!raw) {
    return "";
  }

  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * ITEM_ID concreto de anuncio. Estrito: `MLB` + 8+ digitos.
 *
 * Rejeita MLBU (user product), URL, texto e qualquer coisa que nao seja
 * um id de anuncio.
 */
export function normalizeMercadoLivreListingItemId(
  raw: string | null | undefined,
): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  const compact = compactId(raw);
  if (!ML_LISTING_ITEM_ID_PATTERN.test(compact)) {
    return null;
  }

  return compact;
}

export function isMercadoLivreListingItemId(
  raw: string | null | undefined,
): boolean {
  return normalizeMercadoLivreListingItemId(raw) !== null;
}

/**
 * `/p/MLB...` e `/up/MLBU...` sao rotas de catalogo/user-product.
 * Nao representam a listing individual escolhida.
 */
export function isMercadoLivreCatalogSourceUrl(
  raw: string | null | undefined,
): boolean {
  if (!raw || typeof raw !== "string") {
    return false;
  }

  return ML_CATALOG_URL_PATTERN.test(raw) || ML_CATALOG_PATH_PATTERN.test(raw);
}

/**
 * Extrai o catalog_product_id de um payload de anuncio ou de uma URL de
 * catalogo. Resultado e METADADO: nunca pode virar `externalId`.
 */
export function extractMercadoLivreCatalogProductId(
  raw: string | null | undefined,
): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  const identities = extractMercadoLivreIdentitiesFromUrl(raw);
  const fromCatalog = identities.catalogIds.find(
    (id) => !identities.listingIds.includes(id),
  );
  if (fromCatalog) {
    return fromCatalog;
  }

  const match = raw
    .replace(/-/g, "")
    .toUpperCase()
    .match(/\b(MLB|MLBU)\d{8,}\b/);
  if (!match) {
    return null;
  }

  return isUserProductId(match[0]) || match[1] === "MLBU"
    ? compactId(match[0])
    : match[0];
}

function digitsOf(listingItemId: string): string {
  return listingItemId.replace(/^MLB/, "");
}

/** URL publica individual derivada do proprio ITEM_ID. */
export function criarUrlPublicaMlListing(
  listingItemId: string,
): string | null {
  const itemId = normalizeMercadoLivreListingItemId(listingItemId);
  if (!itemId) {
    return null;
  }

  return `${ML_PUBLIC_LISTING_URL_PREFIX}${digitsOf(itemId)}`;
}

/**
 * `true` quando a URL carrega evidencia do MESMO item_id anunciado.
 *
 * Aceita `produto.mercadolivre.com.br/MLB-<id>-slug`, `.../MLB<id>`,
 * `?wid=MLB<id>`, `?item_id=MLB<id>` e `pdp_filters=item_id:MLB<id>`.
 * Rejeita `/p/` de catalogo e URL que aponta outra listing.
 */
export function mercadoLivreSourceUrlProvesListing(
  raw: string | null | undefined,
  listingItemId: string,
): boolean {
  const itemId = normalizeMercadoLivreListingItemId(listingItemId);
  if (!itemId || !raw || typeof raw !== "string") {
    return false;
  }

  const url = raw.trim();
  if (!url || isMercadoLivreCatalogSourceUrl(url)) {
    return false;
  }

  const identities = extractMercadoLivreIdentitiesFromUrl(url);
  if (!identities.listingIds.includes(itemId)) {
    return false;
  }

  /*
   * Catalogo e listing podem ser /p/MLB<catalog>?wid=MLB<item>.
   * A identidade do /p/ e o catalog_product_id, nunca a oferta.
   */
  return identities.catalogIds.every((id) => id !== itemId);
}

/**
 * Resolve a sourceUrl comprável de uma listing concreta.
 *
 * Prefere a URL original quando ela prova o item_id; caso contrario deriva a
 * rota publica individual do ITEM_ID. URL `/p/` de catalogo nunca é devolvida.
 */
export function resolveMercadoLivreListingSourceUrl(
  candidateUrl: string | null | undefined,
  listingItemId: string | null | undefined,
): string | null {
  const itemId = normalizeMercadoLivreListingItemId(listingItemId);
  if (!itemId) {
    return null;
  }

  const url = candidateUrl?.trim() ?? "";
  if (url && mercadoLivreSourceUrlProvesListing(url, itemId)) {
    return url;
  }

  return criarUrlPublicaMlListing(itemId);
}

function rejected(
  rejection: MercadoLivreListingIdentityRejection,
  listingItemId: string | null,
  catalogProductId: string | null,
  sourceUrl: string | null,
  purchasable: boolean,
): MercadoLivreListingIdentityVerdict {
  return {
    valid: false,
    rejection,
    listingItemId,
    catalogProductId,
    sourceUrl,
    purchasable,
  };
}

/**
 * FUNCAO CENTRAL. Uma identidade so e oferta do Mercado Livre quando vem de
 * uma listing concreta: ITEM_ID valido, origem `listing` e sourceUrl que
 * comprova exatamente aquele item_id.
 */
export function classifyMercadoLivreListingIdentity(
  input: MercadoLivreListingIdentityInput,
): MercadoLivreListingIdentityVerdict {
  const sourceUrl = input.sourceUrl?.trim() || null;
  const catalogProductId =
    input.sourceUrl ? extractMercadoLivreCatalogProductId(input.sourceUrl) : null;

  if (input.origin === "catalog") {
    return rejected(
      "CATALOG_PRODUCT_NOT_LISTING",
      null,
      catalogProductId,
      sourceUrl,
      false,
    );
  }

  const rawItemId = input.listingItemId ?? input.externalId ?? null;
  const itemId = normalizeMercadoLivreListingItemId(rawItemId);

  if (!itemId) {
    return rejected(
      rawItemId ? "INVALID_LISTING_ITEM_ID" : "MISSING_LISTING_ITEM_ID",
      null,
      catalogProductId,
      sourceUrl,
      false,
    );
  }

  if (!sourceUrl) {
    return rejected("MISSING_SOURCE_URL", itemId, catalogProductId, null, false);
  }

  if (isMercadoLivreCatalogSourceUrl(sourceUrl)) {
    return rejected(
      "CATALOG_SOURCE_URL",
      itemId,
      catalogProductId,
      sourceUrl,
      false,
    );
  }

  if (!mercadoLivreSourceUrlProvesListing(sourceUrl, itemId)) {
    return rejected(
      "LISTING_URL_MISMATCH",
      itemId,
      catalogProductId,
      sourceUrl,
      false,
    );
  }

  return {
    valid: true,
    rejection: null,
    listingItemId: itemId,
    catalogProductId,
    sourceUrl,
    purchasable: true,
  };
}

/**
 * FUNCAO CENTRAL reutilizada por todos os writers/importers.
 */
export function isValidMercadoLivreListingIdentity(
  input: MercadoLivreListingIdentityInput,
): boolean {
  return classifyMercadoLivreListingIdentity(input).valid;
}

/**
 * Contrato completo exigido ANTES de persistir uma oferta ML:
 * listingItemId + preco + sourceUrl da listing concreta.
 */
export function classifyMercadoLivreOfferContract(
  input: MercadoLivreOfferContractInput,
): MercadoLivreOfferContractVerdict {
  const base = classifyMercadoLivreListingIdentity(input);
  const price =
    typeof input.price === "number" && Number.isFinite(input.price)
      ? input.price
      : null;
  const sellerId =
    input.sellerId === null || input.sellerId === undefined
      ? null
      : String(input.sellerId).trim() || null;

  if (!base.valid) {
    return { ...base, price, sellerId };
  }

  if (price === null) {
    return { ...base, valid: false, rejection: "MISSING_PRICE", price, sellerId };
  }

  if (price <= 0) {
    return { ...base, valid: false, rejection: "INVALID_PRICE", price, sellerId };
  }

  return { ...base, price, sellerId };
}

/**
 * Gate fail-closed de writer: lanca em vez de gravar oferta ML sem
 * identidade de listing comprovada.
 */
export function assertMercadoLivreListingIdentity(
  input: MercadoLivreOfferContractInput,
  context = "saveProduct",
): MercadoLivreOfferContractVerdict {
  const verdict = classifyMercadoLivreOfferContract(input);

  if (!verdict.valid) {
    throw new Error(
      `[ML_LISTING_FIRST] ${context}: oferta Mercado Livre recusada ` +
        `(${verdict.rejection}). ` +
        `CATALOG PRODUCT != MARKETPLACE OFFER; ` +
        `externalId=${input.externalId ?? input.listingItemId ?? "(vazio)"} ` +
        `sourceUrl=${input.sourceUrl ?? "(vazio)"} ` +
        `catalogProductId=${verdict.catalogProductId ?? "(nenhum)"}`,
    );
  }

  return verdict;
}

/** Mensagem estavel para metricas de trace. */
export function mlListingIdentityRejectionReason(
  input: MercadoLivreListingIdentityInput,
): string {
  return (
    classifyMercadoLivreListingIdentity(input).rejection ??
    "UNKNOWN_LISTING_IDENTITY"
  );
}

export type MercadoLivreLegacyClassification =
  | "LEGACY_LISTING_KNOWN"
  | "LEGACY_CATALOG_ONLY"
  | "LEGACY_BLOCKED_IDENTITY";

/**
 * Classifica a oferta ML ja gravada sem apagar nada. Usado pelos gates e pelo
 * relatorio de legado.
 *
 * - LEGACY_LISTING_KNOWN: item_id valido e sourceUrl (ou ausencia dela)
 *   compativel com uma listing.
 * - LEGACY_CATALOG_ONLY: id com forma de MLB, mas a unica evidencia e de
 *   catalogo (`/p/`) ou o proprio id coincide com o catalog_product_id.
 * - LEGACY_BLOCKED_IDENTITY: id ausente, malformado, MLBU ou URL crua.
 */
export function classifyLegacyMercadoLivreOffer(input: {
  externalId?: string | null;
  sourceUrl?: string | null;
  catalogProductId?: string | null;
}): MercadoLivreLegacyClassification {
  const rawId = input.externalId?.trim() ?? "";
  const sourceUrl = input.sourceUrl?.trim() || null;
  const catalogProductId =
    input.catalogProductId?.trim() ||
    (sourceUrl ? extractMercadoLivreCatalogProductId(sourceUrl) : null);

  if (isUserProductId(rawId) || /^\s*https?:\/\//i.test(rawId)) {
    return "LEGACY_BLOCKED_IDENTITY";
  }

  const itemId = normalizeMercadoLivreListingItemId(rawId);
  if (!itemId) {
    return "LEGACY_BLOCKED_IDENTITY";
  }

  if (catalogProductId && compactId(catalogProductId) === itemId) {
    return "LEGACY_CATALOG_ONLY";
  }

  if (sourceUrl && isMercadoLivreCatalogSourceUrl(sourceUrl)) {
    return "LEGACY_CATALOG_ONLY";
  }

  if (!sourceUrl) {
    /*
     * Sem URL nao da para provar nem o catalogo nem a listing.
     * O id tem forma de listing: tratamos como conhecida, mas a oferta
     * continua sem URL compravel (interna, nao publicavel).
     */
    return "LEGACY_LISTING_KNOWN";
  }

  return mercadoLivreSourceUrlProvesListing(sourceUrl, itemId)
    ? "LEGACY_LISTING_KNOWN"
    : "LEGACY_BLOCKED_IDENTITY";
}

/**
 * `true` quando a oferta pode virar CTA/publicacao. Oferta catalog-only
 * fica no banco, mas nunca e compravel nem publicavel.
 */
export function isPublicavelMercadoLivreOffer(input: {
  externalId?: string | null;
  sourceUrl?: string | null;
  catalogProductId?: string | null;
}): boolean {
  return (
    classifyLegacyMercadoLivreOffer(input) === "LEGACY_LISTING_KNOWN" &&
    isValidMercadoLivreListingIdentity({
      externalId: input.externalId,
      sourceUrl: input.sourceUrl,
      origin: "listing",
    })
  );
}
