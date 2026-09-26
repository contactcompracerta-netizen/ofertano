/**
 * CATALOG_ARCHITECTURE_V1 — CANDIDATE GENERATION V1 TEST (FASE 8.3).
 *
 * Trava as regras das fases C..J:
 *   D — token genérico nunca é chave sozinha;
 *   E — toda chave tem type/normalizedValue/strength/provenance;
 *   G — teto de candidatos + AMBIGUOUS_BLOCK;
 *   H — pré-filtro de hard conflict (UNKNOWN nunca é conflito);
 *   I — grandezas normalizadas (1TB == 1024GB, 256GB != 512GB);
 *   J — category-aware.
 *
 * E o mais importante: Candidate Generation NÃO decide. Nada aqui publica,
 * une produtos ou emite EXACT.
 */

import assert from "node:assert/strict";

import {
  buildBlockingKeys,
  canonicalModel,
  canonicalCategory,
  generateCandidates,
  InMemoryBlockingKeyIndex,
  hasHardConflictPreFilter,
  extractBrand,
  extractModelCandidates,
  GENERIC_TOKENS,
  MAX_CANDIDATES_PER_LISTING,
  CANDIDATE_BLOCKING_KEY_V1,
} from "./candidateGeneration";
import { buildFakeListing } from "../fake/fakeConnectors";
import { UNKNOWN } from "../types/normalizedListingV1";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";

const LEXICON = new Set(["samsung", "xiaomi", "logitech", "fastplug", "apple"]);

function L(
  marketplaceId: string,
  externalListingId: string,
  spec: {
    title: string;
    brand?: string | null;
    model?: string | null;
    mpn?: string | null;
    gtin?: string[];
    storage?: string | null;
    memory?: string | null;
    voltage?: string | null;
  },
): NormalizedMarketplaceListingV1 {
  return buildFakeListing({
    marketplaceId,
    externalListingId,
    identity: {
      gtin: spec.gtin ?? [],
      brand: spec.brand ?? null,
      manufacturerModel: spec.model ?? null,
      model: spec.model ?? null,
      mpn: spec.mpn ?? null,
    },
    catalog: { title: spec.title, category: null, attributes: {} },
    variant: {
      storage: spec.storage ?? null,
      memory: spec.memory ?? null,
      voltage: spec.voltage ?? null,
      size: null,
    },
    commerce: { price: 199.9 },
  });
}

function main() {
  /* === FASE E — estrutura da chave ================================== */
  {
    const listing = L("ml", "a", { title: "Samsung Galaxy S25 Ultra 256GB", brand: "Samsung", model: "SM-S938B", gtin: ["7891234567890"] });
    const keys = buildBlockingKeys(listing, { brandLexicon: LEXICON });
    assert.ok(keys.length > 0, "listing com identidade produz chaves");
    for (const key of keys) {
      assert.equal(key.version, CANDIDATE_BLOCKING_KEY_V1, "toda chave é versionada");
      assert.ok(key.type && key.type.length > 0, "toda chave tem type");
      assert.ok(key.normalizedValue && key.normalizedValue.length > 0, "toda chave tem valor");
      assert.ok(key.strength === "STRONG" || key.strength === "MEDIUM", "toda chave tem strength");
      assert.ok(
        ["STRUCTURED_FIELD", "TITLE_EXTRACTED", "CANONICAL_DERIVED"].includes(key.provenance),
        `provenance inválida: ${key.provenance}`,
      );
      // FASE G/F: valor canônico indexável (sem separador de espaço).
      assert.equal(key.normalizedValue, key.normalizedValue.toLowerCase().replace(/\s+/g, ""));
    }
    assert.ok(
      keys.some((k) => k.type === "GTIN" && k.strength === "STRONG"),
      "GTIN estruturada vira chave STRONG",
    );
    assert.ok(
      keys.some((k) => k.type === "MANUFACTURER_MODEL" && k.strength === "STRONG"),
      "manufacturerModel estruturado vira chave STRONG",
    );
  }

  /* === FASE E — ProductIdentifier NÃO é blocking key ================= */
  {
    const listing = L("ml", "a", { title: "Fone X", brand: "Xiaomi", model: "REDMIBUDS6PLAY" });
    const keys = buildBlockingKeys(listing, { brandLexicon: LEXICON });
    // O tipo da chave é um conjunto FECHADO: nem MARKETPLACE_EXTERNAL_ID nem
    // PRODUCT_ID existem nele, então nem podem ser emitidos. O teste é
    // estrutural (a lista de tipos não os contém) em vez de comparar
    // string solta, que o compilador rejeitaria.
    const types: readonly string[] = keys.map((k) => String(k.type));
    assert.equal(
      types.includes("MARKETPLACE_EXTERNAL_ID"),
      false,
      "externalId legacy não é chave",
    );
    assert.equal(types.includes("PRODUCT_ID"), false, "productId legacy não é chave");
  }

  /* === FASE D — token genérico NUNCA vira chave sozinha ============== */
  {
    assert.ok(GENERIC_TOKENS.has("ultra"), "ultra é genérico");
    assert.ok(GENERIC_TOKENS.has("pro"));
    assert.ok(GENERIC_TOKENS.has("premium"));
    // "samsung ultra" não pode gerar chave de modelo = ultra.
    const brand = extractBrand(L("ml", "x", { title: "Samsung Ultra Pro" }), LEXICON);
    assert.equal(brand.brand, "samsung");
    const models = extractModelCandidates(L("ml", "x", { title: "Samsung Ultra Pro" }), "samsung");
    for (const m of models) {
      assert.notEqual(m.model, "ultra", "'ultra' isolado nunca é modelo");
      assert.notEqual(m.model, "pro");
    }
    // Uma chave de modelo precisa carregar CONTEXTO, não só o genérico.
    const listing = L("ml", "x", { title: "Samsung Galaxy S25 Ultra 256GB", brand: "Samsung" });
    for (const key of buildBlockingKeys(listing, { brandLexicon: LEXICON })) {
      if (key.type === "MODEL_CODE") {
        assert.notEqual(key.normalizedValue, "ultra", "chave isolada 'ultra' proibida");
      }
    }
  }

  /* === FASE I — grandezas normalizadas ================================ */
  {
    assert.equal(canonicalModel("REDMIBUDS6PLAY"), "redmibuds6play", "canônico sem separador");
    assert.equal(canonicalModel("Redmi Buds 6 Play"), "redmibuds6play", "mesmo canônico dos dois lados");
    assert.equal(
      canonicalModel("REDMIBUDS6PLAY"),
      canonicalModel("Redmi Buds 6 Play"),
      "título e campo estruturado convergem",
    );

    const probe = L("ml", "p", { title: "Notebook 1TB", storage: "1TB" });
    const sameCap = L("shopee", "c", { title: "Notebook 1024GB", storage: "1024GB" });
    const bigger = L("shopee", "d", { title: "Notebook 512GB", storage: "512GB" });
    assert.equal(
      hasHardConflictPreFilter(probe, sameCap),
      false,
      "1TB e 1024GB são a MESMA capacidade: não é conflito",
    );
    assert.equal(
      hasHardConflictPreFilter(probe, bigger),
      true,
      "1TB vs 512GB: grandezas diferentes => conflito",
    );
  }

  /* === FASE H — UNKNOWN nunca é conflito ============================= */
  {
    const withStorage = L("ml", "p", { title: "Smartwatch 256GB", storage: "256GB" });
    const noStorage = L("shopee", "c", { title: "Smartwatch Bluetooth" });
    assert.equal(
      hasHardConflictPreFilter(withStorage, noStorage),
      false,
      "UNKNOWN (ausente) NÃO é conflito",
    );
    const wrongStorage = L("shopee", "d", { title: "Smartwatch 512GB", storage: "512GB" });
    assert.equal(
      hasHardConflictPreFilter(withStorage, wrongStorage),
      true,
      "256GB vs 512GB estruturado => conflito",
    );
    // 127V vs 220V
    const v1 = L("ml", "v1", { title: "Ventilador", voltage: "127V" });
    const v2 = L("shopee", "v2", { title: "Ventilador", voltage: "220V" });
    assert.equal(hasHardConflictPreFilter(v1, v2), true, "127V vs 220V => conflito");
  }

  /* === FASE J — category-aware ======================================== */
  {
    assert.equal(canonicalCategory(L("x", "1", { title: "Smartphone Samsung Galaxy S25" })), "smartphone");
    assert.equal(canonicalCategory(L("x", "2", { title: "Smart TV Samsung 55 polegadas" })), "tv");
    assert.equal(canonicalCategory(L("x", "3", { title: "Notebook Dell Inspiron 16GB" })), "notebook");
    assert.equal(canonicalCategory(L("x", "4", { title: "Mouse Sem Fio Logitech" })), "mouse");
    assert.equal(canonicalCategory(L("x", "5", { title: "Fone de Ouvido Bluetooth" })), "audio");
    assert.equal(canonicalCategory(L("x", "6", { title: "Geladeira Frost Free 220V" })), "eletrodomestico");
  }

  /* === FASE C/G — gera candidatos cross-market, com teto ============= */
  {
    const probe = L("shopee", "probe", { title: "Fone Bluetooth Xiaomi Redmi Buds 6 Play Preto" });
    const match = L("ml", "match", { title: "Fone de Ouvido Sem Fio Xiaomi Redmi Buds 6 Play", brand: "Xiaomi", model: "REDMIBUDS6PLAY" });
    const index = new InMemoryBlockingKeyIndex([match]);
    const result = generateCandidates(probe, index, { brandLexicon: LEXICON });
    assert.ok(result.candidates.length >= 1, "descobre o par por evidência de título");
    assert.equal(result.candidates.length <= MAX_CANDIDATES_PER_LISTING, true, "respeita o teto");
  }

  /* === FASE G — AMBIGUOUS_BLOCK quando o bloco explode =============== */
  {
    const probe = L("shopee", "probe", { title: "Fone Bluetooth Xiaomi Redmi Buds 6 Play" });
    // 30 itens com a MESMA assinatura => bloco ambíguo.
    const pool: NormalizedMarketplaceListingV1[] = [];
    for (let i = 0; i < 30; i += 1) {
      pool.push(L("ml", `dup${i}`, { title: "Fone de Ouvido Sem Fio Xiaomi Redmi Buds 6 Play", brand: "Xiaomi", model: "REDMIBUDS6PLAY" }));
    }
    const index = new InMemoryBlockingKeyIndex(pool);
    const result = generateCandidates(probe, index, { brandLexicon: LEXICON, maxCandidatesPerListing: 20 });
    assert.equal(
      result.candidates.length <= 20,
      true,
      "nunca devolve mais que o teto, mesmo com bloco enorme",
    );
    assert.ok(
      (result.skipStats.AMBIGUOUS_BLOCK ?? 0) > 0,
      "bloco ambíguo é registrado, não escondido",
    );
  }

  /* === REGRA FUNDAMENTAL — gerador NÃO decide ======================== */
  {
    const probe = L("shopee", "probe", { title: "Fone Bluetooth Xiaomi Redmi Buds 6 Play" });
    const match = L("ml", "match", { title: "Fone de Ouvido Sem Fio Xiaomi Redmi Buds 6 Play", brand: "Xiaomi", model: "REDMIBUDS6PLAY" });
    const index = new InMemoryBlockingKeyIndex([match]);
    const result = generateCandidates(probe, index, { brandLexicon: LEXICON });
    // Nenhum campo de decisão existe no resultado do gerador.
    const serialized = JSON.stringify(result.candidates[0] ?? {});
    assert.equal(serialized.includes("EXACT"), false, "gerador não emite EXACT");
    assert.equal(serialized.includes("REVIEW"), false, "gerador não emite REVIEW");
    assert.equal(serialized.includes("REJECT"), false, "gerador não emite REJECT");
    assert.equal(serialized.includes("productId"), false, "gerador não carrega productId");
    assert.equal(result.skipStats.PUBLISHED ?? 0, 0, "gerador não publica");
  }

  /* === Determinismo (mesma entrada => mesma saída) =================== */
  {
    const probe = L("shopee", "probe", { title: "Mouse Sem Fio Logitech M170 Cinza" });
    const match = L("ml", "m", { title: "Mouse Sem Fio Logitech M170", brand: "Logitech", model: "M170" });
    const index = new InMemoryBlockingKeyIndex([match]);
    const a = generateCandidates(probe, index, { brandLexicon: LEXICON });
    const b = generateCandidates(probe, index, { brandLexicon: LEXICON });
    assert.deepEqual(a.candidates, b.candidates, "candidate generation é determinístico");
  }

  /* === Título sozinho NUNCA vira chave STRONG ======================== */
  {
    const listing = L("shopee", "t", { title: "Samsung Galaxy S25 Ultra 256GB" });
    for (const key of buildBlockingKeys(listing, { brandLexicon: LEXICON })) {
      if (key.provenance === "TITLE_EXTRACTED") {
        assert.equal(
          key.strength,
          "MEDIUM",
          "evidência de título nunca é STRONG (não pode sustentar EXACT sozinha)",
        );
      }
    }
  }

  /* === Marca de API (sem brand estruturado) ainda vira chave ======== */
  {
    const listing = L("shopee", "api", { title: "SMARTWATCH RELOGIO Z100 INTELIGENTE" });
    const brand = extractBrand(listing, LEXICON);
    /*
     * Sem brand estruturado, a procedência é TITLE_EXTRACTED e a marca
     * fica VAZIA: "smartwatch"/"relógio"/"z100" não são marca nenhuma.
     * O ponto é não inventar — inventar seria preencher com "smartwatch".
     */
    assert.equal(brand.provenance, "TITLE_EXTRACTED", "procedência revela que veio do texto");
    assert.equal(brand.brand, "", "NÃO inventa marca quando o léxico não reconhece nada");
  }

  console.log("candidateGeneration.test.ts PASS");
}

main();
