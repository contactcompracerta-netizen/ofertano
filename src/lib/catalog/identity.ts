/**
 * CATALOG_WAVE 1 - ENGINE DE IDENTIDADE (FASE I).
 *
 * Níveis:
 *   A = GTIN/EAN válido (checksum conferido)
 *   B = brand + model/MPN forte
 *   C = identidade parcial (brand + título)
 *   D = identidade fraca/ambígua
 *
 * Auto-write futuro: somente A/B. C => REVIEW. D => REVIEW/REJECT.
 */
import { normalizeGTIN } from "../feed/normalization";
import type { CatalogFeedItem, IdentityLevel } from "./types";

export interface IdentityResult {
  level: IdentityLevel;
  evidence: string[];
}

/** Normaliza para comparação: minúsculas, só dígitos/alnum. */
export function normalizeToken(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** GTIN-8/12/13/14 com dígitos e checksum EAN-13 válido. */
export function isValidGtin(value: string | null | undefined): boolean {
  if (!value) return false;
  const digits = String(value).replace(/[\s-]/g, "");
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(digits)) return false;

  // Checksum EAN (funciona para 8/13 e para GTIN-14 com dígito inicial).
  const body = digits.slice(0, -1).split("").map(Number);
  const check = Number(digits[digits.length - 1]);
  let sum = 0;
  // Pesos: da direita para a esquerda do corpo, alternando 3/1.
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += body[i] * w;
  }
  const expected = (10 - (sum % 10)) % 10;
  return check === expected;
}

function hasStrongText(value: string | null | undefined, minLen: number): boolean {
  if (!value) return false;
  return value.trim().length >= minLen;
}

/** Classifica o nível de identidade de um item normalizado. */
export function computeIdentityLevel(item: CatalogFeedItem): IdentityResult {
  const evidence: string[] = [];

  const gtinNorm = normalizeGTIN(item.gtin);
  const gtinUsable =
    gtinNorm.status === "VALID" && isValidGtin(gtinNorm.value);

  if (gtinUsable) {
    evidence.push("GTIN_VALID");
    return { level: "A", evidence };
  }

  const brand = hasStrongText(item.brand, 2);
  const model = hasStrongText(item.model, 3);
  const mpn = hasStrongText(item.mpn, 3);

  if (brand && (model || mpn)) {
    evidence.push(model ? "BRAND_MODEL" : "BRAND_MPN");
    return { level: "B", evidence };
  }

  const titleOk = hasStrongText(item.title, 10);
  if (brand && titleOk) {
    evidence.push("BRAND_TITLE");
    return { level: "C", evidence };
  }

  if (titleOk) {
    evidence.push("TITLE_ONLY");
  } else {
    evidence.push("NO_IDENTIFIERS");
  }
  return { level: "D", evidence };
}
