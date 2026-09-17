import type { Prisma, PrismaClient } from '@prisma/client';
import { commerceEnabled, type CommerceFlag } from './flags';
import { buildObservationFingerprint, buildVariantKey, extractIdentifiers, normalizeAttributes, type ObservationState, type Attributes } from './domain';

type Models = Pick<PrismaClient, 'productIdentifier' | 'productVariant' | 'identityEvidence' | 'identityConflict' | 'offerObservation' | 'offerPriceComponent' | 'trustSignal' | 'productRelation'>;
export type WriteResult<T> = {status: 'disabled'} | {status:'written'; value:T};
/** Internal only. OFF returns before obtaining a DB client. No legacy imports. */
export function createCommerceRepositories(getClient: () => Models, enabled: (flag: CommerceFlag) => boolean = commerceEnabled) {
  async function gated<T>(flag: CommerceFlag, write: () => Promise<T>): Promise<WriteResult<T>> {
    if (!enabled(flag)) return {status:'disabled'};
    return {status:'written',value:await write()};
  }
  async function validateVariant(productId: string | null | undefined, variantId: string | null | undefined) {
    if (!variantId) return;
    if (!enabled('COMMERCE_VARIANTS_ENABLED')) throw new Error('VARIANTS_DISABLED');
    const variant = await getClient().productVariant.findUnique({where:{id:variantId}});
    if (!variant || (productId && variant.productId !== productId)) throw new Error('VARIANT_PRODUCT_MISMATCH');
  }
  return {
    productIdentifierRepository: {
      create: (data: Omit<Prisma.ProductIdentifierUncheckedCreateInput,'conflicts'>) => gated('COMMERCE_IDENTITY_GRAPH_ENABLED', async () => {
        if ('conflicts' in data) throw new Error('NESTED_WRITE_FORBIDDEN');
        if (data.variantId && !enabled('COMMERCE_VARIANTS_ENABLED')) throw new Error('VARIANTS_DISABLED');
        const observed = extractIdentifiers({brand:data.brandScope ?? undefined, marketplace:data.marketplace ?? undefined, externalId:data.type === 'MARKETPLACE_EXTERNAL_ID' ? data.value : undefined, attributes:{[data.type.toLowerCase()]:data.value}}).find(i=>i.type===data.type);
        if (!observed?.valid || observed.normalizedValue !== data.normalizedValue) throw new Error('INVALID_IDENTIFIER');
        if (['MPN','MODEL','BRAND_SKU'].includes(data.type) && !data.brandScope) throw new Error('BRAND_SCOPE_REQUIRED');
        await validateVariant(data.productId, data.variantId);
        return getClient().productIdentifier.create({data:{...data,brandScope:observed.brandScope}});
      }),
    },
    variantRepository: {
      upsert: (productId:string, attributes:Attributes, name?:string) => gated('COMMERCE_VARIANTS_ENABLED', () => {
        const normalized=normalizeAttributes(attributes); const variantKey=buildVariantKey(attributes);
        return getClient().productVariant.upsert({where:{productId_variantKey:{productId,variantKey}}, create:{productId,variantKey,name,attributes:normalized,...normalized}, update:{active:true}});
      }),
    },
    identityEvidenceRepository: {
      append: (data:Omit<Prisma.IdentityEvidenceUncheckedCreateInput,'conflicts'>) => gated('COMMERCE_IDENTITY_GRAPH_ENABLED', async () => {
        if(data.variantId && !enabled('COMMERCE_VARIANTS_ENABLED')) throw new Error('VARIANTS_DISABLED');
        if ('conflicts' in data) throw new Error('NESTED_WRITE_FORBIDDEN');
        await validateVariant(data.productId, data.variantId);
        return getClient().identityEvidence.create({data});
      }),
    },
    identityConflictRepository: {
      record: (data:Prisma.IdentityConflictUncheckedCreateInput) => gated('COMMERCE_IDENTITY_GRAPH_ENABLED', () => getClient().identityConflict.create({data:{...data,status:'OPEN',resolvedAt:null}})),
    },
    offerObservationRepository: {
      append: (data: Omit<Prisma.OfferObservationUncheckedCreateInput,'fingerprint'|'components'|'trustSignals'>, state:ObservationState) => gated('OFFER_LEDGER_ENABLED', async () => {
        if (data.variantId && !enabled('COMMERCE_VARIANTS_ENABLED')) throw new Error('VARIANTS_DISABLED');
        if (state.components?.length && !enabled('PRICE_TRUTH_ENABLED')) throw new Error('PRICE_TRUTH_DISABLED');
        await validateVariant(data.productId, data.variantId);
        // Hash persisted state, never trust a caller-supplied fingerprint.
        const fingerprint=buildObservationFingerprint({...state,marketplace:data.marketplace,externalId:data.externalId,price:data.price == null ? null : String(data.price),oldPrice:data.oldPrice == null ? null : String(data.oldPrice),currency:data.currency ?? 'BRL',stock:data.stock,available:data.available,sellerId:data.sellerId,sellerName:data.sellerName,title:data.title,sourceUrl:data.sourceUrl,affiliateLink:data.affiliateLink});
        const components=state.components?.map(c=>({...c,conditions:c.conditions ? c.conditions as Prisma.InputJsonObject : undefined,source:c.source ?? 'observed'}));
        if ('trustSignals' in data || 'components' in data) throw new Error('NESTED_WRITE_FORBIDDEN');
        const create={...data,fingerprint,components:components?.length ? {create:components} : undefined};
        const where={marketplace_externalId_fingerprint:{marketplace:data.marketplace,externalId:data.externalId,fingerprint}};
        const existing=await getClient().offerObservation.findUnique({where});
        if(existing)return existing;
        try { return await getClient().offerObservation.create({data:create}); }
        catch(e) {
          if ((e as {code?:string}).code !== 'P2002') throw e;
          const existing=await getClient().offerObservation.findUnique({where:{marketplace_externalId_fingerprint:{marketplace:data.marketplace,externalId:data.externalId,fingerprint}}});
          if (!existing) throw e; return existing;
        }
      }),
    },
    trustSignalRepository: {
      append: (data:Prisma.TrustSignalUncheckedCreateInput) => gated('TRUST_SIGNALS_ENABLED', () => {
        const refs: Record<string,string|undefined|null>={PRODUCT:data.productId,RAW_LISTING:data.rawListingId,OFFER_OBSERVATION:data.observationId,MARKETPLACE_OFFER:data.marketplaceOfferId};
        if(refs[data.scopeType]!==data.scopeId || Object.values(refs).filter(Boolean).length!==1) throw new Error('INVALID_TRUST_SCOPE');
        return getClient().trustSignal.create({data});
      }),
    },
    productRelationRepository: {
      create: (data:Prisma.ProductRelationUncheckedCreateInput) => gated('COMMERCE_IDENTITY_GRAPH_ENABLED', () => {
        if(data.fromProductId===data.toProductId) throw new Error('SELF_RELATION');
        return getClient().productRelation.create({data});
      }),
    },
  };
}
