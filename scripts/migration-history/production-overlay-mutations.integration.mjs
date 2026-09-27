/** Restore only a reviewed production schema-only dump into an owned 55433 clone. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { root, createClone, restoreClone, assertSchemaOnly, prismaDiff } from './production-audit-io.mjs';
import { productionEquivalenceSchema } from './production-equivalence.mjs';
import { normalizeClone, requireZeroDiff } from './verify-production-schema-equivalence.mjs';
assert.equal(process.argv.length,4,'usage: node script production-schema.sql /absolute/psql');
assertSchemaOnly(fs.readFileSync(process.argv[2],'utf8'));
const clone=await createClone();let overlay;
try{
 await restoreClone(clone,process.argv[2],process.argv[3]);
 await clone.client.query(fs.readFileSync(root+'/prisma/migrations/20260927180000_social_post_index_reconciliation/migration.sql','utf8'));
 await normalizeClone(clone);overlay=productionEquivalenceSchema(root+'/prisma/schema.prisma');
 const original=fs.readFileSync(overlay.file,'utf8');requireZeroDiff(prismaDiff(clone.url,overlay.file));
 const mutations={
  'retained type':s=>s.replace('armed Boolean @default(true)','armed String @default("true")'),
  'retained default':s=>s.replace('armed Boolean @default(true)','armed Boolean @default(false)'),
  'retained missing':s=>s.replace('  lastTriggeredPrice Float?\n',''),
  'unexpected column':s=>s.replace('model PriceAlert {','model PriceAlert {\n unknownExtension String?'),
  'legacy table absent':s=>s.replace(/model notifications \{[\s\S]*?\n\}/,'').replace(/.*productionNotifications.*\n/,'').replace(/.*notifications notifications\[\].*\n/,''),
  'unexpected index':s=>s.replace('model SocialPost {','model SocialPost {\n @@index([slot], map: "unexpected_index")'),
  'internal FK':s=>s.replace('onDelete: Cascade, onUpdate: NoAction','onDelete: NoAction, onUpdate: NoAction'),
 };
 for(const [name,mutate] of Object.entries(mutations)){
  const changed=mutate(original);assert.notEqual(changed,original);fs.writeFileSync(overlay.file,changed);
  const diff=prismaDiff(clone.url,overlay.file);assert.equal(diff.status,2,`${name}: expected structural difference, got ${diff.status}`);
  console.log(JSON.stringify({mutation:name,result:'FAIL_DETECTED',exit:diff.status}));
 }
}finally{overlay?.cleanup();await clone.cleanup();}
