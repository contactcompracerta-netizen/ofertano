import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {runCommerceShadowCanary} from './service';
import {buildShadowPlan} from './plan';
import {WriteBudget,type CommerceShadowInput,type CommerceShadowResult,type ShadowEvent} from './contracts';
import {scheduleCommerceShadowAfterBarrier} from './integration';
import {searchMultistoreV2} from '../../multistore-v2/search';
import type {DiscoveryAdapter,DiscoveryCandidate} from '../../discovery/core/types';
const url=process.env.DATABASE_URL??'';const target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.port!=='55433'||target.pathname!=='/ofertano_50ag2_shadow')throw Error('LOCAL_TRIPWIRE');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})});
const env:Record<string,string|undefined>={COMMERCE_SHADOW_ENABLED:'true',COMMERCE_SHADOW_MARKETPLACE:'AMAZON',COMMERCE_SHADOW_EXTERNAL_ID:'SHADOW-ASIN1',COMMERCE_SHADOW_MAX_WRITES:'1',COMMERCE_SHADOW_DRY_RUN:'false',COMMERCE_SHADOW_REQUIRE_EXACT_IDENTITY:'true',COMMERCE_IDENTITY_GRAPH_ENABLED:'true',COMMERCE_VARIANTS_ENABLED:'true',OFFER_LEDGER_ENABLED:'true',PRICE_TRUTH_ENABLED:'true',TRUST_SIGNALS_ENABLED:'true'};
const input:CommerceShadowInput={marketplace:'AMAZON',externalId:'SHADOW-ASIN1',title:'Headphone JBL Tune 520BT',brand:'JBL',ean:'4006381333931',modelNumber:'Tune 520BT',price:'100',oldPrice:'120',currency:'BRL',stock:5,available:true,sellerName:'Synthetic Seller',sourceUrl:'https://shop.example/item?api_key=private-shadow-secret',affiliateLink:'https://shop.example/aff?tag=public-affiliate&token=private-affiliate-secret',capturedAt:'2026-09-17T12:00:00.000Z',attributes:{color:'Preto',memory:'16 GB'},pricing:{oldPriceIsListPrice:true,shipping:10,coupon:{amount:5,eligible:true},pix:{amount:5,eligible:true}},provenance:{sourceFlow:'offline-fixture'}};
const events:ShadowEvent[]=[];
const deps=(budget=new WriteBudget(),overrides:Record<string,string|undefined>={})=>({env:{...env,...overrides},getClient:async()=>db,connectionString:url,budget,log:(e:ShadowEvent)=>events.push(e)});
async function counts(){return {product:await db.product.count(),offer:await db.marketplaceOffer.count(),history:await db.priceHistory.count(),raw:await db.rawMarketplaceListing.count(),observation:await db.offerObservation.count(),component:await db.offerPriceComponent.count(),variant:await db.productVariant.count(),identifier:await db.productIdentifier.count(),evidence:await db.identityEvidence.count(),signal:await db.trustSignal.count(),conflict:await db.identityConflict.count()};}
function legacy(c:Awaited<ReturnType<typeof counts>>){return {product:c.product,offer:c.offer,history:c.history,raw:c.raw};}
async function main(){
const network=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('SHADOW_NETWORK_FORBIDDEN');};
try {
assert.equal(await db.product.count(),0,'Fixture must start fresh; never delete/reset existing data');
for(const id of ['50ag2-primary','50ag2-conflict'])await db.product.create({data:{id,name:'Synthetic JBL Tune 520BT',image:'https://shop.example/img',images:[],category:'Synthetic',store:'Synthetic',affiliateLink:'https://shop.example/aff',price:100,brand:'JBL',active:false}});
await db.productIdentifier.createMany({data:[{productId:'50ag2-primary',type:'EAN',value:'4006381333931',normalizedValue:'4006381333931',source:'local-fixture',confidence:'EXACT'},{productId:'50ag2-primary',type:'MODEL',value:'Tune 520BT',normalizedValue:'TUNE 520BT',brandScope:'jbl',source:'local-fixture',confidence:'HIGH'}]});
const before=await counts();
for(const override of [{COMMERCE_SHADOW_ENABLED:'false'},{COMMERCE_SHADOW_MARKETPLACE:'SHOPEE'},{COMMERCE_SHADOW_EXTERNAL_ID:'other'},{COMMERCE_SHADOW_MAX_WRITES:'0'}]) {
 let reads=0;const result=await runCommerceShadowCanary(input,{...deps(undefined,override),getClient:async()=>{reads++;return db;}});
 assert.equal(result.status,'BLOCKED');assert.equal(reads,0);assert.equal(result.writesPerformed,0);
}
const dry=await runCommerceShadowCanary(input,deps(undefined,{COMMERCE_SHADOW_DRY_RUN:'true'}));
assert.equal(dry.status,'DRY_RUN');assert.equal(dry.identity?.status,'EXACT');assert.equal(dry.priceTruth?.state,'EXACT');assert.equal(dry.priceTruth?.value,'100.000000');assert.deepEqual(await counts(),before);
const high=await runCommerceShadowCanary({...input,ean:undefined},deps());assert.equal(high.identity?.status,'HIGH');assert.equal(high.status,'BLOCKED');assert.equal(high.writesPerformed,0);
const unresolved=await runCommerceShadowCanary({...input,ean:undefined,modelNumber:undefined,attributes:{}},deps());assert.equal(unresolved.identity?.status,'UNRESOLVED');assert.equal(unresolved.status,'BLOCKED');
const budget=new WriteBudget();const first=await runCommerceShadowCanary(input,deps(budget));
assert.equal(first.status,'CREATED');assert.equal(first.writesPerformed,1);assert.equal(budget.committed,1);
const afterFirst=await counts();assert.equal(afterFirst.observation-before.observation,1);assert.equal(afterFirst.component-before.component,6);assert.equal(afterFirst.variant-before.variant,1);assert.equal(afterFirst.signal-before.signal,8);assert.deepEqual(legacy(afterFirst),legacy(before));
const row=await db.offerObservation.findUniqueOrThrow({where:{id:first.observation!.id!}});assert.equal(row.rawListingId,null);assert.ok(!JSON.stringify(row.provenance).includes('private-shadow-secret'));assert.ok(!row.sourceUrl?.includes('private-shadow-secret'));assert.ok(!row.affiliateLink?.includes('private-affiliate-secret'));
const dedupe=await runCommerceShadowCanary(input,deps(budget));assert.equal(dedupe.status,'DEDUPED');assert.equal(dedupe.writesPerformed,0);assert.deepEqual(await counts(),afterFirst);
const irrelevant=await runCommerceShadowCanary({...input,attributes:{memory:'16 GB',color:'Preto'},provenance:Object.fromEntries(Object.entries(input.provenance).reverse()) as CommerceShadowInput['provenance']},deps(budget));assert.equal(irrelevant.status,'DEDUPED');assert.equal(irrelevant.observation?.fingerprint,first.observation?.fingerprint);
const exhausted=await runCommerceShadowCanary({...input,price:'90'},deps(budget));assert.equal(exhausted.reason,'BUDGET_EXHAUSTED');assert.deepEqual(await counts(),afterFirst);
const changed=await runCommerceShadowCanary({...input,price:'90'},deps());assert.equal(changed.status,'CREATED');assert.notEqual(changed.observation?.fingerprint,first.observation?.fingerprint);assert.equal(await db.offerObservation.count(),2);
const concurrentBudget=new WriteBudget();const races=await Promise.all([runCommerceShadowCanary({...input,price:'82'},deps(concurrentBudget)),runCommerceShadowCanary({...input,price:'82'},deps(concurrentBudget))]);assert.deepEqual(races.map(r=>r.status).sort(),['CREATED','DEDUPED']);assert.equal(concurrentBudget.committed,1);assert.equal(await db.offerObservation.count(),3);
const preFailure=await counts();const failureBudget=new WriteBudget();
await db.$executeRawUnsafe(`CREATE FUNCTION public._50ag2_reject_component() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source = 'shadow-derived-v1' THEN RAISE EXCEPTION 'LOCAL_COMPONENT_FAILURE'; END IF; RETURN NEW; END $$`);
await db.$executeRawUnsafe('CREATE TRIGGER _50ag2_component_failure BEFORE INSERT ON "OfferPriceComponent" FOR EACH ROW EXECUTE FUNCTION public._50ag2_reject_component()');
let failure;
try {failure=await runCommerceShadowCanary({...input,price:'81',attributes:{color:'Azul',memory:'16 GB'}},deps(failureBudget));}
finally {await db.$executeRawUnsafe('DROP TRIGGER _50ag2_component_failure ON "OfferPriceComponent"');await db.$executeRawUnsafe('DROP FUNCTION public._50ag2_reject_component()');}
assert.equal(failure!.status,'FAILED');assert.equal(failureBudget.committed,0);assert.deepEqual(await counts(),preFailure);
// Exercise the REAL acquisition entry point with offline adapters and the attached scheduling hook.
const adapters:DiscoveryAdapter[]=['AMAZON','SHOPEE'].map((marketplace)=>({enabled:true,marketplace:marketplace as DiscoveryAdapter['marketplace'],marketplaceName:(marketplace==='AMAZON'?'Amazon':'Shopee') as DiscoveryAdapter['marketplaceName'],searcher:async req=>({marketplace:marketplace as DiscoveryAdapter['marketplace'],query:req.query,success:true,scanned:1,error:null,candidates:[{marketplace,marketplaceName:marketplace==='AMAZON'?'Amazon':'Shopee',externalId:marketplace==='AMAZON'?input.externalId:'offline-shopee',sourceUrl:'https://shop.example/item',affiliateLink:'https://shop.example/aff',title:input.title,image:'https://shop.example/img',price:100,oldPrice:120,brand:'JBL',attributes:{ean:input.ean!,color:'Preto'},seller:'Synthetic Seller',status:'FOUND',error:null} as DiscoveryCandidate]})}));
const saved={...process.env};const responses:unknown[]=[];const boundaryResults:CommerceShadowResult[]=[];
const normalize=(value:unknown):unknown=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='elapsedMs').map(([k,v])=>[k,normalize(v)])):value;
for(const mode of ['OFF','DRY','WRITE']) {
 Object.assign(process.env,env,{DATABASE_URL:url,COMMERCE_SHADOW_ENABLED:mode==='OFF'?'false':'true',COMMERCE_SHADOW_DRY_RUN:mode==='DRY'?'true':'false'});
 const pending:Array<()=>Promise<void>>=[];
 const taskDeps=deps(undefined,{COMMERCE_SHADOW_DRY_RUN:mode==='DRY'?'true':'false'});
 const response=await searchMultistoreV2('JBL Tune 520BT',{persist:false,adapters,shadow:{defer:work=>pending.push(work),run:async snapshot=>{const result=await runCommerceShadowCanary(snapshot,taskDeps);boundaryResults.push(result);return result;}}});responses.push(normalize(response));
 // The response is already returned; await controlled background work deterministically in this local test.
 for(const work of pending)await work();
}
for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);
assert.deepEqual(responses[0],responses[1]);assert.deepEqual(responses[0],responses[2]);
assert.deepEqual(boundaryResults.map(r=>r.status),['DRY_RUN','CREATED']);
assert.ok((await counts()).observation>preFailure.observation,'Actual background boundary must execute local writer');
let schedulingError=false;const warn=console.warn;console.warn=()=>{schedulingError=true;};
try {scheduleCommerceShadowAfterBarrier([{marketplace:'AMAZON',marketplaceName:'Amazon',externalId:input.externalId,title:input.title!,price:100,url:'https://shop.example/item',image:'https://shop.example/img',brand:'JBL',category:null,seller:null,affiliateLink:null,attributes:{}}],{env,defer:()=>{throw Error('injected scheduling failure');}});}finally {console.warn=warn;}
assert.ok(schedulingError);
// A second synthetic candidate is attached only by fixture setup, outside shadow writers.
await db.productIdentifier.create({data:{productId:'50ag2-conflict',type:'EAN',value:input.ean!,normalizedValue:input.ean!,source:'local-conflict-fixture',confidence:'EXACT'}});
const beforeConflict=await counts();
const conflictDry=await runCommerceShadowCanary(input,deps(undefined,{COMMERCE_SHADOW_DRY_RUN:'true'}));assert.equal(conflictDry.status,'DRY_RUN');assert.equal(conflictDry.conflict,true);
const conflictBlocked=await runCommerceShadowCanary(input,deps());assert.equal(conflictBlocked.status,'BLOCKED');assert.equal(conflictBlocked.writesPerformed,0);assert.deepEqual(await counts(),beforeConflict);
const conflictRecorded=await runCommerceShadowCanary(input,deps(undefined,{COMMERCE_SHADOW_RECORD_CONFLICTS_ENABLED:'true'}));assert.equal(conflictRecorded.status,'BLOCKED');assert.equal(conflictRecorded.writesPerformed,1);assert.equal(await db.identityConflict.count(),1);assert.equal(await db.offerObservation.count(),beforeConflict.observation);
const final=await counts();assert.deepEqual(legacy(final),legacy(before));
assert.ok(!JSON.stringify(events).includes('private-shadow-secret'));assert.ok(!JSON.stringify(events).includes('private-affiliate-secret'));assert.ok(!JSON.stringify(events).includes('public-affiliate'));
const identity={status:'EXACT' as const,confidence:'EXACT' as const,productId:'50ag2-primary',candidateIds:['50ag2-primary'],method:'validated-gtin'};
const times=[];for(let i=0;i<200;i++){const t=performance.now();buildShadowPlan(input,identity,true);times.push(performance.now()-t);}times.sort((a,b)=>a-b);
const evidence={before,afterFirst,final,legacyDelta:{product:0,offer:0,history:0,raw:0},dry,first,dedupe,irrelevant,exhausted,changed,races,failure,conflictDry,conflictBlocked,conflictRecorded,legacyOutputDeepEqual:true,boundaryResults,telemetryExcluded:['acquisitions.elapsedMs'],performance:{purePipelineSamples:200,p50Ms:times[99],p95Ms:times[189],dbWriteMs:first.timings.dbWriteMs,dedupeMs:dedupe.timings.dbWriteMs},events};
mkdirSync('docs/evidence/50ag2',{recursive:true});writeFileSync('docs/evidence/50ag2/local-canary.json',JSON.stringify(evidence,null,2)+'\n');
console.log('LOCAL_CANARY_MATRIX_DEDUPE_RACE_ROLLBACK_CONFLICT_LEGACY=PASS');
} finally {globalThis.fetch=network;await db.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
