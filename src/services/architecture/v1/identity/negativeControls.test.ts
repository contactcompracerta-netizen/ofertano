/**
 * CATALOG_ARCHITECTURE_V1 — NEGATIVE CONTROLS (FASE 8.3B / FASE L).
 *
 * Estes são os casos que DEVEM falhar. Se um deles virar EXACT, o sistema
 * está unindo produtos que o consumidor não pediu para unir — a falha mais
 * grave possível num comparador de preços.
 *
 * Resultado exigido: FALSE_EXACT = 0.
 */

import assert from "node:assert/strict";

import { evaluateIdentityConfidence } from "./identityConfidence";
import { buildBlockingKeys, generateCandidates, InMemoryBlockingKeyIndex } from "./candidateGeneration";
import { buildFakeListing } from "../fake/fakeConnectors";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";

const LEXICON = new Set(["samsung", "xiaomi", "apple", "logitech"]);

type Spec = {
  title: string;
  brand?: string | null;
  model?: string | null;
  gtin?: string[];
  storage?: string | null;
  memory?: string | null;
  voltage?: string | null;
  size?: string | null;
  attributes?: Record<string, string | number | boolean | string[] | null>;
};

function L(marketplaceId: string, externalListingId: string, spec: Spec): NormalizedMarketplaceListingV1 {
  return buildFakeListing({
    marketplaceId,
    externalListingId,
    identity: {
      gtin: spec.gtin ?? [],
      brand: spec.brand ?? null,
      manufacturerModel: spec.model ?? null,
      model: spec.model ?? null,
      mpn: null,
    },
    catalog: { title: spec.title, category: null, attributes: spec.attributes ?? {} },
    variant: {
      storage: spec.storage ?? null,
      memory: spec.memory ?? null,
      voltage: spec.voltage ?? null,
      size: spec.size ?? null,
    },
    commerce: { price: 999 },
  });
}

/** Uma decisão EXACT para um par que NÃO devia ser EXACT é um falso EXACT. */
let FALSE_EXACT = 0;
function mustNotBeExact(
  label: string,
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
) {
  const d = evaluateIdentityConfidence(left, right);
  if (d.confidence === "EXACT") {
    FALSE_EXACT += 1;
    console.error(`  FALSO EXACT: ${label} -> ${d.confidence} (${d.reasonCodes.join(",")})`);
  }
  assert.notEqual(d.confidence, "EXACT", `${label} NUNCA pode ser EXACT`);
  return d;
}

function main() {
  /* ---- 1. 256GB vs 512GB --------------------------------------------- */
  {
    const d = mustNotBeExact(
      "256GB vs 512GB",
      L("ml", "1", { title: "Smartphone Galaxy S25 256GB 12GB RAM", brand: "Samsung", model: "SM-S938B", storage: "256GB", memory: "12GB" }),
      L("shopee", "2", { title: "Smartphone Galaxy S25 512GB 12GB RAM", brand: "Samsung", model: "SM-S938B", storage: "512GB", memory: "12GB" }),
    );
    assert.equal(d.confidence, "REJECT", "storage divergente = REJECT");
    assert.ok(d.hardConflicts.some((c) => c.field.includes("storage")));
  }

  /* ---- 2. 127V vs 220V ------------------------------------------------- */
  {
    const d = mustNotBeExact(
      "127V vs 220V",
      L("ml", "3", { title: "Ventilador Ventisol 40cm Bivolt", brand: "Philco", model: "VT40", voltage: "127V" }),
      L("shopee", "4", { title: "Ventilador Ventisol 40cm Bivolt", brand: "Philco", model: "VT40", voltage: "220V" }),
    );
    assert.equal(d.confidence, "REJECT");
  }

  /* ---- 3. 43" vs 50" -------------------------------------------------- */
  {
    const d = mustNotBeExact(
      '43" vs 50"',
      L("ml", "5", { title: "Smart TV Samsung Crystal 43 polegadas 4K", brand: "Samsung", model: "UN43", size: "43 polegadas" }),
      L("shopee", "6", { title: "Smart TV Samsung Crystal 50 polegadas 4K", brand: "Samsung", model: "UN50", size: "50 polegadas" }),
    );
    assert.equal(d.confidence, "REJECT");
  }

  /* ---- 4. iPhone 15 vs iPhone 16 --------------------------------------- */
  {
    const d = mustNotBeExact(
      "iPhone 15 vs iPhone 16",
      L("ml", "7", { title: "iPhone 15 128GB Apple", brand: "Apple", model: "IP15" }),
      L("shopee", "8", { title: "iPhone 16 128GB Apple", brand: "Apple", model: "IP16" }),
    );
    assert.notEqual(d.confidence, "EXACT");
  }

  /* ---- 5. Galaxy S24 vs S25 ------------------------------------------- */
  {
    const d = mustNotBeExact(
      "Galaxy S24 vs S25",
      L("ml", "9", { title: "Samsung Galaxy S24 256GB", brand: "Samsung", model: "SM-S921B", storage: "256GB" }),
      L("shopee", "10", { title: "Samsung Galaxy S25 256GB", brand: "Samsung", model: "SM-S938B", storage: "256GB" }),
    );
    assert.notEqual(d.confidence, "EXACT");
  }

  /* ---- 6. 1TB vs 1024GB: EQUIVALENTE, nao conflito -------------------- */
  {
    const left = L("ml", "11", { title: "Notebook SSD 1TB 16GB RAM", brand: "Dell", model: "I15", storage: "1TB", memory: "16GB" });
    const right = L("shopee", "12", { title: "Notebook SSD 1024GB 16GB RAM", brand: "Dell", model: "I15", storage: "1024GB", memory: "16GB" });
    const d = evaluateIdentityConfidence(left, right);
    assert.equal(d.confidence, "EXACT", "1TB == 1024GB: mesma capacidade, EXACT legitimo");
    assert.equal(
      d.hardConflicts.filter((c) => c.field.includes("storage")).length,
      0,
      "1TB vs 1024GB NÃO pode virar conflito de storage",
    );
  }

  /* ---- 7. 256GB vs UNKNOWN: não é conflito, mas tampa em REVIEW ------- */
  {
    const known = L("ml", "13", { title: "Smartwatch Galaxy 4 44mm 256GB", brand: "Samsung", model: "SM-R890", storage: "256GB" });
    const unknown = L("shopee", "14", { title: "Smartwatch Galaxy 4 44mm Bluetooth", brand: "Samsung", model: "SM-R890" });
    const d = evaluateIdentityConfidence(known, unknown);
    assert.equal(
      d.hardConflicts.filter((c) => c.field.includes("storage")).length,
      0,
      "UNKNOWN nunca é conflito",
    );
    assert.notEqual(d.confidence, "EXACT", "atributo crítico ausente => nunca EXACT");
    assert.equal(d.confidence, "REVIEW", "atributo crítico ausente => REVIEW");
    assert.ok(d.missingCriticalAttributes.some((m) => m.axis === "storage"));
  }

  /* ---- 8. títulos parecidos, produtos diferentes --------------------- */
  {
    mustNotBeExact(
      "titulo semelhante, produto diferente",
      L("ml", "15", { title: "Fone Bluetooth JBL Tune 520BT", brand: "JBL", model: "TUNE520" }),
      L("shopee", "16", { title: "Fone Bluetooth JBL Tune 510BT", brand: "JBL", model: "TUNE510" }),
    );
  }

  /* ---- 9. similaridade textual sozinha NUNCA é EXACT ------------------ */
  {
    const left = L("ml", "17", { title: "Carregador Turbo 30W USB-C Preto" });
    const right = L("shopee", "18", { title: "Carregador Turbo 30W USB-C Preto" });
    const d = evaluateIdentityConfidence(left, right);
    assert.equal(d.confidence, "REJECT", "texto idêntico sem evidência estruturada => REJECT");
    assert.ok(d.evidence.length === 0, "texto não é evidência forte");
  }

  /* ---- 10. TITLE_DERIVED acha candidato mas não vira EXACT ---------- */
  {
    // Candidate derivado de título: DESCobre, mas a policy não fecha EXACT.
    const probe = L("shopee", "19", { title: "Carregador iPhone 20W Fonte Turbo Tipo C" });
    const pool = [
      L("ml", "20", { title: "Carregador Fonte USB-C 20w para iPhone Apple Tipo-C Turbo Adaptador", brand: "Apple", model: "A2465" }),
    ];
    const index = new InMemoryBlockingKeyIndex(pool);
    const gen = generateCandidates(probe, index, { brandLexicon: LEXICON });
    // (a) pode descobrir candidato
    assert.ok(gen.candidates.length >= 0, "candidate generation roda");
    // (b) nenhuma chave TITLE_EXTRACTED é STRONG
    for (const key of buildBlockingKeys(probe, { brandLexicon: LEXICON })) {
      if (key.provenance === "TITLE_EXTRACTED") {
        assert.equal(key.strength, "MEDIUM", "TITLE_EXTRACTED nunca é STRONG");
      }
    }
    // (c) se houver candidato, a policy NÃO dá EXACT só por causa do título
    if (gen.candidates.length > 0) {
      const d = evaluateIdentityConfidence(probe, pool[0]);
      assert.notEqual(d.confidence, "EXACT", "candidato por título não vira EXACT sozinho");
    }
  }

  /* ---- 11. nenhum hard conflict pode virar EXACT --------------------- */
  {
    const cases: Array<[string, NormalizedMarketplaceListingV1, NormalizedMarketplaceListingV1]> = [
      ["storage", L("ml", "s1", { title: "Notebook 256GB", brand: "D", model: "M1", storage: "256GB" }), L("shopee", "s2", { title: "Notebook 512GB", brand: "D", model: "M1", storage: "512GB" })],
      ["voltage", L("ml", "v1", { title: "Ventilador", brand: "P", model: "V1", voltage: "127V" }), L("shopee", "v2", { title: "Ventilador", brand: "P", model: "V1", voltage: "220V" })],
    ];
    for (const [label, left, right] of cases) {
      const d = evaluateIdentityConfidence(left, right);
      if (d.hardConflicts.length > 0) {
        assert.notEqual(d.confidence, "EXACT", `hard conflict (${label}) JAMAIS vira EXACT`);
      }
    }
  }

  console.log(`negativeControls.test.ts PASS (FALSE_EXACT=${FALSE_EXACT})`);
  assert.equal(FALSE_EXACT, 0, "FALSE_EXACT deve ser 0");
}

main();
