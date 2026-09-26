/**
 * CATALOG_ARCHITECTURE_V1 — CROSS-MARKET MATCHING TEST (FASE 8 / FASE K, L, M).
 *
 * Provas:
 *   - hard conflict DERROTA similaridade textual alta (256GB != 512GB, etc.);
 *   - candidate generation NUNCA compara o catalogo inteiro;
 *   - GTIN igual + coerencia => EXACT; evidencia fraca => REVIEW;
 *   - par do mesmo marketplace nao e cross-market.
 */
import assert from "node:assert/strict";

import {
  buildEvidenceIndex,
  classifyCrossMarketPair,
  detectHardConflicts,
  matchCrossMarket,
  textSimilarity,
  EXACT_TEXT_SIMILARITY,
} from "./crossMarketMatching";
import { buildFakeListing } from "../fake/fakeConnectors";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";

function main() {
  /* --- 256GB != 512GB: hard conflict vence texto identico --------------- */
  {
    const left = buildFakeListing({
      marketplaceId: "mercado_livre",
      externalListingId: "ml-1",
      identity: { brand: "Samsung", model: "Galaxy A54" },
      catalog: { title: "Samsung Galaxy A54 5G 256GB 8GB RAM Dual SIM" },
      variant: { storage: "256GB" },
      commerce: { price: 1999 },
    });
    const right = buildFakeListing({
      marketplaceId: "shopee",
      externalListingId: "sp-1",
      identity: { brand: "Samsung", model: "Galaxy A54" },
      catalog: { title: "Samsung Galaxy A54 5G 256GB 8GB RAM Dual SIM" },
      variant: { storage: "512GB" },
      commerce: { price: 2100 },
    });

    const conflicts = detectHardConflicts(left, right);
    assert.ok(
      conflicts.some((c) => c.kind === "STORAGE_MISMATCH"),
      "256GB vs 512GB e hard conflict",
    );
    const similarity = textSimilarity(left, right);
    assert.ok(
      similarity >= EXACT_TEXT_SIMILARITY,
      `titulos praticamente iguais: similaridade=${similarity}`,
    );
    const result = classifyCrossMarketPair(left, right);
    assert.equal(
      result.decision,
      "REJECT",
      "hard conflict derrota similaridade textual alta",
    );
    assert.ok(result.hardConflicts.length > 0);
  }

  /* --- 127V != 220V ------------------------------------------------------ */
  {
    const left = buildFakeListing({
      marketplaceId: "mercado_livre",
      externalListingId: "ml-v1",
      identity: { brand: "Philco", model: "Ventilador" },
      catalog: { title: "Ventilador Philco Ventisol 127V" },
      variant: { voltage: "127V" },
      commerce: { price: 199 },
    });
    const right = buildFakeListing({
      marketplaceId: "shopee",
      externalListingId: "sp-v1",
      identity: { brand: "Philco", model: "Ventilador" },
      catalog: { title: "Ventilador Philco Ventisol 127V" },
      variant: { voltage: "220V" },
      commerce: { price: 189 },
    });
    const result = classifyCrossMarketPair(left, right);
    assert.ok(
      result.hardConflicts.some((c) => c.kind === "VOLTAGE_MISMATCH"),
      "127V vs 220V e hard conflict",
    );
    assert.equal(result.decision, "REJECT");
  }

  /* --- 43 polegadas != 50 polegadas ------------------------------------- */
  {
    const left = buildFakeListing({
      marketplaceId: "mercado_livre",
      externalListingId: "ml-t1",
      identity: { brand: "Samsung", model: "SmartTV" },
      catalog: { title: "Samsung Smart TV 43 polegadas 4K" },
      variant: { size: "43 polegadas" },
      commerce: { price: 2199 },
    });
    const right = buildFakeListing({
      marketplaceId: "shopee",
      externalListingId: "sp-t1",
      identity: { brand: "Samsung", model: "SmartTV" },
      catalog: { title: "Samsung Smart TV 43 polegadas 4K" },
      variant: { size: "50 polegadas" },
      commerce: { price: 2999 },
    });
    const result = classifyCrossMarketPair(left, right);
    assert.ok(
      result.hardConflicts.some((c) => c.kind === "SIZE_MISMATCH"),
      "43\" vs 50\" e hard conflict",
    );
    assert.equal(result.decision, "REJECT");
  }

  /* --- Conflictos detectados pelo TITULO (eixo nao estruturado) ---------- */
  {
    const left = buildFakeListing({
      marketplaceId: "mercado_livre",
      externalListingId: "ml-t2",
      identity: { brand: "Generic", model: "Fone" },
      catalog: { title: "Fone Bluetooth 256GB 127V" },
      commerce: { price: 99 },
    });
    const right = buildFakeListing({
      marketplaceId: "shopee",
      externalListingId: "sp-t2",
      identity: { brand: "Generic", model: "Fone" },
      catalog: { title: "Fone Bluetooth 512GB 127V" },
      commerce: { price: 99 },
    });
    const result = classifyCrossMarketPair(left, right);
    assert.equal(
      result.decision,
      "REJECT",
      "256GB vs 512GB no titulo tambem e hard conflict",
    );
  }

  /* --- Modelo A != Modelo B --------------------------------------------- */
  {
    const left = buildFakeListing({
      marketplaceId: "mercado_livre",
      externalListingId: "ml-m1",
      identity: { brand: "Xiaomi", model: "Redmi Note 12" },
      catalog: { title: "Xiaomi Redmi Note 12 128GB" },
      commerce: { price: 999 },
    });
    const right = buildFakeListing({
      marketplaceId: "shopee",
      externalListingId: "sp-m1",
      identity: { brand: "Xiaomi", model: "Redmi Note 13" },
      catalog: { title: "Xiaomi Redmi Note 13 128GB" },
      commerce: { price: 1099 },
    });
    const result = classifyCrossMarketPair(left, right);
    assert.equal(result.decision, "REJECT");
  }

  /* --- GTIN igual => EXACT ---------------------------------------------- */
  {
    const left = buildFakeListing({
      marketplaceId: "mercado_livre",
      externalListingId: "ml-g1",
      identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
      catalog: { title: "Smartphone Nova X 256GB" },
      variant: { storage: "256GB" },
      commerce: { price: 1999.9 },
    });
    const right = buildFakeListing({
      marketplaceId: "shopee",
      externalListingId: "sp-g1",
      identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
      catalog: { title: "Smartphone Nova X 256GB" },
      variant: { storage: "256GB" },
      commerce: { price: 1959.9 },
    });
    const result = classifyCrossMarketPair(left, right);
    assert.equal(result.decision, "EXACT", "mesmo GTIN e mesma variante => EXACT");
    assert.ok(result.evidence.some((e) => e.kind === "GTIN"));
    assert.equal(result.hardConflicts.length, 0);
  }

  /* --- GTIN diferente => REJECT mesmo com texto identico ---------------- */
  {
    const left = buildFakeListing({
      marketplaceId: "mercado_livre",
      externalListingId: "ml-g2",
      identity: { gtin: ["1111111111111"], brand: "Nova", model: "Nova X" },
      catalog: { title: "Smartphone Nova X 256GB" },
      variant: { storage: "256GB" },
      commerce: { price: 1999.9 },
    });
    const right = buildFakeListing({
      marketplaceId: "shopee",
      externalListingId: "sp-g2",
      identity: { gtin: ["2222222222222"], brand: "Nova", model: "Nova X" },
      catalog: { title: "Smartphone Nova X 256GB" },
      variant: { storage: "256GB" },
      commerce: { price: 1959.9 },
    });
    const result = classifyCrossMarketPair(left, right);
    assert.equal(result.decision, "REJECT", "GTIN diferente e hard conflict");
  }

  /* --- Sem evidencia => REJECT (fail-closed, nunca "achismo") ----------- */
  {
    const left = buildFakeListing({
      marketplaceId: "mercado_livre",
      externalListingId: "ml-n1",
      identity: { gtin: [], brand: null, model: null },
      catalog: { title: "Produto qualquer" },
      commerce: { price: 10 },
    });
    const right = buildFakeListing({
      marketplaceId: "shopee",
      externalListingId: "sp-n1",
      identity: { gtin: [], brand: null, model: null },
      catalog: { title: "Produto qualquer" },
      commerce: { price: 10 },
    });
    const result = classifyCrossMarketPair(left, right);
    assert.equal(result.decision, "REJECT", "sem evidencia nunca vira EXACT");
  }

  /* --- Mesmo marketplace => nao e cross-market --------------------------- */
  {
    const a = buildFakeListing({
      marketplaceId: "shopee",
      externalListingId: "x1",
      identity: { gtin: ["9999999999999"], brand: "Nova", model: "X" },
      catalog: { title: "Nova X 256GB" },
      commerce: { price: 10 },
    });
    const b = buildFakeListing({
      marketplaceId: "shopee",
      externalListingId: "x2",
      identity: { gtin: ["9999999999999"], brand: "Nova", model: "X" },
      catalog: { title: "Nova X 256GB" },
      commerce: { price: 11 },
    });
    assert.equal(classifyCrossMarketPair(a, b).decision, "REJECT");
  }

  /* --- Candidate generation por evidencia (nao cartesiano) --------------- */
  {
    const listings: NormalizedMarketplaceListingV1[] = [
      buildFakeListing({
        marketplaceId: "mercado_livre",
        externalListingId: "m1",
        identity: { gtin: ["1111111111111"], brand: "A", model: "A1" },
        catalog: { title: "Produto A1" },
        commerce: { price: 10 },
      }),
      buildFakeListing({
        marketplaceId: "shopee",
        externalListingId: "s1",
        identity: { gtin: ["1111111111111"], brand: "A", model: "A1" },
        catalog: { title: "Produto A1" },
        commerce: { price: 11 },
      }),
      // Sem nenhuma evidencia em comum: NUNCA vira candidato.
      buildFakeListing({
        marketplaceId: "amazon",
        externalListingId: "a1",
        identity: { gtin: [], brand: null, model: null },
        catalog: { title: "Produto totalmente diferente" },
        commerce: { price: 12 },
      }),
    ];
    const index = buildEvidenceIndex(listings);
    const results = matchCrossMarket(listings);
    const keys = results.map((r) => `${r.leftKey}|${r.rightKey}`).sort();
    assert.equal(
      results.length,
      1,
      `apenas o par com evidencia e candidato (obtido: ${keys.join(", ")})`,
    );
    assert.equal(results[0].decision, "EXACT");
    for (const result of results) {
      assert.notEqual(
        result.leftMarketplaceId,
        result.rightMarketplaceId,
        "pares cross-market sao sempre de marketplaces distintos",
      );
    }
    assert.ok(index.size > 0, "indice de evidencia foi construido");
  }

  console.log("crossMarketMatching.test.ts PASS");
}

main();
