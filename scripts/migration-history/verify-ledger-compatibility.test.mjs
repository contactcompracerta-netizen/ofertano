import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyLedgerCompatibility, loadRepositoryContract, commercePending } from './verify-ledger-compatibility.mjs';
const original = JSON.parse(fs.readFileSync(new URL('./production-ledger.fixture.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(original);
const reject = (mutate, code, pending = commercePending) => { const s = clone(); mutate(s); assert.throws(() => verifyLedgerCompatibility(s, pending), new RegExp(code)); };
test('forensic ledger allows exactly two known divergences and Commerce pending without mutation', () => {
  const snapshot = clone(), before = structuredClone(snapshot);
  const result = verifyLedgerCompatibility(snapshot, commercePending);
  assert.equal(result.verdict, 'PASS_WITH_KNOWN_HISTORICAL_DIVERGENCES'); assert.equal(result.warnings.length, 2); assert.deepEqual(result.pending, commercePending); assert.equal(result.ledgerMutation, false); assert.deepEqual(snapshot, before);
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
test('after Commerce applied, explicit empty pending allows unchanged historical warnings', () => {
 const s = clone(), c = loadRepositoryContract();
 for (const n of commercePending) s.ledger.push({ ...s.ledger[0], migration_name: n, checksum: c.repositoryChecksums[n], applied_steps_count: 1 });
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

test('Prisma rehearsal requires a real modified-migration warning, not a generic npm warning', async () => {
 const { verifyPrismaDeployRehearsal } = await import('./verify-prisma-deploy-rehearsal.mjs');
 const applied = commercePending.map(n => `Applying migration \`${n}\``).join('\n');
 assert.throws(() => verifyPrismaDeployRehearsal({ exitCode: 0, output: applied }), /WARNING_NOT_OBSERVED/);
 assert.throws(() => verifyPrismaDeployRehearsal({ exitCode: 0, output: 'npm warn unknown config\n'+applied }), /WARNING_NOT_OBSERVED/);
 assert.throws(() => verifyPrismaDeployRehearsal({ exitCode: 1, output: applied }), /NONZERO/);
 assert.throws(() => verifyPrismaDeployRehearsal({ exitCode: 0, output: 'Applying migration `unexpected`\nmodified' }), /UNEXPECTED_MIGRATION/);
 assert.equal(verifyPrismaDeployRehearsal({ exitCode: 0, output: 'Applied migration was modified\n'+applied }).verdict, 'PASS');
});
