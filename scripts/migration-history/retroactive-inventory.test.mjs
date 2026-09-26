/**
 * Testes DISCRIMINANTES do contrato de inventário de migrations.
 *
 * Foco: provar que a categoria `retroactiveForwardMigrations` é uma EXCEÇÃO
 * EXPLÍCITA E PINADA — e NÃO uma brecha genérica que enfraqueça o invariante
 * normal "toda forward migration > última baseline".
 *
 * Esse invariante NORMAL é intencionalmente preservado. A categoria retroativa
 * só é aceita quando cada entrada declara anchor, posição, rationale, estado de
 * produção e checksum pinado coerente com o disco.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateInventory, assertRetroactivePending } from '../bootstrap/migration-inventory.mjs';
import * as verifyMod from './verify-ledger-compatibility.mjs';

const RETRO = '20260905110000_bootstrap_legacy_objects';
const ANCHOR = '20260905120000_price_alerts';
const SHA = 'a'.repeat(64);

const base = () => ({
  baselineMigrations: {
    '20260824000000_postgresql_baseline': '1'.repeat(64),
    '20260824120000_analytics_intelligence': '2'.repeat(64),
    '20260828220000_admin_push_subscription': '3'.repeat(64),
    [ANCHOR]: '4'.repeat(64),
    '20260907000000_social_automation': '5'.repeat(64),
    '20260907220000_social_three_slots': '6'.repeat(64),
    '20260912000000_add_raw_marketplace_listing': '7'.repeat(64),
  },
  forwardMigrations: { '20260915194500_rls_security_hardening': '8'.repeat(64) },
  retroactiveForwardMigrations: {
    [RETRO]: { checksum: SHA, mustPrecede: ANCHOR, productionState: 'PENDING', rationale: 'bootstrap de objetos legados ausentes da cadeia versionada' },
  },
});

// checksums coerentes com o pin, por padrão
const sums = (m) => Object.fromEntries(Object.keys(m.baselineMigrations).map(n => [n, m.baselineMigrations[n]])
  .concat(Object.entries(m.forwardMigrations))
  .concat(Object.entries(m.retroactiveForwardMigrations).map(([n, v]) => [n, v.checksum])));
const run = (m, actual) => validateInventory({ ...m, actualNames: actual ?? Object.keys(sums(m)), actualChecksums: sums(m) });
const rejects = (mutate, code) => { const m = base(); mutate(m); assert.throws(() => run(m), new RegExp(code)); };

// A) forward ordinária depois da última baseline -> PASS
test('A: ordinary forward greater than lastBaseline is accepted', () => {
  assert.doesNotThrow(() => run(base()));
});

// B) forward ordinária <= última baseline -> FAIL (invariante normal INTACTO)
test('B: ordinary forward at or before lastBaseline is rejected', () => {
  rejects(m => { m.forwardMigrations[RETRO] = SHA; delete m.retroactiveForwardMigrations[RETRO]; },
    'BOOTSTRAP_MIGRATION_ORDER_VIOLATION');
});

// C) retroativa <= última baseline, declarada e pinada -> PASS
test('C: explicitly declared and pinned retroactive migration is accepted', () => {
  const r = run(base());
  assert.deepEqual(r.retroactive, [RETRO]);
  assert.equal(r.lastBaseline, '20260912000000_add_raw_marketplace_listing');
});

// D) migration antiga presente no disco e NÃO declarada -> FAIL
test('D: undeclared legacy-ordered migration is rejected', () => {
  // O arquivo EXISTE no disco, ordena antes de lastBaseline, mas NENHUMA
  // categoria o declara -> nao pode passar como migration esquecida.
  const m = base();
  delete m.retroactiveForwardMigrations[RETRO];
  assert.throws(() => validateInventory({
    ...m,
    actualNames: Object.keys(sums(m)).concat(RETRO),
    actualChecksums: { ...sums(m), [RETRO]: SHA },
  }), new RegExp('RETROACTIVE_NOT_DECLARED'));
});

// E) checksum retroativo divergente do disco -> FAIL
test('E: retroactive checksum divergence is rejected', () => {
  assert.throws(() => validateInventory({
    ...base(), actualNames: Object.keys(sums(base())), actualChecksums: { ...sums(base()), [RETRO]: 'b'.repeat(64) },
  }), new RegExp('RETROACTIVE_CHECKSUM_DIVERGED'));
});

// F) retroativa posicionada DEPOIS do mustPrecede -> FAIL
test('F: retroactive positioned after its mustPrecede anchor is rejected', () => {
  rejects(m => { m.retroactiveForwardMigrations[RETRO].mustPrecede = '20260824000000_postgresql_baseline'; },
    'RETROACTIVE_POSITION_INVALID');
});

// G) retroativa marcada como baseline -> FAIL (não pode ser baseline antes do deploy real)
test('G: retroactive declared as baseline is rejected', () => {
  // Dupla declaracao: aparece como baseline E como retroativa. Finge que
  // producao ja a executou quando o ledger real ainda diz PENDING.
  rejects(m => { m.baselineMigrations[RETRO] = SHA; },
    'RETROACTIVE_DECLARED_AS_BASELINE');
});

// H) retroativa declarada PENDING mas ledger já diz applied -> reconciliação pós-deploy exigida
test('H: retroactive declared pending but already applied in production ledger', () => {
  assert.throws(() => assertRetroactivePending([{ migration_name: RETRO }], [RETRO]),
    new RegExp('RETROACTIVE_POST_DEPLOY_RECONCILIATION_REQUIRED'));
  assert.equal(assertRetroactivePending([{ migration_name: ANCHOR }], [RETRO]), true);
});

// invariantes adicionais do contrato retroativo
test('anchor must exist among migrations production already executed', () => {
  rejects(m => { m.retroactiveForwardMigrations[RETRO].mustPrecede = '20260999999999_does_not_exist'; },
    'RETROACTIVE_MUST_PRECEDE_INVALID');
});
test('productionState must be PENDING', () => {
  rejects(m => { m.retroactiveForwardMigrations[RETRO].productionState = 'APPLIED'; },
    'RETROACTIVE_PRODUCTION_STATE_INVALID');
});
test('rationale is mandatory', () => {
  rejects(m => { delete m.retroactiveForwardMigrations[RETRO].rationale; },
    'RETROACTIVE_RATIONALE_MISSING');
});
test('pinned checksum is mandatory', () => {
  rejects(m => { m.retroactiveForwardMigrations[RETRO].checksum = ''; },
    'RETROACTIVE_CHECKSUM_MISSING');
});
test('retroactive must not also be an ordinary forward', () => {
  rejects(m => { m.forwardMigrations[RETRO] = SHA; },
    'RETROACTIVE_DECLARED_AS_NORMAL_FORWARD');
});

// o manifest real do repositório deve satisfazer o contrato
test('repository manifest satisfies the retroactive contract', () => {
  const man = JSON.parse(fs.readFileSync(new URL('../bootstrap/manifest.json', import.meta.url), 'utf8'));
  const dir = new URL('../../prisma/migrations/', import.meta.url);
  const actualNames = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(new URL(`${d.name}/migration.sql`, dir)))
    .map(d => d.name).sort();
  const actualChecksums = Object.fromEntries(actualNames.map(n =>
    [n, crypto.createHash('sha256').update(fs.readFileSync(new URL(`${n}/migration.sql`, dir))).digest('hex')]));
  const r = validateInventory({
    baselineMigrations: man.baselineMigrations,
    forwardMigrations: man.forwardMigrations,
    retroactiveForwardMigrations: man.retroactiveForwardMigrations,
    actualNames, actualChecksums,
  });
  assert.ok(r.retroactive.includes('20260905110000_bootstrap_legacy_objects'));
  assert.ok(!Object.keys(man.forwardMigrations).some(n => n <= r.lastBaseline));
});

/*
 * PARTE B — o pending set NÃO pode ser um literal hardcoded nos testes.
 *
 * `verifyLedgerCompatibility` calcula `pending` a partir do MANIFEST
 * (baseline + forward + retroactive), filtrando o que o ledger da producao
 * ainda nao contem, e ordena com .sort(). Os testes devem refletir esse
 * calculo, nao uma copia congelada dele.
 *
 * Estes testes provam que a expectativa e DERIVADA: mexer no manifest muda o
 * pending calculado, e a ordem errada e detectada.
 */
test('EXPECTED_PENDING_SET_IS_DERIVED_FROM_MANIFEST', () => {
  const { verifyLedgerCompatibility, loadRepositoryContract, retroactivePending, commercePending, architecturePending } = verifyMod;
  const fixture = JSON.parse(fs.readFileSync(new URL('./production-ledger.fixture.json', import.meta.url), 'utf8'));
  const man = loadRepositoryContract().manifest;
  const seen = new Set(fixture.ledger.map(r => r.migration_name));

  // 1) pending e exatamente "tudo que o manifest declara e o ledger nao tem",
  //    ordenado. Nao ha literal em lugar nenhum.
  const derived = Object.keys({ ...man.baselineMigrations, ...man.forwardMigrations, ...Object.fromEntries(Object.entries(man.retroactiveForwardMigrations).map(([n, m]) => [n, m.checksum])) })
    .filter(n => !seen.has(n)).sort();
  // a retroativa ordena PRIMEIRO porque 20260905110000 < 20260917120000 e pending e .sort()
  const expectedPending = [...retroactivePending, ...commercePending, ...architecturePending];
  assert.deepEqual(derived, expectedPending);

  // 2) o gate concorda com o calculo derivado.
  const r = verifyLedgerCompatibility(structuredClone(fixture), derived, loadRepositoryContract());
  assert.deepEqual(r.pending, derived);

  // 3) REMOVER a bootstrap do manifest muda o pending -> o gate rejeita.
  const withoutRetro = loadRepositoryContract();
  delete withoutRetro.manifest.retroactiveForwardMigrations[RETRO];
  // Falha fechado — e pelo motivo certo: manifest e pins forenses divergem
  // (o pin ainda declara a bootstrap), antes mesmo de comparar o pending.
  assert.throws(() => verifyLedgerCompatibility(structuredClone(fixture), derived, withoutRetro),
    new RegExp('FORENSIC_PINS_CHANGED'));

  // 4) ORDEM ERRADA e detectada: a mesma lista fora de ordem falha.
  // Ordem invertida nem e um estado legitimo: nem entra na allowlist.
  // Falha fechado ainda mais cedo, o que e o resultado correto.
  const wrongOrder = [...derived].reverse();
  assert.notDeepEqual(wrongOrder, derived);
  assert.throws(() => verifyLedgerCompatibility(structuredClone(fixture), wrongOrder, loadRepositoryContract()),
    new RegExp('PENDING_ALLOWLIST_REQUIRED'));
});
