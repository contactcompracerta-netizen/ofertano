import assert from 'node:assert/strict';
import { canTransition, claimableStatus, isTerminal, CANARY_TRANSITIONS } from './state';
import { hashToken, validCanaryToken, tokenHashPrefix, externalIdSafe } from './token';
import { parseDistributedCanaryConfig, distributedTokenState, localControlPlaneTarget, productionControlModeRequirement } from './config';
import { createHash } from 'node:crypto';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

async function main() {
  // ---------- PART C — state machine ----------
  // Valid transitions
  assert.equal(canTransition('ARMED', 'CLAIMED'), true);
  assert.equal(canTransition('CLAIMED', 'CONSUMED'), true);
  assert.equal(canTransition('CLAIMED', 'FAILED'), true);
  assert.equal(canTransition('ARMED', 'DISABLED'), true);
  assert.equal(canTransition('ARMED', 'EXPIRED'), true);
  // Forbidden transitions (fail closed, no auto rearm)
  for (const from of ['FAILED', 'CONSUMED', 'CLAIMED', 'EXPIRED', 'DISABLED'] as const) {
    for (const to of ['ARMED', 'CLAIMED'] as const) {
      assert.equal(canTransition(from, to), false, `${from}->${to} must be forbidden`);
    }
  }
  assert.equal(canTransition('CONSUMED', 'FAILED'), false);
  assert.equal(canTransition('FAILED', 'CONSUMED'), false);
  assert.deepEqual(CANARY_TRANSITIONS.ARMED, ['CLAIMED', 'DISABLED', 'EXPIRED']);
  assert.deepEqual(CANARY_TRANSITIONS.CLAIMED, ['CONSUMED', 'FAILED']);
  for (const s of ['CONSUMED', 'FAILED', 'EXPIRED', 'DISABLED'] as const) assert.equal(isTerminal(s), true);
  assert.equal(claimableStatus('ARMED'), true);
  for (const s of ['CLAIMED', 'CONSUMED', 'FAILED', 'EXPIRED', 'DISABLED'] as const) assert.equal(claimableStatus(s), false);

  // ---------- PART D1 / AK — token hashing and validation ----------
  const token = 'canary-secret-token-7f3a';
  const digest = hashToken(token);
  assert.equal(digest, sha(token));
  assert.equal(digest.length, 64);
  assert.notEqual(digest, token);
  // Hash is deterministic
  assert.equal(hashToken(token), digest);
  // different token -> different hash
  assert.notEqual(hashToken(token), hashToken(token + 'x'));
  // Never plaintext: hash must not contain the token
  assert.ok(!digest.includes(token));
  // tokenHashPrefix is a short non-reversible fingerprint
  assert.equal(tokenHashPrefix(token).length, 8);

  // Validation (Part AK): empty / whitespace / malformed / very long / unicode
  assert.equal(validCanaryToken(undefined), false);
  assert.equal(validCanaryToken(''), false);
  assert.equal(validCanaryToken('   '), false);
  assert.equal(validCanaryToken('\t\n'), false);
  assert.equal(validCanaryToken('short'), false);          // < 8 chars
  assert.equal(validCanaryToken('has space inside'), false); // whitespace inside
  assert.equal(validCanaryToken('x'.repeat(513)), false);  // > 512 chars
  assert.equal(validCanaryToken('a'.repeat(8)), true);
  assert.equal(validCanaryToken('a'.repeat(512)), true);
  assert.equal(validCanaryToken('🔐canary-unicode-🙈'), true);
  assert.equal(hashToken('🔐canary-unicode-🙈').length, 64);

  // ---------- PART E / AL — config parsing (fail-closed by default) ----------
  const empty = parseDistributedCanaryConfig({});
  assert.equal(empty.enabled, false);
  assert.equal(empty.shadowEnabled, false);
  assert.equal(empty.token, undefined);
  assert.equal(empty.tokenHash, undefined);
  assert.equal(empty.marketplace, undefined);
  assert.equal(empty.externalId, undefined);
  assert.equal(empty.dryRun, true); // dry run remains the safe default
  for (const bad of ['', 'yes', '1', 'TRUE-ish']) {
    assert.equal(parseDistributedCanaryConfig({ COMMERCE_DISTRIBUTED_CANARY_ENABLED: bad }).enabled, false, bad);
  }
  assert.equal(parseDistributedCanaryConfig({ COMMERCE_DISTRIBUTED_CANARY_ENABLED: 'True' }).enabled, true);
  assert.equal(parseDistributedCanaryConfig({ COMMERCE_DISTRIBUTED_CANARY_ENABLED: ' true ' }).enabled, true);
  // Distributed gate requires valid token only for execution; config records validity
  const withToken = parseDistributedCanaryConfig({ COMMERCE_SHADOW_CANARY_TOKEN: token });
  assert.equal(withToken.token, token);
  assert.equal(withToken.tokenHash, hashToken(token));
  // Invalid tokens never reach config token
  assert.equal(parseDistributedCanaryConfig({ COMMERCE_SHADOW_CANARY_TOKEN: '  ' }).token, undefined);
  // exact marketplace/externalId
  const cfg = parseDistributedCanaryConfig({ COMMERCE_SHADOW_MARKETPLACE: 'AMAZON', COMMERCE_SHADOW_EXTERNAL_ID: 'SHADOW-ASIN1' });
  assert.equal(cfg.marketplace, 'AMAZON');
  assert.equal(cfg.externalId, 'SHADOW-ASIN1');
  assert.equal(parseDistributedCanaryConfig({ COMMERCE_SHADOW_MARKETPLACE: 'garbage' }).marketplace, undefined);
  // token presence/validity
  assert.deepEqual(distributedTokenState({}), { reason: 'TOKEN_MISSING' });
  assert.deepEqual(distributedTokenState({ COMMERCE_SHADOW_CANARY_TOKEN: ' ' }), { reason: 'TOKEN_INVALID' });
  const ts = distributedTokenState({ COMMERCE_SHADOW_CANARY_TOKEN: token });
  assert.equal(ts.reason, 'OK');
  assert.equal(ts.hash, hashToken(token));

  // ---------- local control-plane target (mirrors 50AG.2 hard tripwire) ----------
  assert.equal(localControlPlaneTarget('postgresql://127.0.0.1:55432/ofertano_50ag3_control_plane', undefined), 'LOCAL_TARGET_REQUIRED');
  assert.equal(localControlPlaneTarget('postgresql://127.0.0.1:55433/ofertano_50ag3_control_plane', 'production'), 'PRODUCTION_FORBIDDEN');
  assert.equal(localControlPlaneTarget('postgresql://127.0.0.1:55433/ofertano_50ag3_control_plane?host=evil', undefined), 'LOCAL_TARGET_REQUIRED');
  assert.equal(localControlPlaneTarget('postgresql://127.0.0.1:55433/ofertano_50ag3_control_plane', undefined), null);
  assert.equal(localControlPlaneTarget('postgresql://127.0.0.1:55433/ofertano_50ag2_shadow', undefined), null);
  assert.equal(localControlPlaneTarget('postgresql://127.0.0.1:55433/other_db', undefined), 'LOCAL_TARGET_REQUIRED');
  assert.equal(localControlPlaneTarget(undefined, undefined), 'LOCAL_TARGET_REQUIRED');

  // ---------- PART R1 — production only DISTRIBUTED_GRANT ----------
  const prodOff = productionControlModeRequirement({}, 'production');
  assert.equal(prodOff.ok, false);
  assert.equal(prodOff.reason, 'PRODUCTION_REQUIRES_DISTRIBUTED_GRANT');
  const prodPartial = productionControlModeRequirement(
    { COMMERCE_DISTRIBUTED_CANARY_ENABLED: 'true', COMMERCE_SHADOW_ENABLED: 'true', COMMERCE_SHADOW_CANARY_TOKEN: 'short' }, 'production');
  assert.equal(prodPartial.ok, false);
  assert.equal(prodPartial.reason, 'PRODUCTION_TOKEN_INVALID');
  const prodOk = productionControlModeRequirement(
    { COMMERCE_DISTRIBUTED_CANARY_ENABLED: 'true', COMMERCE_SHADOW_ENABLED: 'true', COMMERCE_SHADOW_CANARY_TOKEN: 'a-secure-production-token-1' }, 'production');
  assert.equal(prodOk.ok, true);
  assert.equal(productionControlModeRequirement({}, undefined).ok, true);

  // ---------- PART Q — event redaction ----------
  // Events must never contain token or full hash. Simulate a serialized event.
  const serialized = JSON.stringify({
    event: 'COMMERCE_CANARY_GRANT_CLAIMED',
    marketplace: 'AMAZON',
    externalIdSafe: externalIdSafe('SHADOW-ASIN1'),
    reason: 'CLAIMED',
    executionId: 'exec-1',
  });
  assert.ok(!serialized.includes(token));
  assert.ok(!serialized.includes(hashToken(token)));
  assert.ok(!serialized.includes('SHADOW-ASIN1'));
  assert.equal(externalIdSafe('SHADOW-ASIN1').length, 12);

  console.log('CONTROL_PLANE_STATE_TOKEN_CONFIG_REDACTION=PASS');
}
main().catch((e) => { console.error(e); process.exitCode = 1; });