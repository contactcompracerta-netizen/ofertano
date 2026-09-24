/** 50AG.4B-R3C local rehearsal: managed security scope + Commerce migrations on a NEW disposable DB (55433 only). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { validateLocalTarget, assertLocalConnection, scaffoldLocalSupabase, verifyLocalRls } from './local-supabase-compatibility.mjs';
import { collectPredeployState } from './local-security-state.mjs';
import { verifyLedgerCompatibility, commercePending, architecturePending, loadRepositoryContract } from '../migration-history/verify-ledger-compatibility.mjs';
const fullPending = [...commercePending, ...architecturePending];
import { authorizeCommerceMigrateDeploy, commerceTables, requiredOffFlags } from '../migration-history/authorize-commerce-migrate-deploy.mjs';
import { verifyPrismaDeployRehearsal } from '../migration-history/verify-prisma-deploy-rehearsal.mjs';
import fixture from '../migration-history/production-ledger.fixture.json' with {type:'json'};
import security from '../migration-history/expected-security-state.json' with {type:'json'};
import r3b from '../migration-history/production-security-r3b.fixture.json' with {type:'json'};
import pins from '../migration-history/forensic-pins.json' with {type:'json'};
const root = process.cwd();
const dbName = 'ofertano_50ag4b_r3c_rehearsal';
process.env.BOOTSTRAP_ALLOWED_DATABASES = dbName;
const target = `postgresql://postgres@127.0.0.1:55433/${dbName}`;
const cli = 'node_modules/prisma/build/index.js';
const pinsDeliverySHA = 'ec755ac167db6d46f939be1005c791142c6127c2';
const manifest = JSON.parse(fs.readFileSync('scripts/bootstrap/manifest.json', 'utf8'));
const tablePrivileges = ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
function run(args, expected = 0) {
  validateLocalTarget(target);
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, DIRECT_URL: target, DATABASE_URL: target, DOTENV_CONFIG_PATH: '/dev/null', VERCEL_ENV: '', VERCEL_TARGET_ENV: '' }, encoding: 'utf8', timeout: 240000 });
  assert.equal(result.status, expected, `${args.join(' ')}: ${(result.stderr ?? '').slice(-2000)} ${(result.stdout ?? '').slice(-2000)}`);
  return (result.stdout ?? '') + '\n' + (result.stderr ?? '');
}
async function connect() {
  validateLocalTarget(target);
  const client = new Client({ connectionString: target }); await client.connect(); await assertLocalConnection(client, target); return client;
}
async function ensureDatabase() {
  validateLocalTarget(target);
  const admin = new Client({ host: '127.0.0.1', port: 55433, user: 'postgres', database: 'postgres' }); await admin.connect();
  try {
    assert.equal(admin.connection.stream.remoteAddress, '127.0.0.1'); assert.equal(admin.connection.stream.remotePort, 55433);
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName])).rowCount;
    assert.equal(exists, 0, 'Requires a NEW mission-owned fixture; never resets existing data');
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally { await admin.end(); }
}
async function baseline(client) {
  assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0, 'Requires an empty disposable fixture; never resets existing data');
  await client.query(fs.readFileSync('scripts/bootstrap/initial-schema.sql', 'utf8'));
  for (const migration of Object.keys(manifest.baselineMigrations)) run([cli, 'migrate', 'resolve', '--applied', migration]);
  return await ledger(client);
}
async function ledger(client) { return JSON.parse(JSON.stringify((await client.query('SELECT * FROM "_prisma_migrations" ORDER BY migration_name')).rows)); }
async function counts(client, tables) { const result = {}; for (const table of tables) result[table] = Number((await client.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n); return result; }
// Part M: static object contract of the two Commerce migrations (SQL comments stripped).
function staticObjectContract() {
  const names = ['20260917120000_commerce_intelligence_foundation', '20260918100000_commerce_canary_control_plane', ...architecturePending];
  const forbidden = [/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i, /CREATE\s+TRIGGER/i, /CREATE\s+(?:SEQUENCE|VIEW|MATERIALIZED\s+VIEW|POLICY)\b/i, /\bGRANT\s+/i, /\bREVOKE\s+/i, /ALTER\s+DEFAULT\s+PRIVILEGES/i, /\bOWNER\s+TO\b/i, /ENABLE\s+ROW\s+LEVEL/i];
  const summary = { tables: 0, enumTypes: 0, indexes: 0, uniqueIndexes: 0 };
  for (const name of names) {
    const sql = fs.readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const re of forbidden) assert.ok(!re.test(sql), `COMMERCE_STATIC_CONTRACT_VIOLATION ${name} ${re}`);
    summary.tables += (sql.match(/CREATE\s+TABLE\b/gi) ?? []).length;
    summary.enumTypes += (sql.match(/CREATE\s+TYPE\s+[\s\S]*?AS\s+ENUM\b/gi) ?? []).length;
    summary.indexes += (sql.match(/CREATE\s+INDEX\b/gi) ?? []).length;
    summary.uniqueIndexes += (sql.match(/CREATE\s+UNIQUE\s+INDEX\b/gi) ?? []).length;
  }
  assert.equal(summary.tables, 12); assert.equal(summary.enumTypes, 14); assert.ok(summary.indexes >= 29); assert.ok(summary.uniqueIndexes >= 4);
  return summary;
}
const evidence = { prismaVersion: '7.9.0', target: '127.0.0.1:55433', database: dbName };
await ensureDatabase();
const client = await connect();
try {
  evidence.staticObjectContract = staticObjectContract();
  await baseline(client);
  await scaffoldLocalSupabase(client, target);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ofertano-r3c-rehearsal-'));
  try {
    const migrations = path.join(temporary, 'migrations'); fs.mkdirSync(migrations); fs.copyFileSync('prisma/migrations/migration_lock.toml', path.join(migrations, 'migration_lock.toml'));
    for (const name of [...Object.keys(manifest.baselineMigrations), ...Object.keys(manifest.forwardMigrations).slice(0, 2)]) { fs.mkdirSync(path.join(migrations, name)); fs.copyFileSync(`prisma/migrations/${name}/migration.sql`, path.join(migrations, name, 'migration.sql')); }
    const config = path.join(temporary, 'prisma.config.ts');
    fs.writeFileSync(config, `export default { schema: ${JSON.stringify(path.join(root, 'prisma/schema.prisma'))}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DIRECT_URL } };\n`);
    const rlsDeploy = run([cli, 'migrate', 'deploy', '--config', config]);
    for (const name of Object.keys(manifest.forwardMigrations).slice(0, 2)) assert.ok(rlsDeploy.includes(`Applying migration \`${name}\``));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  // Intentional mutation of a LOCAL disposable ledger only, reproducing the Production-like 9-row state.
  await client.query('BEGIN');
  try {
    for (const row of fixture.ledger) assert.equal((await client.query('UPDATE "_prisma_migrations" SET checksum=$1,applied_steps_count=$2 WHERE migration_name=$3', [row.checksum, row.applied_steps_count, row.migration_name])).rowCount, 1);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  const before = await ledger(client); assert.equal(before.length, 9);
  const gate = verifyLedgerCompatibility({ version: 1, ledger: before }, fullPending); assert.equal(gate.warnings.length, 2);
  const expectedProductionIdentity = { environment: 'production', targetEnvironment: 'production', projectId: pins.projectId, deliverySHA: pinsDeliverySHA };
  const schemaState = await collectPredeployState(client, expectedProductionIdentity);
  assert.equal(schemaState.version, 2); assert.equal(schemaState.migrationRole, 'postgres');
  assert.equal(schemaState.publicSchemaPrivileges.anon.create, false); assert.equal(schemaState.publicSchemaPrivileges.authenticated.create, false);
  // Local managed policies must equal the canonical 10 (production-formed).
  const canonicalManaged = security.policies;
  const localManaged = schemaState.policies.filter(p => canonicalManaged.some(c => c.tablename === p.tablename && c.policyname === p.policyname));
  assert.equal(localManaged.length, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(localManaged.map(p => ({ tablename: p.tablename, policyname: p.policyname, permissive: p.permissive, roles: [...p.roles].sort(), cmd: p.cmd, qual: p.qual, with_check: p.with_check })))), JSON.parse(JSON.stringify(canonicalManaged.map(p => ({ tablename: p.tablename, policyname: p.policyname, permissive: p.permissive, roles: [...p.roles].sort(), cmd: p.cmd, qual: p.qual, with_check: p.with_check })))));
  // Inject R3B reality into the SNAPSHOT ONLY (DB untouched): 6 unmanaged policies + platform default-ACL rows.
  const unmanaged = r3b.policies.filter(p => !canonicalManaged.some(c => c.tablename === p.tablename && c.policyname === p.policyname));
  assert.equal(unmanaged.length, 6);
  schemaState.policies = [...localManaged, ...unmanaged];
  const platformDefaults = [...r3b.defaultPrivileges.filter(r => r.owner === 'supabase_admin'), ...r3b.defaultPrivileges.filter(r => r.grantee === 'service_role')];
  schemaState.defaultPrivileges = [...schemaState.defaultPrivileges, ...platformDefaults];
  const observedFlags = { version: 1, flags: Object.fromEntries(requiredOffFlags.map(n => [n, false])), canaryTokenPresent: false };
  const authorization = authorizeCommerceMigrateDeploy({ ledgerSnapshot: { version: 1, ledger: before }, allowedPending: fullPending, repositoryContract: loadRepositoryContract(), observedFlags, schemaState, expectedProductionIdentity });
  assert.equal(authorization.verdict, 'AUTHORIZED', JSON.stringify(authorization));
  assert.equal(authorization.outOfScopePolicyCount, 6);
  assert.equal(authorization.managedPolicyCount, 10);
  assert.equal(authorization.managedGrantCount, 38);
  assert.equal(authorization.unsafeMigrationDefaultAclCount, 0);
  assert.equal(authorization.publicSchemaCreateSafe, true);
  assert.deepEqual(authorization.outOfScopePolicies.map(p => p.policyname).sort(), ['notifications_select_own', 'notifications_update_own', 'price_alerts_delete_own', 'price_alerts_insert_own', 'price_alerts_select_own', 'price_alerts_update_own'].sort());
  // LOCAL migrate deploy of Commerce ONLY (Foundation + Control Plane).
  const deployOutput = run([cli, 'migrate', 'deploy']);
  const execution = verifyPrismaDeployRehearsal({ exitCode: 0, output: deployOutput, expected: fullPending });
  assert.deepEqual(execution.applied, fullPending);
  const after = await ledger(client); assert.equal(after.length, 12);
  for (const name of fullPending) { const row = after.find(r => r.migration_name === name); assert.ok(row.finished_at); assert.equal(row.applied_steps_count, 1); assert.equal(row.checksum, manifest.forwardMigrations[name]); }
  // Part W: 10 Commerce tables present, 0 rows, zero effective anon/authenticated privileges.
  const present = (await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])", [commerceTables])).rows.map(r => r.relname);
  assert.deepEqual(present.sort(), [...commerceTables].sort());
  const newCounts = await counts(client, commerceTables); assert.ok(Object.values(newCounts).every(n => n === 0));
  const privilegeMatrix = {};
  for (const role of ['anon', 'authenticated']) {
    privilegeMatrix[role] = {};
    for (const t of commerceTables) {
      const row = (await client.query('SELECT has_table_privilege($1,$2,$3) AS s,has_table_privilege($1,$2,$4) AS i,has_table_privilege($1,$2,$5) AS u,has_table_privilege($1,$2,$6) AS d,has_table_privilege($1,$2,$7) AS t,has_table_privilege($1,$2,$8) AS r,has_table_privilege($1,$2,$9) AS g,has_table_privilege($1,$2,$10) AS m', [role, `public."${t}"`, 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'])).rows[0];
      const effective = tablePrivileges.filter(p => row[['s', 'i', 'u', 'd', 't', 'r', 'g', 'm'][tablePrivileges.indexOf(p)]]);
      privilegeMatrix[role][t] = effective;
      assert.deepEqual(effective, [], `COMMERCE_PRIVILEGE_LEAK ${role} ${t}`);
    }
  }
  const schemaCheck = (await client.query('SELECT has_schema_privilege($1,$2,$3) AS usage,has_schema_privilege($1,$2,$4) AS create', ['anon', 'public', 'USAGE', 'CREATE'])).rows[0];
  assert.equal(schemaCheck.create, false);
  await verifyLocalRls(client, target);
  evidence.rehearsal = { verdict: 'PASS', authorization, execution, appliedNames: execution.applied, commerceOnly: JSON.stringify(execution.applied) === JSON.stringify(commercePending), newTableCounts: newCounts, anonAuthPrivileges: privilegeMatrix, publicSchemaAnonCreate: schemaCheck.create, ledgerBefore: before, ledgerAfter: after, r3bSnapshotInjected: { unmanagedPolicies: unmanaged.length, platformDefaultRows: platformDefaults.length }, staticObjectContract: evidence.staticObjectContract };
  fs.mkdirSync('docs/evidence/50ag4b-r3c', { recursive: true });
  fs.writeFileSync('docs/evidence/50ag4b-r3c/rehearsal.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ rehearsal: 'PASS', commerceOnlyApplied: true, outOfScopePoliciesAuthorized: 6, unsafeMigrationDefaultAclCount: 0 }));
} finally { await client.end(); }