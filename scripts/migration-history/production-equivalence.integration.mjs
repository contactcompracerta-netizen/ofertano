/** Explicit integration gate; uses only newly owned databases on 127.0.0.1:55433. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { root, createClone, runTool } from './production-audit-io.mjs';
const migration=fs.readFileSync(root+'/prisma/migrations/20260927180000_social_post_index_reconciliation/migration.sql','utf8');
const scenarios=[
 ['canonical missing',null,null,false],
 ['stale exact','CREATE UNIQUE INDEX "SocialPost_dayKey_slot_key" ON public."SocialPost"("dayKey",slot)','CREATE INDEX "SocialPost_dayKey_key" ON public."SocialPost"("dayKey")',true],
 ['stale absent','CREATE UNIQUE INDEX "SocialPost_dayKey_slot_key" ON public."SocialPost"("dayKey",slot)',null,true],
 ['stale unique','CREATE UNIQUE INDEX "SocialPost_dayKey_slot_key" ON public."SocialPost"("dayKey",slot)','CREATE UNIQUE INDEX "SocialPost_dayKey_key" ON public."SocialPost"("dayKey")',false],
 ['stale partial','CREATE UNIQUE INDEX "SocialPost_dayKey_slot_key" ON public."SocialPost"("dayKey",slot)','CREATE INDEX "SocialPost_dayKey_key" ON public."SocialPost"("dayKey") WHERE slot IS NOT NULL',false],
 ['stale wrong key','CREATE UNIQUE INDEX "SocialPost_dayKey_slot_key" ON public."SocialPost"("dayKey",slot)','CREATE INDEX "SocialPost_dayKey_key" ON public."SocialPost"(slot)',false],
 ['canonical nonunique','CREATE INDEX "SocialPost_dayKey_slot_key" ON public."SocialPost"("dayKey",slot)',null,false],
 ['canonical wrong order','CREATE UNIQUE INDEX "SocialPost_dayKey_slot_key" ON public."SocialPost"(slot,"dayKey")',null,false],
];
for(const [name,canonical,stale,pass] of scenarios){
 const clone=await createClone();try{
  await clone.client.query('CREATE TABLE public."SocialPost"(id text PRIMARY KEY,"dayKey" text NOT NULL,slot text NOT NULL)');
  if(canonical)await clone.client.query(canonical);if(stale)await clone.client.query(stale);
  const before=(await clone.client.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename='SocialPost' ORDER BY indexname")).rows;
  if(pass){await clone.client.query(migration);await clone.client.query(migration);assert.equal((await clone.client.query("SELECT to_regclass('public.\"SocialPost_dayKey_key\"') AS stale")).rows[0].stale,null);}else{
   await assert.rejects(clone.client.query(migration),/SOCIAL_(CANONICAL|STALE)_INDEX_DIVERGED/);await clone.client.query('ROLLBACK');
   assert.deepEqual((await clone.client.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename='SocialPost' ORDER BY indexname")).rows,before);
  }console.log(JSON.stringify({scenario:name,result:'PASS'}));
 }finally{await clone.cleanup();}
}
const clone=await createClone();try{
 const r=runTool(process.execPath,['scripts/bootstrap/fresh-bootstrap.mjs'],{DIRECT_URL:clone.url,DATABASE_URL:clone.url,DOTENV_CONFIG_PATH:'/dev/null',VERCEL_ENV:'',VERCEL_TARGET_ENV:'',BOOTSTRAP_ALLOWED_DATABASES:clone.name});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.match(r.stdout,/"category":"A"/);assert.match(r.stdout,/"verdict":"PASS"/);
 console.log(JSON.stringify({freshBootstrap:'PASS_CATEGORY_A',localEquivalence:'ZERO',output:r.stdout}));
}finally{await clone.cleanup();}
