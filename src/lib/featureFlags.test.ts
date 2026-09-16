import assert from "node:assert/strict";
import test from "node:test";

import {
  isCatalogPopulateEnabled,
  isExplicitlyEnabled,
  isImportQueueProcessEnabled,
  isPublicSearchPersistenceEnabled,
} from "./featureFlags";

test("feature flags are disabled unless exactly true", () => {
  for (const value of [undefined, "", "false", "1", "yes", "garbage"]) {
    assert.equal(isExplicitlyEnabled(value), false, String(value));
    assert.equal(isCatalogPopulateEnabled(value), false, String(value));
    assert.equal(isImportQueueProcessEnabled(value), false, String(value));
    assert.equal(isPublicSearchPersistenceEnabled(value), false, String(value));
  }

  assert.equal(isExplicitlyEnabled("true"), true);
  assert.equal(isCatalogPopulateEnabled("true"), true);
  assert.equal(isImportQueueProcessEnabled("true"), true);
  assert.equal(isPublicSearchPersistenceEnabled("true"), true);
});
