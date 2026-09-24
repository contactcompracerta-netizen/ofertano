/**
 * CATALOG_ARCHITECTURE_V1 — CUTOVER IDEMPOTENCY KEY TESTS (FASE E).
 *
 * Mesmo payload => mesma chave; payload diferente => chave diferente;
 * retry com a mesma chave nunca 'duplica' (chave é determinística).
 */
import assert from "node:assert/strict";
import {
  idempotencyKeyAfterWrite,
  idempotencyKeyFor,
  idempotencyKeysEqual,
} from "./idempotency";

async function main(): Promise<void> {
  const base = {
    marketplaceId: "mercado_livre",
    externalListingId: "ML-ABC-1",
    payloadVersion: "normalized-listing/v1",
    catalogHash: "catalog-hash-1",
    offerHash: "offer-hash-1",
    rawHash: "raw-hash-1",
  };

  // --- Determinismo ----------------------------------------------------------------
  const a = idempotencyKeyFor(base);
  const b = idempotencyKeyFor({ ...base });
  assert.equal(a, b, "mesmo input => mesma chave");
  assert.equal(idempotencyKeysEqual(a, b), true);

  // --- Sensibilidade a cada componente -----------------------------------------------
  for (const key of [
    "marketplaceId",
    "externalListingId",
    "payloadVersion",
    "catalogHash",
    "offerHash",
    "rawHash",
  ] as const) {
    const other = { ...base, [key]: `${base[key]}-ALTERADO` };
    assert.notEqual(
      idempotencyKeyFor(other),
      a,
      `mudança em ${key} deve alterar a chave`,
    );
  }

  // --- Diferença de mercado altera a chave (mesmo externalId em outros mercados) -----
  {
    const amazon = idempotencyKeyFor({
      ...base,
      marketplaceId: "amazon",
    });
    assert.notEqual(amazon, a, "mesmo externalId em outro marketplace => chave diferente");
  }

  // --- Chave pós-write (applied) -----------------------------------------------------
  {
    const applied = idempotencyKeyAfterWrite(
      "mercado_livre",
      "ML-ABC-1",
      "catalog-hash-1",
      "offer-hash-1",
    );
    assert.equal(typeof applied, "string");
    assert.ok(applied.length > 0);
    const applied2 = idempotencyKeyAfterWrite(
      "mercado_livre",
      "ML-ABC-1",
      "catalog-hash-1",
      "offer-hash-1",
    );
    assert.equal(applied, applied2, "retry pós-write => mesma chave applied");
  }

  console.log("cutover/idempotency.test.ts PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});