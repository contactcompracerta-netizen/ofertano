import { Marketplace, type PrismaClient, type Prisma } from '@prisma/client';
import {createHash,randomUUID} from 'node:crypto';
import {commerceEnabled,commerceFlagNames} from '../flags';
import {extractIdentifiers} from '../domain';
import {createCommerceRepositories} from '../repositories';
import {evaluateShadowEligibility,localShadowTarget,parseShadowConfig,shadowFlagNames} from './config';
import {resolveShadowIdentity} from './identity';
import {buildShadowPlan,sanitizeShadowUrl} from './plan';
import {WriteBudget,type CommerceShadowInput,type CommerceShadowResult,type ShadowDependencies,type ShadowEvent,type CommerceShadowPlan} from './contracts';
const processBudget=new WriteBudget();
let localClient:PrismaClient|undefined;
let localClientUrl:string|undefined;
async function defaultLocalClient(connectionString:string):Promise<PrismaClient> {
  if(localClient&&localClientUrl===connectionString)return localClient;
  // Lazy load only after all gates: OFF does not initialize a client or driver.
  const [{PrismaClient},{PrismaPg}]=await Promise.all([import('@prisma/client'),import('@prisma/adapter-pg')]);
  if(!localClient||localClientUrl!==connectionString) {
    if(localClient)void localClient.$disconnect().catch(()=>{});
    localClient=new PrismaClient({adapter:new PrismaPg({connectionString})});localClientUrl=connectionString;
  }
  return localClient;
}
const safeId=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:'').digest('hex').slice(0,12);
export async function runCommerceShadowCanary(input:CommerceShadowInput,deps:ShadowDependencies={}):Promise<CommerceShadowResult> {
  const started=performance.now();const sourceEnv=deps.env??process.env;
  const env=Object.fromEntries([...shadowFlagNames,...commerceFlagNames].map(k=>[k,sourceEnv[k]]));const config=parseShadowConfig(env);
  const budget=deps.budget??processBudget;
  let plan:CommerceShadowPlan|null=null;
  const timings={identityMs:0,purePipelineMs:0,dbWriteMs:0};let writeStarted:number|null=null;
  const emit=(event:ShadowEvent['event'],reason:string,writeCount=0)=>{
    const record:ShadowEvent={event,marketplace:Object.values(Marketplace).includes(input.marketplace)?input.marketplace:'UNKNOWN',externalIdSafe:safeId(input.externalId??''),reason,
      ...(plan?{identityConfidence:plan.identity.confidence,observationFingerprintPrefix:plan.observation.fingerprint.slice(0,15)}:{}),durationMs:performance.now()-started,writeCount};
    try {(deps.log??((e)=>console.info(JSON.stringify(e))))(record);}
    catch {try {console.warn(JSON.stringify({...record,event:'COMMERCE_SHADOW_FAILED',reason:'LOGGER_FAILED'}));}catch {/* Caller isolation also covers unavailable log sinks. */}}
  };
  const finish=(status:CommerceShadowResult['status'],reason:string,writesPerformed=0,id?:string):CommerceShadowResult=>({status,eligible:['CREATED','DEDUPED','DRY_RUN'].includes(status),reason,
    identity:plan?.identity??null,variant:plan?.variant??null,observation:plan?{...plan.observation,...(id?{id}:{})}:null,
    priceTruth:plan?.priceTruth??null,trustSignals:plan?.trustSignals??[],writesPlanned:plan?1:0,writesPerformed,deduped:status==='DEDUPED',conflict:plan?.identity.status==='CONFLICT',durationMs:performance.now()-started,timings});
  const blocked=(reason:string)=>{emit('COMMERCE_SHADOW_BLOCKED',reason);return finish('BLOCKED',reason);};
  emit('COMMERCE_SHADOW_ATTEMPT','ATTEMPT');
  const reservation:{release:(()=>void)|null}={release:null};
  try {
    const eligibility=evaluateShadowEligibility(input,config);
    if(!eligibility.eligible)return blocked(eligibility.reason);
    const connectionString=deps.connectionString??process.env.DATABASE_URL;
    const targetError=localShadowTarget(connectionString,deps.deploymentEnv??process.env.VERCEL_ENV,deps.localDbNames);
    if(targetError)return blocked(targetError);
    const enabled=(flag:Parameters<typeof commerceEnabled>[0])=>commerceEnabled(flag,env);
    if(!config.dryRun&&['COMMERCE_IDENTITY_GRAPH_ENABLED','OFFER_LEDGER_ENABLED','PRICE_TRUTH_ENABLED','TRUST_SIGNALS_ENABLED'].some(f=>!enabled(f as Parameters<typeof commerceEnabled>[0])))return blocked('FOUNDATION_FLAG_OFF');
    const client=deps.getClient?await deps.getClient():await defaultLocalClient(connectionString!);
    const identityStarted=performance.now();
    const identity=await client.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 500');
      return resolveShadowIdentity(input,extractIdentifiers(input),tx as unknown as PrismaClient);
    },{maxWait:500,timeout:1500});
    timings.identityMs=performance.now()-identityStarted;
    const pureStarted=performance.now();
    plan=buildShadowPlan(input,identity,enabled('COMMERCE_VARIANTS_ENABLED'));
    timings.purePipelineMs=performance.now()-pureStarted;
    if(identity.status==='CONFLICT')emit('COMMERCE_SHADOW_CONFLICT',identity.conflictReason??'IDENTITY_CONFLICT');
    if(config.dryRun){emit('COMMERCE_SHADOW_DRY_RUN','DRY_RUN');return finish('DRY_RUN','DRY_RUN');}
    const writeEligibility=evaluateShadowEligibility(input,config,{identity,writePhase:true});
    const conflictOnly=identity.status==='CONFLICT'&&config.recordConflicts;
    if(!writeEligibility.eligible&&!conflictOnly)return blocked(writeEligibility.reason);
    if(identity.status==='CONFLICT'&&!conflictOnly)return blocked('CONFLICT_RECORDING_DISABLED');
    const observedPlan=plan;
    writeStarted=performance.now();
    const written=await client.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 500');
      await tx.$executeRawUnsafe('SET LOCAL lock_timeout = 500');
      const lockKey=`50ag2:${input.marketplace}:${input.externalId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
      const repos=createCommerceRepositories(()=>tx as unknown as PrismaClient,enabled);
      // Identity can change between planning and writing. Revalidate under the canary lock.
      const current=await resolveShadowIdentity(input,observedPlan.identifiers,tx as unknown as PrismaClient);
      if(JSON.stringify(current)!==JSON.stringify(identity))throw new Error('IDENTITY_CHANGED');
      if(conflictOnly) {
        reservation.release=budget.reserve(config.maxWrites);
        if(!reservation.release)return {status:'BLOCKED' as const,writes:0,reason:'BUDGET_EXHAUSTED'};
        const conflict=await repos.identityConflictRepository.record({productAId:identity.candidateIds[0]??null,productBId:identity.candidateIds[1]??null,reason:identity.conflictReason??'IDENTITY_CONFLICT',details:{candidateIds:identity.candidateIds,shadowVersion:'50ag2-v1'}});
        if(conflict.status!=='written')throw new Error('WRITER_DISABLED');
        return {status:'BLOCKED' as const,writes:1,reason:'IDENTITY_NOT_EXACT'};
      }
      const existing=await tx.offerObservation.findUnique({where:{marketplace_externalId_fingerprint:{marketplace:input.marketplace,externalId:input.externalId,fingerprint:observedPlan.observation.fingerprint}}});
      if(existing) {
        // The repository performs its own persisted-state fingerprint check and returns the original row.
        const result=await repos.offerObservationRepository.append({...observationData(input,observedPlan),id:randomUUID()}, {...input,attributes:input.attributes??{},components:observedPlan.observation.components});
        if(result.status!=='written')throw new Error('WRITER_DISABLED');
        return {status:'DEDUPED' as const,writes:0,reason:'READY',id:result.value.id};
      }
      reservation.release=budget.reserve(config.maxWrites);
      if(!reservation.release)return {status:'BLOCKED' as const,writes:0,reason:'BUDGET_EXHAUSTED'};
      let variantId:string|undefined;
      if(observedPlan.variant&&identity.productId) {
        const variant=await repos.variantRepository.upsert(identity.productId,input.attributes??{});
        if(variant.status!=='written')throw new Error('WRITER_DISABLED');variantId=variant.value.id;
      }
      if(identity.productId) {
        for(const id of observedPlan.identifiers.filter(i=>i.valid&&(!['MPN','MODEL','BRAND_SKU'].includes(i.type)||i.brandScope))) {
          const where={productId:identity.productId,type:id.type,normalizedValue:id.normalizedValue,marketplace:id.type==='MARKETPLACE_EXTERNAL_ID'?input.marketplace:null,brandScope:id.brandScope??null};
          if(await tx.productIdentifier.findFirst({where}))continue;
          const created=await repos.productIdentifierRepository.create({...where,value:id.value,variantId,source:'shadow-observed-v1',confidence:'EXACT'});
          if(created.status!=='written')throw new Error('WRITER_DISABLED');
        }
      }
      const observation=await repos.offerObservationRepository.append({...observationData(input,observedPlan),id:randomUUID(),variantId}, {...input,attributes:input.attributes??{},components:observedPlan.observation.components});
      if(observation.status!=='written')throw new Error('WRITER_DISABLED');
      const evidence=await repos.identityEvidenceRepository.append({productId:identity.productId,variantId,rawListingId:input.rawListingId??null,kind:identity.status==='EXACT'?'IDENTIFIER_MATCH':'MARKETPLACE_LINK',rawEvidence:{associated:identity.status==='EXACT',method:identity.method,confidence:identity.confidence,identifiers:observedPlan.identifiers.filter(i=>i.valid).map(i=>({type:i.type,value:i.normalizedValue}))},confidence:identity.confidence,source:'shadow-observed-v1'});
      if(evidence.status!=='written')throw new Error('WRITER_DISABLED');
      for(const signal of observedPlan.trustSignals) {
        const result=await repos.trustSignalRepository.append({...signal,scopeType:'OFFER_OBSERVATION',scopeId:observation.value.id,observationId:observation.value.id,source:'shadow-observed-v1',observedAt:input.capturedAt});
        if(result.status!=='written')throw new Error('WRITER_DISABLED');
      }
      return {status:'CREATED' as const,writes:1,reason:'READY',id:observation.value.id};
    },{maxWait:500,timeout:2000});
    timings.dbWriteMs=performance.now()-writeStarted;
    if(reservation.release) {
      if(written.writes)budget.commit(reservation.release);else reservation.release();
      reservation.release=null;
    }
    emit(written.status==='CREATED'?'COMMERCE_SHADOW_CREATED':written.status==='DEDUPED'?'COMMERCE_SHADOW_DEDUPED':'COMMERCE_SHADOW_BLOCKED',written.reason,written.writes);
    return finish(written.status,written.reason,written.writes,'id' in written?written.id:undefined);
  } catch(error) {
    if(writeStarted!==null)timings.dbWriteMs=performance.now()-writeStarted;
    reservation.release?.();
    const code=(error as {code?:string}).code;
    const message=(error as {message?:string}).message;
    const reason=code&&/^(P\d{4}|[A-Z0-9_]{1,24})$/.test(code)?code:['IDENTITY_CHANGED','WRITER_DISABLED'].includes(message??'')?message!:'SHADOW_EXECUTION_FAILED';
    emit('COMMERCE_SHADOW_FAILED',reason);return finish('FAILED',reason);
  }
}
function observationData(input:CommerceShadowInput,plan:CommerceShadowPlan) {
  return {marketplace:input.marketplace,externalId:input.externalId,productId:plan.identity.productId,rawListingId:input.rawListingId??null,
    sellerId:input.sellerId,sellerName:input.sellerName,sourceUrl:sanitizeShadowUrl(input.sourceUrl),affiliateLink:sanitizeShadowUrl(input.affiliateLink),title:input.title,
    price:input.price,oldPrice:input.oldPrice,currency:input.currency,stock:input.stock,available:input.available,capturedAt:input.capturedAt,provenance:plan.observation.provenance} satisfies Omit<Prisma.OfferObservationUncheckedCreateInput,'fingerprint'>;
}
