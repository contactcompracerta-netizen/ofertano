import {
  classifyProductConcept,
  normalizeConceptText,
  type ProductConceptId,
} from "./productConcepts";

export type MarketplaceCategoryKind = "EMPTY" | "NUMERIC_ID" | "CODE" | "TEXT";

export type MarketplaceCategoryEvidence = {
  raw: string | null;
  kind: MarketplaceCategoryKind;
  conceptId: ProductConceptId;
};

/*
 * Categoria de marketplace e evidencia, nao identidade.
 * IDs numericos (Shopee productCatIds) e codigos tipo MLB1234
 * permanecem UNKNOWN: nao ha mapeamento confiavel nesta camada.
 * Seller nunca entra aqui.
 */
export function interpretMarketplaceCategory(
  raw: string | null | undefined,
): MarketplaceCategoryEvidence {
  const trimmed = raw?.trim() || "";
  if (!trimmed) {
    return { raw: null, kind: "EMPTY", conceptId: "UNKNOWN" };
  }

  if (/^\d+(?:[./]\d+)*$/.test(trimmed)) {
    return { raw: trimmed, kind: "NUMERIC_ID", conceptId: "UNKNOWN" };
  }

  if (/^[a-z]{2,5}-?\d{2,}$/i.test(trimmed) && !/[aeiou]{2,}/i.test(trimmed)) {
    return { raw: trimmed, kind: "CODE", conceptId: "UNKNOWN" };
  }

  const classified = classifyProductConcept(trimmed);
  if (classified.id !== "UNKNOWN") {
    return { raw: trimmed, kind: "TEXT", conceptId: classified.id };
  }

  const normalized = normalizeConceptText(trimmed);
  if (/\b(?:livros?|books?|ebooks?)\b/.test(normalized)) {
    return { raw: trimmed, kind: "TEXT", conceptId: "book" };
  }

  if (/\b(?:cookware|kitchen|cozinha)\b/.test(normalized)) {
    return { raw: trimmed, kind: "TEXT", conceptId: "cookware" };
  }

  return { raw: trimmed, kind: "TEXT", conceptId: "UNKNOWN" };
}
