/** Destructive setup ONLY for mission-owned disposable databases on 127.0.0.1:55433. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Client} from 'pg';
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync('scripts/bootstrap/manifest.json','utf8'));
const names=['ofertano_50ag1_foundation','ofertano_50ag1_forward'];
function url(name) {return `postgresql://postgres:postgres@127.0.0.1:55433/${name}`;}
function run(args,name,expected=0) {
  const p=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,DIRECT_URL:url(name),DATABASE_URL:url(name)},encoding:'utf8',timeout:180000});
  if(p.status!==expected) throw new Error(JSON.stringify({args,status:p.status,stderr:p.stderr?.slice(-1000),stdout:p.stdout?.slice(-1000)}));
  return p.stdout;
}
const cli='node_modules/prisma/build/index.js';
async function client(name) {const c=new Client({connectionString:url(name)});await c.connect();assert.equal(c.connection.stream.remoteAddress,'127.0.0.1');assert.equal(c.connection.stream.remotePort,55433);return c;}
const forward=await client(names[1]);
try {
  const objects=await forward.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'");
  assert.equal(objects.rows[0].n,0,'Forward fixture must start empty; never reset existing data');
  await forward.query(fs.readFileSync('scripts/bootstrap/initial-schema.sql','utf8'));
  for(const n of Object.keys(manifest.baselineMigrations)) run([cli,'migrate','resolve','--applied',n],names[1]);
  const before=(await forward.query('SELECT migration_name,checksum,started_at,finished_at,applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  assert.equal(before.length,7);
  const output=run([cli,'migrate','deploy'],names[1]);
  assert.match(output,/Applying migration `20260917120000_commerce_intelligence_foundation`/);
  const after=(await forward.query('SELECT migration_name,checksum,started_at,finished_at,applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  assert.deepEqual(after.filter(r=>manifest.baselineMigrations[r.migration_name]),before);
  assert.equal(after.length,8);
  const newMigration=after.find(r=>manifest.forwardMigrations[r.migration_name]);
  assert.ok(newMigration.finished_at);assert.ok(newMigration.applied_steps_count>0);
  const fresh=await client(names[0]);
  try {
    const ledger=(await fresh.query('SELECT migration_name,finished_at,applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name')).rows;
    assert.equal(ledger.length,8);
    for(const row of ledger) {assert.ok(row.finished_at);assert.equal(row.applied_steps_count,manifest.baselineMigrations[row.migration_name]?0:1);}
    const a=JSON.parse(run(['scripts/bootstrap/schema-fingerprint.mjs'],names[0]));
    const b=JSON.parse(run(['scripts/bootstrap/schema-fingerprint.mjs'],names[1]));
    assert.deepEqual(a,b);
    fs.mkdirSync('docs/evidence/50ag1',{recursive:true});
    fs.writeFileSync('docs/evidence/50ag1/local-db.json',JSON.stringify({freshLedger:ledger,forwardLedger:after,baselineUnchanged:true,schemaEquivalent:true,schema:a},null,2)+'\n');
  } finally {await fresh.end();}
  for(const name of names) {run([cli,'migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--exit-code'],name);const classified=run(['scripts/bootstrap/fresh-bootstrap.mjs','--check'],name);assert.match(classified,/"category":"B"/);}
  // Classification guards: recognized schema without ledger is UNKNOWN; unfinished ledger is PARTIAL.
  const unknown=await client('ofertano_50ag1_unknown');try {await unknown.query('CREATE TABLE laboratory (id int)');} finally {await unknown.end();}
  assert.match(run(['scripts/bootstrap/fresh-bootstrap.mjs','--check'],'ofertano_50ag1_unknown',1),/"category":"D"/);
  const partial=await client('ofertano_50ag1_partial');try {await partial.query('CREATE TABLE "_prisma_migrations" (migration_name text,checksum text,finished_at timestamptz,rolled_back_at timestamptz,started_at timestamptz)');await partial.query('INSERT INTO "_prisma_migrations" (migration_name,checksum,started_at) VALUES ($1,$2,now())',[Object.keys(manifest.baselineMigrations)[0],Object.values(manifest.baselineMigrations)[0]]);} finally {await partial.end();}
  assert.match(run(['scripts/bootstrap/fresh-bootstrap.mjs','--check'],'ofertano_50ag1_partial',1),/"category":"C"/);
  const tripwire=spawnSync(process.execPath,['scripts/bootstrap/fresh-bootstrap.mjs','--check'],{env:{...process.env,DIRECT_URL:'postgresql://127.0.0.1:55432/ofertano_50ag1_foundation'},encoding:'utf8'});
  assert.equal(tripwire.status,1);assert.match(tripwire.stdout,/LOCAL_TRIPWIRE_VIOLATED/);
  console.log('FRESH_LEDGER=7_RESOLVED_PLUS_1_DEPLOYED\nFORWARD=ONLY_50AG\nSCHEMA_EQUIVALENCE=PASS\nCLASSIFICATION_A_B_C_D=PASS\nTRIPWIRE=PASS');
} finally {await forward.end();}
