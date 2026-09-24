/**
 * CATALOG_ARCHITECTURE_V1 — PUBLICATION GATE CENTRAL (FASE O).
 *
 * PublicationEligibility responde:
 *   eligible: boolean
 *   reasonCodes: string[]
 *   evidence: { publicMarketplaceCount, validOfferCount, identityStatus,
 *               freshness, ... }
 *
 * Nunca retorna apenas boolean sem explicação. Adicionar o marketplace nº 50
 * NÃO altera esta função: ela opera sobre contagem de marketplaces distintos e
 * invariantes de oferta — não sobre nomes.
 *
 * Regras mínimas (preservadas da Fase 3):
 *   - match EXACT
 *   - oferta válida (isUsablePublicOffer: active, EXACT, available,
 *     status != UNAVAILABLE/ERROR, price > 0)
 *   - marketplaces DISTINTOS >= PUBLIC_MULTISTORE_MIN_MARKETPLACES (2)
 *   - freshness FRESH/AGING quando freshness é fornecida (STALE/EXPIRED
 *     nunca disputam melhor oferta — FASE L)
 */

import {
  PUBLIC_MULTISTORE_MIN_MARKETPLACES,
  countDistinctPublicMarketplaces,
  isUsablePublicOffer,
} from "../../../publicVisibility/multiStoreVisibility";
import type { PublicOfferLike } from "../../../publicVisibility/multiStoreVisibility";
import {
  canCompeteForBestOffer,
  classifyFreshness,
} from "../freshness";
import type { FreshnessStateV1, FreshnessTimestampsV1 } from "../freshness";

export type IdentityStatusEvidenceV1 = "EXACT" | "NON_EXACT" | "UNKNOWN";
export type FreshnessEvidenceV1 = FreshnessStateV1 | "UNKNOWN";

export interface PublicationEligibilityEvidenceV1 {
  publicMarketplaceCount: number;
  validOfferCount: number;
  identityStatus: IdentityStatusEvidenceV1;
  freshness: FreshnessEvidenceV1;
  freshnessContractApplied: boolean;
  minPublicMarketplaces: number;
  autoCreated: boolean;
}

export interface PublicationEligibilityInputV1 {
  autoCreated: boolean;
  offers: PublicOfferLike[];
  /** Quando fornecidos, aplica o contrato de frescor (FASE L). */
  freshnessTimestamps?: FreshnessTimestampsV1;
  identityStatusOverride?: IdentityStatusEvidenceV1;
}

export interface PublicationEligibilityVerdictV1 {
  eligible: boolean;
  reasonCodes: string[];
  evidence: PublicationEligibilityEvidenceV1;
}

/** Códigos de razão estáveis da política central. */
export const PUBLICATION_REASON_CODES = {
  MANUAL_PRODUCT: "MANUAL_PRODUCT",
  MULTISTORE_NOT_READY: "MULTISTORE_NOT_READY",
  INSUFFICIENT_PUBLIC_MULTISTORE: "INSUFFICIENT_PUBLIC_MULTISTORE",
  NO_VALID_OFFERS: "NO_VALID_OFFERS",
  IDENTITY_NOT_EXACT: "IDENTITY_NOT_EXACT",
  OFFER_FRESHNESS_STALE: "OFFER_FRESHNESS_STALE",
  OFFER_FRESHNESS_EXPIRED: "OFFER_FRESHNESS_EXPIRED",
  FRESHNESS_UNKNOWN: "FRESHNESS_UNKNOWN",
} as const;

function deriveIdentityStatus(offers: PublicOfferLike[]): IdentityStatusEvidenceV1 {
  const usable = offers.filter(isUsablePublicOffer);
  if (usable.length === 0) return "UNKNOWN";
  const nonExact = usable.some(
    (o) => o.matchStatus !== undefined && o.matchStatus !== "EXACT",
  );
  return nonExact ? "NON_EXACT" : "EXACT";
}

/**
 * Política central de elegibilidade de publicação automática.
 * Fail-closed: informação insuficiente => não elegível.
 */
export function evaluatePublicationEligibility(
  input: PublicationEligibilityInputV1,
): PublicationEligibilityVerdictV1 {
  const { autoCreated, offers, identityStatusOverride } = input;
  const reasonCodes: string[] = [];

  if (autoCreated !== true) {
    // Fluxo MANUAL: liberado (comportamento legado inalterado).
    return {
      eligible: true,
      reasonCodes: [PUBLICATION_REASON_CODES.MANUAL_PRODUCT],
      evidence: {
        publicMarketplaceCount: countDistinctPublicMarketplaces(offers),
        validOfferCount: offers.filter(isUsablePublicOffer).length,
        identityStatus: deriveIdentityStatus(offers),
        freshness: "UNKNOWN",
        freshnessContractApplied: false,
        minPublicMarketplaces: PUBLIC_MULTISTORE_MIN_MARKETPLACES,
        autoCreated,
      },
    };
  }

  const validOffers = offers.filter(isUsablePublicOffer);
  const publicMarketplaceCount = new Set(
    validOffers.map((o) => o.marketplace.trim()).filter(Boolean),
  ).size;

  const identityStatus =
    identityStatusOverride ?? deriveIdentityStatus(offers);

  let freshness: FreshnessEvidenceV1 = "UNKNOWN";
  let freshnessContractApplied = false;
  if (input.freshnessTimestamps) {
    freshnessContractApplied = true;
    freshness = classifyFreshness(input.freshnessTimestamps);
  }

  if (validOffers.length === 0) {
    reasonCodes.push(PUBLICATION_REASON_CODES.NO_VALID_OFFERS);
  }
  if (identityStatus === "NON_EXACT") {
    reasonCodes.push(PUBLICATION_REASON_CODES.IDENTITY_NOT_EXACT);
  }
  if (freshnessContractApplied && freshness === "STALE") {
    reasonCodes.push(PUBLICATION_REASON_CODES.OFFER_FRESHNESS_STALE);
  }
  if (freshnessContractApplied && freshness === "EXPIRED") {
    reasonCodes.push(PUBLICATION_REASON_CODES.OFFER_FRESHNESS_EXPIRED);
  }
  if (freshnessContractApplied && freshness === "UNKNOWN") {
    reasonCodes.push(PUBLICATION_REASON_CODES.FRESHNESS_UNKNOWN);
  }
  if (
    validOffers.length > 0 &&
    publicMarketplaceCount < PUBLIC_MULTISTORE_MIN_MARKETPLACES
  ) {
    reasonCodes.push(PUBLICATION_REASON_CODES.INSUFFICIENT_PUBLIC_MULTISTORE);
  }

  const freshnessCanCompete =
    !freshnessContractApplied ||
    (freshness !== "UNKNOWN" && canCompeteForBestOffer(freshness));

  const eligible =
    validOffers.length > 0 &&
    publicMarketplaceCount >= PUBLIC_MULTISTORE_MIN_MARKETPLACES &&
    identityStatus !== "NON_EXACT" &&
    freshnessCanCompete;

  if (!eligible && reasonCodes.length === 0) {
    reasonCodes.push(PUBLICATION_REASON_CODES.MULTISTORE_NOT_READY);
  }

  return {
    eligible,
    reasonCodes,
    evidence: {
      publicMarketplaceCount,
      validOfferCount: validOffers.length,
      identityStatus,
      freshness,
      freshnessContractApplied,
      minPublicMarketplaces: PUBLIC_MULTISTORE_MIN_MARKETPLACES,
      autoCreated,
    },
  };
}

/**
 * Variante booleana com a MESMA semântica da guarda de ativação automática
 * (autoCreated => hasPublicMultiStore). Aponta para a política central para
 * que "publicado" e "visível" nunca divirjam.
 */
export function publicationEligibleToActivate(
  autoCreated: boolean,
  offers: PublicOfferLike[],
): boolean {
  return evaluatePublicationEligibility({ autoCreated, offers }).eligible;
}