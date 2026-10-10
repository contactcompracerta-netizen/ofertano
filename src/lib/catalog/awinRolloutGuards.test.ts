import assert from "node:assert/strict";
import test from "node:test";
import {
  isAwinCronAuthorized,
  isAwinPhaseEnabled,
} from "./awinRolloutGuards";

test("AWIN cron auth fails closed, including preview requests", () => {
  assert.equal(isAwinCronAuthorized(null, "secret"), false);
  assert.equal(isAwinCronAuthorized("Bearer wrong", "secret"), false);
  assert.equal(isAwinCronAuthorized("Bearer secret", undefined), false);
  assert.equal(isAwinCronAuthorized("Bearer secret", "secret"), true);
});

test("AWIN SHADOW requires no write flags but CANARY and LIVE do", () => {
  assert.equal(isAwinPhaseEnabled("SHADOW", {}), true);
  assert.equal(isAwinPhaseEnabled("CANARY", {}), false);
  assert.equal(isAwinPhaseEnabled("LIVE", {}), false);
  assert.equal(isAwinPhaseEnabled("CANARY", { AWIN_WAVE1_WRITE_ENABLED: "true" }), true);
  assert.equal(isAwinPhaseEnabled("LIVE", { AWIN_WAVE1_WRITE_ENABLED: "true" }), false);
  assert.equal(isAwinPhaseEnabled("LIVE", {
    AWIN_WAVE1_WRITE_ENABLED: "true",
    AWIN_WAVE1_LIVE_ENABLED: "true",
  }), true);
});
