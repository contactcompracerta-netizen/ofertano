import {extractIdentifiers,normalizeAttributes,buildVariantKey,buildObservationFingerprint,computeEffectivePrice} from '../domain';
import type {CommerceShadowInput,CommerceShadowPlan,OfferPriceComponentDraft,ShadowIdentity,ShadowTrustDraft} from './contracts';
export function sanitizeShadowUrl(value:string|null|undefined):string|null {
  if(!value)return null;
  try {const url=new URL(value);if(!['http:','https:'].includes(url.protocol))return null;url.username='';url.password='';
    for(const key of [...url.searchParams.keys()])if(/token|secret|password|signature|api[_-]?key|authorization|credential/i.test(key))url.searchParams.delete(key);
    url.hash='';return url.toString();
  } catch {return null;}
}
export function derivePriceComponents(input:CommerceShadowInput):OfferPriceComponentDraft[] {
  const components:OfferPriceComponentDraft[]=[];
  const add=(type:OfferPriceComponentDraft['type'],amount:string|number,conditions?:OfferPriceComponentDraft['conditions'])=>components.push({type,amount,currency:input.currency,truthState:'EXACT',source:'shadow-observed-v1',...(conditions?{conditions}:{})});
  if(input.price!=null)add('SALE_PRICE',input.price);
  if(input.oldPrice!=null&&input.pricing?.oldPriceIsListPrice===true&&input.price!=null&&Number(input.oldPrice)>=Number(input.price))add('LIST_PRICE',input.oldPrice);
  const p=input.pricing;
  if(p?.shipping!=null)add('SHIPPING',p.shipping);
  if(p?.coupon)add('COUPON',p.coupon.amount,{...(p.coupon.eligible===undefined?{}:{eligible:p.coupon.eligible})});
  if(p?.pix)add('PIX_DISCOUNT',p.pix.amount,{...(p.pix.eligible===undefined?{}:{eligible:p.pix.eligible})});
  if(p?.membership)add('MEMBERSHIP_PRICE',p.membership.amount,{...(p.membership.eligible===undefined?{}:{eligible:p.membership.eligible})});
  if(p?.installment?.complete===true&&Number.isSafeInteger(p.installment.count)&&p.installment.count>0)add('INSTALLMENT_TOTAL',p.installment.total,{installments:p.installment.count,eligible:true});
  return components;
}
export function deriveTrustSignals(input:CommerceShadowInput,identity:ShadowIdentity,truth:ReturnType<typeof computeEffectivePrice>):ShadowTrustDraft[] {
  const identifiers=extractIdentifiers(input);
  const values:[ShadowTrustDraft['signalType'],boolean][]=[
    ['IDENTITY_EXACT',identity.status==='EXACT'],['IDENTIFIER_VALID',identifiers.some(i=>i.valid&&(['GTIN','EAN','UPC'].includes(i.type)||(i.type==='MPN'&&!!i.brandScope)))],
    ['SELLER_PRESENT',!!(input.sellerId?.trim()||input.sellerName?.trim())],['PRICE_OBSERVED',input.price!=null],
    ['AVAILABILITY_OBSERVED',input.available!=null],['SOURCE_URL_PRESENT',!!sanitizeShadowUrl(input.sourceUrl)],['AFFILIATE_LINK_PRESENT',!!sanitizeShadowUrl(input.affiliateLink)],['PRICE_COMPONENT_COMPLETE',truth.state==='EXACT'],
  ];
  return values.map(([signalType,present])=>({signalType,state:present?'CONFIRMED':'UNKNOWN',evidence:{observed:present,shadowVersion:'50ag2-v1'}}));
}
export function buildShadowPlan(input:CommerceShadowInput,identity:ShadowIdentity,variantsEnabled:boolean):CommerceShadowPlan {
  const identifiers=extractIdentifiers(input);const attributes=normalizeAttributes(input.attributes??{});
  const semantic=Object.entries(attributes).some(([key,value])=>key!=='modelNumber'&&!!value&&!value.includes('|'))&&!Object.values(attributes).some(v=>v.includes('|'));
  const variant=variantsEnabled&&identity.status==='EXACT'&&semantic?{variantKey:buildVariantKey(input.attributes??{}),attributes}:null;
  const components=derivePriceComponents(input);const priceTruth=computeEffectivePrice(components);
  // A computed final may remain PARTIAL (e.g. shipping unknown); never manufacture a missing value.
  components.push({type:'FINAL_EFFECTIVE_PRICE',amount:priceTruth.value??null,currency:input.currency,truthState:priceTruth.state,source:'shadow-derived-v1',conditions:{eligible:true,explanation:priceTruth.explanation}});
  const fingerprint=buildObservationFingerprint({...input,sourceUrl:sanitizeShadowUrl(input.sourceUrl),affiliateLink:sanitizeShadowUrl(input.affiliateLink),attributes:input.attributes??{},components});
  return {identifiers,attributes,identity,variant,observation:{fingerprint,productId:identity.productId,rawListingId:input.rawListingId??null,components,provenance:{sourceFlow:input.provenance.sourceFlow,shadowVersion:'50ag2-v1',capturedAt:input.capturedAt,marketplace:input.marketplace,externalId:input.externalId,identityMethod:identity.method,inputFingerprintVersion:'v2',inputFingerprint:fingerprint}},priceTruth,trustSignals:deriveTrustSignals(input,identity,priceTruth)};
}
