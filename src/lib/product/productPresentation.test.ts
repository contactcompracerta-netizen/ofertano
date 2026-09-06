import assert from "node:assert/strict";

import {
  createProductPresentation,
  sanitizeProductNameForDisplay,
  type ProductPresentationInput,
} from "./productPresentation";

console.log("Starting product presentation tests...");

// ---- PHASE 12: DISPLAY NAME TESTS ----
{
  const result = createProductPresentation({
    name: "Produto,   ",
  });
  assert.equal(result.displayName, "Produto", "Trailing comma and spaces should be removed");
}
console.log("DISPLAY_NAME_TRAILING_CLEANUP=PASS");

{
  const result = createProductPresentation({
    name: "TV\nSamsung",
  });
  assert.equal(result.displayName, "TV Samsung", "Newlines should be normalized to spaces");
}
console.log("DISPLAY_NAME_NEWLINE_NORMALIZATION=PASS");

{
  const result = createProductPresentation({
    name: "Produto!!!",
  });
  assert.equal(result.displayName, "Produto!", "Multiple exclamation marks should be preserved");
}
console.log("DISPLAY_NAME_PUNCTUATION_PRESERVED=PASS");

{
  const result = createProductPresentation({
    name: "Produto... edição 2026",
  });
  assert.equal(result.displayName, "Produto... edição 2026", "Internal ellipsis should be preserved");
}
console.log("DISPLAY_NAME_INTERNAL_ELLIPSIS_PRESERVED=PASS");

{
  const result = createProductPresentation({
    name: "Notebook XYZ 220V 16GB",
  });
  assert.equal(result.displayName, "Notebook XYZ 220V 16GB", "Model, voltage, and capacity should be preserved");
}
console.log("DISPLAY_NAME_TECHNICAL_SPECS_PRESERVED=PASS");

// ---- PHASE 11: PUBLIC DESCRIPTION TESTS ----
{
  const result = createProductPresentation({
    name: "Produto Teste",
    description: "3070218200",
  });
  assert.equal(result.publicDescription, null, "Numeric code should not be renderable as About");
}
console.log("PUBLIC_DESCRIPTION_NUMERIC_CODE_HIDDEN=PASS");

{
  const result = createProductPresentation({
    name: "Produto Teste",
    description: "B07CXTZ2KS",
  });
  assert.equal(result.publicDescription, null, "ASIN should not be renderable as About");
}
console.log("PUBLIC_DESCRIPTION_ASIN_HIDDEN=PASS");

{
  const result = createProductPresentation({
    name: "Produto Teste",
    description: "https://example.com",
  });
  assert.equal(result.publicDescription, null, "URL should not be renderable as About");
}
console.log("PUBLIC_DESCRIPTION_URL_HIDDEN=PASS");

{
  const result = createProductPresentation({
    name: "Chave de fenda",
    description: "Excelente chave de fenda para uso doméstico.",
  });
  assert.equal(result.publicDescription, "Excelente chave de fenda para uso doméstico.", "Real description should be preserved");
}
console.log("PUBLIC_DESCRIPTION_REAL_PRESERVED=PASS");

{
  const result = createProductPresentation({
    name: "Produto Teste",
    description: "Novo",
  });
  assert.equal(result.publicDescription, "Novo", "Short human description should not be discarded");
}
console.log("PUBLIC_DESCRIPTION_SHORT_HUMAN_PRESERVED=PASS");

{
  const result = createProductPresentation({
    name: "Notebook Lenovo",
    description: "Notebook Lenovo",
  });
  assert.equal(result.publicDescription, null, "Description equal to title should be treated as redundant");
}
console.log("PUBLIC_DESCRIPTION_REDUNDANT_HIDDEN=PASS");

// ---- PHASE 10: BRAND RESOLUTION TESTS ----
{
  const result = createProductPresentation({
    name: "Produto",
    brand: "Vonder",
    specifications: { Marca: "VONDER" },
  });
  assert.equal(result.resolvedBrand, "Vonder", "Same brand case-insensitive should resolve to canonical");
  assert.equal(result.brandConflict, false, "No conflict when brands match");
}
console.log("BRAND_RESOLUTION_SAME_BRAND_CANONICAL=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    brand: null,
    specifications: { Marca: "VONDER" },
  });
  assert.equal(result.resolvedBrand, "VONDER", "Structured brand should be used when canonical is null");
  assert.equal(result.brandConflict, false);
}
console.log("BRAND_RESOLUTION_STRUCTURED_ONLY=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    brand: "Vonder",
    specifications: null,
  });
  assert.equal(result.resolvedBrand, "Vonder", "Canonical brand should be used when structured is null");
  assert.equal(result.brandConflict, false);
}
console.log("BRAND_RESOLUTION_CANONICAL_ONLY=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    brand: "Amazon",
    specifications: { Marca: "VONDER" },
  });
  assert.equal(result.resolvedBrand, "VONDER", "Structured brand should override invalid canonical (marketplace)");
  assert.equal(result.brandConflict, false);
}
console.log("BRAND_RESOLUTION_STRUCTURED_OVERRIDE_INVALID=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    brand: "Fertak",
    specifications: { Marca: "VONDER" },
  });
  assert.equal(result.resolvedBrand, null, "Conflicting brands should resolve to null");
  assert.equal(result.brandConflict, true, "Conflict should be detected");
}
console.log("BRAND_RESOLUTION_CONFLICT_NULL=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    brand: "sem marca",
    specifications: null,
  });
  assert.equal(result.resolvedBrand, null, "Invalid canonical brand should resolve to null");
  assert.equal(result.brandConflict, false);
}
console.log("BRAND_RESOLUTION_INVALID_CANONICAL_NULL=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    brand: "3M",
    specifications: null,
  });
  assert.equal(result.resolvedBrand, "3M", "Valid brand like 3M should be preserved");
  assert.equal(result.brandConflict, false);
}
console.log("BRAND_RESOLUTION_VALID_BRAND_3M=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    brand: "WD-40",
    specifications: null,
  });
  assert.equal(result.resolvedBrand, "WD-40", "Valid brand like WD-40 should be preserved");
  assert.equal(result.brandConflict, false);
}
console.log("BRAND_RESOLUTION_VALID_BRAND_WD40=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    brand: null,
    specifications: { Marca: "Visite a loja VONDER" },
  });
  assert.equal(result.structuredBrand, "VONDER", "Boilerplate 'Visite a loja' should be removed");
  assert.equal(result.resolvedBrand, "VONDER", "Cleaned structured brand should be used");
  assert.equal(result.brandConflict, false);
}
console.log("BRAND_BOILERPLATE_CLEANUP_VISITE_LOJA=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    brand: null,
    specifications: { Brand: "Marca: Bosch" },
  });
  assert.equal(result.structuredBrand, "Bosch", "Boilerplate 'Marca:' should be removed");
  assert.equal(result.resolvedBrand, "Bosch", "Cleaned structured brand should be used");
  assert.equal(result.brandConflict, false);
}
console.log("BRAND_BOILERPLATE_CLEANUP_MARCA_PREFIX=PASS");

// ---- PHASE 9: REAL REGRESSION PRODUCT TEST ----
{
  const realProduct: ProductPresentationInput = {
    name: "Vonder, Chave De Fenda 1/8\" X 2\", Aço Cromo Vanádio, Com Ponta Magnetizada,",
    description: "3070218200",
    brand: "Fertak",
    specifications: {
      Marca: "Visite a loja VONDER",
    },
  };

  const result = createProductPresentation(realProduct);

  assert.equal(
    result.displayName,
    "Vonder, Chave De Fenda 1/8\" X 2\", Aço Cromo Vanádio, Com Ponta Magnetizada",
    "Display name should not end with comma"
  );
  assert.equal(result.publicDescription, null, "Numeric description should be hidden");
  assert.equal(result.structuredBrand, "VONDER", "Structured brand should be cleaned");
  assert.equal(result.brandConflict, true, "Brand conflict should be detected");
  assert.equal(result.resolvedBrand, null, "Resolved brand should be null on conflict");
}
console.log("REAL_REGRESSION_PRODUCT_PASS=PASS");

// ---- PHASE 3: SPECIFICATIONS CLEANING TESTS ----
{
  const result = createProductPresentation({
    name: "Produto",
    specifications: {
      ASIN: "B07CXTZ2KS",
      Material: "Aço cromo vanádio",
      "Número de itens": "1",
      Cor: "yellow",
    },
  });

  const asinSpec = result.displaySpecifications.find(([key]) => key === "ASIN");
  assert.ok(asinSpec, "ASIN specification should be preserved");
  assert.equal(asinSpec[1], "B07CXTZ2KS", "ASIN value should be preserved");

  const materialSpec = result.displaySpecifications.find(([key]) => key === "Material");
  assert.ok(materialSpec, "Material specification should be preserved");
  assert.equal(materialSpec[1], "Aço cromo vanádio", "Material value should be preserved");

  const colorSpec = result.displaySpecifications.find(([key]) => key === "Cor");
  assert.ok(colorSpec, "Color specification should be preserved");
  assert.equal(colorSpec[1], "yellow", "Color value should be preserved");
}
console.log("SPECIFICATIONS_REAL_PRESERVED=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    specifications: {
      "Marca": "Visite a loja VONDER",
    },
  });

  const brandSpec = result.displaySpecifications.find(([key]) => key === "Marca");
  assert.ok(brandSpec, "Brand specification should be preserved in display");
  assert.equal(brandSpec[1], "VONDER", "Brand value should be cleaned in display specifications");
}
console.log("SPECIFICATIONS_BRAND_DISPLAY_CLEANED=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    specifications: {
      "Valor com espaços  estranhos": "teste   valor",
    },
  });

  const spec = result.displaySpecifications.find(([key]) => key === "Valor com espaços  estranhos");
  assert.ok(spec, "Specification with weird spacing should be preserved");
  assert.equal(spec[1], "teste valor", "Value should have normalized spacing");
}
console.log("SPECIFICATIONS_WHITESPACE_NORMALIZED=PASS");

// ---- EDGE CASES ----
{
  const result = createProductPresentation({
    name: "Produto",
    description: null,
    brand: null,
    specifications: null,
  });

  assert.equal(result.displayName, "Produto", "Display name should work with minimal input");
  assert.equal(result.publicDescription, null, "Null description should remain null");
  assert.equal(result.structuredBrand, null, "Null specifications should yield null structured brand");
  assert.equal(result.resolvedBrand, null, "Null brands should resolve to null");
  assert.equal(result.brandConflict, false, "No conflict with null values");
  assert.equal(result.displaySpecifications.length, 0, "Null specifications should yield empty array");
}
console.log("EDGE_CASE_MINIMAL_INPUT=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    specifications: {
      "empty value": "",
      "null value": null,
      "spaces only": "   ",
    },
  });

  const emptySpec = result.displaySpecifications.find(([key]) => key === "empty value");
  assert.equal(emptySpec[1], "Não informado", "Empty string should show 'Não informado'");

  const nullSpec = result.displaySpecifications.find(([key]) => key === "null value");
  assert.equal(nullSpec[1], "Não informado", "Null value should show 'Não informado'");

  const spacesSpec = result.displaySpecifications.find(([key]) => key === "spaces only");
  assert.equal(spacesSpec[1], "Não informado", "Spaces-only value should show 'Não informado'");
}
console.log("EDGE_CASE_EMPTY_VALUES=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    specifications: {
      "boolean true": true,
      "boolean false": false,
    },
  });

  const trueSpec = result.displaySpecifications.find(([key]) => key === "boolean true");
  assert.equal(trueSpec[1], "Sim", "Boolean true should show 'Sim'");

  const falseSpec = result.displaySpecifications.find(([key]) => key === "boolean false");
  assert.equal(falseSpec[1], "Não", "Boolean false should show 'Não'");
}
console.log("EDGE_CASE_BOOLEAN_VALUES=PASS");

{
  const result = createProductPresentation({
    name: "Produto",
    specifications: {
      "array value": ["item1", "item2", "item3"],
    },
  });

  const arraySpec = result.displaySpecifications.find(([key]) => key === "array value");
  assert.equal(arraySpec[1], "item1, item2, item3", "Array should be joined with commas");
}
console.log("EDGE_CASE_ARRAY_VALUES=PASS");

console.log("All product presentation tests passed successfully!");

// ---- NEW TESTS FOR sanitizeProductNameForDisplay ----
{
  const result = sanitizeProductNameForDisplay("Produto,   ");
  assert.equal(result, "Produto", "Trailing comma and spaces should be removed");
}
console.log("SANITIZE_NAME_TRAILING_CLEANUP=PASS");

{
  const result = sanitizeProductNameForDisplay("TV\nSamsung");
  assert.equal(result, "TV Samsung", "Newlines should be normalized to spaces");
}
console.log("SANITIZE_NAME_NEWLINE_NORMALIZATION=PASS");

{
  const result = sanitizeProductNameForDisplay("Produto!!!");
  assert.equal(result, "Produto!", "Multiple exclamation marks should be preserved");
}
console.log("SANITIZE_NAME_PUNCTUATION_PRESERVED=PASS");

{
  const result = sanitizeProductNameForDisplay("Produto... edição 2026");
  assert.equal(result, "Produto... edição 2026", "Internal ellipsis should be preserved");
}
console.log("SANITIZE_NAME_INTERNAL_ELLIPSIS_PRESERVED=PASS");

{
  const result = sanitizeProductNameForDisplay("Notebook XYZ 220V 16GB");
  assert.equal(result, "Notebook XYZ 220V 16GB", "Model, voltage, and capacity should be preserved");
}
console.log("SANITIZE_NAME_TECHNICAL_SPECS_PRESERVED=PASS");

{
  const result = sanitizeProductNameForDisplay("  Produto com espaços  ");
  assert.equal(result, "Produto com espaços", "Leading/trailing spaces should be trimmed");
}
console.log("SANITIZE_NAME_WHITESPACE_TRIMMED=PASS");

{
  const result = sanitizeProductNameForDisplay("Produto,    com,    vírgulas,    ");
  assert.equal(result, "Produto, com, vírgulas", "Multiple spaces after commas should be normalized");
}
console.log("SANITIZE_NAME_COMMA_SPACES_NORMALIZED=PASS");

console.log("All sanitizeProductNameForDisplay tests passed successfully!");
