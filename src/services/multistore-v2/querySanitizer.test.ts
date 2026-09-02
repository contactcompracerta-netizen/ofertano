/**
 * QUERY SANITIZER TESTS
 */

import * as assert from "assert";
import {
  sanitizeCommerceQuery,
  looksLikeListingTitle,
  inferConditionFromQuery,
} from "./querySanitizer";

async function runSanitizerTests() {
  console.log("=== QUERY SANITIZER TESTS ===\n");

  // Test 1: Amazon query contaminated with rating/review noise
  console.log("1. AMAZON_QUERY_SANITIZER");
  const amazonContaminated =
    "Aramóveis\n4,5 de 5 estrelas\n(5)\nArmário de Cozinha Completa Aramóveis Kit Mega 9 Portas 2 Gavetas";
  const sanitized1 = sanitizeCommerceQuery(amazonContaminated);
  assert.ok(sanitized1.changed, "should detect noise");
  assert.ok(
    sanitized1.sanitizedQuery.includes("Armário"),
    "should preserve Armário"
  );
  assert.ok(
    sanitized1.sanitizedQuery.includes("Kit Mega"),
    "should preserve Kit Mega"
  );
  assert.ok(
    sanitized1.sanitizedQuery.includes("9 Portas"),
    "should preserve 9 Portas"
  );
  assert.ok(
    sanitized1.sanitizedQuery.includes("2 Gavetas"),
    "should preserve 2 Gavetas"
  );
  assert.equal(
    sanitized1.removedNoise.length > 0,
    true,
    "should track removed noise"
  );
  console.log("✓ PASS: Correctly sanitized Amazon query with noise\n");

  // Test 2: Clean Amazon title should pass through
  console.log("2. AMAZON_CLEAN_TITLE");
  const amazonClean =
    "Cozinha Compacta Madesa Emilly Pop Com Armário e Balcão - Rustic";
  const sanitized2 = sanitizeCommerceQuery(amazonClean);
  assert.ok(sanitized2.sanitizedQuery.includes("Madesa"), "preserve Madesa");
  assert.ok(
    sanitized2.sanitizedQuery.includes("Emilly Pop"),
    "preserve Emilly Pop"
  );
  assert.ok(
    sanitized2.sanitizedQuery.includes("Rustic"),
    "preserve Rustic"
  );
  console.log("✓ PASS: Clean title preserved\n");

  // Test 3: Query with condition keywords
  console.log("3. CONDITION_INFERENCE");
  const cond1 = inferConditionFromQuery(
    "Sofá recondicionado 2 lugares"
  );
  assert.equal(cond1, "refurbished", "detect recondicionado");
  const cond2 = inferConditionFromQuery("Produto seminovo");
  assert.equal(cond2, "used", "detect seminovo");
  const cond3 = inferConditionFromQuery("Headphone novo wireless");
  assert.equal(cond3, null, "novo is not meaningful without context");
  console.log("✓ PASS: Condition inference works\n");

  // Test 4: Detect listing title queries
  console.log("4. LISTING_TITLE_DETECTION");
  const longTitle1 =
    "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos (Recondicionado)";
  assert.ok(
    looksLikeListingTitle(longTitle1),
    "detect PS4 title with bundle+capacity+condition"
  );

  const shortQuery = "PS4 Slim";
  assert.ok(
    !looksLikeListingTitle(shortQuery),
    "reject short queries"
  );

  // Note: "KIT 4" queries must be >= 26 chars with additional signals
  const kitQuery = "KIT 4 Camisas Térmicas com Proteção UV 50+ Manga Longa";
  assert.ok(
    looksLikeListingTitle(kitQuery),
    "detect bundle quantity signal"
  );

  const aliexpressTitle =
    "Novas Camisas Polo Masculinas de Manga Curta, Camiseta Casual de Cor Sólida com Diversos Modelos";
  assert.ok(
    looksLikeListingTitle(aliexpressTitle),
    "detect long AliExpress title"
  );
  console.log("✓ PASS: Listing title detection works\n");

  // Test 5: Preserve product specifications
  console.log("5. PRESERVE_SPECIFICATIONS");
  const specQuery = "Jogo De Chave Combinada 6 À 19 Mm Com 11 Peças 8tn Eda";
  const sanitized5 = sanitizeCommerceQuery(specQuery);
  assert.ok(
    sanitized5.sanitizedQuery.includes("6"),
    "preserve 6"
  );
  assert.ok(
    sanitized5.sanitizedQuery.includes("19"),
    "preserve 19"
  );
  assert.ok(
    sanitized5.sanitizedQuery.includes("11"),
    "preserve 11"
  );
  assert.ok(
    sanitized5.sanitizedQuery.includes("8tn"),
    "preserve 8tn"
  );
  assert.ok(
    sanitized5.sanitizedQuery.includes("Eda"),
    "preserve Eda (brand)"
  );
  console.log("✓ PASS: Product specifications preserved\n");

  // Test 6: Empty query handling
  console.log("6. EMPTY_QUERY_HANDLING");
  const empty = sanitizeCommerceQuery("");
  assert.equal(empty.sanitizedQuery, "", "empty stays empty");
  assert.equal(empty.changed, false, "empty not marked as changed");
  console.log("✓ PASS: Empty query handled\n");

  // Test 7: Frete/parcelado/cupom removal
  console.log("7. COMMERCE_METADATA_REMOVAL");
  const freteQuery = "Headphone 10 frete grátis cupom 20% parcelado 3x";
  const sanitized7 = sanitizeCommerceQuery(freteQuery);
  assert.ok(!sanitized7.sanitizedQuery.includes("frete"), "remove frete");
  assert.ok(!sanitized7.sanitizedQuery.includes("cupom"), "remove cupom");
  assert.ok(!sanitized7.sanitizedQuery.includes("parcelado"), "remove parcelado");
  assert.ok(sanitized7.sanitizedQuery.includes("Headphone"), "preserve product");
  assert.ok(sanitized7.sanitizedQuery.includes("10"), "preserve number");
  console.log("✓ PASS: Commerce metadata removed\n");

  console.log("=== ALL SANITIZER TESTS PASSED ===\n");
}

void runSanitizerTests()
  .then(() => {
    console.log("Success: Query sanitizer tests completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("FAILED:", error);
    process.exit(1);
  });
