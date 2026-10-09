/**
 * CATALOG_WAVE 1 - PLAN ENGINE (FASE L).
 *
 * Saída determinística do planejamento de importação. É o que será
 * consumido quando os feeds reais chegarem (shadow -> plan -> canary).
 */
import type {
  IdentityLevel,
  ImportDecision,
  MerchantSlug,
  OfferAction,
  ReasonCode,
  StagingRecord,
  ValidationStatus,
} from "./types";

export interface CatalogImportPlanItem {
  merchant: MerchantSlug;
  externalId: string;
  decision: ImportDecision;
  offerAction: OfferAction;
  validationStatus: ValidationStatus;
  identityLevel: IdentityLevel;
  matchCandidateProductId: string | null;
  matchConfidence: number | null;
  reasonCodes: ReasonCode[];
  staging: StagingRecord;
}

export interface CatalogImportPlanCounters {
  wouldCreateProducts: number;
  wouldMatchProducts: number;
  wouldCreateOffers: number;
  wouldUpdateOffers: number;
  wouldRemainUnchanged: number;
  wouldReview: number;
  wouldReject: number;
}

export interface MerchantPlanCounters extends CatalogImportPlanCounters {
  total: number;
}

export interface CatalogImportPlan {
  mode: string;
  merchant: MerchantSlug;
  items: CatalogImportPlanItem[];
  counters: CatalogImportPlanCounters;
  duplicateExternalIds: number;
}

export function emptyCounters(): CatalogImportPlanCounters {
  return {
    wouldCreateProducts: 0,
    wouldMatchProducts: 0,
    wouldCreateOffers: 0,
    wouldUpdateOffers: 0,
    wouldRemainUnchanged: 0,
    wouldReview: 0,
    wouldReject: 0,
  };
}

export function summarizePlan(
  items: readonly CatalogImportPlanItem[],
): CatalogImportPlanCounters {
  const counters = emptyCounters();
  for (const item of items) {
    if (item.decision === "CREATE_PRODUCT") counters.wouldCreateProducts += 1;
    else if (item.decision === "MATCH_PRODUCT") counters.wouldMatchProducts += 1;
    else if (item.decision === "REVIEW") counters.wouldReview += 1;
    else if (item.decision === "REJECT") counters.wouldReject += 1;

    if (item.offerAction === "CREATE_OFFER") counters.wouldCreateOffers += 1;
    else if (item.offerAction === "UPDATE_OFFER") counters.wouldUpdateOffers += 1;
    else if (item.offerAction === "UNCHANGED") counters.wouldRemainUnchanged += 1;
  }
  return counters;
}

export function buildPlan(
  mode: string,
  merchant: MerchantSlug,
  items: CatalogImportPlanItem[],
  duplicateExternalIds: number,
): CatalogImportPlan {
  return {
    mode,
    merchant,
    items,
    counters: summarizePlan(items),
    duplicateExternalIds,
  };
}
