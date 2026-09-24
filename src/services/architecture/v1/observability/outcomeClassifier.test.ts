/**
 * CATALOG_ARCHITECTURE_V1 — OUTCOME CLASSIFIER TESTS (FASE N, puro-lógica).
 *
 * POLICY_BLOCKED_METRIC_SEPARATED:
 *  - bloqueio de POLÍTICA (envelope NON_RETRYABLE|POLICY_NOT_READY)
 *    => policy_blocked (não é falha de sistema);
 *  - erro de sistema qualquer => system_failure;
 *  - sem erro => success.
 */
import assert from "node:assert/strict";
import {
  classifyOperationOutcome,
  summarizeOutcomes,
  OPERATIONAL_OUTCOME,
  POLICY_NOT_READY_TOKEN,
} from "./outcomeClassifier";
import { NON_RETRYABLE_ENVELOPE_PREFIX } from "../../../importQueue/retryClassification";

// Política: NON_RETRYABLE|POLICY_NOT_READY|... => POLICY_BLOCKED.
{
  const verdict = classifyOperationOutcome(`${NON_RETRYABLE_ENVELOPE_PREFIX}${POLICY_NOT_READY_TOKEN}|INSUFFICIENT_PUBLIC_MULTISTORE`);
  assert.equal(verdict.outcome, OPERATIONAL_OUTCOME.POLICY_BLOCKED);
  assert.equal(verdict.isPolicyBlock, true);
  assert.deepEqual(verdict.reasonCodes, ["POLICY_NOT_READY", "INSUFFICIENT_PUBLIC_MULTISTORE"]);
}

// NON_RETRYABLE sem token de política => SYSTEM_FAILURE (dado inválido é falha do sistema).
{
  const verdict = classifyOperationOutcome(`${NON_RETRYABLE_ENVELOPE_PREFIX}SOME_DATA_ERROR`);
  assert.equal(verdict.outcome, OPERATIONAL_OUTCOME.SYSTEM_FAILURE, "NON_RETRYABLE por dado inválido NÃO é policy block");
  assert.equal(verdict.isPolicyBlock, false);
}

// Erro de rede => SYSTEM_FAILURE.
{
  const verdict = classifyOperationOutcome("timeout fetching source");
  assert.equal(verdict.outcome, OPERATIONAL_OUTCOME.SYSTEM_FAILURE);
}

// Sem erro => SUCCESS.
{
  const verdict = classifyOperationOutcome(null);
  assert.equal(verdict.outcome, OPERATIONAL_OUTCOME.SUCCESS);
  assert.deepEqual(verdict.reasonCodes, []);
}

// summarizeOutcomes separa as categorias.
{
  const summary = summarizeOutcomes([
    { errorMessage: null },
    { errorMessage: `${NON_RETRYABLE_ENVELOPE_PREFIX}${POLICY_NOT_READY_TOKEN}` },
    { errorMessage: "boom" },
    { errorMessage: null },
  ]);
  assert.deepEqual(summary, {
    policy_blocked: 1,
    system_failure: 1,
    success: 2,
  });
}

console.log("outcomeClassifier.test.ts PASS");