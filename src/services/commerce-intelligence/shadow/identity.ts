import type { Prisma, PrismaClient } from '@prisma/client';
import { extractIdentifiers, type ObservedIdentifier } from '../domain';
import type {CommerceShadowInput,ShadowIdentity} from './contracts';
type Reader=Pick<PrismaClient,'productIdentifier'|'marketplaceOffer'|'product'>;
const normalized=(v:string)=>v.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
function gtinForms(value:string) {
  const canonical=value.padStart(14,'0');
  return [8,12,13,14].filter(n=>/^0*$/.test(canonical.slice(0,14-n))).map(n=>canonical.slice(14-n));
}
export async function resolveShadowIdentity(input:CommerceShadowInput,identifiers:ObservedIdentifier[],db:Reader):Promise<ShadowIdentity> {
  const clauses:Prisma.ProductIdentifierWhereInput[]=[];
  for(const id of identifiers.filter(i=>i.valid)) {
    if(['GTIN','EAN','UPC'].includes(id.type))clauses.push({type:{in:['GTIN','EAN','UPC']},normalizedValue:{in:gtinForms(id.normalizedValue)}});
    if(id.type==='MARKETPLACE_EXTERNAL_ID')clauses.push({type:id.type,normalizedValue:id.normalizedValue,marketplace:input.marketplace});
    if(id.type==='MPN'&&id.brandScope)clauses.push({type:id.type,normalizedValue:id.normalizedValue,brandScope:id.brandScope});
  }
  const rows=clauses.length?await db.productIdentifier.findMany({where:{OR:clauses},take:17}):[];
  const offer=await db.marketplaceOffer.findUnique({where:{marketplace_externalId:{marketplace:input.marketplace,externalId:input.externalId}},select:{productId:true}});
  const validRows=rows.filter(row=>{
    const observed=extractIdentifiers({brand:row.brandScope??undefined,marketplace:row.marketplace??undefined,externalId:row.type==='MARKETPLACE_EXTERNAL_ID'?row.value:undefined,attributes:{[row.type.toLowerCase()]:row.value}}).find(i=>i.type===row.type);
    return observed?.valid&&observed.normalizedValue===row.normalizedValue;
  });
  const ids=[...new Set([...validRows.map(r=>r.productId),...(offer?[offer.productId]:[])])].sort();
  const conflict=(reason:string):ShadowIdentity=>({status:'CONFLICT',confidence:'LOW',productId:null,candidateIds:ids,method:'conflicting-strong-identifiers',conflictReason:reason});
  if(rows.length>=17)return conflict('CANDIDATE_LIMIT_REACHED');
  if(ids.length>1)return conflict('MULTIPLE_STRONG_IDENTITIES');
  if(ids.length===1) {
    const product=await db.product.findUnique({where:{id:ids[0]},select:{brand:true}});
    if(!product)return conflict('MISSING_CANDIDATE');
    if(input.brand&&product.brand&&normalized(input.brand)!==normalized(product.brand))return conflict('BRAND_CONTRADICTION');
    return {status:'EXACT',confidence:'EXACT',productId:ids[0],candidateIds:ids,method:offer?'marketplace-external-id':validRows.some(r=>['GTIN','EAN','UPC'].includes(r.type))?'validated-gtin':validRows.some(r=>r.type==='MPN')?'brand-mpn':'marketplace-external-id'};
  }
  const model=identifiers.find(i=>i.type==='MODEL'&&i.brandScope);
  const weak=model?await db.productIdentifier.findMany({where:{type:'MODEL',normalizedValue:model.normalizedValue,brandScope:model.brandScope},take:2}):[];
  if(weak.length===1)return {status:'HIGH',confidence:'HIGH',productId:null,candidateIds:[weak[0].productId],method:'brand-model-diagnostic-only'};
  return {status:'UNRESOLVED',confidence:'LOW',productId:null,candidateIds:[],method:'no-strong-link'};
}
