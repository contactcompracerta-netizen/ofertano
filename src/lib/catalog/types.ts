/**
 * CATALOG_WAVE 1 - tipos centrais do scaffolding.
 *
 * Camadas de identidade (auditoria FASE A):
 *   source           -> "AWIN"          (origem do feed)
 *   affiliateNetwork -> "AWIN"          (rede de afiliados; NÃO é marketplace)
 *   merchant         -> slug da loja    (kabum | cama-in-box | olympikus | leveros)
 *
 * O enum `Marketplace` do Prisma NÃO participa deste módulo.
 */
import type { NormalizedAwinFeedItem } from "../feed/awinAdapter";

/** Origem do feed (rede de afiliados usada como fonte). */
export const CATALOG_SOURCE = "AWIN" as const;
export type CatalogSource = typeof CATALOG_SOURCE;

/** Rede de afiliados. Rede != marketplace != merchant. */
export const AWIN_AFFILIATE_NETWORK = "AWIN" as const;
export type AffiliateNetwork = typeof AWIN_AFFILIATE_NETWORK;

/** Merchants aprovados para a Wave 1. */
export type MerchantSlug = "kabum" | "cama-in-box" | "olympikus" | "leveros";

/** Modos de execução do CatalogImporterV1. */
export type CatalogImportMode = "DISABLED" | "DRY_RUN" | "SHADOW" | "CANARY" | "LIVE";

export type ValidationStatus = "VALID" | "PARTIAL" | "INVALID";

/** A = GTIN válido | B = brand + model/MPN forte | C = parcial | D = fraco. */
export type IdentityLevel = "A" | "B" | "C" | "D";

/** Decisão primária por item (FASE E). */
export type ImportDecision =
  | "CREATE_PRODUCT"
  | "MATCH_PRODUCT"
  | "REVIEW"
  | "REJECT";

/** Ação de oferta secundária (contadores do plan, FASE L). */
export type OfferAction = "NONE" | "CREATE_OFFER" | "UPDATE_OFFER" | "UNCHANGED";

export type ReasonCode =
  | "REJECT_UNAPPROVED_SOURCE"
  | "MISSING_EXTERNAL_ID"
  | "DUPLICATE_EXTERNAL_ID"
  | "MISSING_TITLE"
  | "INVALID_PRICE"
  | "INVALID_CURRENCY"
  | "INVALID_DESTINATION_URL"
  | "INVALID_AFFILIATE_URL"
  | "MISSING_AFFILIATE_URL"
  | "UNAVAILABLE_ITEM"
  | "MISSING_IMAGE"
  | "INVALID_GTIN_IGNORED"
  | "WEAK_IDENTITY"
  | "PARTIAL_IDENTITY"
  | "GTIN_CONFLICT"
  | "CROSS_BRAND_NO_MATCH"
  | "MODEL_INCOMPATIBLE"
  | "MATCH_GTIN_EXACT"
  | "MATCH_BRAND_MPN"
  | "MATCH_BRAND_MODEL"
  | "MATCH_ATTRIBUTES"
  | "MATCH_TITLE_SIMILARITY"
  | "AUTO_MATCH"
  | "REVIEW_THRESHOLD"
  | "NEW_PRODUCT_CANDIDATE"
  | "CANARY_LIMIT_REACHED"
  | "OFFER_UNCHANGED"
  | "OFFER_PRICE_CHANGED";

/** Item de entrada já normalizado pelo adapter AWIN do feed engine. */
export type CatalogFeedItem = NormalizedAwinFeedItem;

/** Linha de staging (espelha a tabela CatalogImportStagingItem). */
export interface StagingRecord {
  source: CatalogSource;
  affiliateNetwork: AffiliateNetwork;
  merchant: MerchantSlug;
  externalId: string;

  title: string;
  description?: string;

  brand?: string;
  gtin?: string;
  mpn?: string;
  model?: string;

  category?: string;

  price: number | null;
  currency: string;

  imageUrl?: string;
  destinationUrl?: string;
  affiliateUrl?: string;

  attributes?: Record<string, unknown>;

  validationStatus: ValidationStatus;
  identityLevel: IdentityLevel;

  matchCandidateProductId: string | null;
  matchConfidence: number | null;

  decision: ImportDecision;
  reasonCodes: ReasonCode[];

  runId?: string;
}

/** Referência mínima de Product existente usada pelo matcher. */
export interface ExistingProductRef {
  id: string;
  name: string;
  brand?: string | null;
  gtin?: string | null;
  ean?: string | null;
  mpn?: string | null;
  modelNumber?: string | null;
  category?: string | null;
}

/** Referência mínima de Offer existente usada pelo plan engine. */
export interface ExistingOfferRef {
  id: string;
  productId: string;
  merchant: string;
  externalId: string;
  price: number;
  active: boolean;
}
