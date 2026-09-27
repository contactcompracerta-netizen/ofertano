import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGuard, EXPECTED_PROJECT_REF as REF } from './supabase-project-guard.mjs';

const ok = (u) => assert.equal(evaluateGuard(u).projectGuard, true);
const no = (u) => assert.equal(evaluateGuard(u).projectGuard, false);

test('DIRECT host exato passa', () => {
  const r = evaluateGuard(`postgresql://postgres:synthetic@db.${REF}.supabase.co:5432/postgres`);
  assert.equal(r.projectGuard, true); assert.equal(r.connectionMode, 'DIRECT'); assert.equal(r.parsed, true);
});
test('POOLER username exato passa', () => {
  const r = evaluateGuard(`postgresql://postgres.${REF}:synthetic@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`);
  assert.equal(r.projectGuard, true); assert.equal(r.connectionMode, 'POOLER');
});
test('trim e aspas externas normalizados', () => {
  ok(`  "postgresql://postgres.${REF}:synthetic@aws-0-x.pooler.supabase.com:6543/postgres"  `);
  ok(`'postgresql://postgres:${'synthetic'}@db.${REF}.supabase.co:5432/postgres'`);
});
test('ref errado em DIRECT falha', () => no('postgresql://postgres:x@db.aaaaaaaaaaaa.supabase.co:5432/postgres'));
test('ref errado em POOLER falha', () => no('postgresql://postgres.aaaaaaaaaaaa:x@aws-0-x.pooler.supabase.com:6543/postgres'));
test('username somente postgres falha mesmo em pooler', () => no('postgresql://postgres:x@aws-0-x.pooler.supabase.com:6543/postgres'));
test('ref como substring maliciosa no hostname falha', () => no(`postgresql://postgres:x@db.${REF}.supabase.co.evil.com:5432/postgres`));
test('ref como substring maliciosa no username falha', () => no(`postgresql://xx${REF}:x@aws-0-x.pooler.supabase.com:6543/postgres`));
test('localhost e loopback falham', () => { no('postgresql://postgres:x@localhost:5432/postgres'); no('postgresql://postgres:x@127.0.0.1:5432/postgres'); });
test('vazio, nao-string e sensiveis falham', () => { no(''); no(undefined); no('[SENSITIVE]'); no('postgresql://postgres:SECRET_TOKEN@db.ujskptfrbbaslvqrqzxa.supabase.co/postgres'); });
test('protocolo nao-postgres falha', () => { no('http://db.ujskptfrbbaslvqrqzxa.supabase.co/x'); no('https://x@y/z'); });
test('URL malformada falha', () => { no('postgresql://'); no('://nope'); no('nao e url'); });
test('guard nunca expoe host/user/url', () => {
  const r = evaluateGuard(`postgresql://postgres.${REF}:synthetic@aws-0-x.pooler.supabase.com:6543/postgres`);
  const keys = Object.keys(r);
  assert.deepEqual(keys.sort(), ['connectionMode', 'parsed', 'projectGuard']);
  assert.equal(JSON.stringify(r).includes('supabase'), false);
  assert.equal(JSON.stringify(r).includes(REF), false);
  assert.equal(JSON.stringify(r).includes('synthetic'), false);
});
