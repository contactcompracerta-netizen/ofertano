import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyLedgerCompatibility, loadRepositoryContract, commercePending, architecturePending, autopilotPending } from './verify-ledger-compatibility.mjs';
const original = JSON.parse(fs.readFileSync(new URL('./production-ledger.fixture.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(original);
const fullPending = [...commercePending, ...architecturePending];
const reject = (mutate, code, pending = fullPending) => { const s = clone(); mutate(s); assert.throws(() => verifyLedgerCompatibility(s, pending), new RegExp(code)); };
test('forensic ledger allows exactly two known divergences and full pending without mutation', () => {
  const snapshot = clone(), before = structuredClone(snapshot);
  const result = verifyLedgerCompatibility(snapshot, fullPending);
  assert.equal(result.verdict, 'PASS_WITH_KNOWN_HISTORICAL_DIVERGENCES'); assert.equal(result.warnings.length, 2); assert.deepEqual(result.pending, fullPending); assert.equal(result.ledgerMutation, false); assert.deepEqual(snapshot, before);
});
test('known historical checksum cannot change', () => reject(s => { s.ledger[1].checksum = 'a'.repeat(64); }, 'UNKNOWN_HISTORICAL_CHECKSUM'));
test('third checksum mismatch blocks', () => reject(s => { s.ledger[3].checksum = 'b'.repeat(64); }, 'UNEXPECTED_CHECKSUM_MISMATCH'));
test('unknown DB-only blocks', () => reject(s => { s.ledger.push({ ...s.ledger[0], migration_name: '20260919000000_unknown' }); }, 'UNKNOWN_DB_ONLY_MIGRATION'));
test('unfinished blocks', () => reject(s => { s.ledger[0].finished_at = null; }, 'UNFINISHED_MIGRATION'));
test('rolled back blocks', () => reject(s => { s.ledger[0].rolled_back_at = s.ledger[0].finished_at; }, 'ROLLED_BACK_MIGRATION'));
test('RLS checksum mismatch blocks', () => reject(s => { s.ledger[7].checksum = 'c'.repeat(64); }, 'RLS_CHECKSUM_MISMATCH'));
test('missing RLS blocks', () => reject(s => { s.ledger.pop(); }, 'REQUIRED_APPLIED_MIGRATION_MISSING'));
test('duplicate migration blocks', () => reject(s => { s.ledger.push({ ...s.ledger[0] }); }, 'DUPLICATE_MIGRATION'));
test('pending must be supplied explicitly and be supported', () => {
 assert.throws(() => verifyLedgerCompatibility(clone()), /PENDING_ALLOWLIST_REQUIRED/);
 assert.throws(() => verifyLedgerCompatibility(clone(), [commercePending[0]]), /PENDING_ALLOWLIST_REQUIRED/);
 assert.throws(() => verifyLedgerCompatibility(clone(), []), /UNEXPECTED_PENDING_SET/);
});
test('unrecorded repository edit blocks even for allowlisted migration', () => {
 const contract = loadRepositoryContract(); contract.repositoryChecksums[original.ledger[1].migration_name] = 'd'.repeat(64);
 assert.throws(() => verifyLedgerCompatibility(clone(), commercePending, contract), /REPOSITORY_CHECKSUM_CHANGED/);
});
test('after full forward inventory applied, explicit empty pending allows unchanged historical warnings', () => {
 const s = clone(), c = loadRepositoryContract();
 for (const n of fullPending) s.ledger.push({ ...s.ledger[0], migration_name: n, checksum: c.repositoryChecksums[n], applied_steps_count: 1 });
 assert.equal(verifyLedgerCompatibility(s, [], c).warnings.length, 2);
});
test('known mismatch replaced with repository checksum is not silently accepted', () => {
 const c = loadRepositoryContract(); reject(s => { s.ledger[1].checksum = c.repositoryChecksums[s.ledger[1].migration_name]; }, 'UNKNOWN_HISTORICAL_CHECKSUM');
});
test('invalid snapshot, checksum, timestamps and absent rollback field block', () => {
 assert.throws(() => verifyLedgerCompatibility({}, commercePending), /INVALID_SNAPSHOT/);
 reject(s => { s.ledger[0].checksum = 'invalid'; }, 'INVALID_LEDGER_ROW');
 reject(s => { s.ledger[0].started_at = 'invalid'; }, 'INVALID_LEDGER_ROW');
 reject(s => { delete s.ledger[0].rolled_back_at; }, 'ROLLED_BACK_MIGRATION');
});

for (const index of [1, 2]) {
 test(`known divergence ${index} rejects random checksum and repository substitution`, () => {
  reject(s => { s.ledger[index].checksum = 'e'.repeat(64); }, 'UNKNOWN_HISTORICAL_CHECKSUM');
  const c = loadRepositoryContract(); reject(s => { s.ledger[index].checksum = c.repositoryChecksums[s.ledger[index].migration_name]; }, 'UNKNOWN_HISTORICAL_CHECKSUM');
 });
}
test('missing baseline and unexpected pending block', () => {
 reject(s => { s.ledger.splice(3, 1); }, 'REQUIRED_APPLIED_MIGRATION_MISSING');
 const c=loadRepositoryContract();reject(s=>s.ledger.push({...s.ledger[1],migration_name:commercePending[0],checksum:c.repositoryChecksums[commercePending[0]]}),'UNEXPECTED_PENDING_SET');
});
for (const name of commercePending) test(`applied ${name} requires exact checksum and completed step`,()=>{
 const c=loadRepositoryContract();
 reject(s=>{for(const n of commercePending)s.ledger.push({...s.ledger[1],migration_name:n,checksum:n===name?'f'.repeat(64):c.repositoryChecksums[n]});},'UNEXPECTED_CHECKSUM_MISMATCH',[]);
 reject(s=>{for(const n of commercePending)s.ledger.push({...s.ledger[1],migration_name:n,checksum:c.repositoryChecksums[n],applied_steps_count:n===name?0:1});},'APPLIED_STEPS_DIVERGED',[]);
});
test('coordinated compatibility and snapshot rewrite cannot redefine forensic pins',()=>{
 const c=loadRepositoryContract(),s=clone(),name=s.ledger[1].migration_name;c.compatibility.productionHistory.knownChecksumDivergences[name].productionChecksum='a'.repeat(64);s.ledger[1].checksum='a'.repeat(64);
 assert.throws(()=>verifyLedgerCompatibility(s,commercePending,c),/FORENSIC_PINS_CHANGED/);
});
test('baseline applied-step simulation and schema contract drift block',()=>{
 reject(s=>{s.ledger[1].applied_steps_count=0;},'APPLIED_STEPS_DIVERGED');
 const c=loadRepositoryContract();c.schemaChecksum='a'.repeat(64);assert.throws(()=>verifyLedgerCompatibility(clone(),commercePending,c),/REPOSITORY_SCHEMA_CONTRACT_CHANGED/);
});

// FASE 7.2: os dois estados reais que a aplicação da migration do autopilot
// produz. Antes do apply só a migration do autopilot está pendente; depois
// do apply nada está. Qualquer outro recorte parcial continua bloqueado.
test('autopilot migration alone is the only new legitimate pending set',()=>{
 const s=clone(),c=loadRepositoryContract();
 for(const n of [...commercePending,...architecturePending]){
   if(n===autopilotPending[0]) continue;
   s.ledger.push({ ...s.ledger[0], migration_name:n, checksum:c.repositoryChecksums[n], applied_steps_count:1 });
 }
 const r=verifyLedgerCompatibility(s,autopilotPending,c);
 assert.deepEqual(r.pending,autopilotPending);
 assert.equal(r.warnings.length,2);
 assert.equal(r.ledgerMutation,false);
 // e, aplicando a ultima, volta a 'nada pendente'
 s.ledger.push({ ...s.ledger[0], migration_name:autopilotPending[0], checksum:c.repositoryChecksums[autopilotPending[0]], applied_steps_count:1 });
 assert.deepEqual(verifyLedgerCompatibility(s,[],c).pending,[]);
});
test('no invented partial pending set around the autopilot migration',()=>{
 for(const bogus of [[...autopilotPending,'20260925130000_catalog_cutover_global_control_timestamptz'],['20260926120000_catalog_cutover_autopilot_x'],[...autopilotPending,...commercePending]])
   assert.throws(()=>verifyLedgerCompatibility(clone(),bogus),/PENDING_ALLOWLIST_REQUIRED/);
 // A migration do autopilot, se aplicada, tem de trazer o checksum do PIN.
 const s=clone(),c=loadRepositoryContract();
 for(const n of [...commercePending,...architecturePending]) s.ledger.push({ ...s.ledger[0], migration_name:n, checksum:n===autopilotPending[0]?'f'.repeat(64):c.repositoryChecksums[n], applied_steps_count:1 });
 assert.throws(()=>verifyLedgerCompatibility(s,[],c),/UNEXPECTED_CHECKSUM_MISMATCH/);
 // E com o PIN correto, sem pendentes, o gate passa.
 s.ledger[s.ledger.length-1].checksum=c.repositoryChecksums[autopilotPending[0]];
 assert.deepEqual(verifyLedgerCompatibility(s,[],c).pending,[]);
});
