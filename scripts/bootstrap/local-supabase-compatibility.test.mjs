import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validateLocalTarget, scaffoldLocalSupabase } from './local-supabase-compatibility.mjs';
const allowed = 'postgresql://127.0.0.1:55433/ofertano_50ag4b_history_fresh';
test('only exact loopback 55433 and disposable names are accepted', () => {
 assert.equal(validateLocalTarget(allowed, {}).database, 'ofertano_50ag4b_history_fresh');
 for (const url of ['postgresql://remote.example:55433/ofertano_50ag4b_history_fresh','postgresql://localhost:55433/ofertano_50ag4b_history_fresh','postgresql://127.0.0.1:55432/ofertano_50ag4b_history_fresh','postgresql://127.0.0.1:55433/postgres', allowed+'?host=remote.example', allowed+'#override']) assert.throws(() => validateLocalTarget(url, {}));
 assert.throws(() => validateLocalTarget(allowed, { VERCEL_ENV: 'production' }), /PRODUCTION_ENV_REFUSED/);
});
test('scaffold rejects remote, wrong port and wrong socket before any query/DDL', async () => {
 let queries = 0;
 const client = { connection: { stream: { remoteAddress: '127.0.0.1', remotePort: 55433 } }, query: () => { queries++; throw Error('UNEXPECTED_SQL'); } };
 await assert.rejects(scaffoldLocalSupabase(client, allowed.replace('127.0.0.1','remote.example')), /LOCAL_TRIPWIRE/);
 await assert.rejects(scaffoldLocalSupabase(client, allowed.replace('55433','55432')), /LOCAL_TRIPWIRE/);
 client.connection.stream.remoteAddress = '192.0.2.1';
 await assert.rejects(scaffoldLocalSupabase(client, allowed), /LOCAL_SOCKET_DIVERGED/);
 assert.equal(queries, 0);
});
test('bootstrap synthetic remote and 55432 return nonzero before connecting', () => {
 for (const url of ['postgresql://remote.example:55433/ofertano_50ag4b_history_fresh',allowed.replace('55433','55432')]) {
  const child = spawnSync(process.execPath, ['scripts/bootstrap/fresh-bootstrap.mjs','--check'], { env: { ...process.env, DIRECT_URL: url, DATABASE_URL: '', VERCEL_ENV: '', VERCEL_TARGET_ENV: '', DOTENV_CONFIG_PATH: '/dev/null' }, encoding: 'utf8' });
  assert.equal(child.status, 1); assert.match(child.stdout, /LOCAL_TRIPWIRE_VIOLATED/); assert.doesNotMatch(child.stderr, /ENOTFOUND|ECONNREFUSED/);
 }
});
