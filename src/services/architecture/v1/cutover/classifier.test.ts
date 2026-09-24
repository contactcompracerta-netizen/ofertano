/**
 * CATALOG_ARCHITECTURE_V1 — CUTOVER FAILURE CLASSIFIER TESTS (FASE G).
 *
 * Fallback SÓ para DB_TRANSIENT / INTERNAL_PROCESSING_FAILURE /
 * UNEXPECTED_V1_FAILURE. NUNCA para IDENTITY_REJECT / IDENTITY_REVIEW /
 * POLICY_NOT_READY / MULTISTORE_NOT_READY / INVALID_DATA.
 */
import assert from "node:assert/strict";
import {
  FALLBACK_ELIGIBLE_CODES,
  NEVER_FALLBACK_CODES,
  allowsLegacyFallbackForCode,
  classifyV1Failure,
  describeV1Failure,
} from "./classifier";

async function main(): Promise<void> {
  // --- Códigos fallback-eligible ---------------------------------------------------
  assert.deepEqual(
    [...FALLBACK_ELIGIBLE_CODES].sort(),
    ["DB_TRANSIENT", "INTERNAL_PROCESSING_FAILURE", "UNEXPECTED_V1_FAILURE"],
  );
  assert.deepEqual(
    [...NEVER_FALLBACK_CODES].sort(),
    [
      "IDENTITY_REJECT",
      "IDENTITY_REVIEW",
      "INVALID_DATA",
      "MULTISTORE_NOT_READY",
      "POLICY_NOT_READY",
    ],
  );
  for (const code of FALLBACK_ELIGIBLE_CODES) {
    assert.equal(allowsLegacyFallbackForCode(code), true, code);
  }
  for (const code of NEVER_FALLBACK_CODES) {
    assert.equal(allowsLegacyFallbackForCode(code), false, code);
  }

  // --- DB_TRANSIENT ----------------------------------------------------------------
  assert.equal(classifyV1Failure(new Error("P1001 connection lost")), "DB_TRANSIENT");
  assert.equal(classifyV1Failure(new Error("ECONNRESET")), "DB_TRANSIENT");
  assert.equal(classifyV1Failure(new Error("connect econnrefused:5432")), "DB_TRANSIENT");
  assert.equal(classifyV1Failure(new Error("database is not accepting connections")), "DB_TRANSIENT");

  // --- INVALID_DATA ----------------------------------------------------------------
  assert.equal(classifyV1Failure(new Error("externalId ausente")), "INVALID_DATA");
  assert.equal(classifyV1Failure(new Error("preço inválido para a oferta")), "INVALID_DATA");
  assert.equal(classifyV1Failure(new Error("INVALID_DATA:sourceUrl ausente")), "INVALID_DATA");

  // --- IDENTITY_REJECT / IDENTITY_REVIEW --------------------------------------------
  assert.equal(classifyV1Failure(new Error("IDENTITY_REJECT matchStatus")), "IDENTITY_REJECT");
  assert.equal(classifyV1Failure(new Error("produto em revisão manual")), "IDENTITY_REVIEW");

  // --- MULTISTORE_NOT_READY ---------------------------------------------------------
  assert.equal(
    classifyV1Failure(new Error("MULTISTORE_NOT_READY:1 marketplace")),
    "MULTISTORE_NOT_READY",
  );
  assert.equal(
    classifyV1Failure(new Error("PUBLIC_MULTISTORE_MIN_MARKETPLACES=2")),
    "MULTISTORE_NOT_READY",
  );

  // --- POLICY_NOT_READY (token do outcomeClassifier real) ----------------------------
  assert.equal(
    classifyV1Failure(new Error("POLICY_NOT_READY:publication policy")),
    "POLICY_NOT_READY",
  );

  // --- Envelope não-retryável => POLICY_NOT_READY (sem fallback) --------------------
  {
    const msg = "NON_RETRYABLE|POLICY_NOT_READY:policy not ready";
    assert.equal(classifyV1Failure(new Error(msg)), "POLICY_NOT_READY");
  }

  // --- Qualquer outra falha => UNEXPECTED_V1_FAILURE (fallback-eligible) -------------
  {
    const code = classifyV1Failure(new Error("algo inesperado sem token"));
    assert.equal(code, "UNEXPECTED_V1_FAILURE");
    assert.equal(allowsLegacyFallbackForCode(code), true);
  }

  // --- Interação: política tem precedência sobre tokens de transiente -----------------
  {
    const code = classifyV1Failure(
      new Error("NON_RETRYABLE|MULTISTORE_NOT_READY:P1008 timeout"),
    );
    assert.equal(code, "POLICY_NOT_READY", "envelope não-retryável fecha sobre transiente");
  }

  // --- describeV1Failure -------------------------------------------------------------
  assert.ok(describeV1Failure("DB_TRANSIENT").includes("permitido"));
  assert.ok(describeV1Failure("IDENTITY_REJECT").includes("NÃO permitido"));

  console.log("cutover/classifier.test.ts PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});