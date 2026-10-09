/**
 * CATALOG_WAVE 1 - FASE N/H: matching conservador.
 *
 * Cobertura: GTIN exato, conflito de GTIN, brand+MPN, brand+model,
 * cross-brand falso positivo, modelo incompatível, modelos próximos,
 * faixas de confiança (nunca AUTO via título).
 */
import { normalizeAwinFeedItem } from "../feed/awinAdapter";
import {
  AUTO_MATCH_THRESHOLD,
  REVIEW_THRESHOLD,
  matchToCatalog,
  titleSimilarity,
} from "./matching";

let passed = 0;
function ok(cond: boolean, label: string): void {
  if (!cond) {
    throw new Error(`FAIL: ${label}`);
  }
  passed += 1;
}

function item(raw: Parameters<typeof normalizeAwinFeedItem>[0]) {
  return normalizeAwinFeedItem(raw);
}

/* --- titleSimilarity ---------------------------------------------------- */
ok(
  titleSimilarity("Mouse Gamer Logitech G305", "Mouse Gamer Logitech G305") === 1,
  "títulos idênticos => 1",
);
ok(
  titleSimilarity("Mouse Gamer Logitech", "Colchao Queen Isopor") === 0,
  "tokens disjuntos => 0",
);
ok(
  titleSimilarity("Mouse Logitech G305", "Mouse Logitech G305 Lightspeed") > 0.7,
  "modelos próximos => similaridade alta porém < 1",
);

/* --- 1) GTIN exato => AUTO (0.99) --------------------------------------- */
const gtinItem = item({
  productId: "K1",
  title: "Mouse Gamer Logitech G305 Sem Fio",
  brand: "Logitech",
  gtin: "4006381333931",
});
const gtinMatch = matchToCatalog(gtinItem, [
  { id: "p-gtin", name: "Mouse Logitech G305", brand: "Logitech", gtin: "4006381333931" },
]);
ok(gtinMatch.productId === "p-gtin", "GTIN exato casa");
ok(gtinMatch.confidence >= AUTO_MATCH_THRESHOLD, "GTIN exato >= AUTO");
ok(gtinMatch.rule === "GTIN_EXACT", "regra GTIN_EXACT");
ok(!gtinMatch.conflict, "sem conflito");

/* --- GTIN conflitante => NUNCA auto-merge ------------------------------ */
const conflict = matchToCatalog(gtinItem, [
  { id: "p-conf", name: "Mouse Genius DX-120", brand: "Genius", gtin: "4006381333931" },
]);
ok(conflict.conflict, "mesmo GTIN + marca diferente => conflito");
ok(conflict.productId === null, "conflito não produz candidato");
ok(conflict.reasonCodes.includes("GTIN_CONFLICT"), "reason GTIN_CONFLICT");

/* --- 2) brand + MPN => 0.96 (AUTO) -------------------------------------- */
const mpnItem = item({
  productId: "K2",
  title: "Webcam Logitech C920 Full HD",
  brand: "Logitech",
  mpn: "C920",
});
const mpnMatch = matchToCatalog(mpnItem, [
  { id: "p-mpn", name: "Webcam Logitech Pro C920", brand: "Logitech", mpn: "C920" },
]);
ok(mpnMatch.productId === "p-mpn", "brand+MPN casa");
ok(mpnMatch.confidence >= AUTO_MATCH_THRESHOLD, "brand+MPN >= 0.95");
ok(mpnMatch.rule === "BRAND_MPN", "regra BRAND_MPN");

/* --- 3) brand + model => 0.93 (faixa REVIEW, não AUTO) ------------------ */
const modelItem = item({
  productId: "K3",
  title: "Teclado Mecanico Redragon Kumara RGB",
  brand: "Redragon",
  model: "K552",
});
const modelMatch = matchToCatalog(modelItem, [
  { id: "p-model", name: "Teclado Redragon Kumara ABNT2", brand: "Redragon", modelNumber: "K552" },
]);
ok(modelMatch.productId === "p-model", "brand+model casa");
ok(modelMatch.confidence >= REVIEW_THRESHOLD, "brand+model >= 0.85");
ok(modelMatch.confidence < AUTO_MATCH_THRESHOLD, "brand+model < 0.95 (REVIEW)");
ok(modelMatch.rule === "BRAND_MODEL", "regra BRAND_MODEL");

/* --- Cross-brand falso positivo: mesmo modelo, marcas diferentes -------- */
const crossItem = item({
  productId: "K4",
  title: "Smart TV 50 polegadas 4K Ultra HD",
  brand: "Samsung",
  model: "50UT8800",
});
const crossBrand = matchToCatalog(crossItem, [
  { id: "p-tv", name: "Smart TV 50 polegadas 4K Ultra HD", brand: "Positivo", modelNumber: "50UT8800" },
]);
ok(crossBrand.productId === null, "cross-brand nunca casa");
ok(crossBrand.confidence === 0, "cross-brand confiança 0");
ok(
  crossBrand.reasonCodes.includes("CROSS_BRAND_NO_MATCH"),
  "reason CROSS_BRAND_NO_MATCH",
);

/* --- Modelo incompatível: mesma marca, modelos diferentes --------------- */
const nearItem = item({
  productId: "K5",
  title: "Mouse Logitech G305 Lightspeed Preto",
  brand: "Logitech",
  model: "G305 Lightspeed",
});
const incompatible = matchToCatalog(nearItem, [
  { id: "p-near", name: "Mouse Logitech G305", brand: "Logitech", modelNumber: "G305" },
]);
ok(incompatible.productId === null, "modelos próximos diferentes não casam");
ok(incompatible.confidence === 0, "modelo incompatível => 0");
ok(
  incompatible.reasonCodes.includes("MODEL_INCOMPATIBLE"),
  "reason MODEL_INCOMPATIBLE",
);

/* --- 5) título (fallback) nunca alcança AUTO ---------------------------- */
const titleOnly = matchToCatalog(
  item({ productId: "K6", title: "Mouse Gamer Logitech G305 Sem Fio Preto" }),
  [{ id: "p-title", name: "Mouse Gamer Logitech G305 Sem Fio Preto" }],
);
ok(titleOnly.productId === "p-title", "título idêntico gera candidato");
ok(titleOnly.confidence <= 0.84, `título capado em 0.84 (got ${titleOnly.confidence})`);
ok(titleOnly.confidence < AUTO_MATCH_THRESHOLD, "título nunca AUTO");
ok(titleOnly.rule === "TITLE_SIM", "regra TITLE_SIM");

/* --- Sem candidatos ------------------------------------------------------ */
const none = matchToCatalog(gtinItem, []);
ok(none.productId === null && none.confidence === 0, "catálogo vazio => sem match");

/* --- Ordem de prioridade: GTIN vence título ----------------------------- */
const priority = matchToCatalog(gtinItem, [
  { id: "p-title-wrong", name: "Mouse Gamer Logitech G305 Sem Fio", brand: "Logitech" },
  { id: "p-gtin-right", name: "Mouse Outro Nome", brand: "Logitech", gtin: "4006381333931" },
]);
ok(priority.productId === "p-gtin-right", "GTIN tem prioridade sobre título");

console.log(`matching.test.ts PASS (${passed} asserções)`);
