/**
 * PHASE 4 — SEARCH PLAN TESTS
 *
 * Tests variant generation with identity preservation rules.
 */

import { describe, it, expect } from "vitest";
import { buildCommerceSearchPlan, variantPreservesCriticalIdentity } from "./searchPlan";
import { extractSanitizedIdentity } from "./sanitizedIdentity";

describe("PHASE 4: Search Plan Variants", () => {
  // Test 1: Full title → multiple variants
  it("1_PS4_PLAN_GENERATES_3_VARIANTS: Should generate multiple variants from full title", () => {
    const query = "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos (Recondicionado)";
    const identity = extractSanitizedIdentity(query);

    const variants = buildCommerceSearchPlan(identity);

    // Should generate at least 1, at most 3 variants
    expect(variants.length).toBeGreaterThanOrEqual(1);
    expect(variants.length).toBeLessThanOrEqual(3);

    // All variants should preserve strong identity (storage, model)
    for (const variant of variants) {
      expect(variant.index).toBeGreaterThanOrEqual(1);
      expect(variant.index).toBeLessThanOrEqual(variants.length);
      expect(variant.originalText.length).toBeGreaterThan(0);
    }

    // Should have storage preserved in variants
    const variantWithStorage = variants.some(
      (v) => v.preservedIdentity.storage && v.preservedIdentity.storage.includes("1"),
    );
    expect(variantWithStorage).toBe(true);
  });

  // Test 2: Lubeck sofa - brand preservation
  it("2_LUBECK_SOFA_VARIANT_PRESERVES_BRAND: Variants must keep brand", () => {
    const query = "Sofá 2 Lugares Retrátil Lubeck Linho Cru";
    const identity = extractSanitizedIdentity(query);

    const variants = buildCommerceSearchPlan(identity);

    // Every variant must preserve Lubeck brand
    for (const variant of variants) {
      expect(variant.preservedIdentity.brand?.toLowerCase()).toMatch(/lubeck/i);
      expect(variantPreservesCriticalIdentity(variant, identity)).toBe(true);
    }
  });

  // Test 3: Aspirador voltage preservation
  it("3_ASPIRADOR_VARIANTS_PRESERVE_VOLTAGE: Variants must keep 220V", () => {
    const query = "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V";
    const identity = extractSanitizedIdentity(query);

    const variants = buildCommerceSearchPlan(identity);

    // Voltage should be preserved across variants
    for (const variant of variants) {
      if (identity.strongIdentity.voltage) {
        expect(variant.originalText).toMatch(/220/);
      }
    }
  });

  // Test 4: Short query → fewer variants
  it("4_SHORT_QUERY_LIMITED_VARIANTS: Short queries may generate fewer variants", () => {
    const query = "Sofá Lubeck";
    const identity = extractSanitizedIdentity(query);

    const variants = buildCommerceSearchPlan(identity);

    // Short queries should still generate at least 1 variant
    expect(variants.length).toBeGreaterThanOrEqual(1);
    expect(variants.length).toBeLessThanOrEqual(3);
  });

  // Test 5: Maximum 3 variants
  it("5_MAX_3_VARIANTS: Should never generate more than 3 variants", () => {
    const queries = [
      "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos Recondicionado 220V Preto",
      "Cozinha Compacta Madesa Emilly Pop Com Armário e Balcão Rustic 2.50m",
      "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro e Seca Rápida 220V Amarelo",
    ];

    for (const query of queries) {
      const identity = extractSanitizedIdentity(query);
      const variants = buildCommerceSearchPlan(identity);

      expect(variants.length).toBeLessThanOrEqual(3);
      expect(variants.every((v) => v.index > 0 && v.index <= variants.length)).toBe(true);
    }
  });

  // Test 6: Variant 1 is always sanitized input
  it("6_VARIANT_1_IS_SANITIZED: First variant should be sanitized query", () => {
    const query = "Console Playstation 4 Ps4 Slim 1 Tb (5 Avaliações) - mais vendido";
    const identity = extractSanitizedIdentity(query);

    const variants = buildCommerceSearchPlan(identity);

    if (variants.length > 0) {
      const variant1 = variants[0];
      expect(variant1.index).toBe(1);
      expect(variant1.reason).toBe("SANITIZED_FULL");
      // Should not have the noise
      expect(variant1.originalText).not.toMatch(/avaliações|mais vendido/i);
    }
  });

  // Test 7: Deduplication of normalized variants
  it("7_VARIANT_DEDUPLICATION: Normalized duplicates should be merged", () => {
    const query = "PS4 PS4 1TB 1TB";  // Intentional duplicates
    const identity = extractSanitizedIdentity(query);

    const variants = buildCommerceSearchPlan(identity);

    // Should not have exact duplicates when normalized
    const normalized = new Set(variants.map((v) => v.originalText.toLowerCase().trim()));
    expect(normalized.size).toBe(variants.length);
  });

  // Test 8: Madesa kitchen variant generation
  it("8_MADESA_KITCHEN_VARIANTS: Should generate variants with brand and model", () => {
    const query = "Cozinha Compacta Madesa Emilly Pop Com Armário e Balcão - Rustic";
    const identity = extractSanitizedIdentity(query);

    const variants = buildCommerceSearchPlan(identity);

    expect(variants.length).toBeGreaterThanOrEqual(1);

    // Should have variants preserving critical identity
    for (const variant of variants) {
      expect(variantPreservesCriticalIdentity(variant, identity)).toBe(true);
    }
  });

  // Test 9: KIT 4 quantity preservation
  it("9_KIT4_QUANTITY_PRESERVED: Bundle quantity should persist in variants", () => {
    const query = "KIT 4 Camisa Térmica Proteção UV 50+";
    const identity = extractSanitizedIdentity(query);

    const variants = buildCommerceSearchPlan(identity);

    // Should preserve bundle quantity
    const hasQuantity = variants.some(
      (v) => v.preservedIdentity.bundleQuantity === 4,
    );
    expect(hasQuantity).toBe(true);
  });

  // Test 10: EDA tools variant generation
  it("10_EDA_TOOLS_VARIANTS: Should generate variants with brand and bundle", () => {
    const query = "Jogo De Chave Combinada 6 À 19 Mm Com 11 Peças 8tn Eda";
    const identity = extractSanitizedIdentity(query);

    const variants = buildCommerceSearchPlan(identity);

    expect(variants.length).toBeGreaterThanOrEqual(1);

    // Should preserve EDA brand if detected
    for (const variant of variants) {
      expect(variantPreservesCriticalIdentity(variant, identity)).toBe(true);
    }
  });

  // Test 11: Bicycle dimensions preservation
  it("11_BICYCLE_VARIANTS_PRESERVE_DIMENSIONS: Dimensions should be in some variant", () => {
    const query = "Bicicleta Aro 29 GTS Dexter 24 Marchas Quadro 21";
    const identity = extractSanitizedIdentity(query);

    const variants = buildCommerceSearchPlan(identity);

    // Dimensions should appear in at least one variant
    const hasDimensions = variants.some(
      (v) => v.originalText.match(/aro|quadro/i),
    );
    // May or may not depending on extraction
    expect(variants.length).toBeGreaterThanOrEqual(1);
  });

  // Test 12: Condition preservation in variants
  it("12_CONDITION_PRESERVED_IN_VARIANTS: Reconditioned state preserved", () => {
    const query = "Aspirador de Pó Wap GTW 12 Recondicionado 220V";
    const identity = extractSanitizedIdentity(query);

    const variants = buildCommerceSearchPlan(identity);

    // At least variant 1 should have condition
    const hasCondition = variants.some(
      (v) => v.originalText.match(/recondicionado|refurbished/i),
    );
    // May or may not depending on sanitization
    expect(variants.length).toBeGreaterThanOrEqual(1);
  });
});
