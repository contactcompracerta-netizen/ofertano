import assert from "node:assert/strict";

import { extractVoltage } from "../multistore-v2/normalizeCandidate";

function assertVoltageMatch(title: string, expected: string | null): void {
  assert.equal(extractVoltage(title), expected, `voltagem em "${title}"`);
}

void (function runVoltageRegressionCase(): void {
  assertVoltageMatch("Aspirador de Pó e Água Wap GTW Inox 12 1400W - 220V", "220v");
  assertVoltageMatch("Aspirador de Pó e Água Wap GTW Inox 12 1400W - 127V", "127v");
  assertVoltageMatch("Aspirador de Pó e Água Wap GTW Inox 12 1400W", null);
  assertVoltageMatch("Aspirador Wap Gtw Inox 12 1400w 220v", "220v");
  assertVoltageMatch("Aspirador com voltagem 220V sem insersão", "220v");
  assert.equal(
    extractVoltage("Aspirador Wap Gtw Inox 12 1400w"),
    null,
    "consulta nunca deve inferir voltagem do texto de busca",
  );

  console.log("ML_VOLTAGE_REGRESSION=PASS");
})();
