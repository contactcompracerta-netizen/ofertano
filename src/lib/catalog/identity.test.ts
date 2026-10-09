/**
 * CATALOG_WAVE 1 - FASE N/I: engine de identidade (níveis A-D).
 *
 * A = GTIN válido (checksum) | B = brand + model/MPN | C = brand + título
 * D = fraco/ambíguo.
 */
import { normalizeAwinFeedItem } from "../feed/awinAdapter";
import { computeIdentityLevel, isValidGtin, normalizeToken } from "./identity";

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

/* --- GTIN checksum ------------------------------------------------------ */
ok(isValidGtin("4006381333931"), "EAN-13 4006381333931 válido");
ok(isValidGtin("7891234567895"), "EAN-13 7891234567895 válido");
ok(isValidGtin("7899875432107"), "EAN-13 7899875432107 válido");
ok(isValidGtin("96385074"), "GTIN-8 96385074 válido");
ok(isValidGtin("4006-3813-3393-1"), "EAN com hífens é aceito");
ok(!isValidGtin("12345678"), "checksum inválido rejeitado");
ok(!isValidGtin("1234567890123"), "checksum EAN-13 inválido rejeitado");
ok(!isValidGtin("400638133393"), "12 dígitos com checksum errado rejeitado");
ok(!isValidGtin(""), "vazio rejeitado");
ok(!isValidGtin(null), "null rejeitado");
ok(!isValidGtin(undefined), "undefined rejeitado");
ok(!isValidGtin("ABCDEFGHIJKL"), "não numérico rejeitado");
ok(!isValidGtin("40063813339312"), "14 dígitos com checksum errado rejeitado");

/* --- normalizeToken ----------------------------------------------------- */
ok(normalizeToken("Olympikus") === "olympikus", "token minúsculas");
ok(normalizeToken("Cama In Box") === "camainbox", "token remove espaços");
ok(normalizeToken("Tênis Corre 3") === "teniscorre3", "token remove acentos");
ok(normalizeToken(null) === "", "token null => vazio");

/* --- Nível A ------------------------------------------------------------ */
const levelA = computeIdentityLevel(
  item({ productId: "X1", title: "Mouse Logitech G305", brand: "Logitech", gtin: "4006381333931" }),
);
ok(levelA.level === "A", "GTIN válido => nível A");
ok(levelA.evidence.includes("GTIN_VALID"), "evidência GTIN_VALID");

/* GTIN presente porém inválido => não é A (cai para B) */
const badGtin = computeIdentityLevel(
  item({ productId: "X2", title: "Mouse Logitech G305", brand: "Logitech", model: "G305", gtin: "12345678" }),
);
ok(badGtin.level === "B", "GTIN inválido ignora; brand+model => B");

/* --- Nível B ------------------------------------------------------------ */
const brandModel = computeIdentityLevel(
  item({ productId: "X3", title: "Teclado Redragon Kumara", brand: "Redragon", model: "K552" }),
);
ok(brandModel.level === "B", "brand+model => B");
ok(brandModel.evidence.includes("BRAND_MODEL"), "evidência BRAND_MODEL");

const brandMpn = computeIdentityLevel(
  item({ productId: "X4", title: "Webcam Logitech C920", brand: "Logitech", mpn: "C920" }),
);
ok(brandMpn.level === "B", "brand+MPN => B");
ok(brandMpn.evidence.includes("BRAND_MPN"), "evidência BRAND_MPN");

/* --- Nível C ------------------------------------------------------------ */
const brandTitle = computeIdentityLevel(
  item({ productId: "X5", title: "Fone Bluetooth JBL Tune 520BT", brand: "JBL" }),
);
ok(brandTitle.level === "C", "brand+título => C");
ok(brandTitle.evidence.includes("BRAND_TITLE"), "evidência BRAND_TITLE");

/* --- Nível D ------------------------------------------------------------ */
const titleOnly = computeIdentityLevel(
  item({ productId: "X6", title: "Kit 2 Lencol 400 Fios Casal Bege" }),
);
ok(titleOnly.level === "D", "só título => D");
ok(titleOnly.evidence.includes("TITLE_ONLY"), "evidência TITLE_ONLY");

const nothing = computeIdentityLevel(item({ productId: "X7", title: "abc" }));
ok(nothing.level === "D", "sem identificadores => D");
ok(nothing.evidence.includes("NO_IDENTIFIERS"), "evidência NO_IDENTIFIERS");

/* brand curto demais não conta */
const shortBrand = computeIdentityLevel(
  item({ productId: "X8", title: "Produto Qualquer Bem Descrito", brand: "A" }),
);
ok(shortBrand.level === "D", "brand de 1 caractere não conta => D");

console.log(`identity.test.ts PASS (${passed} asserções)`);
