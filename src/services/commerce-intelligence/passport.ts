import type { Product, ProductIdentifier, ProductVariant, IdentityEvidence, IdentityConflict, OfferObservation, OfferPriceComponent, TrustSignal, ProductRelation, IdentityConfidence } from '@prisma/client';
import type { computeEffectivePrice } from './domain';
/** Read contract only; no route, table, query or writer. */
export interface ProductPassport {
  canonicalIdentity: Pick<Product,'id'|'canonicalName'|'brand'|'modelNumber'>;
  identifiers: ProductIdentifier[];
  variants: ProductVariant[];
  identity: {confidence?:IdentityConfidence; evidence:IdentityEvidence[]; conflicts:IdentityConflict[]};
  offers: Array<{observation:OfferObservation; components:OfferPriceComponent[]; priceTruth:ReturnType<typeof computeEffectivePrice>}>;
  trustSignals: TrustSignal[];
  relations: ProductRelation[];
  provenance: Array<{source:string; observedAt:string; evidence:unknown}>;
}
