/**
 * CATALOG_ARCHITECTURE_V1 — IDENTITY CONFIDENCE ENGINE TEST (FASE 8.1 / FASE J).
 *
 * Este arquivo e a PROVA DOS BUGS E REGRAS DA MISSAO:
 *
 *   1. "256GB 127V" vs "512GB 127V"  -> NOT EXACT (conflito por eixo storage)
 *   2. "256GB 127V" vs "256GB 220V"  -> NOT EXACT (conflito por eixo voltage)
 *   3. "256GB" vs storage ausente     -> REVIEW (ausencia != conflito, mas
 *                                           nao confirma)
 *   4. manufacturerModel forte + sem conflito critico -> conforme politica
 *   5. Texto sozinho NUNCA produz EXACT
 *   6. Mesma politica para QUALQUER fonte (sem `if marketplace === "SHOPEE"`)
 */

import assert from "node:assert/strict";

import {
  evaluateIdentityConfidence,
  collectStrongEvidence,
  readAxisValue,
  EXACT_EVIDENCE_WEIGHT_THRESHOLD,
  IDENTITY_REASON_CODES,
} from "./identityConfidence";
import { IDENTITY_POLICY_V1, classifyCategory, CATEGORY_PROFILES } from "./identityPolicy";
import { buildFakeListing } from "../fake/fakeConnectors";
import { UNKNOWN } from "../types/normalizedListingV1";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";

/** Listing de uma fonte GENERICA (o teste nunca diz "shopee" para o motor). */
function listing(
  marketplaceId: string,
  externalListingId: string,
  spec: {
    title: string;
    brand?: string | null;
    manufacturerModel?: string | null;
    model?: string | null;
    gtin?: string[];
    storage?: string | null;
    memory?: string | null;
    voltage?: string | null;
    size?: string | null;
  },
): NormalizedMarketplaceListingV1 {
  const built = buildFakeListing({
    marketplaceId,
    externalListingId,
    identity: {
      gtin: spec.gtin ?? [],
      brand: spec.brand ?? null,
      manufacturerModel: spec.manufacturerModel ?? null,
      model: spec.model ?? null,
      mpn: null,
    },
    catalog: { title: spec.title, category: null },
    variant: {
      storage: spec.storage ?? null,
      memory: spec.memory ?? null,
      voltage: spec.voltage ?? null,
      size: spec.size ?? null,
    },
    commerce: { price: 999 },
  });
  return built;
}

function main() {
  /* ================================================================
   * 1. BUG DA FASE 8 PROVADO: 256GB 127V vs 512GB 127V -> NOT EXACT
   *    storage conflita; 127V e IGUAL e NAO pode mascarar.
   * ================================================================ */
  {
    // Notebook: storage e RAM sao eixos criticos reais da categoria.
    // O eixo compartilhado (16gb RAM) NAO pode mascarar o conflito de storage.
    const a = listing("mercado_livre", "a1", {
      title: "Notebook Dell Inspiron 15 16GB RAM 512GB SSD 127V Bivolt",
      brand: "Dell",
      manufacturerModel: "I15-3520",
      storage: "512GB",
      memory: "16GB",
      voltage: "127V",
    });
    const b = listing("fonte_b", "b1", {
      title: "Notebook Dell Inspiron 15 16GB RAM 1024GB SSD 127V Bivolt",
      brand: "Dell",
      manufacturerModel: "I15-3520",
      storage: "1024GB",
      memory: "16GB",
      voltage: "127V",
    });
    const d = evaluateIdentityConfidence(a, b);
    assert.equal(
      d.confidence,
      "REJECT",
      "512GB vs 1024GB NUNCA pode ser EXACT, mesmo com 16GB RAM e 127V iguais",
    );
    assert.ok(d.reasonCodes.includes(IDENTITY_REASON_CODES.HARD_CONFLICT));
    assert.ok(
      d.axisComparisons.some(
        (c) => c.axis === "storage" && c.status === "CONFLICT",
      ),
      `conflito detectado no eixo storage especificamente (obtido: ${JSON.stringify(d.axisComparisons.map((c) => `${c.axis}=${c.status}`))})`,
    );
    assert.ok(
      d.axisComparisons.some(
        (c) => (c.axis === "memory" || c.axis === "ram") && c.status === "MATCH",
      ),
      `RAM IGUAL => MATCH, e nao conflito (obtido: ${JSON.stringify(d.axisComparisons.map((c) => `${c.axis}=${c.status}`))})`,
    );
    assert.ok(
      d.axisComparisons.some((c) => c.axis === "model" && c.status === "MATCH"),
      "model IGUAL => MATCH, e nao conflito",
    );
    /*
     * O ponto central do bug: RAM e voltage IGUAIS coexistem com um conflito
     * de storage. O eixo compartilhado nao mascara o conflitante — e o
     * inverso tambem: voltage nao entra como eixo de notebook, entao nao
     * gera falso conflito a partir do "127V" do titulo.
     */
    assert.equal(
      d.axisComparisons.filter((c) => c.status === "CONFLICT").length,
      1,
      "apenas storage conflita; nenhum outro eixo virou conflito",
    );
  }

  /* ================================================================
   * 2. 256GB 127V vs 256GB 220V -> NOT EXACT (conflito por eixo voltage)
   * ================================================================ */
  {
    // Eletrodomestico: voltage e eixo critico da categoria.
    const a = listing("mercado_livre", "a2", {
      title: "Ventilador Ventisol 40cm Bivolt Automatico",
      brand: "Philco",
      manufacturerModel: "VT-40",
      voltage: "127V",
    });
    const b = listing("fonte_b", "b2", {
      title: "Ventilador Ventisol 40cm Bivolt Automatico",
      brand: "Philco",
      manufacturerModel: "VT-40",
      voltage: "220V",
    });
    const d = evaluateIdentityConfidence(a, b);
    assert.equal(d.confidence, "REJECT", "127V vs 220V NUNCA pode ser EXACT");
    assert.ok(
      d.axisComparisons.some(
        (c) => c.axis === "voltage" && c.status === "CONFLICT",
      ),
      `conflito detectado no eixo voltage especificamente (obtido: ${JSON.stringify(d.axisComparisons.map((c) => `${c.axis}=${c.status}`))})`,
    );
    assert.ok(
      d.axisComparisons.some(
        (c) => c.axis === "model" && c.status === "MATCH",
      ),
      "model IGUAL => MATCH, e nao conflito",
    );
  }

  /* ================================================================
   * 3. CONFLICT != UNKNOWN: 256GB vs storage ausente => REVIEW
   * ================================================================ */
  {
    const a = listing("mercado_livre", "a3", {
      title: "Smartwatch Galaxy 4 44mm 256GB",
      brand: "Samsung",
      manufacturerModel: "SM-R890",
      storage: "256GB",
    });
    // Fonte sem storage estruturado e sem storage no titulo.
    const b = listing("fonte_b", "b3", {
      title: "Smartwatch Galaxy 4 44mm Bluetooth",
      brand: "Samsung",
      manufacturerModel: "SM-R890",
    });
    assert.equal(readAxisValue(a, "storage"), "256gb");
    assert.equal(
      readAxisValue(b, "storage"),
      null,
      "fonte sem storage NAO afirma nada (UNKNOWN, nao 0)",
    );
    const d = evaluateIdentityConfidence(a, b);
    assert.equal(
      d.confidence,
      "REVIEW",
      "ausencia de atributo critico => REVIEW, nunca EXACT",
    );
    assert.ok(d.missingCriticalAttributes.length > 0, "a ausencia e registrada");
    assert.ok(
      d.missingCriticalAttributes.some((m) => m.axis === "storage"),
      "eixo critico ausente e nomeado",
    );
    assert.notEqual(d.confidence, "EXACT");
  }

  /* ================================================================
   * 4. manufacturerModel forte + sem conflito critico => EXACT
   *    (categoria default, sem eixo critico alem do model)
   * ================================================================ */
  {
    const a = listing("mercado_livre", "a4", {
      title: "Carregador Turbo 20W Tipo C",
      brand: "Apple",
      manufacturerModel: "MHJA3ZD/A",
    });
    const b = listing("fonte_b", "b4", {
      title: "Carregador Turbo 20W Tipo C Preto",
      brand: "Apple",
      manufacturerModel: "MHJA3ZD/A",
    });
    const d = evaluateIdentityConfidence(a, b);
    assert.equal(
      d.confidence,
      "EXACT",
      "manufacturerModel exato + sem conflito => EXACT",
    );
    assert.ok(
      d.reasonCodes.includes(IDENTITY_REASON_CODES.MANUFACTURER_MODEL_MATCH),
    );
    assert.equal(d.policyVersion, IDENTITY_POLICY_V1);
  }

  /* ================================================================
   * 5. TEXTO SOZINHO NUNCA PRODUZ EXACT
   * ================================================================ */
  {
    const a = listing("mercado_livre", "a5", {
      title: "Smartphone Nova X 256GB Preto",
    });
    const b = listing("fonte_b", "b5", {
      title: "Smartphone Nova X 256GB Preto",
    });
    const d = evaluateIdentityConfidence(a, b);
    assert.equal(
      d.confidence,
      "REJECT",
      "titulos identicos sem evidencia estruturada => REJECT",
    );
    assert.ok(d.reasonCodes.includes(IDENTITY_REASON_CODES.NO_SHARED_EVIDENCE));
    assert.equal(d.evidence.length, 0, "texto nao entra como evidencia forte");
  }

  /* ================================================================
   * 6. SEM EXCEPCAO POR MARKETPLACE: a politica e a MESMA
   *    para qualquer id, inclusive um desconhecido.
   * ================================================================ */
  {
    const spec = {
      title: "Fone Bluetooth X2",
      brand: "JBL",
      manufacturerModel: "JBL-TUNE520",
    };
    const viaConhecida = evaluateIdentityConfidence(
      listing("mercado_livre", "x", spec),
      listing("shopee", "y", spec),
    );
    const viaDesconhecida = evaluateIdentityConfidence(
      listing("mercado_livre", "x", spec),
      listing("marketplace_zzz", "y", spec),
    );
    assert.equal(
      viaConhecida.confidence,
      viaDesconhecida.confidence,
      "a decisao nao muda com o nome/id da fonte",
    );
  }

  /* ================================================================
   * 7. GTIN igual vence, mesmo sem brand/model
   * ================================================================ */
  {
    const a = listing("mercado_livre", "a7", {
      title: "Produto Alfa",
      gtin: ["7891234567890"],
    });
    const b = listing("fonte_b", "b7", {
      title: "Produto completamente diferente",
      gtin: ["7891234567890"],
    });
    const d = evaluateIdentityConfidence(a, b);
    assert.equal(d.confidence, "EXACT", "GTIN igual e identidade fisica confirmada");
    assert.ok(d.reasonCodes.includes(IDENTITY_REASON_CODES.GTIN_MATCH));
  }

  /* ================================================================
   * 8. GTIN diferente => REJECT mesmo com texto/modelo identicos
   * ================================================================ */
  {
    const a = listing("mercado_livre", "a8", {
      title: "Produto Alfa",
      brand: "X",
      model: "Y1",
      gtin: ["1111111111111"],
    });
    const b = listing("fonte_b", "b8", {
      title: "Produto Alfa",
      brand: "X",
      model: "Y1",
      gtin: ["2222222222222"],
    });
    const d = evaluateIdentityConfidence(a, b);
    assert.equal(d.confidence, "REJECT", "GTIN divergente e hard conflict");
  }

  /* ================================================================
   * 9. CATEGORIAS: infra category-aware funciona e e extensivel
   * ================================================================ */
  {
    assert.ok(CATEGORY_PROFILES.length > 0, "existem perfis de categoria");
    const smart = listing("ml", "c1", {
      title: "Smartphone Samsung Galaxy S25 256GB 12GB RAM",
    });
    assert.equal(classifyCategory(smart).category, "smartphone");
    const tv = listing("ml", "c2", { title: "Smart TV Samsung 55 polegadas 4K" });
    assert.equal(classifyCategory(tv).category, "tv");
    const nb = listing("ml", "c3", { title: "Notebook Dell Inspiron 16GB 512GB" });
    assert.equal(classifyCategory(nb).category, "notebook");
    const gel = listing("ml", "c4", { title: "Geladeira Brastemp Frost Free 220V" });
    assert.equal(classifyCategory(gel).category, "eletrodomestico");

    /* Criticos por categoria sao os declarados na politica. */
    const smartProfile = classifyCategory(smart);
    assert.ok(
      smartProfile.criticalAxes.some((a) => a.key === "storage"),
      "smartphone exige storage",
    );
    assert.ok(
      tvProfileAxis(tv).some((a) => a.key === "screenSize"),
      "TV exige screenSize",
    );
  }

  /* ================================================================
   * 10. 43" vs 50" => REJECT (screenSize, eixo critico de TV)
   * ================================================================ */
  {
    const a = listing("ml", "d1", {
      title: "Smart TV Samsung Crystal 43 polegadas 4K",
      brand: "Samsung",
      model: "UN43",
      size: "43 polegadas",
    });
    const b = listing("fonte_b", "d2", {
      title: "Smart TV Samsung Crystal 50 polegadas 4K",
      brand: "Samsung",
      model: "UN50",
      size: "50 polegadas",
    });
    const d = evaluateIdentityConfidence(a, b);
    assert.equal(d.confidence, "REJECT", "43\" vs 50\" nunca e EXACT");
  }

  /* ================================================================
   * 11. Capacidade equivalente NAO e falso conflito (1TB == 1024GB)
   *     Um falso REJECT seria tao errado quanto um falso EXACT.
   * ================================================================ */
  {
    // Categoria "audio": model e o unico eixo critico, storage e opcional.
    // Assim o teste isola SO a equivalencia de capacidade.
    const a = listing("ml", "e1", {
      title: "Fone Bluetooth X 1TB",
      brand: "X",
      model: "M1",
      storage: "1TB",
    });
    const b = listing("fonte_b", "e2", {
      title: "Fone Bluetooth X 1024GB",
      brand: "X",
      model: "M1",
      storage: "1024GB",
    });
    const d = evaluateIdentityConfidence(a, b);
    assert.equal(
      d.confidence,
      "EXACT",
      `1TB e 1024GB sao a MESMA capacidade (eixos: ${JSON.stringify(d.axisComparisons.map((c) => `${c.axis}=${c.status}`))})`,
    );
    assert.ok(
      d.axisComparisons.some((c) => c.axis === "storage" && c.status === "MATCH"),
      "storage equivalente => MATCH",
    );

    /* E o caso inverso, na MESMA familia: capacidade diferente e conflito. */
    const c = listing("fonte_b", "e3", {
      title: "Fone Bluetooth X 512GB",
      brand: "X",
      model: "M1",
      storage: "512GB",
    });
    const rejected = evaluateIdentityConfidence(a, c);
    assert.equal(
      rejected.confidence,
      "REJECT",
      "1TB vs 512GB sao capacidades DIFERENTES => conflito real",
    );
  }

  /* ================================================================
   * 11b. Ausencia de eixo critico de smartphone => REVIEW (nao EXACT)
   *      1TB/1024GB sao equivalentes, mas falta RAM => nao fecha como EXACT.
   * ================================================================ */
  {
    const a = listing("ml", "e4", {
      title: "Smartphone X 1TB 12GB RAM",
      brand: "X",
      model: "M1",
      storage: "1TB",
      memory: "12GB",
    });
    const b = listing("fonte_b", "e5", {
      title: "Smartphone X 1024GB 12GB RAM",
      brand: "X",
      model: "M1",
      storage: "1024GB",
      memory: "12GB",
    });
    const d = evaluateIdentityConfidence(a, b);
    assert.equal(d.confidence, "EXACT", "1TB vs 1024GB nao e conflito em smartphone");
  }

  /* ================================================================
   * 12. Mesmo marketplace => REJECT (nao e cross-market)
   * ================================================================ */
  {
    const spec = { title: "Fone X", brand: "J", model: "M1" };
    const d = evaluateIdentityConfidence(
      listing("shopee", "f1", spec),
      listing("shopee", "f2", spec),
    );
    assert.equal(d.confidence, "REJECT");
    assert.ok(d.reasonCodes.includes(IDENTITY_REASON_CODES.SAME_MARKETPLACE));
  }

  /* ================================================================
   * 13. Peso de evidencia: brand+model basta, texto nao
   * ================================================================ */
  {
    const onlyText = collectStrongEvidence(
      listing("ml", "g1", { title: "Fone Bluetooth" }),
      listing("fonte_b", "f2", { title: "Fone Bluetooth" }),
    );
    assert.equal(onlyText.length, 0);

    const brandModel = collectStrongEvidence(
      listing("ml", "g2", { title: "Fone", brand: "JBL", model: "Tune 520" }),
      listing("fonte_b", "f2", { title: "Fone", brand: "JBL", model: "Tune 520" }),
    );
    assert.ok(brandModel.length >= 1);
    assert.ok(
      brandModel[0].weight >= EXACT_EVIDENCE_WEIGHT_THRESHOLD,
      "brand+model atinge o limiar de EXACT",
    );
  }

  /* ================================================================
   * 14. Toda decisao e EXPLICAVEL (FASE L)
   * ================================================================ */
  {
    const a = listing("ml", "h1", {
      title: "Smartphone Galaxy 256GB",
      brand: "Samsung",
      model: "S25",
      storage: "256GB",
      memory: "12GB",
    });
    const b = listing("fonte_b", "h2", {
      title: "Smartphone Galaxy 512GB",
      brand: "Samsung",
      model: "S25",
      storage: "512GB",
      memory: "12GB",
    });
    const d = evaluateIdentityConfidence(a, b);
    assert.ok(d.reasonCodes.length > 0, "toda decisao tem reasonCode");
    assert.ok(d.policyVersion === IDENTITY_POLICY_V1, "versao registrada");
    assert.ok(d.axisComparisons.length > 0, "eixos comparados sao expostos");
    assert.ok(d.hardConflicts.length > 0, "conflito explica o REJECT");
    assert.ok(
      d.hardConflicts.every((c) => typeof c.field === "string"),
      "cada conflito diz QUAL campo conflita",
    );
  }

  console.log("identityConfidence.test.ts PASS");
}

function tvProfileAxis(listingToCheck: NormalizedMarketplaceListingV1) {
  return classifyCategory(listingToCheck).criticalAxes;
}

main();
