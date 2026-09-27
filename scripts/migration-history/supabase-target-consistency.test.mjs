import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSupabaseTarget, assertSameTarget, safeOutput, EXPECTED_PROJECT_REF as REF } from './supabase-project-guard.mjs';

const pooler = `postgresql://postgres.${REF}:synthetic@aws-0-x.pooler.supabase.com:6543/postgres`;
const validated = validateSupabaseTarget(pooler);

test('validado: POOLER e hostname em memoria', () => {
  assert.equal(validated.projectGuard, true);
  assert.equal(validated.connectionMode, 'POOLER');
  assert.ok(validated.hostname.endsWith('.pooler.supabase.com'));
});

test('1: mesmo hostname + EAI_AGAIN => RETRYABLE_EAI_AGAIN', () => {
  assert.equal(assertSameTarget({ hostname: validated.hostname, code: 'EAI_AGAIN' }, validated), 'RETRYABLE_EAI_AGAIN');
});
test('2: hostname divergente => CONNECTION_TARGET_DIVERGENCE', () => {
  assert.equal(assertSameTarget({ hostname: 'other.pooler.supabase.com', code: 'EAI_AGAIN' }, validated), 'CONNECTION_TARGET_DIVERGENCE');
});
test('3: pooler validado + error.hostname="base" => DIVERGENCE sem retry', () => {
  const r = assertSameTarget({ hostname: 'base', code: 'EAI_AGAIN' }, validated);
  assert.equal(r, 'CONNECTION_TARGET_DIVERGENCE');
  assert.notEqual(r, 'RETRYABLE_EAI_AGAIN');
});
test('4: mesmo hostname + erro diferente => NON_RETRYABLE', () => {
  assert.equal(assertSameTarget({ hostname: validated.hostname, code: 'ECONNREFUSED' }, validated), 'NON_RETRYABLE');
});
test('5: erro sem hostname => NO_HOSTNAME_IN_ERROR', () => {
  assert.equal(assertSameTarget({ code: 'EAI_AGAIN' }, validated), 'NO_HOSTNAME_IN_ERROR');
  assert.equal(assertSameTarget(null, validated), 'NO_HOSTNAME_IN_ERROR');
});
test('case do hostname e case-insensitive', () => {
  assert.equal(assertSameTarget({ hostname: validated.hostname.toUpperCase(), code: 'EAI_AGAIN' }, validated), 'RETRYABLE_EAI_AGAIN');
});
test('safeOutput nunca serializa connectionString nem hostname', () => {
  const o = safeOutput(validated);
  assert.deepEqual(Object.keys(o).sort(), ['connectionMode', 'parsed', 'projectGuard']);
  const j = JSON.stringify(o);
  assert.equal(j.includes('supabase'), false);
  assert.equal(j.includes(REF), false);
  assert.equal(j.includes('synthetic'), false);
  assert.equal(j.includes('postgres'), false);
});
test('validated.connectionString e o MESMO valor normalizado (single-read invariant)', () => {
  const withSpaces = `  "${pooler}"  `;
  const a = validateSupabaseTarget(pooler);
  const b = validateSupabaseTarget(withSpaces);
  assert.equal(a.connectionString, b.connectionString);
  assert.equal(a.hostname, b.hostname);
});
