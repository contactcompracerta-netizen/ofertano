import { isAwinCronAuthorized, isAwinPhaseEnabled, isEnabled } from "@/lib/catalog/awinRolloutGuards";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { discoverJoinedAwinAdvertiserId, downloadAwinFeedRows, fetchAwinFeedList, listJoinedAwinFeeds } from "@/lib/catalog/awinFeedSource";
import { CatalogImporterV1 } from "@/lib/catalog/importer";
import { PrismaCatalogGateway } from "@/lib/catalog/prismaGateway";
import { PrismaStagingStore } from "@/lib/catalog/prismaStaging";
import { NoWriteGateway } from "@/lib/catalog/transaction";
import type { CatalogImportFlags } from "@/lib/catalog/featureFlags";
import type { ExistingOfferRef, ExistingProductRef, MerchantSlug } from "@/lib/catalog/types";
export const dynamic="force-dynamic"; export const maxDuration=300;
type Phase="SHADOW"|"CANARY"|"LIVE";
const MERCHANTS:ReadonlyArray<{slug:MerchantSlug;aliases:readonly string[];advertiserKey:string;feedKey:string}>=[
 {slug:"kabum",aliases:["KaBuM BR","KaBuM!","KaBuM"],advertiserKey:"AWIN_KABUM_ADVERTISER_ID",feedKey:"AWIN_KABUM_FEED_ID"},
 {slug:"cama-in-box",aliases:["Cama In Box BR","Cama In Box"],advertiserKey:"AWIN_CAMA_IN_BOX_ADVERTISER_ID",feedKey:"AWIN_CAMA_IN_BOX_FEED_ID"},
 {slug:"olympikus",aliases:["Olympikus BR","Olympikus"],advertiserKey:"AWIN_OLYMPIKUS_ADVERTISER_ID",feedKey:"AWIN_OLYMPIKUS_FEED_ID"},
 {slug:"leveros",aliases:["Leveros BR","Leveros"],advertiserKey:"AWIN_LEVEROS_ADVERTISER_ID",feedKey:"AWIN_LEVEROS_FEED_ID"},
];
function merchantFromMarketplace(v:string):MerchantSlug|null{if(v==="KABUM")return"kabum";if(v==="CAMA_IN_BOX")return"cama-in-box";if(v==="OLYMPIKUS")return"olympikus";if(v==="LEVEROS")return"leveros";return null;}
function flagsFor(p:Phase):CatalogImportFlags{return{catalogImportEnabled:true,awinWave1Enabled:true,awinWave1StagingWriteEnabled:p==="SHADOW",awinWave1WriteEnabled:p!=="SHADOW"&&isEnabled(process.env.AWIN_WAVE1_WRITE_ENABLED),awinWave1LiveEnabled:p==="LIVE"&&isEnabled(process.env.AWIN_WAVE1_LIVE_ENABLED),mode:p};}
function parsePhase(v:string|null):Phase|null{const p=v?.trim().toUpperCase();return p==="SHADOW"||p==="CANARY"||p==="LIVE"?p:null;}
function limitFor(raw:string|null,p:Phase){const f=p==="SHADOW"?250:p==="CANARY"?25:100,c=p==="SHADOW"?1000:p==="CANARY"?25:500,n=Number.parseInt(raw??"",10);return Number.isFinite(n)&&n>0?Math.min(Math.trunc(n),c):f;}
async function loadState():Promise<{products:ExistingProductRef[];offers:ExistingOfferRef[]}>{
 const [products,rows]=await Promise.all([
  prisma.product.findMany({select:{id:true,name:true,brand:true,gtin:true,ean:true,mpn:true,modelNumber:true,category:true},take:100000}),
  prisma.marketplaceOffer.findMany({select:{id:true,productId:true,externalId:true,price:true,active:true,marketplace:true},take:200000}),
 ]);
 const offers:ExistingOfferRef[]=rows.flatMap(o=>{const m=merchantFromMarketplace(String(o.marketplace));return m&&o.externalId?[{id:o.id,productId:o.productId,merchant:m,externalId:o.externalId,price:o.price,active:o.active}]:[];});
 return{products,offers};
}
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;
 if(!isAwinCronAuthorized(request.headers.get("authorization"),secret))return NextResponse.json({success:false,error:"Acesso não autorizado."},{status:401});
 if(process.env.AWIN_WAVE1_ROLLOUT_ENABLED?.trim().toLowerCase()!=="true")return NextResponse.json({success:false,error:"AWIN_WAVE1_ROLLOUT_DISABLED"},{status:403});
 const url=new URL(request.url),phase=parsePhase(url.searchParams.get("phase")); if(!phase)return NextResponse.json({success:false,error:"PHASE_REQUIRED: SHADOW|CANARY|LIVE"},{status:400});
 if(!isAwinPhaseEnabled(phase,process.env))return NextResponse.json({success:false,error:"AWIN_PHASE_NOT_ENABLED"},{status:403});
 const apiKey=process.env.AWIN_DATAFEED_API_KEY?.trim(); if(!apiKey)return NextResponse.json({success:false,error:"AWIN_DATAFEED_API_KEY_MISSING"},{status:503});
 const maxRows=limitFor(url.searchParams.get("limit"),phase),runId=`awin-${phase.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g,"-")}`;
 const productsBefore=await prisma.product.count(),offersBefore=await prisma.marketplaceOffer.count();
 try{
  const feeds=await fetchAwinFeedList(apiKey,{maxBytes:8*1024*1024,timeoutMs:30000}); if(feeds.length===0)throw new Error("AWIN_FEED_LIST_EMPTY");
  const reports:Array<Record<string,unknown>>=[];let failures=0;
  for(const m of MERCHANTS){try{
    const advertiserId=process.env[m.advertiserKey]?.trim()||discoverJoinedAwinAdvertiserId(feeds,m.aliases);
    const configuredFeedId=process.env[m.feedKey]?.trim();
    const joinedFeeds=configuredFeedId
      ? listJoinedAwinFeeds(feeds,advertiserId).filter(feed=>feed.feedId===configuredFeedId)
      : listJoinedAwinFeeds(feeds,advertiserId);
    if(joinedFeeds.length===0)throw new Error("AWIN_JOINED_FEED_NOT_FOUND");
    const byExternalId=new Map<string,Awaited<ReturnType<typeof downloadAwinFeedRows>>[number]>();
    const feedReports:Array<{feedId:string;feedName:string;lastImported:string;rows:number}>=[];
    for(const feed of joinedFeeds.slice(0,10)){
      if(byExternalId.size>=maxRows)break;
      const part=await downloadAwinFeedRows(feed,{maxRows:maxRows-byExternalId.size,maxBytes:64*1024*1024,maxDecodedBytes:128*1024*1024,timeoutMs:60000});
      feedReports.push({feedId:feed.feedId,feedName:feed.feedName,lastImported:feed.lastImported,rows:part.length});
      for(const raw of part){
        const externalId=String(raw.productId??raw.sku??raw.id??"").trim();
        if(externalId&&!byExternalId.has(externalId))byExternalId.set(externalId,raw);
      }
    }
    const rows=[...byExternalId.values()]; if(rows.length===0)throw new Error("EMPTY_FEED_SAMPLE");
    const state=await loadState(),importer=new CatalogImporterV1({flags:flagsFor(phase),stagingStore:new PrismaStagingStore(prisma),gateway:phase==="SHADOW"?new NoWriteGateway():new PrismaCatalogGateway(prisma),existingProducts:state.products,existingOffers:state.offers,runId});
    const result=await importer.run(rows,m.slug),c=result.plan.counters;if(result.apply?.failed)failures+=result.apply.failed;
    reports.push({merchant:m.slug,advertiserId,feedCount:joinedFeeds.length,feeds:feedReports,rows:rows.length,wouldCreateProducts:c.wouldCreateProducts,wouldMatchProducts:c.wouldMatchProducts,wouldCreateOffers:c.wouldCreateOffers,wouldUpdateOffers:c.wouldUpdateOffers,wouldReview:c.wouldReview,wouldReject:c.wouldReject,duplicateExternalIds:result.plan.duplicateExternalIds,apply:result.apply});
   }catch(e){failures+=1;reports.push({merchant:m.slug,error:e instanceof Error?e.message:"UNKNOWN_ERROR"});}}
  const productsAfter=await prisma.product.count(),offersAfter=await prisma.marketplaceOffer.count();
  if(phase==="SHADOW"&&(productsBefore!==productsAfter||offersBefore!==offersAfter))throw new Error("SHADOW_CATALOG_CHANGED");
  const processed=reports.filter(r=>!("error"in r)).length,success=processed>0&&failures===0;
  return NextResponse.json({success,phase,runId,maxRows,productsBefore,productsAfter,offersBefore,offersAfter,productWrites:productsAfter-productsBefore,offerWrites:offersAfter-offersBefore,processedMerchants:processed,failures,merchants:reports},{status:success?200:207,headers:{"cache-control":"no-store, max-age=0"}});
 }catch(e){return NextResponse.json({success:false,phase,runId,productsBefore,offersBefore,error:e instanceof Error?e.message:"AWIN_ROLLOUT_FAILED"},{status:500,headers:{"cache-control":"no-store, max-age=0"}});}
}
