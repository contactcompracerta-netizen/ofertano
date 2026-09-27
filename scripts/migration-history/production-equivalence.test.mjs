import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { contract, fingerprint, verifyObservation, verifyContractDefinition, classifyUnmanaged, productionEquivalenceSchema } from './production-equivalence.mjs';
import { root, validateCloneTarget, assertSchemaOnly } from './production-audit-io.mjs';
import { requireZeroDiff } from './verify-production-schema-equivalence.mjs';
import { verifyLedgerCompatibility, loadRepositoryContract, socialPostReconciliationPending } from './verify-ledger-compatibility.mjs';
import fixture from './production-ledger.fixture.json' with {type:'json'};
const observation=()=>({shape:structuredClone(contract.tables),external:structuredClone(contract.externalFKs),functions:structuredClone(contract.triggerFunctions)});
const schema=fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8');
test('reviewed exact production contract passes',()=>{verifyContractDefinition();assert.equal(Object.keys(verifyObservation(observation())).length,4);});
const mutations={
  'missing legacy table':s=>delete s.shape.notifications,
  'unexpected legacy table':s=>s.shape.unexpected=structuredClone(s.shape.notifications),
  'legacy column type':s=>s.shape.price_alerts.columns[0].udt_name='text',
  'legacy default':s=>s.shape.notifications.columns[0].column_default=null,
  'new managed physical column':s=>s.shape.PriceAlert.columns.push({...s.shape.PriceAlert.columns[0],column_name:'extra'}),
  'removed retained column':s=>s.shape.PriceAlert.columns.splice(7,1),
  'new external FK':s=>s.external.push({...s.external[0],conname:'other'}),
  'internal FK modified':s=>s.shape.price_alerts.constraints.find(c=>c.conname==='price_alerts_product_id_fkey').definition='FOREIGN KEY (product_id) REFERENCES other(id)',
  'unexpected index':s=>s.shape.SocialPost.indexes.push(structuredClone(contract.staleIndex)),
  'policy change':s=>s.shape.price_alerts.policies[0].qual='true',
  'RLS disabled':s=>s.shape.notifications.rls[0].relrowsecurity=false,
  'trigger changed':s=>s.shape.price_alerts.triggers[0].tgenabled='D',
  'trigger function changed':s=>s.functions[0].definition+=' -- changed',
  'check removed':s=>s.shape.notifications.constraints.splice(0,1),
  'sequence unexpected':s=>s.shape.notifications.sequences.push({sequence:'public.extra'}),
  'identity changed':s=>s.shape.notifications.columns[0].is_identity='YES',
  'nullability changed':s=>s.shape.PriceAlert.columns[7].is_nullable='YES',
  'ordinal changed':s=>s.shape.PriceAlert.columns[7].ordinal_position=99,
  'invalid canonical index':s=>s.shape.SocialPost.indexes.find(i=>i.name==='SocialPost_dayKey_slot_key').indisvalid=false,
};
for(const [name,mutate] of Object.entries(mutations))test('fail closed: '+name,()=>{const s=observation();mutate(s);assert.throws(()=>verifyObservation(s));});
for(const field of contract.legacyPriceAlertColumns)test('retained field pinned: '+field,()=>{const s=observation();s.shape.PriceAlert.columns.find(c=>c.column_name===field).column_default='false';assert.throws(()=>verifyObservation(s));});
for(const mutate of [c=>c.unmanagedTables.pop(),c=>c.unmanagedTables.push('other'),c=>c.legacyPriceAlertColumns.pop(),c=>c.tables.SocialPost.indexes.push(c.staleIndex)])test('contract/overlay inventory mutation rejected',()=>{const c=structuredClone(contract);mutate(c);assert.throws(()=>productionEquivalenceSchema(path.join(root,'prisma/schema.prisma'),c),/CONTRACT_CHANGED/);});
test('Prisma ownership is based on physical model mapping',()=>{assert.ok(classifyUnmanaged(schema).includes('PriceAlert'));assert.throws(()=>classifyUnmanaged(schema.replace('model PriceAlert {','model PriceAlert {\n @@map("price_alerts")')),/MAPPING_CHANGED/);assert.throws(()=>classifyUnmanaged(schema+'\nmodel other {\n id String @id\n @@map("notifications")\n}'),/BECAME_MANAGED/);});
test('overlay is separate and leaves runtime file unchanged',()=>{const before=fs.readFileSync(path.join(root,'prisma/schema.prisma'));const overlay=productionEquivalenceSchema(path.join(root,'prisma/schema.prisma'));try{const s=fs.readFileSync(overlay.file,'utf8');for(const column of contract.legacyPriceAlertColumns)assert.match(s,new RegExp('\\b'+column+'\\b'));assert.match(s,/model notifications/);assert.match(s,/model price_alerts/);assert.doesNotMatch(s,/SocialPost_dayKey_key/);assert.deepEqual(fs.readFileSync(path.join(root,'prisma/schema.prisma')),before);}finally{overlay.cleanup();}});
const name='ofertano_equivalence_'+'a'.repeat(32);
for(const url of ['postgresql://postgres@127.0.0.1:55432/'+name,'postgresql://postgres@localhost:55433/'+name,'postgresql://postgres@db.remote:55433/'+name,'postgresql://postgres@127.0.0.1:55433/postgres','postgresql://postgres@127.0.0.1:55433/'+name+'?host=remote'])test('clone rejects '+url,()=>assert.throws(()=>validateCloneTarget(url,name)));
test('clone accepts exact owned target',()=>validateCloneTarget('postgresql://postgres@127.0.0.1:55433/'+name,name));
test('schema-only guard rejects secrets and data',()=>{for(const s of ['COPY public.foo FROM stdin;','INSERT INTO foo VALUES (1);','postgresql://user:password@host/db','secret=bad'])assert.throws(()=>assertSchemaOnly(s));assert.throws(()=>assertSchemaOnly('known-secret',['known-secret']),/SECRET_LEAK/);});
test('diff requires exit zero and exact success message',()=>{requireZeroDiff({status:0,stdout:'No difference detected.'});for(const diff of [{status:2,stdout:'No difference detected.'},{status:1,stdout:''},{status:0,stdout:''}])assert.throws(()=>requireZeroDiff(diff));});
test('social reconciliation exact pending, postdeploy and mutation gates',()=>{const c=loadRepositoryContract();const s=structuredClone(fixture);const seen=new Set(s.ledger.map(r=>r.migration_name));for(const n of Object.keys(c.repositoryChecksums))if(!seen.has(n)&&!socialPostReconciliationPending.includes(n))s.ledger.push({...s.ledger[0],migration_name:n,checksum:c.repositoryChecksums[n],applied_steps_count:1});assert.deepEqual(verifyLedgerCompatibility(s,socialPostReconciliationPending).pending,socialPostReconciliationPending);const n=socialPostReconciliationPending[0];s.ledger.push({...s.ledger[0],migration_name:n,checksum:c.repositoryChecksums[n],applied_steps_count:1});assert.deepEqual(verifyLedgerCompatibility(s,[]).pending,[]);s.ledger.at(-1).checksum='f'.repeat(64);assert.throws(()=>verifyLedgerCompatibility(s,[]),/CHECKSUM/);});
