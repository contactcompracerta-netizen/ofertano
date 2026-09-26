/** Pure Production-ledger gate. Reads snapshots/files only; never connects or mutates. */
import fs from 'node:fs';
import pins from './forensic-pins.json' with { type: 'json' };
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const commercePending = ['20260917120000_commerce_intelligence_foundation', '20260918100000_commerce_canary_control_plane'];
// CATALOG_ARCHITECTURE_V1 (aditivo): nova migration forward canônica.
// FASE 7.2: a migration do autopilot e ADITIVA (2 enums + 3 tabelas) e entra
// na MESMA cadeia do cutover, porque o estado do autopilot vive no mesmo plano
// de controle. Nao muda nenhuma migracao ja aplicada.
export const cutoverPending = ['20260925120000_catalog_cutover_global_control', '20260925130000_catalog_cutover_global_control_timestamptz', '20260926120000_catalog_cutover_autopilot'];
export const architecturePending = ['20260924080000_catalog_architecture_v1', ...cutoverPending];
const knownNames = ['20260824120000_analytics_intelligence', '20260828220000_admin_push_subscription'];
const rlsNames = ['20260915194500_rls_security_hardening', '20260915203000_fix_rls_product_public_read'];
export const canonicalForwardInventory = [...rlsNames, ...commercePending, ...architecturePending];
// Estados legítimos de produção para o histórico do catálogo: nada pendente,
// só o commerce, só o catálogo, tudo, e os dois pontos intermediários do
// cutover (as duas migrations do plano de controle, e só a segunda delas —
// que é exatamente o estado de produção enquanto o 20260925120000 já foi
// aplicado e o 20260925130000 ainda não).
const pendingAllowlistSets = [[], commercePending, architecturePending, [...commercePending, ...architecturePending], cutoverPending, [cutoverPending[1]], architecturePending.slice(0, -1)];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validChecksum = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export function loadRepositoryContract() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/bootstrap/manifest.json'), 'utf8'));
  const compatibility = JSON.parse(fs.readFileSync(path.join(root, 'scripts/migration-history/production-ledger-compatibility.json'), 'utf8'));
  const names = fs.readdirSync(path.join(root, 'prisma/migrations')).filter(n => fs.existsSync(path.join(root, 'prisma/migrations', n, 'migration.sql'))).sort();
  const repositoryChecksums = Object.fromEntries(names.map(n => [n, sha(fs.readFileSync(path.join(root, 'prisma/migrations', n, 'migration.sql')))]));
  return { manifest, compatibility, repositoryChecksums, baselineDDLChecksum: sha(fs.readFileSync(path.join(root, 'scripts/bootstrap/initial-schema.sql'))), schemaChecksum: sha(fs.readFileSync(path.join(root, 'prisma/schema.prisma'))) };
}
export function verifyLedgerCompatibility(snapshot, allowedPending, contract = loadRepositoryContract()) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.ledger)) fail('INVALID_SNAPSHOT');
  if (!Array.isArray(allowedPending) || !pendingAllowlistSets.some(set => same(set, allowedPending))) fail('PENDING_ALLOWLIST_REQUIRED');
  const { manifest, compatibility, repositoryChecksums } = contract;
  if (manifest.version !== 3 || compatibility.version !== 1) fail('CONTRACT_VERSION_MISMATCH');
  const expected = { ...manifest.baselineMigrations, ...manifest.forwardMigrations };
  if (!same(expected, pins.repositoryMigrationChecksums) || !same(compatibility.productionHistory?.knownChecksumDivergences, pins.knownDivergences) || !same(compatibility.productionHistory?.restoredExactMigrations, pins.restoredExactMigrations)) fail('FORENSIC_PINS_CHANGED');
  if (manifest.baselineDDLHash !== pins.baselineDDLChecksum || contract.baselineDDLChecksum !== pins.baselineDDLChecksum || manifest.currentSchemaSHA256 !== pins.schemaChecksum || contract.schemaChecksum !== pins.schemaChecksum) fail('REPOSITORY_SCHEMA_CONTRACT_CHANGED');
  const baselineNames = ['20260824000000_postgresql_baseline', ...knownNames, '20260905120000_price_alerts', '20260907000000_social_automation', '20260907220000_social_three_slots', '20260912000000_add_raw_marketplace_listing'];
  if (!same(Object.keys(manifest.baselineMigrations).sort(), baselineNames.sort()) || !same(Object.keys(manifest.forwardMigrations), canonicalForwardInventory)) fail('CANONICAL_INVENTORY_CHANGED');
  if (!same(Object.keys(repositoryChecksums).sort(), Object.keys(expected).sort())) fail('REPOSITORY_INVENTORY_MISMATCH');
  for (const [name, checksum] of Object.entries(expected)) if (!validChecksum(checksum) || repositoryChecksums[name] !== checksum) fail('REPOSITORY_CHECKSUM_CHANGED');
  const history = compatibility.productionHistory;
  if (!history || !same(Object.keys(history.knownChecksumDivergences ?? {}).sort(), [...knownNames].sort()) || !same(Object.keys(history.restoredExactMigrations ?? {}).sort(), rlsNames)) fail('COMPATIBILITY_ALLOWLIST_CHANGED');
  for (const name of knownNames) {
    const row = history.knownChecksumDivergences[name];
    if (!validChecksum(row.productionChecksum) || row.productionChecksum === row.repositoryChecksum || row.repositoryChecksum !== expected[name] || row.appliedBytesRecoverable !== false || row.policy !== 'KNOWN_WARNING_ONLY_NO_LEDGER_MUTATION') fail('INVALID_KNOWN_DIVERGENCE');
  }
  for (const name of rlsNames) {
    const row = history.restoredExactMigrations[name];
    if (row.exactMatch !== true || row.productionChecksum !== expected[name] || row.repositoryChecksum !== expected[name]) fail('RLS_CONTRACT_CHECKSUM_CHANGED');
  }
  const seen = new Set();
  const warnings = [];
  for (const row of snapshot.ledger) {
    if (!row || typeof row.migration_name !== 'string' || !validChecksum(row.checksum)) fail('INVALID_LEDGER_ROW');
    const name = row.migration_name;
    if (!Object.hasOwn(expected, name)) fail('UNKNOWN_DB_ONLY_MIGRATION');
    if (seen.has(name)) fail('DUPLICATE_MIGRATION');
    seen.add(name);
    if (row.rolled_back_at !== null) fail('ROLLED_BACK_MIGRATION');
    if (!row.finished_at) fail('UNFINISHED_MIGRATION');
    if (typeof row.started_at !== 'string' || typeof row.finished_at !== 'string' || !Number.isFinite(Date.parse(row.started_at)) || !Number.isFinite(Date.parse(row.finished_at)) || Date.parse(row.finished_at) < Date.parse(row.started_at) || !Number.isInteger(row.applied_steps_count) || row.applied_steps_count < 0) fail('INVALID_LEDGER_ROW');
    if (row.applied_steps_count !== (pins.productionAppliedSteps[name] ?? 1)) fail('APPLIED_STEPS_DIVERGED');
    const known = history.knownChecksumDivergences[name];
    if (known) {
      // Require the forensic checksum itself; a silently edited ledger is not accepted.
      if (row.checksum !== known.productionChecksum) fail('UNKNOWN_HISTORICAL_CHECKSUM');
      warnings.push({ migration: name, classification: 'KNOWN_HISTORICAL_CHECKSUM_DIVERGENCE', policy: known.policy });
    } else if (row.checksum !== expected[name]) fail(rlsNames.includes(name) ? 'RLS_CHECKSUM_MISMATCH' : 'UNEXPECTED_CHECKSUM_MISMATCH');
  }
  for (const name of [...baselineNames, ...rlsNames]) if (!seen.has(name)) fail('REQUIRED_APPLIED_MIGRATION_MISSING');
  const pending = Object.keys(expected).filter(n => !seen.has(n)).sort();
  if (!same(pending, allowedPending)) fail('UNEXPECTED_PENDING_SET');
  return { verdict: 'PASS_WITH_KNOWN_HISTORICAL_DIVERGENCES', warnings, pending, ledgerMutation: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--snapshot' || args[2] !== '--allowed-pending') fail('USAGE_SNAPSHOT_AND_PENDING_REQUIRED');
    const pending = args[3] === 'none' ? [] : args[3].split(',');
    console.log(JSON.stringify(verifyLedgerCompatibility(JSON.parse(fs.readFileSync(args[1], 'utf8')), pending)));
  } catch (error) {
    console.error(JSON.stringify({ verdict: 'FAIL_CLOSED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'INVALID_INPUT' }));
    process.exitCode = 1;
  }
}
