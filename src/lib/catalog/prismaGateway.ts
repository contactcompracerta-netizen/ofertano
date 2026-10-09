import type { Marketplace, Prisma, PrismaClient } from "@prisma/client";
import { sincronizarMelhorOfertaDoProduto } from "@/services/database/saveProduct";
import { upsertOfertaListingAware, withUniqueRaceRetry } from "@/services/database/marketplaceOfferWriter";
import { buildBlockingKeys, canonicalModel, CANDIDATE_BLOCKING_KEY_V1 } from "@/services/architecture/v1/identity/candidateGeneration";
import { NORMALIZED_LISTING_V1, UNKNOWN, type NormalizedMarketplaceListingV1 } from "@/services/architecture/v1/types/normalizedListingV1";
import type { CatalogWriteGateway, CatalogWriteOps, OfferDraft, ProductDraft } from "./transaction";
import type { MerchantSlug } from "./types";

type CatalogTx = Prisma.TransactionClient;
const MARKETPLACE: Record<MerchantSlug, Marketplace> = { kabum:"KABUM", "cama-in-box":"CAMA_IN_BOX", olympikus:"OLYMPIKUS", leveros:"LEVEROS" };
const MARKETPLACE_ID: Record<MerchantSlug,string> = { kabum:"kabum", "cama-in-box":"cama_in_box", olympikus:"olympikus", leveros:"leveros" };
const LABEL: Record<MerchantSlug,string> = { kabum:"KaBuM!", "cama-in-box":"Cama In Box", olympikus:"Olympikus", leveros:"Leveros" };

function merchant(value:string):MerchantSlug {
  if (value==="kabum"||value==="cama-in-box"||value==="olympikus"||value==="leveros") return value;
  throw new Error(`AWIN_MERCHANT_NOT_APPROVED: ${value}`);
}
function marketplaceFor(v:string){return MARKETPLACE[merchant(v)];}
function marketplaceIdFor(v:string){return MARKETPLACE_ID[merchant(v)];}
function labelFor(v:string){return LABEL[merchant(v)];}

function normalized(d:ProductDraft):NormalizedMarketplaceListingV1 {
  const image=d.imageUrl?.trim()||null;
  return {
    contractVersion:NORMALIZED_LISTING_V1, source:"awin-catalog-importer-v1",
    marketplaceId:marketplaceIdFor(d.merchant), externalListingId:d.externalId,
    seller:{externalSellerId:null,name:labelFor(d.merchant)},
    identity:{gtin:d.gtin?[d.gtin]:[],mpn:d.mpn??null,manufacturerModel:d.modelNumber??null,brand:d.brand??null,model:d.modelNumber??null},
    catalog:{title:d.name,description:d.description??null,category:d.category??null,images:image?[image]:[],attributes:{},primaryImageUrl:image},
    variant:{color:UNKNOWN,storage:UNKNOWN,memory:UNKNOWN,voltage:UNKNOWN,size:UNKNOWN,otherAttributes:{}},
    commerce:{price:d.price,oldPrice:null,pixPrice:UNKNOWN,installments:UNKNOWN,stock:UNKNOWN,availability:"IN_STOCK",shippingHint:UNKNOWN,promotion:null},
    metadata:{sourceUpdatedAt:null,collectedAt:new Date().toISOString(),rawHash:`awin:${d.merchant}:${d.externalId}`,payloadVersion:"awin-feed/v1"},
  };
}
async function persistKeys(tx:CatalogTx,productId:string,d:ProductDraft){
  const lexicon=new Set<string>(); const b=canonicalModel(d.brand); if(b) lexicon.add(b);
  const seen=new Set<string>();
  for(const k of buildBlockingKeys(normalized(d),{brandLexicon:lexicon})){
    const id=`${k.type}:${k.normalizedValue}`; if(seen.has(id)) continue; seen.add(id);
    const strength=k.strength==="STRONG"&&k.provenance==="STRUCTURED_FIELD"?"STRONG":"MEDIUM";
    await tx.candidateBlockingKey.upsert({
      where:{productId_keyType_normalizedValue_policyVersion:{productId,keyType:k.type as never,normalizedValue:k.normalizedValue,policyVersion:CANDIDATE_BLOCKING_KEY_V1}},
      create:{productId,keyType:k.type as never,normalizedValue:k.normalizedValue,category:k.category,strength:strength as never,provenance:k.provenance as never,policyVersion:CANDIDATE_BLOCKING_KEY_V1,sourceMarketplace:marketplaceIdFor(d.merchant)},
      update:{category:k.category,strength:strength as never,provenance:k.provenance as never,sourceMarketplace:marketplaceIdFor(d.merchant)},
    });
  }
}
function opsFor(tx:CatalogTx):CatalogWriteOps {
  return {
    async createProduct(d){
      if(!Number.isFinite(d.price)||d.price<=0) throw new Error("AWIN_INVALID_PRODUCT_PRICE");
      if(d.gtin){
        const existing=await tx.product.findFirst({where:{OR:[{gtin:d.gtin},{ean:d.gtin}]},select:{id:true}});
        if(existing) return existing;
      }
      const image=d.imageUrl?.trim(); if(!image) throw new Error("AWIN_PRODUCT_IMAGE_REQUIRED");
      const created=await tx.product.create({data:{
        name:d.name,canonicalName:d.name,image,images:[image],brand:d.brand??null,description:d.description??null,
        category:d.category?.trim()||"Outros",store:labelFor(d.merchant),affiliateLink:d.affiliateUrl?.trim()||"",price:d.price,
        gtin:d.gtin??null,ean:d.gtin??null,mpn:d.mpn??null,modelNumber:d.modelNumber??null,
        active:false,publicationStatus:"DRAFT",autoCreated:true,sourceQuery:`AWIN:${d.merchant}`,
      },select:{id:true}});
      await persistKeys(tx,created.id,d); return created;
    },
    async createOffer(d:OfferDraft){
      if(!Number.isFinite(d.price)||d.price<=0) throw new Error("AWIN_INVALID_OFFER_PRICE");
      const affiliateLink=d.affiliateUrl?.trim()||null; const sourceUrl=d.sourceUrl?.trim()||null;
      const common={externalId:d.externalId,title:d.title,image:d.imageUrl??null,seller:labelFor(d.merchant),price:d.price,sourceUrl,affiliateLink,available:true,active:true,matchStatus:"EXACT" as const,discoverySource:"API" as const,status:affiliateLink?("ACTIVE" as const):("PENDING_AFFILIATE" as const),errorMessage:null};
      const row=await upsertOfertaListingAware({db:tx,productId:d.productId,marketplace:marketplaceFor(d.merchant),externalId:d.externalId,update:common,create:{...common,isBest:false},select:{id:true}});
      await sincronizarMelhorOfertaDoProduto(tx,d.productId); return row;
    },
    async updateOffer(offerId,patch){
      if(!Number.isFinite(patch.price)||patch.price<=0) throw new Error("AWIN_INVALID_OFFER_PRICE");
      const current=await tx.marketplaceOffer.findUnique({where:{id:offerId},select:{productId:true,price:true,affiliateLink:true}});
      if(!current) throw new Error("AWIN_OFFER_NOT_FOUND");
      const affiliateLink=patch.affiliateUrl?.trim()||current.affiliateLink||null;
      await tx.marketplaceOffer.update({where:{id:offerId},data:{price:patch.price,affiliateLink,status:affiliateLink?"ACTIVE":"PENDING_AFFILIATE",available:true,active:true,errorMessage:null,...(Math.abs(current.price-patch.price)>0.009?{lastPriceChangeAt:new Date()}:{})}});
      await sincronizarMelhorOfertaDoProduto(tx,current.productId);
    },
  };
}
export class PrismaCatalogGateway implements CatalogWriteGateway {
  constructor(private readonly prisma:PrismaClient){}
  async transaction<T>(fn:(ops:CatalogWriteOps)=>Promise<T>):Promise<T>{
    return withUniqueRaceRetry(()=>this.prisma.$transaction(async tx=>fn(opsFor(tx))));
  }
}
