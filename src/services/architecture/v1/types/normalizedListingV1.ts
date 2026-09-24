/**
 * CATALOG_ARCHITECTURE_V1 — NORMALIZED MARKETPLACE LISTING CONTRACT (v1).
 *
 * Todo conector (MarketplaceConnector) deve converter os dados externos da fonte
 * para exatamente este contrato interno antes de o catálogo interpretá-los.
 *
 * Semântica de ausência:
 *  - `null`        => fonte reportou vazio / campo não aplicável.
 *  - `UNKNOWN`     => o dado NÃO foi coletado (capacidade indisponível ou erro).
 *  - array vazio   => fonte reportou nenhum item.
 *
 * Nenhuma regra de negócio central pode depender de nomes de marketplace
 * (ex.: "MERCADO_LIVRE", "SHOPEE"). O núcleo conhece apenas:
 *   marketplaceId, externalListingId, seller, capabilities e payload normalizado.
 */

export const NORMALIZED_LISTING_V1 = "normalized-listing/v1" as const;

/** Marca que um dado não foi coletado (diferente de vazio informado pela fonte). */
export const UNKNOWN = "__UNKNOWN__" as const;
export type UnknownValue = typeof UNKNOWN;

/** T | null | UNKNOWN */
export type MaybeUnknown<T> = T | null | UnknownValue;

export type AvailabilityValue =
  | "IN_STOCK"
  | "OUT_OF_STOCK"
  | "PRE_ORDER"
  | "UNAVAILABLE"
  | UnknownValue;

export type CurrencyCode = string; // ISO 4217, ex.: "BRL"

export interface InstallmentsInfoV1 {
  /** Número de parcelas (ex.: 12). */
  count: number;
  /** Valor da parcela, quando informado pela fonte. */
  value?: number;
  /** Sem juros, quando a fonte expõe essa informação. */
  withoutInterest?: boolean;
}

export interface NormalizedSellerV1 {
  /** Identificador do vendedor DENTRO da fonte. Nunca identidade global. */
  externalSellerId: string | null | UnknownValue;
  name: string | null | UnknownValue;
}

export interface NormalizedIdentityV1 {
  /** GTIN/EAN/UPC informados pela fonte. Evidência de identidade, não identidade de listing. */
  gtin: string[];
  mpn: string | null | UnknownValue;
  manufacturerModel: string | null | UnknownValue;
  brand: string | null | UnknownValue;
  model: string | null | UnknownValue;
}

export interface NormalizedCatalogV1 {
  title: string | null | UnknownValue;
  description: string | null | UnknownValue;
  category: string | null | UnknownValue;
  images: string[];
  /** Atributos genéricos (specs) da fonte, chave => valor. */
  attributes: Record<string, string | number | boolean | string[] | null>;
  /** URLs que participam do catalogHash quando a fonte as altera estruturalmente. */
  primaryImageUrl: string | null | UnknownValue;
}

export interface NormalizedVariantV1 {
  color: string | null | UnknownValue;
  storage: string | null | UnknownValue;
  memory: string | null | UnknownValue;
  voltage: string | null | UnknownValue;
  size: string | null | UnknownValue;
  /** Atributos adicionais de variante (ex.: "capacidade", "acabamento"). */
  otherAttributes: Record<string, string | number | boolean | string[] | null>;
}

export interface NormalizedCommerceV1 {
  price: number;
  oldPrice: number | null | UnknownValue;
  pixPrice: number | null | UnknownValue;
  installments: InstallmentsInfoV1 | null | UnknownValue;
  stock: number | null | UnknownValue;
  availability: AvailabilityValue;
  /** Dica de frete (ex.: "Gratis", "R$ 12,90"). Nunca afeta identidade. */
  shippingHint: string | null | UnknownValue;
  /** Promoção ativa reportada pela fonte (nunca afeta identidade). */
  promotion: string | null | UnknownValue;
}

export interface NormalizedMetadataV1 {
  /** Momento reportado pela fonte como última atualização do anúncio. */
  sourceUpdatedAt: string | null | UnknownValue;
  /** Momento da coleta. */
  collectedAt: string;
  /** Hash do payload bruto da fonte (permite detectar payload idêntico). */
  rawHash: string;
  /** Versão do schema do payload bruto (para reprocessamento futuro). */
  payloadVersion: string;
}

export interface NormalizedMarketplaceListingV1 {
  /** Versão fixa do contrato. */
  contractVersion: typeof NORMALIZED_LISTING_V1;

  /** Identificador do conector que produziu o payload (ex.: "fake-connector-a"). */
  source: string;

  /** MarketplaceId CANÔNICO interno (estável). Nunca nome exibido/domínio/URL. */
  marketplaceId: string;

  /**
   * Identidade da listing DENTRO da fonte.
   * UNIQUE(marketplaceId, externalListingId) é a invariante de idempotência.
   * Seller SKU / GTIN / URL NUNCA identificam a listing.
   */
  externalListingId: string;

  seller: NormalizedSellerV1;
  identity: NormalizedIdentityV1;
  catalog: NormalizedCatalogV1;
  variant: NormalizedVariantV1;
  commerce: NormalizedCommerceV1;
  metadata: NormalizedMetadataV1;
}

/** Chave de identidade de listing (FASE F — SOURCE LISTING IDENTITY). */
export interface SourceListingKeyV1 {
  marketplaceId: string;
  externalListingId: string;
}

export function sourceListingKeyV1(
  marketplaceId: string,
  externalListingId: string,
): SourceListingKeyV1 {
  return { marketplaceId, externalListingId };
}

/** Coletores aceitos por uma fonte (eixo de coleta do conector). */
export const OFFER_HASH_PAYLOAD_VERSION = "normalized-listing/v1" as const;

/** Versão de reprocessamento do payload bruto. */
export const DEFAULT_PAYLOAD_VERSION = "raw/v1" as const;

export function listingKeyEquals(
  a: SourceListingKeyV1,
  b: SourceListingKeyV1,
): boolean {
  return (
    a.marketplaceId === b.marketplaceId &&
    a.externalListingId === b.externalListingId
  );
}