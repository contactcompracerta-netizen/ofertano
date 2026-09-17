import { Marketplace } from '@prisma/client';
import type { CommerceShadowInput, EligibilityReason, ShadowConfig, ShadowIdentity } from './contracts';
export const shadowFlagNames=[
  'COMMERCE_SHADOW_ENABLED','COMMERCE_SHADOW_MARKETPLACE','COMMERCE_SHADOW_EXTERNAL_ID',
  'COMMERCE_SHADOW_MAX_WRITES','COMMERCE_SHADOW_DRY_RUN','COMMERCE_SHADOW_REQUIRE_EXACT_IDENTITY',
  'COMMERCE_SHADOW_RECORD_CONFLICTS_ENABLED',
] as const;
const exactTrue=(v:string|undefined)=>v?.trim().toLowerCase()==='true';
const defaultTrue=(v:string|undefined)=>v?.trim().toLowerCase()!=='false';
export function parseShadowConfig(env:Record<string,string|undefined>):ShadowConfig {
  const marketplace=env.COMMERCE_SHADOW_MARKETPLACE?.trim();
  const externalId=env.COMMERCE_SHADOW_EXTERNAL_ID?.trim();
  const raw=env.COMMERCE_SHADOW_MAX_WRITES?.trim()??'';
  const maxWrites=/^(0|[1-9]\d*)$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):0;
  return {enabled:exactTrue(env.COMMERCE_SHADOW_ENABLED),marketplace:Object.values(Marketplace).includes(marketplace as Marketplace)?marketplace as Marketplace:undefined,
    externalId:externalId&&/^[A-Za-z0-9_-]{1,128}$/.test(externalId)?externalId:undefined,
    maxWrites,dryRun:defaultTrue(env.COMMERCE_SHADOW_DRY_RUN),requireExactIdentity:defaultTrue(env.COMMERCE_SHADOW_REQUIRE_EXACT_IDENTITY),recordConflicts:exactTrue(env.COMMERCE_SHADOW_RECORD_CONFLICTS_ENABLED)};
}
const amountValid=(v:unknown)=>v==null||(typeof v==='string'||typeof v==='number')&&/^\d+(\.\d{1,6})?$/.test(String(v))&&Number(v)<=Number.MAX_SAFE_INTEGER;
export function validShadowInput(input:CommerceShadowInput):boolean {
  if(!Object.values(Marketplace).includes(input.marketplace)||!input.currency||!/^[A-Z]{3}$/.test(input.currency)||!Number.isFinite(Date.parse(input.capturedAt)))return false;
  if(!amountValid(input.price)||!amountValid(input.oldPrice))return false;
  if(input.available!=null&&typeof input.available!=='boolean')return false;
  if(input.stock!=null&&(!Number.isSafeInteger(input.stock)||input.stock<0))return false;
  if(!input.provenance||!/^[a-zA-Z0-9_-]{1,64}$/.test(input.provenance.sourceFlow))return false;
  if(input.attributes&&typeof input.attributes!=='object')return false;
  const p=input.pricing;
  if(p&&![p.shipping,p.coupon?.amount,p.pix?.amount,p.membership?.amount,p.installment?.total].every(amountValid))return false;
  return true;
}
export function evaluateShadowEligibility(input:CommerceShadowInput,config:ShadowConfig,context:{identity?:ShadowIdentity;writePhase?:boolean;remaining?:number}={}):{eligible:boolean;reason:EligibilityReason;details:{rawRequired:false;dryRun:boolean}} {
  const details={rawRequired:false as const,dryRun:config.dryRun};
  const result=(eligible:boolean,reason:EligibilityReason)=>({eligible,reason,details});
  if(!config.enabled)return result(false,'SHADOW_DISABLED');
  if(!input.externalId)return result(false,'MISSING_EXTERNAL_ID');
  if(!validShadowInput(input))return result(false,'INVALID_INPUT');
  if(!config.marketplace||config.marketplace!==input.marketplace)return result(false,'MARKETPLACE_NOT_ALLOWED');
  if(!config.externalId||config.externalId!==input.externalId)return result(false,'EXTERNAL_ID_NOT_ALLOWED');
  if(config.maxWrites===0)return result(false,'WRITE_BUDGET_ZERO');
  if(context.writePhase&&context.remaining===0)return result(false,'BUDGET_EXHAUSTED');
  if(!config.dryRun&&context.writePhase&&context.identity?.status!=='EXACT')return result(false,'IDENTITY_NOT_EXACT');
  if(config.dryRun)return result(true,'DRY_RUN');
  return result(true,input.rawListingId?'READY':'RAW_NOT_REQUIRED');
}
export function localShadowTarget(connectionString:string|undefined,deploymentEnv:string|undefined):EligibilityReason|null {
  if(deploymentEnv==='production')return 'PRODUCTION_FORBIDDEN';
  try {const u=new URL(connectionString??'');if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||u.port!=='55433'||u.pathname!=='/ofertano_50ag2_shadow'||u.search||u.hash)return 'LOCAL_TARGET_REQUIRED';}
  catch{return 'LOCAL_TARGET_REQUIRED';}
  return null;
}
