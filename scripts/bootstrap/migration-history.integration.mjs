/** Full-chain and Prisma-behavior rehearsal, ONLY disposable local PostgreSQL 127.0.0.1:55433. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { validateLocalTarget, assertLocalConnection, scaffoldLocalSupabase, verifyLocalRls, localEquivalenceSchema, verifyLocalRolesAndAuth } from './local-supabase-compatibility.mjs';
import { verifyLedgerCompatibility, commercePending } from '../migration-history/verify-ledger-compatibility.mjs';
import { verifyPrismaDeployRehearsal } from '../migration-history/verify-prisma-deploy-rehearsal.mjs';
const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync('scripts/bootstrap/manifest.json', 'utf8'));
const compatibility = JSON.parse(fs.readFileSync('scripts/migration-history/production-ledger-compatibility.json', 'utf8'));
const names = { fresh: 'ofertano_50ag4b_history_fresh', forward: 'ofertano_50ag4b_history_forward', rehearsal: 'ofertano_50ag4b_history_rehearsal' };
const target = name => `postgresql://postgres@127.0.0.1:55433/${name}`;
const cli = 'node_modules/prisma/build/index.js';
const newTables = ['ProductIdentifier','ProductVariant','IdentityEvidence','IdentityConflict','OfferObservation','OfferPriceComponent','TrustSignal','ProductRelation','CommerceCanaryGrant','CommerceCanaryAttempt'];
const legacyTables = ['Product','MarketplaceOffer','RawMarketplaceListing','PriceHistory','BlogPost','SocialPost','AnalyticsEvent','AnalyticsDailyAgg','Favorite','PriceAlert','PriceAlertEvent'];
const evidence = { prismaVersion: '7.9.0', target: '127.0.0.1:55433', databases: names };
function run(args, name, expected = 0) {
 validateLocalTarget(target(name));
 const result = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, DIRECT_URL: target(name), DATABASE_URL: target(name), DOTENV_CONFIG_PATH: '/dev/null', VERCEL_ENV: '', VERCEL_TARGET_ENV: '' }, encoding: 'utf8', timeout: 240000 });
 assert.equal(result.status, expected, `${args.join(' ')}: ${(result.stderr ?? '').slice(-2000)} ${(result.stdout ?? '').slice(-2000)}`);
 return (result.stdout ?? '') + '\n' + (result.stderr ?? '');
}
async function connect(name) {
 validateLocalTarget(target(name));
 const client = new Client({ connectionString: target(name) }); await client.connect(); await assertLocalConnection(client, target(name)); return client;
}
async function ensureDatabase(name) {
 validateLocalTarget(target(name));
 const admin = new Client({ host: '127.0.0.1', port: 55433, user: 'postgres', database: 'postgres' }); await admin.connect();
 try { assert.equal(admin.connection.stream.remoteAddress, '127.0.0.1'); assert.equal(admin.connection.stream.remotePort, 55433);
  const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount;
  if (!exists) await admin.query(`CREATE DATABASE "${name}"`);
 } finally { await admin.end(); }
}
async function baseline(client, name) {
 assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0, 'Requires an empty disposable fixture; never resets existing data');
 await client.query(fs.readFileSync('scripts/bootstrap/initial-schema.sql', 'utf8'));
 for (const migration of Object.keys(manifest.baselineMigrations)) run([cli,'migrate','resolve','--applied',migration], name);
 return ledger(client);
}
async function ledger(client) { return (await client.query('SELECT migration_name,checksum,started_at,finished_at,rolled_back_at,applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name')).rows; }
async function counts(client, tables) { const result = {}; for (const table of tables) result[table] = Number((await client.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n); return result; }
function assertFullLedger(rows) {
 assert.equal(rows.length, 11);
 for (const row of rows) { assert.ok(row.finished_at); assert.equal(row.rolled_back_at, null); assert.equal(row.checksum, ({ ...manifest.baselineMigrations, ...manifest.forwardMigrations })[row.migration_name]); assert.equal(row.applied_steps_count, manifest.baselineMigrations[row.migration_name] ? 0 : 1); }
}
for (const name of Object.values(names)) await ensureDatabase(name);
const fresh = await connect(names.fresh), forward = await connect(names.forward), rehearsal = await connect(names.rehearsal);
try {
 const freshOutput = run(['scripts/bootstrap/fresh-bootstrap.mjs'], names.fresh);
 assert.match(freshOutput, /"verdict":"(PASS|NOOP)"/);
 const freshLedger = await ledger(fresh); assertFullLedger(freshLedger);
 const status = run([cli,'migrate','status'], names.fresh); assert.match(status,/up to date/i); assert.doesNotMatch(status,/modified|divergent|have not yet been applied/i);
 const forwardBaseline = await baseline(forward, names.forward);
 await scaffoldLocalSupabase(forward, target(names.forward));
 const forwardDeploy = run([cli,'migrate','deploy'], names.forward);
 for (const name of Object.keys(manifest.forwardMigrations)) assert.ok(forwardDeploy.includes(`Applying migration \`${name}\``));
 const forwardLedger = await ledger(forward); assertFullLedger(forwardLedger); assert.deepEqual(forwardLedger.filter(r => manifest.baselineMigrations[r.migration_name]), forwardBaseline);
 const a = JSON.parse(run(['scripts/bootstrap/schema-fingerprint.mjs'], names.fresh));
 const b = JSON.parse(run(['scripts/bootstrap/schema-fingerprint.mjs'], names.forward));
 assert.deepEqual(a,b);
 for (const name of [names.fresh,names.forward]) { const schema = localEquivalenceSchema('prisma/schema.prisma'); try { run([cli,'migrate','diff','--from-config-datasource','--to-schema',schema.file,'--exit-code'],name); } finally { schema.cleanup(); } }
 const fingerprintBefore = createHash('sha256').update(JSON.stringify(a)).digest('hex');
 const checkOutput = run(['scripts/bootstrap/fresh-bootstrap.mjs','--check'],names.fresh); assert.match(checkOutput,/"category":"B"/);
 const noOp = run([cli,'migrate','deploy'],names.fresh); assert.match(noOp,/No pending migrations to apply/i);
 assert.deepEqual(JSON.parse(run(['scripts/bootstrap/schema-fingerprint.mjs'],names.fresh)),a);
 evidence.fresh = { bootstrap:'PASS',ledger:freshLedger,status:'UP_TO_DATE',newTableCounts:await counts(fresh,newTables),rls:await verifyLocalRls(fresh,target(names.fresh)),roles:await verifyLocalRolesAndAuth(fresh),idempotence:'PASS' };
 assert.ok(Object.values(evidence.fresh.newTableCounts).every(n=>n===0));
 evidence.forward = { upgrade:'PASS',ledger:forwardLedger,baselineUnchanged:true,rls:await verifyLocalRls(forward,target(names.forward)) };
 evidence.equivalence = { relationalSchema:true,enums:true,indexes:true,constraints:true,foreignKeys:true,rls:true,policies:true,grants:true,defaultPrivileges:true,fingerprintSHA256:fingerprintBefore };
 // Apply RLS genuinely with an isolated nine-file inventory, leaving Commerce pending.
 await baseline(rehearsal,names.rehearsal); await scaffoldLocalSupabase(rehearsal,target(names.rehearsal));
 const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'ofertano-rehearsal-'));
 try {
  const migrations = path.join(temporary,'migrations'); fs.mkdirSync(migrations); fs.copyFileSync('prisma/migrations/migration_lock.toml',path.join(migrations,'migration_lock.toml'));
  for (const name of [...Object.keys(manifest.baselineMigrations),...Object.keys(manifest.forwardMigrations).slice(0,2)]) { fs.mkdirSync(path.join(migrations,name)); fs.copyFileSync(`prisma/migrations/${name}/migration.sql`,path.join(migrations,name,'migration.sql')); }
  const config = path.join(temporary,'prisma.config.ts');
  fs.writeFileSync(config,`export default { schema: ${JSON.stringify(path.join(root,'prisma/schema.prisma'))}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DIRECT_URL } };\n`);
  const rlsDeploy = run([cli,'migrate','deploy','--config',config],names.rehearsal);
  for (const name of Object.keys(manifest.forwardMigrations).slice(0,2)) assert.ok(rlsDeploy.includes(`Applying migration \`${name}\``));
 } finally { fs.rmSync(temporary,{recursive:true,force:true}); }
 // Intentional mutation of a LOCAL disposable ledger only, explicitly authorized for this rehearsal.
 for (const [name,row] of Object.entries(compatibility.productionHistory.knownChecksumDivergences)) await rehearsal.query('UPDATE "_prisma_migrations" SET checksum=$1 WHERE migration_name=$2',[row.productionChecksum,name]);
 const before = await ledger(rehearsal); assert.equal(before.length,9);
 const beforeCounts = await counts(rehearsal,legacyTables);
 const gate = verifyLedgerCompatibility({version:1,ledger:before},commercePending); assert.equal(gate.warnings.length,2);
 const deployOutput = run([cli,'migrate','deploy'],names.rehearsal);
 const appliedNames = [...deployOutput.matchAll(/Applying migration `([^`]+)`/g)].map(m=>m[1]); assert.deepEqual(appliedNames,commercePending);
 const after = await ledger(rehearsal); assert.equal(after.length,11); assert.deepEqual(after.filter(r=>!commercePending.includes(r.migration_name)),before);
 for (const name of commercePending) { const row=after.find(r=>r.migration_name===name); assert.ok(row.finished_at);assert.equal(row.applied_steps_count,1);assert.equal(row.checksum,manifest.forwardMigrations[name]); }
 assert.deepEqual(await counts(rehearsal,legacyTables),beforeCounts);
 const newCounts=await counts(rehearsal,newTables); assert.ok(Object.values(newCounts).every(n=>n===0));
 verifyLedgerCompatibility({version:1,ledger:after},[]);
 const warningObserved=/modified|changed since|checksum[^\n]*(?:mismatch|differ)/i.test(deployOutput);
 evidence.rehearsal={verdict:warningObserved?'PASS':'HARD_BLOCKER',blocker:warningObserved?null:'PRISMA_MODIFIED_MIGRATION_WARNING_NOT_OBSERVED',exitCode:0,appliedNames,baselineNotReapplied:true,rlsNotReapplied:true,ledgerBefore:before,ledgerAfter:after,legacyCountsBefore:beforeCounts,legacyCountsAfter:await counts(rehearsal,legacyTables),newTableCounts:newCounts,prismaWarningObserved:warningObserved,prismaOutput:deployOutput,gate:gate.verdict};
 fs.mkdirSync('docs/evidence/50ag4b-r2g',{recursive:true}); fs.writeFileSync('docs/evidence/50ag4b-r2g/local-validation.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({fresh:'PASS',forward:'PASS',equivalence:'PASS',idempotence:'PASS',rehearsal:warningObserved?'PASS':'HARD_BLOCKER',prismaWarningObserved:warningObserved}));
 verifyPrismaDeployRehearsal({exitCode:0,output:deployOutput});
} finally { await Promise.all([fresh.end(),forward.end(),rehearsal.end()]); }
