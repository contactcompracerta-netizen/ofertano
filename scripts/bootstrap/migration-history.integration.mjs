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
import fixture from '../migration-history/production-ledger.fixture.json' with {type:'json'};
import security from '../migration-history/expected-security-state.json' with {type:'json'};
import pins from '../migration-history/forensic-pins.json' with {type:'json'};
import {authorizeCommerceMigrateDeploy,commerceTables,requiredOffFlags} from '../migration-history/authorize-commerce-migrate-deploy.mjs';
import {loadRepositoryContract} from '../migration-history/verify-ledger-compatibility.mjs';
import { verifyPrismaDeployRehearsal } from '../migration-history/verify-prisma-deploy-rehearsal.mjs';
const root = process.cwd();
const pinsDeliverySHA='ec755ac167db6d46f939be1005c791142c6127c2';
const manifest = JSON.parse(fs.readFileSync('scripts/bootstrap/manifest.json', 'utf8'));
const runId=process.env.MIGRATION_HISTORY_RUN_ID??'r2g2';
assert.match(runId,/^[a-z0-9_]{1,24}$/);
const names=Object.fromEntries(['fresh','forward','rehearsal'].map(n=>[n,`ofertano_50ag4b_history_${runId}_${n}`]));
process.env.BOOTSTRAP_ALLOWED_DATABASES=Object.values(names).join(',');
const target = name => `postgresql://postgres@127.0.0.1:55433/${name}`;
const cli = 'node_modules/prisma/build/index.js';
const newTables = ['ProductIdentifier','ProductVariant','IdentityEvidence','IdentityConflict','OfferObservation','OfferPriceComponent','TrustSignal','ProductRelation','CommerceCanaryGrant','CommerceCanaryAttempt'];
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
  assert.equal(exists,0,'Requires new mission-owned fixtures; never resets existing data');
  await admin.query(`CREATE DATABASE "${name}"`);
 } finally { await admin.end(); }
}
async function baseline(client, name) {
 assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0, 'Requires an empty disposable fixture; never resets existing data');
 await client.query(fs.readFileSync('scripts/bootstrap/initial-schema.sql', 'utf8'));
 for (const migration of Object.keys(manifest.baselineMigrations)) run([cli,'migrate','resolve','--applied',migration], name);
 return ledger(client);
}
async function ledger(client) { return JSON.parse(JSON.stringify((await client.query('SELECT * FROM "_prisma_migrations" ORDER BY migration_name')).rows)); }
async function counts(client, tables) { const result = {}; for (const table of tables) result[table] = Number((await client.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n); return result; }
async function predeployState(client,identity) {
 const rls=(await client.query("SELECT c.relname AS \"tableName\",c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname",[security.rls.map(r=>r.tableName)])).rows;
 const policies=(await client.query("SELECT tablename,policyname,permissive,roles::text[] AS roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;
 const grants=[],columnPrivilegeExceptions=[];
 for(const t of security.rls.map(r=>r.tableName))for(const role of ['anon','authenticated']) {
  const privileges=[],grantOptions=[];
  for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) {
   const allowed=(await client.query('SELECT has_table_privilege($1,$2,$3) AS allowed,has_table_privilege($1,$2,$4) AS grantable',[role,`public."${t}"`,p,p+' WITH GRANT OPTION'])).rows[0];
   if(allowed.allowed)privileges.push(p);if(allowed.grantable)grantOptions.push(p);
   if(['SELECT','INSERT','UPDATE','REFERENCES'].includes(p)&&!allowed.allowed&&(await client.query('SELECT has_any_column_privilege($1,$2,$3) AS allowed',[role,`public."${t}"`,p])).rows[0].allowed)columnPrivilegeExceptions.push({tableName:t,role,privilege:p});
  }
  grants.push({tableName:t,role,privileges,grantOptions});
 }
 const defaultPrivileges=(await client.query("SELECT pg_get_userbyid(d.defaclrole) AS owner,n.nspname AS schema,pg_get_userbyid(a.grantee) AS role,a.privilege_type FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE (n.nspname='public' OR n.nspname IS NULL) AND pg_get_userbyid(a.grantee) IN ('anon','authenticated') ORDER BY owner,schema,role,privilege_type")).rows;
 const present=(await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])",[commerceTables])).rows.map(r=>r.relname);
 const ledgerCounts=(await client.query('SELECT count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished,count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::int AS rolled_back FROM "_prisma_migrations"')).rows[0];
 return {version:1,targetIdentity:identity,rls,policies,grants,defaultPrivileges,columnPrivilegeExceptions,commerceTables:Object.fromEntries(commerceTables.map(t=>[t,present.includes(t)])),unfinishedCount:ledgerCounts.unfinished,unexpectedRolledBackCount:ledgerCounts.rolled_back,blockers:[],legacyCounts:await counts(client,security.rls.map(r=>r.tableName).filter(n=>n!=='_prisma_migrations'))};
}
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
 await rehearsal.query('BEGIN');
 try {
  for(const row of fixture.ledger) assert.equal((await rehearsal.query('UPDATE "_prisma_migrations" SET checksum=$1,applied_steps_count=$2 WHERE migration_name=$3',[row.checksum,row.applied_steps_count,row.migration_name])).rowCount,1);
  await rehearsal.query('COMMIT');
 }catch(error){await rehearsal.query('ROLLBACK');throw error;}
 const before = await ledger(rehearsal); assert.equal(before.length,9);
 const relevant=rows=>rows.map(r=>({migration_name:r.migration_name,checksum:r.checksum,applied_steps_count:r.applied_steps_count,finished:!!r.finished_at,rolledBack:!!r.rolled_back_at})).sort((a,b)=>a.migration_name.localeCompare(b.migration_name));
 assert.deepEqual(relevant(before),relevant(fixture.ledger));
 const beforeCounts = await counts(rehearsal,security.rls.map(r=>r.tableName).filter(n=>n!=='_prisma_migrations'));
 const gate = verifyLedgerCompatibility({version:1,ledger:before},commercePending); assert.equal(gate.warnings.length,2);
 // Production identity/flags are synthetic gate inputs; actual SQL target is guarded local.
 const expectedProductionIdentity={environment:'production',targetEnvironment:'production',projectId:pins.projectId,deliverySHA:pinsDeliverySHA};
 const schemaState=await predeployState(rehearsal,expectedProductionIdentity);
 const observedFlags={version:1,flags:Object.fromEntries(requiredOffFlags.map(n=>[n,false])),canaryTokenPresent:false};
 const authorization=authorizeCommerceMigrateDeploy({ledgerSnapshot:{version:1,ledger:before},allowedPending:commercePending,repositoryContract:loadRepositoryContract(),observedFlags,schemaState,expectedProductionIdentity});
 assert.equal(authorization.verdict,'AUTHORIZED',JSON.stringify(authorization));
 const securityBefore={rls:schemaState.rls,policies:schemaState.policies,grants:schemaState.grants,defaultPrivileges:schemaState.defaultPrivileges,columnPrivilegeExceptions:schemaState.columnPrivilegeExceptions};
 const deployOutput = run([cli,'migrate','deploy'],names.rehearsal);
 const execution=verifyPrismaDeployRehearsal({exitCode:0,output:deployOutput});
 const appliedNames = [...deployOutput.matchAll(/Applying migration `([^`]+)`/g)].map(m=>m[1]); assert.deepEqual(appliedNames,commercePending);
 const after = await ledger(rehearsal); assert.equal(after.length,11); assert.deepEqual(after.filter(r=>!commercePending.includes(r.migration_name)),before);
 for (const name of commercePending) { const row=after.find(r=>r.migration_name===name); assert.ok(row.finished_at);assert.equal(row.applied_steps_count,1);assert.equal(row.checksum,manifest.forwardMigrations[name]); }
 assert.deepEqual(await counts(rehearsal,Object.keys(beforeCounts)),beforeCounts);
 const newCounts=await counts(rehearsal,newTables); assert.ok(Object.values(newCounts).every(n=>n===0));
 verifyLedgerCompatibility({version:1,ledger:after},[]);
 const warningObserved=/modified|changed since|checksum[^\n]*(?:mismatch|differ)/i.test(deployOutput);
 evidence.rehearsal={verdict:'PASS',blocker:null,exitCode:0,appliedNames,baselineNotReapplied:true,rlsNotReapplied:true,ledgerBefore:before,ledgerAfter:after,legacyCountsBefore:beforeCounts,legacyCountsAfter:await counts(rehearsal,Object.keys(beforeCounts)),newTableCounts:newCounts,prismaWarningObserved:warningObserved,prismaOutput:deployOutput,gate:gate.verdict};
 const afterState=await predeployState(rehearsal,expectedProductionIdentity);assert.deepEqual({rls:afterState.rls,policies:afterState.policies,grants:afterState.grants,defaultPrivileges:afterState.defaultPrivileges,columnPrivilegeExceptions:afterState.columnPrivilegeExceptions},securityBefore);
 await verifyLocalRls(rehearsal,target(names.rehearsal));
 evidence.rehearsal={...evidence.rehearsal,verdict:'PASS',blocker:null,exactLedgerMatched:true,localLedgerMetadataSimulation:true,authorization,execution,syntheticProductionIdentity:true};
 fs.mkdirSync('docs/evidence/50ag4b-r2g2',{recursive:true}); fs.writeFileSync('docs/evidence/50ag4b-r2g2/local-validation.json',JSON.stringify(evidence,null,2)+'\n');
 fs.writeFileSync('docs/evidence/50ag4b-r2g2/summary.json',JSON.stringify({version:1,prismaVersion:'7.9.0',exactLedgerMatched:true,knownDivergences:2,unknownDivergences:0,warningObserved,commerceOnlyApplied:true,baselineReapplied:false,rlsReapplied:false,independentLedgerGate:'PASS',authorizeGate:'PASS',warningRequiredForSafety:false,localLedgerMetadataSimulation:true,productionAccessed:false},null,2)+'\n');
 console.log(JSON.stringify({fresh:'PASS',forward:'PASS',equivalence:'PASS',idempotence:'PASS',rehearsal:'PASS',prismaWarningObserved:warningObserved}));
 verifyPrismaDeployRehearsal({exitCode:0,output:deployOutput});
} finally { await Promise.all([fresh.end(),forward.end(),rehearsal.end()]); }
