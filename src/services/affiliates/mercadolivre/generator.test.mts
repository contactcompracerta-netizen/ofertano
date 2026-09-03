import assert from "node:assert/strict";

import { extractItemId } from "./generator";

function run() {
  assert.equal(
    extractItemId("https://produto.mercadolivre.com.br/MLB-1234567890-x"),
    "MLB-1234567890",
  );
  assert.equal(
    extractItemId("https://produto.mercadolivre.com.br/MLB1234567890-x"),
    "MLB1234567890",
  );
  assert.equal(extractItemId("https://example.com/sem-id"), null);
  assert.equal(
    extractItemId("https://produto.mercadolivre.com.br/MLB_12345"),
    "MLB-12345",
  );
  console.log("ML_AFFILIATE_GENERATOR_TEST_OK");
}

run();
