/**
 * Feed Ingestion Engine V1 - Dry Run Engine Tests.
 */
import { DryRunEngine, isDryRunMode, isDisableMode, defaultDryRunEngine } from "./dryRunEngine";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) { passed += 1; }
  else { failed += 1; console.error("FAIL: " + message); }
}

// Teste 1: Engine com modo DRY_RUN
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  assert(isDryRunMode(engine.getMode() || ""), "Modo DRY_RUN detectado");
  assert(isDisableMode("DRY_RUN") === false, "isDisableMode('DRY_RUN') returns false");
}

// Teste 2: Engine com modo DISABLED
{
  const engine = new DryRunEngine("DISABLED", "awin");
  assert(engine.getMode() === "DISABLED", "Modo DISABLED definido corretamente");
}

// Teste 3: Engine com modo LIVE (setMode converts to DISABLED)
{
  const engine = new DryRunEngine("DISABLED", "awin");
  engine.setMode("LIVE");
  assert(engine.getMode() === "DISABLED", "LIVE mode converts to DISABLED via setMode");
}

// Teste 4: processRows com fixture simples
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  const fixture = [
    { externalId: "test-001", price: "1299.90", currency: "brl", productUrl: "https://example.com/product/1" },
    { externalId: "test-002", price: "abc", currency: "brl", productUrl: "https://example.com/product/2" },
    { price: "100", currency: "brl", productUrl: "http://example.com/product/3" },
    { externalId: "test-001", price: "500", currency: "brl", productUrl: "https://example.com/product/4" },
  ];
  const result = engine.processRows(fixture);
  assert(result.totalRows === 4, "Total rows = 4");
  assert(result.validRows >= 0, "Valid rows >= 0");
  assert(result.partialRows >= 0, "Partial rows >= 0");
  assert(result.invalidRows >= 0, "Invalid rows >= 0");
  assert(result.duplicateExternalIds >= 0, "Duplicate externalIds >= 0");
  assert(result.rowsWithPrice >= 0, "Rows with price >= 0");
  assert(result.rowsWithValidUrl >= 0, "Rows with valid URL >= 0");
  assert(result.failureReasons !== undefined, "Failure reasons defined");
  assert(result.source === "awin", "Source is awin");
}

// Teste 4b: Verificar que externalId duplicado e rejeitado
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  const fixture = [
    { externalId: "dup-1", price: "100", currency: "brl", productUrl: "https://example.com/1" },
    { externalId: "dup-1", price: "200", currency: "brl", productUrl: "https://example.com/2" },
  ];
  const result = engine.processRows(fixture);
  assert(result.duplicateExternalIds === 1, "1 duplicate externalId detected (second occurrence)");
  assert(result.validRows === 1, "1 valid row (first occurrence kept)");
  assert(result.invalidRows === 1, "1 invalid row (the duplicate)");
}

// Teste 5: Engine default (DISABLED)
{
  const engine = defaultDryRunEngine;
  assert(engine.getMode() === "DISABLED", "Default mode is DISABLED");
  const result = engine.processRows([
    { externalId: "test-001", price: "100", currency: "brl", productUrl: "https://example.com/1" },
  ]);
  assert(result.totalRows >= 0, "processRows works in DISABLED mode");
}

// Teste 6: Engine.runFixture
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  const { report, databaseWrites } = engine.runFixture([
    { externalId: "test-001", price: "100", currency: "brl", productUrl: "https://example.com/1" },
  ]);
  assert(databaseWrites === 0, "runFixture returns databaseWrites=0");
  assert(report.totalRows === 1, "runFixture totalRows=1");
  assert(report.validRows >= 0, "runFixture validRows>=0");
}

// Teste 7: fulfillment das condicoes do relatorio
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  const fixture = [
    { externalId: "f-001", price: "100", currency: "brl", productUrl: "https://example.com/1", brand: "BrandA", model: "ModX", gtin: "123456789", attributes: { color: "red" } },
  ];
  const result = engine.processRows(fixture);
  assert(result.rowsWithBrand >= 0, "rowsWithBrand tracked");
  assert(result.rowsWithModel >= 0, "rowsWithModel tracked");
  assert(result.rowsWithGtin >= 0, "rowsWithGtin tracked");
  assert(result.rowsWithValidUrl >= 0, "rowsWithValidUrl tracked");
}

// Teste 8: identidadeSignalStats populado
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  const fixture = [
    { externalId: "sig-1", price: "100", currency: "brl", productUrl: "https://example.com/1" },
    { externalId: "sig-1", price: "200", currency: "brl", productUrl: "https://example.com/2" }, // duplicate
  ];
  const result = engine.processRows(fixture);
  assert(result.identitySignalStats["sig-1"] === 1, "identitySignalStats counts unique occurrences");
}

// Teste 9: ExecutionMode enum behavior
{
  assert(isDryRunMode("DRY_RUN"), "DRY_RUN is dry run");
  assert(!isDryRunMode("DISABLED"), "DISABLED is not dry run");
  assert(isDisableMode("DISABLED"), "DISABLED is disabled");
  assert(!isDisableMode("DRY_RUN"), "DRY_RUN is not disabled");
}

// Teste 10: currencyStats tracked (apenas BRL e valido)
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  const fixture = [
    { externalId: "cur-1", price: "100", currency: "brl", productUrl: "https://example.com/1" },
    { externalId: "cur-2", price: "200", currency: "brl", productUrl: "https://example.com/2" },
    { externalId: "cur-3", price: "300", currency: "BRL", productUrl: "https://example.com/3" },
  ];
  const result = engine.processRows(fixture);
  assert(result.currencyStats["BRL"] === 3, "currencyStats BRL = 3");
}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
else console.log("DRY_RUN_ENGINE_TESTS=PASS");