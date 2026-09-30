import { withForwardMigrationsApplied } from './forward-applied-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyLedgerCompatibility, loadRepositoryContract, commercePending, architecturePending, autopilotPending, blockingKeyMigration, retroactivePending, schemaReconciliationPending, priceAlertReconciliationPending } from './verify-ledger-compatibility.mjs';
const original = JSON.parse(fs.readFileSync(new URL('./production-ledger.fixture.json', import.meta.url), 'utf8'));
const clone = () => withForwardMigrationsApplied(original);
const fullPending = [...retroactivePending, ...commercePending, ...architecturePending, ...schemaReconciliationPending, ...priceAlertReconciliationPending];
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
/*
 * CASO A (teste discriminante): falta UMA migration obrigatoriamente aplicada.
 *
 * O alvo e a migration RLS POR IDENTIDADE, nao por posicao. Antes este teste
 * usava `s.ledger.pop()`, o que funcionava so enquanto a migration RLS fosse
 * a ULTIMA entrada do fixture. Ao adicionar a migration de blocking (que e a
 * mais recente, portanto a ultima), o `pop()` passou a remover a migration
 * ERRADA -- uma migration forward, que nao esta em baselineNames/rlsNames.
 * Resultado: REQUIRED_APPLIED_MIGRATION_MISSING deixava de disparar e o
 * gate acusava UNEXPECTED_PENDING_SET.
 *
 * A precedencia do gate NUNCA mudou. O que estava quebrado era a suposicao
 * posicional do teste. Aqui o alvo e nomeado, e o teste volta a provar o que
 * sempre pretendeu provar: sumir com uma RLS continua bloqueando.
 */
/*
 * CASO B: nenhuma required-applied ausente, mas o conjunto PENDING diverge.
 * O gate tem de dizer UNEXPECTED_PENDING_SET (nao "missing").
 */
test('CASO B: pending set inesperado continua sendo UNEXPECTED_PENDING_SET', () => {
  // Ledger completo, exceto a migration de blocking. Nenhuma required-applied
  // some, mas o pending {blockingKeyMigration} nao e um set autorizado => o gate
  // tem de dizer UNEXPECTED_PENDING_SET. Isto prova que a migration nova esta
  // COBERTA pelo gate (nao e invisivel) e que pending inesperado segue barrando.
  reject(s => {
    const idx = s.ledger.findIndex(e => e.migration_name === blockingKeyMigration[0]);
    assert.notEqual(idx, -1, 'fixture deve conter a migration de blocking');
    s.ledger.splice(idx, 1);
  }, 'UNEXPECTED_PENDING_SET');
});

/*
 * CASO C: as DUAS anomalias ao mesmo tempo. Documenta a PRECEDENCIA
 * comprovada: REQUIRED_APPLIED_MISSING vem antes, porque no verificador a
 * checagem de required-applied (linha ~97) ocorre ANTES do calculo de
 * pending (linha ~98). Nenhuma condicao fica mascarada: a outra continua
 * detectavel sozinha (CASO A e CASO B provam isso).
 */
test('CASO C: com as duas anomalias, missing tem precedencia sobre pending', () => {
  reject(s => {
    const idx = s.ledger.findIndex(e => e.migration_name === '20260915203000_fix_rls_product_public_read');
    s.ledger.splice(idx, 1);            // remove required-applied -> CASO A
    s.ledger.pop();                     // e deixa um pending-set inesperado
  }, 'REQUIRED_APPLIED_MIGRATION_MISSING');
});

test('missing RLS blocks', () => reject(s => {
  const idx = s.ledger.findIndex(e => e.migration_name === '20260915203000_fix_rls_product_public_read');
  assert.notEqual(idx, -1, 'fixture deve conter a migration RLS alvo');
  s.ledger.splice(idx, 1);
}, 'REQUIRED_APPLIED_MIGRATION_MISSING'));
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
test('autopilot plus schema reconciliation is the legitimate pending set',()=>{
 const s=clone(),c=loadRepositoryContract();
 for(const n of [...retroactivePending,...commercePending,...architecturePending]){
   if(n===autopilotPending[0]) continue;
   s.ledger.push({ ...s.ledger[0], migration_name:n, checksum:c.repositoryChecksums[n], applied_steps_count:1 });
 }
 const r=verifyLedgerCompatibility(s,[...autopilotPending,...schemaReconciliationPending,...priceAlertReconciliationPending],c);
 assert.deepEqual(r.pending,[...autopilotPending,...schemaReconciliationPending,...priceAlertReconciliationPending]);
 assert.equal(r.warnings.length,2);
 assert.equal(r.ledgerMutation,false);
 // e, aplicando a ultima, volta a 'nada pendente'
 s.ledger.push({ ...s.ledger[0], migration_name:autopilotPending[0], checksum:c.repositoryChecksums[autopilotPending[0]], applied_steps_count:1 });
 assert.deepEqual(verifyLedgerCompatibility(s,[...schemaReconciliationPending,...priceAlertReconciliationPending],c).pending,[...schemaReconciliationPending,...priceAlertReconciliationPending]);
 s.ledger.push({ ...s.ledger[0], migration_name:schemaReconciliationPending[0], checksum:c.repositoryChecksums[schemaReconciliationPending[0]], applied_steps_count:1 });
  assert.deepEqual(verifyLedgerCompatibility(s,priceAlertReconciliationPending,c).pending,priceAlertReconciliationPending);
  s.ledger.push({ ...s.ledger[0], migration_name:priceAlertReconciliationPending[0], checksum:c.repositoryChecksums[priceAlertReconciliationPending[0]], applied_steps_count:1 });
 assert.deepEqual(verifyLedgerCompatibility(s,[],c).pending,[]);
});
test('no invented partial pending set around the autopilot migration',()=>{
 for(const bogus of [[...autopilotPending,'20260925130000_catalog_cutover_global_control_timestamptz'],['20260926120000_catalog_cutover_autopilot_x'],[...autopilotPending,...commercePending]])
   assert.throws(()=>verifyLedgerCompatibility(clone(),bogus),/PENDING_ALLOWLIST_REQUIRED/);
 // A migration do autopilot, se aplicada, tem de trazer o checksum do PIN.
 const s=clone(),c=loadRepositoryContract();
 for(const n of [...retroactivePending,...commercePending,...architecturePending,...schemaReconciliationPending,...priceAlertReconciliationPending]) s.ledger.push({ ...s.ledger[0], migration_name:n, checksum:n===autopilotPending[0]?'f'.repeat(64):c.repositoryChecksums[n], applied_steps_count:1 });
 assert.throws(()=>verifyLedgerCompatibility(s,[],c),/UNEXPECTED_CHECKSUM_MISMATCH/);
 // E com o PIN correto, sem pendentes, o gate passa.
 s.ledger.find(r=>r.migration_name===autopilotPending[0]).checksum=c.repositoryChecksums[autopilotPending[0]];
 assert.deepEqual(verifyLedgerCompatibility(s,[],c).pending,[]);
});

// FASE 8.4 — reconciliacao de PriceAlert. O gate aceita EXATAMENTE os estados
// nomeados abaixo e continua rejeitando qualquer recorte parcial inventado.
test('price alert reconciliation is pinned and only its exact pending states are accepted',()=>{
  const c=loadRepositoryContract();
  // 1) Inventario canonico: a migration existe, com checksum pinado, e e a ultima.
  assert.deepEqual(priceAlertReconciliationPending,['20260927120000_price_alert_schema_reconciliation']);
  assert.equal(c.manifest.forwardMigrations['20260927120000_price_alert_schema_reconciliation'],
               c.repositoryChecksums['20260927120000_price_alert_schema_reconciliation']);
  // A posicao no inventario e relativa, nao absoluta: o inventario forward cresce
  // a cada migration aditiva aplicada (social_post, catalogo ML). O que precisa
  // valer e a ORDEM CRONOLOGICA do catalogo, que e o invariante real.
  const forwardNames=Object.keys(c.manifest.forwardMigrations);
  const pos=n=>{const i=forwardNames.indexOf(n);assert.notEqual(i,-1,`${n} ausente do inventario forward`);return i;};
  assert.ok(pos('20260927100000_schema_reconciliation')<pos(priceAlertReconciliationPending[0]),
            'reconciliacao de schema precede a de PriceAlert');
  assert.ok(pos(priceAlertReconciliationPending[0])<pos('20260927180000_social_post_index_reconciliation'),
            'reconciliacao de PriceAlert precede a de social_post');
  // 2) PREVIEW: schema_reconciliation ja aplicada, so a de PriceAlert pendente.
  const p=clone();
  for(const n of [...retroactivePending,...commercePending,...architecturePending,...schemaReconciliationPending])
    p.ledger.push({ ...p.ledger[0], migration_name:n, checksum:c.repositoryChecksums[n], applied_steps_count:1 });
  const rp=verifyLedgerCompatibility(p,priceAlertReconciliationPending,c);
  assert.deepEqual(rp.pending,priceAlertReconciliationPending);
  assert.equal(rp.ledgerMutation,false);
  // 3) PRODUCAO antes do deploy: exatamente as duas pendentes.
  const q=clone();
  for(const n of [...retroactivePending,...commercePending,...architecturePending])
    q.ledger.push({ ...q.ledger[0], migration_name:n, checksum:c.repositoryChecksums[n], applied_steps_count:1 });
  const rq=verifyLedgerCompatibility(q,[...schemaReconciliationPending,...priceAlertReconciliationPending],c);
  assert.deepEqual(rq.pending,[...schemaReconciliationPending,...priceAlertReconciliationPending]);
  assert.equal(rq.warnings.length,2);
  // 4) Apos o deploy: nada pendente.
  for(const n of [...schemaReconciliationPending,...priceAlertReconciliationPending])
    q.ledger.push({ ...q.ledger[0], migration_name:n, checksum:c.repositoryChecksums[n], applied_steps_count:1 });
  assert.deepEqual(verifyLedgerCompatibility(q,[],c).pending,[]);
  // 5) Nenhum recorte parcial inventado e aceito.
  // a ordem importa: as DUAS pendentes em ordem invertida nao e um estado legitimo
  for(const bogus of [[...priceAlertReconciliationPending,'20260927100000_schema_reconciliation'],
                      [...priceAlertReconciliationPending,...commercePending],
                      ['20260927120000_price_alert_schema_reconciliation_x']])
    assert.throws(()=>verifyLedgerCompatibility(clone(),bogus),/PENDING_ALLOWLIST_REQUIRED/);
});
// 6) Checksum alterado da migration nova bloqueia: o gate nao aceita o PIN reescrito.
test('price alert reconciliation checksum is not silently rewritable',()=>{
  const c=loadRepositoryContract();
  const s=clone();
  for(const n of [...retroactivePending,...commercePending,...architecturePending,...schemaReconciliationPending,...priceAlertReconciliationPending])
    s.ledger.push({ ...s.ledger[0], migration_name:n, checksum:'d'.repeat(64), applied_steps_count:1 });
  assert.throws(()=>verifyLedgerCompatibility(s,[]),/UNEXPECTED_CHECKSUM_MISMATCH/);
});
