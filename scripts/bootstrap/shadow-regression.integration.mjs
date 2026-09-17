import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Client} from 'pg';
const manifest=JSON.parse(fs.readFileSync('scripts/bootstrap/manifest.json','utf8'));
const url=name=>`postgresql://postgres:postgres@127.0.0.1:55433/${name}`;
function run(args,name) {const out=spawnSync(process.execPath,args,{env:{...process.env,DIRECT_URL:url(name),DATABASE_URL:url(name)},encoding:'utf8',timeout:180000});assert.equal(out.status,0,out.stderr?.slice(-500));return out.stdout;}
const forward='ofertano_50ag2_forward';const fresh='ofertano_50ag2_shadow';
const client=new Client({connectionString:url(forward)});await client.connect();
assert.equal(client.connection.stream.remoteAddress,'127.0.0.1');assert.equal(client.connection.stream.remotePort,55433);
try {
  assert.equal((await client.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0,'Never reset existing fixture');
  await client.query(fs.readFileSync('scripts/bootstrap/initial-schema.sql','utf8'));
  for(const name of Object.keys(manifest.baselineMigrations))run(['node_modules/prisma/build/index.js','migrate','resolve','--applied',name],forward);
  const before=(await client.query('SELECT migration_name,checksum,finished_at,started_at,applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  const output=run(['node_modules/prisma/build/index.js','migrate','deploy'],forward);assert.match(output,/Applying migration `20260917120000_commerce_intelligence_foundation`/);
  const after=(await client.query('SELECT migration_name,checksum,finished_at,started_at,applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  assert.deepEqual(after.filter(r=>manifest.baselineMigrations[r.migration_name]),before);
  const local=new Client({connectionString:url(fresh)});await local.connect();
  let ledger;try {ledger=(await local.query('SELECT migration_name,finished_at,applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name')).rows;}finally{await local.end();}
  assert.equal(ledger.length,8);for(const row of ledger){assert.ok(row.finished_at);assert.equal(row.applied_steps_count,manifest.baselineMigrations[row.migration_name]?0:1);}
  const a=JSON.parse(run(['scripts/bootstrap/schema-fingerprint.mjs'],fresh));const b=JSON.parse(run(['scripts/bootstrap/schema-fingerprint.mjs'],forward));assert.deepEqual(a,b);
  for(const name of [fresh,forward]){run(['node_modules/prisma/build/index.js','migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--exit-code'],name);assert.match(run(['scripts/bootstrap/fresh-bootstrap.mjs','--check'],name),/"category":"B"/);}
  fs.mkdirSync('docs/evidence/50ag2',{recursive:true});fs.writeFileSync('docs/evidence/50ag2/bootstrap.json',JSON.stringify({freshLedger:ledger,forwardLedger:after,baselineLedgerUnchanged:true,schemaEquivalent:true,schemaSHA256:manifest.currentSchemaSHA256,forwardMigrationNames:Object.keys(manifest.forwardMigrations)},null,2)+'\n');
  console.log('BOOTSTRAP_FRESH_FORWARD_LEDGER_SCHEMA=PASS');
} finally {await client.end();}
