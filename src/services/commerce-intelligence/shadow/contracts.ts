import type { IdentityConfidence, Marketplace, Prisma, PrismaClient } from '@prisma/client';
import type { Attributes, ObservedIdentifier, PriceComponent, computeEffectivePrice } from '../domain';
export interface CommerceShadowInput {
  marketplace: Marketplace; externalId: string; title?: string | null;
  sellerId?: string | null; sellerName?: string | null;
  price?: string | number | null; oldPrice?: string | number | null; currency: string;
  stock?: number | null; available?: boolean | null;
  sourceUrl?: string | null; affiliateLink?: string | null;
  attributes?: Attributes; brand?: string; modelNumber?: string; ean?: string; gtin?: string; upc?: string; mpn?: string;
  capturedAt: string; provenance: {sourceFlow: string}; rawListingId?: string;
  pricing?: {
    oldPriceIsListPrice?: boolean;
    shipping?: string | number;
    coupon?: {amount: string | number; eligible?: boolean};
    pix?: {amount: string | number; eligible?: boolean};
    membership?: {amount: string | number; eligible?: boolean};
    installment?: {total: string | number; count: number; complete: boolean};
  };
}
export interface ShadowConfig {
  enabled: boolean; marketplace?: Marketplace; externalId?: string; maxWrites: number;
  dryRun: boolean; requireExactIdentity: boolean; recordConflicts: boolean;
}
export const eligibilityReasons = [
  'SHADOW_DISABLED','MARKETPLACE_NOT_ALLOWED','EXTERNAL_ID_NOT_ALLOWED','WRITE_BUDGET_ZERO',
  'DRY_RUN','IDENTITY_NOT_EXACT','MISSING_EXTERNAL_ID','INVALID_INPUT','RAW_NOT_REQUIRED','READY',
  'LOCAL_TARGET_REQUIRED','PRODUCTION_FORBIDDEN','FOUNDATION_FLAG_OFF','BUDGET_EXHAUSTED','CONFLICT_RECORDING_DISABLED',
] as const;
export type EligibilityReason = typeof eligibilityReasons[number];
export interface ShadowIdentity {
  status: 'EXACT' | 'HIGH' | 'UNRESOLVED' | 'CONFLICT'; confidence: IdentityConfidence;
  productId: string | null; candidateIds: string[]; method: string; conflictReason?: string;
}
export type OfferPriceComponentDraft = PriceComponent & {source: string};
export interface ShadowTrustDraft {
  signalType: 'IDENTITY_EXACT' | 'IDENTIFIER_VALID' | 'SELLER_PRESENT' | 'PRICE_OBSERVED' | 'AVAILABILITY_OBSERVED' | 'SOURCE_URL_PRESENT' | 'AFFILIATE_LINK_PRESENT' | 'PRICE_COMPONENT_COMPLETE';
  state: 'CONFIRMED' | 'UNKNOWN'; evidence: Prisma.InputJsonObject;
}
export interface CommerceShadowPlan {
  identifiers: ObservedIdentifier[]; attributes: Record<string,string>;
  identity: ShadowIdentity; variant: {variantKey:string; attributes:Record<string,string>} | null;
  observation: {fingerprint:string; productId:string|null; rawListingId:string|null; components:OfferPriceComponentDraft[]; provenance:Prisma.InputJsonObject};
  priceTruth: ReturnType<typeof computeEffectivePrice>; trustSignals:ShadowTrustDraft[];
}
export interface CommerceShadowResult {
  status:'CREATED'|'DEDUPED'|'BLOCKED'|'DRY_RUN'|'FAILED'; eligible:boolean; reason:string;
  identity:ShadowIdentity|null; variant:CommerceShadowPlan['variant'];
  observation:(CommerceShadowPlan['observation'] & {id?:string})|null;
  priceTruth:CommerceShadowPlan['priceTruth']|null; trustSignals:ShadowTrustDraft[];
  writesPlanned:number; writesPerformed:number; deduped:boolean; conflict:boolean; durationMs:number; timings:{identityMs:number;purePipelineMs:number;dbWriteMs:number};
}
export type ShadowEvent = {
  event:'COMMERCE_SHADOW_ATTEMPT'|'COMMERCE_SHADOW_BLOCKED'|'COMMERCE_SHADOW_DRY_RUN'|'COMMERCE_SHADOW_CREATED'|'COMMERCE_SHADOW_DEDUPED'|'COMMERCE_SHADOW_FAILED'|'COMMERCE_SHADOW_CONFLICT';
  marketplace:string; externalIdSafe:string; reason:string; identityConfidence?:IdentityConfidence;
  observationFingerprintPrefix?:string; durationMs:number; writeCount:number;
};
export interface ShadowDependencies {
  getClient?:()=>Promise<PrismaClient>; env?:Record<string,string|undefined>;
  connectionString?:string; deploymentEnv?:string; log?:(event:ShadowEvent)=>void;
  budget?:WriteBudget;
}
/** Counts committed canary transactions, not SQL rows. Reservations include in-flight attempts. */
export class WriteBudget {
  committed=0; private reserved=0;
  remaining(limit:number) {return Math.max(0,limit-this.committed-this.reserved);}
  reserve(limit:number):(()=>void)|null {
    if(this.remaining(limit)===0)return null;
    this.reserved++;let completed=false;
    return ()=>{if(!completed){this.reserved--;completed=true;}};
  }
  commit(release:()=>void) {this.committed++;release();}
}
