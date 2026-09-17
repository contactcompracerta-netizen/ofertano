import {createHash} from 'node:crypto';
import {commerceFlagNames} from '../flags';
import type {RawCandidate} from '../../multistore-v2/types';
import type {CommerceShadowInput,CommerceShadowResult} from './contracts';
import {localShadowTarget,parseShadowConfig,shadowFlagNames} from './config';
function logBoundary(event:Record<string,unknown>,failed=false) {
  try {(failed?console.warn:console.info)(JSON.stringify(event));}
  catch {try {console.error('COMMERCE_SHADOW_FAILED LOGGING_FAILED');}catch {/* Logging must never break legacy. */}}
}
/** A dedicated single boundary; results never enter the legacy response. */
export function scheduleCommerceShadowAfterBarrier(candidates:readonly RawCandidate[],options:{
  env?:Record<string,string|undefined>; defer?:(work:()=>Promise<void>)=>void;
  run?:(input:CommerceShadowInput)=>Promise<CommerceShadowResult>;
}={}) {
  const env=options.env??process.env;
  const config=parseShadowConfig(env);
  if(!config.enabled)return;
  // Even accidentally enabled Preview/Production cannot reach legacy/shared database tables.
  const blocked=(reason:string)=>logBoundary({event:'COMMERCE_SHADOW_BLOCKED',marketplace:config.marketplace??'UNKNOWN',externalIdSafe:createHash('sha256').update(config.externalId??'').digest('hex').slice(0,12),reason,durationMs:0,writeCount:0});
  const targetError=localShadowTarget(process.env.DATABASE_URL,process.env.VERCEL_ENV);
  if(targetError){blocked(targetError);return;}
  if(!config.marketplace||!config.externalId||config.maxWrites===0){blocked('CONFIGURATION_BLOCKED');return;}
  const match=candidates.find(c=>c.marketplace===config.marketplace&&c.externalId===config.externalId);
  if(!match){blocked('NO_MATCHING_SNAPSHOT');return;}
  try {
    const input:CommerceShadowInput={marketplace:match.marketplace,externalId:match.externalId,title:match.title,
      price:match.price,currency:'BRL',sellerName:match.seller,sourceUrl:match.url,affiliateLink:match.affiliateLink,
      attributes:structuredClone(match.attributes),brand:match.brand??undefined,capturedAt:new Date().toISOString(),provenance:{sourceFlow:'multistore-v2-post-barrier'}};
    const taskEnv=Object.fromEntries([...shadowFlagNames,...commerceFlagNames].map(k=>[k,env[k]]));
    const run=options.run??((snapshot:CommerceShadowInput)=>import('./service').then(({runCommerceShadowCanary})=>runCommerceShadowCanary(snapshot,{env:taskEnv})));
    const work=async()=>{
      try {await run(input);}
      catch {logBoundary({event:'COMMERCE_SHADOW_FAILED',reason:'BACKGROUND_BOUNDARY_FAILURE',durationMs:0,writeCount:0},true);}
    };
    if(options.defer)options.defer(work);
    else {
      try {
        // Synchronous registration, but no Next/worker module initialization when OFF.
        const {after}=require('next/server') as typeof import('next/server');
        after(work);
      }
      catch {
        // Local CLI has no request context. Preview/Production never uses this fallback.
        if(process.env.VERCEL_ENV)throw new Error('AFTER_CONTEXT_REQUIRED');
        setTimeout(()=>{void work();},0);
      }
    }
  } catch {logBoundary({event:'COMMERCE_SHADOW_FAILED',reason:'SCHEDULING_FAILED',durationMs:0,writeCount:0},true);}
}
