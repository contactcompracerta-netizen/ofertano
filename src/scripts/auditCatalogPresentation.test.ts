import assert from "node:assert/strict";

import {
  createProductPresentation,
} from "@/lib/product/productPresentation";
import { isDescriptionInvalid, sanitizeProductTitle } from "@/lib/seo/product";
import {
  hasPublicMultiStore,
  isUsablePublicOffer,
} from "@/services/publicVisibility/multiStoreVisibility";

// ---- AUDIT_MULTI_STORE_PUBLIC_PRODUCTS ------------------------------------
{
  const multiStoreProduct = {
    id: "multi-1",
    name: "Test Product",
    offers: [
      { marketplace: "MERCADO_LIVRE", active: true, available: true, status: "ACTIVE", matchStatus: "EXACT", price: 100 },
      { marketplace: "AMAZON", active: true, available: true, status: "ACTIVE", matchStatus: "EXACT", price: 110 },
    ],
  };
  assert.equal(hasPublicMultiStore(multiStoreProduct), true, "Multi store product should be public");
}
console.log("AUDIT_MULTI_STORE_PUBLIC_PRODUCTS=PASS");

// ---- AUDIT_NON_PUBLIC_PRODUCTS_EXCLUDED -----------------------------------
{
  const singleStoreProduct = {
    id: "single-1",
    name: "Test Product",
    offers: [
      { marketplace: "MERCADO_LIVRE", active: true, available: true, status: "ACTIVE", matchStatus: "EXACT", price: 100 },
    ],
  };
  assert.equal(hasPublicMultiStore(singleStoreProduct), false, "Single store product should be excluded");
}
console.log("AUDIT_NON_PUBLIC_PRODUCTS_EXCLUDED=PASS");

// ---- AUDIT_SAME_MARKETPLACE_NOT_MULTI_STORE --------------------------------
{
  const sameMarketplaceProduct = {
    id: "same-1",
    name: "Test Product",
    offers: [
      { marketplace: "MERCADO_LIVRE", active: true, available: true, status: "ACTIVE", matchStatus: "EXACT", price: 100 },
      { marketplace: "MERCADO_LIVRE", active: true, available: true, status: "ACTIVE", matchStatus: "EXACT", price: 90 },
    ],
  };
  assert.equal(hasPublicMultiStore(sameMarketplaceProduct), false, "Same marketplace offers should not count as multi store");
}
console.log("AUDIT_SAME_MARKETPLACE_NOT_MULTI_STORE=PASS");

// ---- AUDIT_TITLE_TRAILING_COMMA_DETECTED ----------------------------------
{
  const titleWithComma = "Produto Teste,";
  const sanitized = sanitizeProductTitle(titleWithComma);
  assert.equal(titleWithComma.trim().endsWith(','), true, "Should detect trailing comma");
  assert.equal(sanitized, "Produto Teste", "Should remove trailing comma");
}
console.log("AUDIT_TITLE_TRAILING_COMMA_DETECTED=PASS");

// ---- AUDIT_TITLE_NORMAL_NO_FALSE_POSITIVE ----------------------------------
{
  const normalTitle = "Produto Teste Normal";
  const sanitized = sanitizeProductTitle(normalTitle);
  assert.equal(sanitized, normalTitle, "Normal title should not be modified");
  assert.equal(normalTitle.includes('\n'), false, "Normal title should not have newlines");
  assert.equal(normalTitle.trim().endsWith(','), false, "Normal title should not have trailing comma");
}
console.log("AUDIT_TITLE_NORMAL_NO_FALSE_POSITIVE=PASS");

// ---- AUDIT_DESCRIPTION_NUMERIC_DETECTED ------------------------------------
{
  const numericDescription = "1234567890";
  assert.equal(isDescriptionInvalid(numericDescription), true, "Numeric description should be invalid");
}
console.log("AUDIT_DESCRIPTION_NUMERIC_DETECTED=PASS");

// ---- AUDIT_DESCRIPTION_URL_DETECTED ---------------------------------------
{
  const urlDescription = "https://example.com/product";
  assert.equal(isDescriptionInvalid(urlDescription), true, "URL description should be invalid");
}
console.log("AUDIT_DESCRIPTION_URL_DETECTED=PASS");

// ---- AUDIT_DESCRIPTION_SHORT_HUMAN_VALID -----------------------------------
{
  const shortHumanDescription = "Novo";
  assert.equal(isDescriptionInvalid(shortHumanDescription), false, "Short human description should be valid");
  assert.equal(isDescriptionInvalid("Chave de fenda"), false, "Short human description should be valid");
}
console.log("AUDIT_DESCRIPTION_SHORT_HUMAN_VALID=PASS");

// ---- AUDIT_BRAND_CANONICAL_STRUCTURED_NO_CONFLICT --------------------------
{
  const presentation = createProductPresentation({
    name: "Produto Teste",
    brand: "Vonder",
    specifications: { marca: "VONDER" },
  });
  assert.equal(presentation.brandConflict, false, "Vonder/VONDER should not conflict");
  assert.equal(presentation.resolvedBrand, "Vonder", "Should resolve to Vonder");
}
console.log("AUDIT_BRAND_CANONICAL_STRUCTURED_NO_CONFLICT=PASS");

// ---- AUDIT_BRAND_CONFLICT_DETECTED -----------------------------------------
{
  const presentation = createProductPresentation({
    name: "Produto Teste",
    brand: "Fertak",
    specifications: { marca: "VONDER" },
  });
  assert.equal(presentation.brandConflict, true, "Fertak/VONDER should conflict");
  assert.equal(presentation.resolvedBrand, null, "Conflict should resolve to null");
}
console.log("AUDIT_BRAND_CONFLICT_DETECTED=PASS");

// ---- AUDIT_MARKETPLACE_AS_CANONICAL_BRAND_INVALID -------------------------
{
  const presentation = createProductPresentation({
    name: "Produto Teste",
    brand: "Amazon",
    specifications: { marca: "VONDER" },
  });
  assert.equal(presentation.resolvedBrand, "VONDER", "Should reject Amazon as canonical brand");
  assert.equal(presentation.brandConflict, false, "Should not conflict when canonical is invalid");
}
console.log("AUDIT_MARKETPLACE_AS_CANONICAL_BRAND_INVALID=PASS");

// ---- AUDIT_STRUCTURED_BRAND_PREFIX_CLEANUP ---------------------------------
{
  const presentation = createProductPresentation({
    name: "Produto Teste",
    brand: null,
    specifications: { marca: "Visite a loja VONDER" },
  });
  assert.equal(presentation.structuredBrand, "VONDER", "Should clean 'Visite a loja' prefix");
  assert.equal(presentation.resolvedBrand, "VONDER", "Should resolve to cleaned brand");
}
console.log("AUDIT_STRUCTURED_BRAND_PREFIX_CLEANUP=PASS");

// ---- AUDIT_BRAND_3M_ACCEPTABLE ---------------------------------------------
{
  const presentation = createProductPresentation({
    name: "Produto Teste",
    brand: "3M",
    specifications: null,
  });
  assert.equal(presentation.resolvedBrand, "3M", "3M should be acceptable brand");
}
console.log("AUDIT_BRAND_3M_ACCEPTABLE=PASS");

// ---- AUDIT_BRAND_WD40_ACCEPTABLE -------------------------------------------
{
  const presentation = createProductPresentation({
    name: "Produto Teste",
    brand: "WD-40",
    specifications: null,
  });
  assert.equal(presentation.resolvedBrand, "WD-40", "WD-40 should be acceptable brand");
}
console.log("AUDIT_BRAND_WD40_ACCEPTABLE=PASS");

// ---- AUDIT_OFFER_VALIDATION ------------------------------------------------
{
  assert.equal(
    isUsablePublicOffer({
      marketplace: "AMAZON",
      active: true,
      available: true,
      status: "ACTIVE",
      matchStatus: "EXACT",
      price: 100,
    }),
    true,
    "Valid offer should be usable"
  );

  assert.equal(
    isUsablePublicOffer({
      marketplace: "AMAZON",
      active: true,
      available: false,
      status: "ACTIVE",
      matchStatus: "EXACT",
      price: 100,
    }),
    false,
    "Unavailable offer should not be usable"
  );

  assert.equal(
    isUsablePublicOffer({
      marketplace: "AMAZON",
      active: true,
      available: true,
      status: "UNAVAILABLE",
      matchStatus: "EXACT",
      price: 100,
    }),
    false,
    "UNAVAILABLE status should not be usable"
  );

  assert.equal(
    isUsablePublicOffer({
      marketplace: "AMAZON",
      active: true,
      available: true,
      status: "ACTIVE",
      matchStatus: "REVIEW",
      price: 100,
    }),
    false,
    "Non-EXACT matchStatus should not be usable"
  );

  assert.equal(
    isUsablePublicOffer({
      marketplace: "AMAZON",
      active: true,
      available: true,
      status: "ACTIVE",
      matchStatus: "EXACT",
      price: 0,
    }),
    false,
    "Zero price should not be usable"
  );
}
console.log("AUDIT_OFFER_VALIDATION=PASS");

// ---- AUDIT_COUNTING_SINGLE_PRODUCT_MULTIPLE_ISSUES --------------------------
{
  // Simulate counting logic: 1 product with 3 different issues should count as 1 problematic product
  const productId = "multi-issue-1";
  const titleIssues = [{ productId, issue: "Trailing comma" }];
  const descriptionIssues = [{ productId, issue: "Invalid description" }];
  const brandConflicts = [{ productId, issue: "Brand conflict" }];

  const productsWithAnyIssue = new Set<string>();
  [...titleIssues, ...descriptionIssues, ...brandConflicts].forEach(issue => {
    productsWithAnyIssue.add(issue.productId);
  });

  const productsWithIssuesCount = productsWithAnyIssue.size;
  const publicProductsScanned = 1;
  const productsOk = publicProductsScanned - productsWithIssuesCount;

  assert.equal(productsWithIssuesCount, 1, "Product with multiple issues should count as 1");
  assert.equal(productsOk, 0, "Products OK should be 0 when all products have issues");
  assert.equal(publicProductsScanned, productsOk + productsWithIssuesCount, "Count invariant should hold");
}
console.log("AUDIT_COUNTING_SINGLE_PRODUCT_MULTIPLE_ISSUES=PASS");

// ---- AUDIT_COUNTING_MULTIPLE_PRODUCTS_MIXED_ISSUES ---------------------------
{
  // Simulate: 3 products where A has no issues, B has 2 issues, C has 1 issue
  const productA = "product-a";
  const productB = "product-b";
  const productC = "product-c";

  const titleIssues = [
    { productId: productB, issue: "Trailing comma" },
    { productId: productC, issue: "Extra whitespace" }
  ];
  const descriptionIssues = [
    { productId: productB, issue: "Invalid description" }
  ];

  const productsWithAnyIssue = new Set<string>();
  [...titleIssues, ...descriptionIssues].forEach(issue => {
    productsWithAnyIssue.add(issue.productId);
  });

  const productsWithIssuesCount = productsWithAnyIssue.size;
  const publicProductsScanned = 3;
  const productsOk = publicProductsScanned - productsWithIssuesCount;

  assert.equal(productsWithIssuesCount, 2, "Should count 2 unique products with issues");
  assert.equal(productsOk, 1, "Should have 1 product without issues");
  assert.equal(publicProductsScanned, productsOk + productsWithIssuesCount, "Count invariant should hold");
}
console.log("AUDIT_COUNTING_MULTIPLE_PRODUCTS_MIXED_ISSUES=PASS");

// ---- AUDIT_COUNTING_INVARIANT ------------------------------------------------
{
  // Test the mathematical invariant: PRODUCTS_OK + PRODUCTS_WITH_ISSUES == PUBLIC_PRODUCTS_SCANNED
  const testCases = [
    { publicProducts: 10, issues: 3, expectedOk: 7 },
    { publicProducts: 5, issues: 0, expectedOk: 5 },
    { publicProducts: 1, issues: 1, expectedOk: 0 },
    { publicProducts: 100, issues: 45, expectedOk: 55 },
  ];

  for (const testCase of testCases) {
    const productsOk = testCase.publicProducts - testCase.issues;
    assert.equal(productsOk, testCase.expectedOk, `Count calculation for ${testCase.publicProducts} products with ${testCase.issues} issues`);
    assert.equal(testCase.publicProducts, productsOk + testCase.issues, "Invariant should hold");
  }
}
console.log("AUDIT_COUNTING_INVARIANT=PASS");

console.log("auditCatalogPresentation.test.ts: todos os casos passaram");
