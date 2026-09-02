/**
 * PHASES 1-9 COMPLETE TEST SUITE
 *
 * Verifies all mission-critical gates and non-regression tests.
 * 12 mandatory test cases + 9 live query gates.
 */

import { describe, it, expect } from "vitest";
import { extractSanitizedIdentity } from "./sanitizedIdentity";
import { buildCommerceSearchPlan, variantPreservesCriticalIdentity } from "./searchPlan";
import { detectDistinctiveConflict } from "./distinctiveAnchors";
import { passesIdentityHardGate } from "./phaseIntegration";

describe("MISSION: Multi-Store Commerce Search (Phases 1-9)", () => {
  // ========== MANDATORY TEST CASES (12) ==========

  describe("MANDATORY TESTS", () => {
    // Test 1: Amazon Query Sanitizer
    it("1_AMAZON_QUERY_SANITIZER: Remove ratings and labels, preserve specs", () => {
      const raw = "Armário Kit Mega 9 Portas 2 Gavetas (4,5 de 5 estrelas) - mais vendido";
      const identity = extractSanitizedIdentity(raw);

      expect(identity.sanitizedQuery).not.toMatch(/avaliações|mais vendido|de 5 estrelas/i);
      expect(identity.sanitizedQuery).toMatch(/Armário|Kit Mega|9 Portas|2 Gavetas/);
      expect(identity.removedNoise.length).toBeGreaterThan(0);
    });

    // Test 2: Amazon Clean Title
    it("2_AMAZON_CLEAN_TITLE: Preserve brand and model", () => {
      const query = "Cozinha Compacta Madesa Emilly Pop Com Armário e Balcão - Rustic";
      const identity = extractSanitizedIdentity(query);

      expect(
        identity.sanitizedQuery.toLowerCase(),
      ).toMatch(/madesa|emilly|pop|rustic/i);
    });

    // Test 3: Amazon Lubeck Identity
    it("3_AMAZON_LUBECK_IDENTITY: Brand conflict detection", () => {
      const query = "Sofá 2 Lugares Retrátil Lubeck Linho Cru";
      const identity = extractSanitizedIdentity(query);

      // Lubeck candidate should pass
      expect(
        passesIdentityHardGate(
          { title: "Sofá Lubeck 2 Lugares Retrátil" },
          identity,
        ),
      ).toBe(true);

      // Beegees should fail (LUBECK_WRONG_MODEL_REJECTED)
      expect(
        passesIdentityHardGate(
          { title: "Sofá Beegees 2 Lugares Retrátil" },
          identity,
        ),
      ).toBe(false);
    });

    // Test 4: ML PS4 Variant
    it("4_ML_PS4_VARIANT: Storage conflict with variant recovery", () => {
      const query = "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos (Recondicionado)";
      const identity = extractSanitizedIdentity(query);

      // 500GB should fail (PS4_500GB_REJECTED)
      expect(
        passesIdentityHardGate(
          { title: "PlayStation 4 PS4 500GB Controles" },
          identity,
        ),
      ).toBe(false);

      // 1TB should pass
      expect(
        passesIdentityHardGate(
          { title: "PlayStation 4 PS4 Slim 1TB 2 Controles" },
          identity,
        ),
      ).toBe(true);
    });

    // Test 5: ML PS4 No False Fallback
    it("5_ML_PS4_NO_FALSE_FALLBACK: Reject incompatible fallback", () => {
      const query = "Console Playstation 4 Ps4 Slim 1 Tb";
      const identity = extractSanitizedIdentity(query);

      // Only 500GB available - should reject
      const result500 = detectDistinctiveConflict(
        identity,
        "PlayStation 4 500GB",
      );
      expect(result500.conflict).toBe(true);
    });

    // Test 6: AliExpress Title Variants
    it("6_ALIEXPRESS_TITLE_VARIANTS: Variant generation handles long titles", () => {
      const query =
        "Wireless Bluetooth Speaker Portable Waterproof with LED Light TF Card AUX";
      const identity = extractSanitizedIdentity(query);
      const variants = buildCommerceSearchPlan(identity);

      expect(variants.length).toBeGreaterThanOrEqual(1);
      expect(variants.length).toBeLessThanOrEqual(3);

      // All variants should preserve critical identity
      for (const variant of variants) {
        expect(variantPreservesCriticalIdentity(variant, identity)).toBe(true);
      }
    });

    // Test 7: MagaLu EDA Non-Regression
    it("7_MAGALU_EDA_NON_REGRESSION: Preserve specs in tool sets", () => {
      const query = "Jogo De Chave Combinada 6 À 19 Mm Com 11 Peças 8tn Eda";
      const identity = extractSanitizedIdentity(query);

      expect(identity.strongIdentity.bundleQuantity).toBe(11);

      // EDA candidate should pass
      const eda = passesIdentityHardGate(
        { title: "Jogo Chave Combinada 6 a 19mm 11 Peças EDA 8TN" },
        identity,
      );
      expect(eda).toBe(true);
    });

    // Test 8: Shopee KIT4 Non-Regression
    it("8_SHOPEE_KIT4_NON_REGRESSION: Preserve bundle quantity", () => {
      const query = "KIT 4 Camisa Térmica Proteção UV 50+";
      const identity = extractSanitizedIdentity(query);

      // Should detect bundle quantity
      expect(identity.strongIdentity.bundleQuantity).toBe(4);

      // Variants should preserve bundle
      const variants = buildCommerceSearchPlan(identity);
      for (const v of variants) {
        if (identity.strongIdentity.bundleQuantity) {
          expect(v.originalText).toMatch(/4|kit/i);
        }
      }
    });

    // Test 9: Gel Non-Regression
    it("9_GEL_NON_REGRESSION: Preserve product class", () => {
      const query = "Gel Dessensibilizante Anestésico Anal Extra Forte Unissex";
      const identity = extractSanitizedIdentity(query);

      expect(identity.descriptiveContext.genericTerms).toContain("gel");
      expect(identity.sanitizedQuery).toMatch(/gel/i);
    });

    // Test 10: Bicycle Non-Regression
    it("10_BICYCLE_NON_REGRESSION: Preserve dimensions and line", () => {
      const query = "Bicicleta Aro 29 GTS Dexter 24 Marchas Quadro 21";
      const identity = extractSanitizedIdentity(query);

      expect(identity.descriptiveContext.genericTerms).toContain("bicicleta");

      // Should detect dimensions
      if (identity.descriptiveContext.dimensions) {
        expect(identity.descriptiveContext.dimensions).toMatch(/aro|quadro/i);
      }
    });

    // Test 11: Aspirador Non-Regression
    it("11_ASPIRADOR_NON_REGRESSION: Preserve voltage and capacity", () => {
      const query = "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V";
      const identity = extractSanitizedIdentity(query);

      expect(identity.strongIdentity.voltage).toMatch(/220v?/i);

      // Should have model code GTW
      expect(identity.strongIdentity.modelCodes).toEqual(
        expect.arrayContaining([expect.stringMatching(/gtw/i)]),
      );
    });

    // Test 12: Deadline Variants
    it("12_DEADLINE_VARIANTS: All variants generateable within budget", () => {
      const queries = [
        "Sofá 2 Lugares Retrátil Lubeck Linho Cru",
        "Cozinha Compacta Madesa Emilly Pop Com Armário e Balcão - Rustic",
        "Jogo De Chave Combinada 6 À 19 Mm Com 11 Peças 8tn Eda",
        "KIT 4 Camisa Térmica Proteção UV 50+",
        "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos",
        "Bicicleta Aro 29 GTS Dexter 24 Marchas Quadro 21",
        "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V",
      ];

      const start = Date.now();

      for (const query of queries) {
        const identity = extractSanitizedIdentity(query);
        const variants = buildCommerceSearchPlan(identity);

        for (const variant of variants) {
          const pass = variantPreservesCriticalIdentity(variant, identity);
          expect(pass).toBe(true);
        }
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000); // 1s to generate all variants
    });
  });

  // ========== LIVE QUERY GATES (9) ==========

  describe("LIVE QUERY GATES", () => {
    // These tests verify the identity logic at query level
    // Actual marketplace results depend on live availability

    it("LUBECK_LIVE: Brand identity preserved", () => {
      const query = "Sofá 2 Lugares Retrátil Lubeck Linho Cru";
      const identity = extractSanitizedIdentity(query);

      expect(identity.strongIdentity.brand?.toLowerCase()).toContain("lubeck");
      expect(identity.sanitizedQuery).toMatch(/lubeck/i);
    });

    it("MADESA_LIVE: Kitchen brand preserved", () => {
      const query = "Cozinha Compacta Madesa Emilly Pop Com Armário e Balcão - Rustic";
      const identity = extractSanitizedIdentity(query);

      expect(identity.strongIdentity.brand?.toLowerCase()).toMatch(/madesa/);
    });

    it("MAGALU_EDA_LIVE: Tool set identity preserved", () => {
      const query = "Jogo De Chave Combinada 6 À 19 Mm Com 11 Peças 8tn Eda";
      const identity = extractSanitizedIdentity(query);

      expect(identity.strongIdentity.bundleQuantity).toBe(11);
    });

    it("SHOPEE_KIT4_LIVE: Bundle quantity detection", () => {
      const query = "KIT 4 Camisa Térmica Proteção UV 50+";
      const identity = extractSanitizedIdentity(query);

      expect(identity.strongIdentity.bundleQuantity).toBe(4);
    });

    it("PS4_LIVE: Storage specification critical", () => {
      const query = "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos (Recondicionado)";
      const identity = extractSanitizedIdentity(query);

      expect(identity.strongIdentity.storage).toMatch(/1\s*tb/i);
      expect(identity.strongIdentity.condition).toBe("refurbished");
    });

    it("PS4_1TB_FOUND: 1TB variant should be acceptable", () => {
      const query = "Console Playstation 4 Ps4 Slim 1 Tb 2controles";
      const identity = extractSanitizedIdentity(query);

      const compat = passesIdentityHardGate(
        { title: "PlayStation 4 PS4 Slim 1TB 2 Controles" },
        identity,
      );
      expect(compat).toBe(true);
    });

    it("PS4_500GB_REJECTED: 500GB fallback should be rejected", () => {
      const query = "Console Playstation 4 Ps4 Slim 1 Tb";
      const identity = extractSanitizedIdentity(query);

      const conflict = passesIdentityHardGate(
        { title: "PlayStation 4 500GB" },
        identity,
      );
      expect(conflict).toBe(false);
    });

    it("GEL_LIVE: Product class preserved", () => {
      const query = "Gel Dessensibilizante Anestésico Anal Extra Forte Unissex";
      const identity = extractSanitizedIdentity(query);

      expect(identity.descriptiveContext.genericTerms).toContain("gel");
    });

    it("BICYCLE_LIVE: Dimensions and line preserved", () => {
      const query = "Bicicleta Aro 29 GTS Dexter 24 Marchas Quadro 21";
      const identity = extractSanitizedIdentity(query);

      expect(identity.descriptiveContext.genericTerms).toContain("bicicleta");
    });
  });

  // ========== DEADLINE COMPLIANCE ==========

  describe("DEADLINE COMPLIANCE", () => {
    it("GLOBAL_DEADLINE_COMPLIANT: Processing within 20s budget", () => {
      const queries = [
        "Sofá 2 Lugares Retrátil Lubeck Linho Cru",
        "Jogo De Chave Combinada 6 À 19 Mm Com 11 Peças 8tn Eda",
        "Console Playstation 4 Ps4 Slim 1 Tb 2controles",
        "Bicicleta Aro 29 GTS Dexter 24 Marchas Quadro 21",
        "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V",
      ];

      const start = Date.now();

      for (const query of queries) {
        const identity = extractSanitizedIdentity(query);
        const variants = buildCommerceSearchPlan(identity);

        for (const variant of variants) {
          // Simulate candidate checking
          detectDistinctiveConflict(
            identity,
            "Sample candidate title for conflict checking",
          );
        }
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(20000); // 20s global budget
    });

    it("HARD_WALL_21S: Never exceed 21s absolute limit", () => {
      const start = Date.now();

      // Intensive variant + conflict checking
      for (let i = 0; i < 100; i++) {
        const identity = extractSanitizedIdentity("Sample query");
        const variants = buildCommerceSearchPlan(identity);

        for (const variant of variants) {
          detectDistinctiveConflict(identity, `Candidate title ${i}`);
        }
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(21000); // 21s hard wall
    });
  });
});
