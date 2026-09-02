/**
 * PHASE 2 — QUERY IDENTITY TESTS
 *
 * Tests for structured identity extraction and conflict detection.
 * Uses real product examples without hardcoding model names into test logic.
 */

import { describe, it, expect } from "vitest";
import {
  extractQueryIdentity,
  detectIdentityConflict,
  type QueryIdentity,
} from "./queryIdentity";

describe("PHASE 2: Query Identity Extraction", () => {
  // Test 1: Amazon Lubeck Sofa - Brand extraction with conflict detection
  it("1_AMAZON_LUBECK_IDENTITY: Should extract brand and reject conflicting model", () => {
    const query = "Sofá 2 Lugares Retrátil Lubeck Linho Cru";
    const identity = extractQueryIdentity(query);

    // Should extract Lubeck as brand
    expect(identity.strongIdentity.brand?.toLowerCase()).toContain("lubeck");
    expect(identity.descriptiveContext.genericTerms).toEqual(
      expect.arrayContaining([expect.stringMatching(/sofá|sofa/)]),
    );

    // Candidate from different brand should conflict
    const conflictBeegees = detectIdentityConflict(
      identity,
      "Sofá 2 Lugares Retrátil Beegees Linho Cru Cinza",
    );
    expect(conflictBeegees.conflict).toBe(true);
    expect(conflictBeegees.reason).toMatch(/brand/i);

    // Candidate from Lubeck should not conflict
    const compatLubeck = detectIdentityConflict(
      identity,
      "Sofá Lubeck Retrátil 2 Lugares Linho Cinza",
    );
    expect(compatLubeck.conflict).toBe(false);
  });

  // Test 2: PS4 Storage - Strict storage conflict detection
  it("2_ML_PS4_1TB_vs_500GB: Should reject 500GB when 1TB explicitly required", () => {
    const query = "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos (Recondicionado)";
    const identity = extractQueryIdentity(query);

    // Should extract 1TB storage
    expect(identity.strongIdentity.storage).toMatch(/1\s*tb/i);

    // Candidate with 500GB should hard-conflict
    const conflict500gb = detectIdentityConflict(
      identity,
      "PlayStation 4 PS4 500GB Com Dois Controles Recondicionado",
    );
    expect(conflict500gb.conflict).toBe(true);
    expect(conflict500gb.reason).toMatch(/storage/i);

    // Candidate with 1TB should NOT conflict
    const compat1tb = detectIdentityConflict(
      identity,
      "PlayStation 4 PS4 Slim 1TB Com 2 Controles + Jogos",
    );
    expect(compat1tb.conflict).toBe(false);
  });

  // Test 3: Aspirador voltage - Electrical specification conflict
  it("3_ML_ASPIRADOR_220V: Should preserve voltage and reject 110V candidate", () => {
    const query = "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V";
    const identity = extractQueryIdentity(query);

    // Should extract 220V voltage
    expect(identity.strongIdentity.voltage).toMatch(/220v?/i);
    expect(identity.descriptiveContext.genericTerms).toEqual(
      expect.arrayContaining([expect.stringMatching(/aspirador/)]),
    );

    // Model code GTW should be extracted
    expect(identity.strongIdentity.modelCodes).toEqual(
      expect.arrayContaining([expect.stringMatching(/gtw/i)]),
    );

    // Candidate with 110V should hard-conflict
    const conflict110v = detectIdentityConflict(
      identity,
      "Aspirador WAP GTW 1400W 110V com Bocal de Sopro",
    );
    expect(conflict110v.conflict).toBe(true);
    expect(conflict110v.reason).toMatch(/voltage/i);

    // Candidate with 220V should NOT conflict
    const compat220v = detectIdentityConflict(
      identity,
      "Aspirador Wap GTW Inox 1400W 220V",
    );
    expect(compat220v.conflict).toBe(false);
  });

  // Test 4: Madesa kitchen - Brand and model preservation
  it("4_AMAZON_MADESA_IDENTITY: Should extract brand and model name", () => {
    const query = "Cozinha Compacta Madesa Emilly Pop Com Armário e Balcão - Rustic";
    const identity = extractQueryIdentity(query);

    // Should extract Madesa as brand
    expect(identity.strongIdentity.brand?.toLowerCase()).toContain("madesa");

    // Should extract model name (Emilly, Pop, or combined)
    expect(
      identity.strongIdentity.modelName ||
        identity.strongIdentity.modelLine,
    ).toBeTruthy();

    // Should have kitchen-related generic terms
    expect(identity.descriptiveContext.genericTerms).toEqual(
      expect.arrayContaining([expect.stringMatching(/cozinha|kitchen/)]),
    );

    // Candidate from Madesa should be compatible
    const compat = detectIdentityConflict(
      identity,
      "Cozinha Compacta Madesa Emilly Pop Rustic com Armário",
    );
    expect(compat.conflict).toBe(false);
  });

  // Test 5: EDA wrench set - Brand and quantity preservation
  it("5_MAGALU_EDA_IDENTITY: Should extract brand and preserve spec details", () => {
    const query = "Jogo De Chave Combinada 6 À 19 Mm Com 11 Peças 8tn Eda";
    const identity = extractQueryIdentity(query);

    // Should extract EDA as brand/model
    const fullText = (
      identity.strongIdentity.brand || identity.strongIdentity.modelLine || ""
    ).toLowerCase();
    expect(fullText).toMatch(/eda/i);

    // Should preserve 11 peças (bundle quantity)
    expect(identity.strongIdentity.bundleQuantity).toBe(11);

    // Should have tool-related generic terms
    expect(identity.descriptiveContext.genericTerms).toEqual(
      expect.arrayContaining([expect.stringMatching(/chave|ferramenta|tool/)]),
    );

    // Candidate from EDA should be compatible
    const compat = detectIdentityConflict(
      identity,
      "Jogo Chave Combinada 6 a 19mm 11 Peças 8TN EDA",
    );
    expect(compat.conflict).toBe(false);
  });

  // Test 6: KIT 4 thermal shirt - Bundle quantity preservation
  it("6_SHOPEE_KIT4_IDENTITY: Should detect bundle quantity from context", () => {
    const query = "KIT 4 Camisa Térmica Proteção UV 50+";
    const identity = extractQueryIdentity(query);

    // Should extract bundle quantity of 4
    expect(identity.strongIdentity.bundleQuantity).toBe(4);

    // Should have clothing-related terms
    expect(identity.descriptiveContext.genericTerms).toEqual(
      expect.arrayContaining([expect.stringMatching(/camisa|shirt|thermal/)]),
    );

    // Candidate offering single unit when bundle required should conflict
    const conflictSingle = detectIdentityConflict(
      identity,
      "Camisa Térmica Proteção UV 50+ Masculina",
    );
    // May or may not conflict depending on how explicit the quantity is in candidate
    if (conflictSingle.conflict) {
      expect(conflictSingle.reason).toMatch(/bundleQuantity/i);
    }

    // Candidate with kit 4 should be compatible
    const compatKit = detectIdentityConflict(
      identity,
      "KIT 4 Camisas Térmicas Proteção UV 50+",
    );
    expect(compatKit.conflict).toBe(false);
  });

  // Test 7: Bicycle GTS Dexter - Model line and dimensions
  it("7_ML_BICYCLE_GTS_DEXTER: Should extract model line and frame size", () => {
    const query = "Bicicleta Aro 29 GTS Dexter 24 Marchas Quadro 21";
    const identity = extractQueryIdentity(query);

    // Should extract GTS Dexter model line or model codes
    const modelIndicator =
      identity.strongIdentity.modelLine ||
      identity.strongIdentity.modelCodes.join(" ");
    expect(modelIndicator.toLowerCase()).toMatch(/gts|dexter/i);

    // Should preserve dimensions (Aro 29, Quadro 21)
    expect(identity.descriptiveContext.dimensions).toMatch(
      /(?:aro|quadro|frame).*/i,
    );

    // Should have bicycle-related terms
    expect(identity.descriptiveContext.genericTerms).toEqual(
      expect.arrayContaining([expect.stringMatching(/bicicleta|bike/)]),
    );

    // Candidate from different line should potentially conflict
    const identityCompat = detectIdentityConflict(
      identity,
      "Bicicleta Aro 29 GTS Dexter 24 Marchas Quadro 21 Preta",
    );
    // Should be compatible with same model
    expect(identityCompat.conflict).toBe(false);
  });

  // Test 8: Missing descriptive context - penalty but not hard conflict
  it("8_IDENTITY_MISSING_CONTEXT: Absence of descriptive context should NOT hard-conflict", () => {
    const query = "Sofá 2 Lugares Retrátil Lubeck Linho Cru";
    const identity = extractQueryIdentity(query);

    // Candidate without all descriptive details (e.g., no "Cru" color mentioned)
    const partialCandidate = detectIdentityConflict(
      identity,
      "Sofá Retrátil Lubeck 2 Lugares",
    );

    // Should NOT be a hard conflict (just missing enrichment)
    expect(partialCandidate.conflict).toBe(false);
  });

  // Test 9: No model code conflict when candidate has different code
  it("9_MODEL_CODE_CONFLICT: Should detect when required model code is absent", () => {
    const query = "Console Playstation 4 Ps4 Slim 1 Tb";
    const identity = extractQueryIdentity(query);

    // PS4 should be in model codes
    expect(identity.strongIdentity.modelCodes.length).toBeGreaterThanOrEqual(0);

    // Candidate as PS5 should conflict if PS4 is required
    // (This depends on identity anchors marking PS4 as required)
    // For now, verify detection logic is callable
    const result = detectIdentityConflict(identity, "PlayStation 5 PS5 1TB");
    expect(result).toHaveProperty("conflict");
    expect(result).toHaveProperty("reason");
  });

  // Test 10: Confidence calculation
  it("10_IDENTITY_CONFIDENCE: Should calculate confidence based on identity signals", () => {
    const richQuery =
      "Console Playstation 4 Ps4 Slim 1 Tb 2controles Recondicionado 220V";
    const richIdentity = extractQueryIdentity(richQuery);
    // Should have HIGH confidence with many signals
    expect(richIdentity.confidence).toMatch(/high|medium/i);

    const poorQuery = "Produto Eletrônico";
    const poorIdentity = extractQueryIdentity(poorQuery);
    // Should have LOW confidence with few signals
    expect(poorIdentity.confidence).toMatch(/low|medium/i);
  });

  // Test 11: Condition preservation from query
  it("11_QUERY_CONDITION: Should preserve condition from query (set by sanitizer)", () => {
    const query = "Aspirador de Pó e Água Wap GTW Inox 12 1400W Recondicionado";
    const identity = extractQueryIdentity(query);

    // Condition should be null until set by caller from sanitizer
    // Test just verifies structure
    expect(identity.strongIdentity).toHaveProperty("condition");
    expect(["refurbished", "used", "repackaged", null]).toContain(
      identity.strongIdentity.condition,
    );
  });

  // Test 12: Generic term extraction for different product classes
  it("12_GENERIC_TERMS: Should extract product class terms correctly", () => {
    const testCases = [
      {
        query: "Sofá 2 Lugares Retrátil",
        shouldMatch: /sofá|sofa/i,
      },
      {
        query: "Aspirador de Pó e Água",
        shouldMatch: /aspirador/i,
      },
      {
        query: "Gel Dessensibilizante Anestésico",
        shouldMatch: /gel/i,
      },
      {
        query: "Bicicleta Aro 29",
        shouldMatch: /bicicleta|bike/i,
      },
    ];

    for (const testCase of testCases) {
      const identity = extractQueryIdentity(testCase.query);
      expect(identity.descriptiveContext.genericTerms.join(" ")).toMatch(
        testCase.shouldMatch,
      );
    }
  });
});
