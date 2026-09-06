import { sanitizeProductTitle, sanitizeBrand, isDescriptionInvalid } from "@/lib/seo/product";

export type ProductPresentationInput = {
  name: string;
  description?: string | null;
  brand?: string | null;
  specifications?: Record<string, unknown> | null;
};

export type ProductPresentation = {
  displayName: string;
  publicDescription: string | null;
  displaySpecifications: Array<[string, string]>;
  structuredBrand: string | null;
  resolvedBrand: string | null;
  brandConflict: boolean;
};

/**
 * Simple helper for sanitizing product names for public display.
 * Use this in components for quick sanitization without full presentation layer.
 *
 * @param name - Raw product name from database
 * @returns Sanitized product name safe for public display
 */
export function sanitizeProductNameForDisplay(name: string): string {
  return sanitizeProductTitle(name);
}

function normalizeSpecificationKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extractStructuredBrand(specifications: Record<string, unknown> | null | undefined): string | null {
  if (!specifications || typeof specifications !== "object") {
    return null;
  }

  for (const [key, value] of Object.entries(specifications)) {
    const normalizedKey = normalizeSpecificationKey(key);

    if (normalizedKey === "marca" || normalizedKey === "brand") {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  return null;
}

function cleanStructuredBrandValue(value: string): string | null {
  const cleaned = value
    .replace(/^visite\s+a\s+loja\s+/i, "")
    .replace(/^visite\s+a\s+loja\s+da\s+/i, "")
    .replace(/^marca:\s*/i, "")
    .trim();

  if (!cleaned) {
    return null;
  }

  return sanitizeBrand(cleaned);
}

function resolveBrandConflict(
  canonicalBrand: string | null | undefined,
  structuredBrand: string | null
): { resolvedBrand: string | null; brandConflict: boolean } {
  const sanitizedCanonical = sanitizeBrand(canonicalBrand);
  const sanitizedStructured = structuredBrand;

  if (!sanitizedCanonical && !sanitizedStructured) {
    return { resolvedBrand: null, brandConflict: false };
  }

  if (sanitizedCanonical && !sanitizedStructured) {
    return { resolvedBrand: sanitizedCanonical, brandConflict: false };
  }

  if (!sanitizedCanonical && sanitizedStructured) {
    return { resolvedBrand: sanitizedStructured, brandConflict: false };
  }

  if (sanitizedCanonical && sanitizedStructured) {
    const canonicalLower = sanitizedCanonical.toLowerCase();
    const structuredLower = sanitizedStructured.toLowerCase();

    if (canonicalLower === structuredLower) {
      return { resolvedBrand: sanitizedCanonical, brandConflict: false };
    }

    return { resolvedBrand: null, brandConflict: true };
  }

  return { resolvedBrand: null, brandConflict: false };
}

function formatSpecificationValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "Não informado";
  }

  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  if (typeof value === "string" || typeof value === "number") {
    const strValue = String(value).trim();
    return strValue || "Não informado";
  }

  if (Array.isArray(value)) {
    const arrayValue = value
      .map((item) => String(item))
      .filter(Boolean)
      .join(", ");
    return arrayValue || "Não informado";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function cleanSpecificationValue(value: unknown, key: string): string {
  const formatted = formatSpecificationValue(value);

  if (formatted === "Não informado") {
    return formatted;
  }

  const cleaned = formatted.replace(/\s+/g, " ").trim();

  const normalizedKey = normalizeSpecificationKey(key);
  if (normalizedKey === "marca" || normalizedKey === "brand") {
    const brandCleaned = cleanStructuredBrandValue(cleaned);
    return brandCleaned || cleaned;
  }

  return cleaned;
}

function getPublicDescription(description: string | null | undefined, productName: string): string | null {
  if (!description) {
    return null;
  }

  if (isDescriptionInvalid(description)) {
    return null;
  }

  const cleaned = description.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }

  const semanticName = sanitizeProductTitle(productName)
    .toLowerCase()
    .replace(/[.,!?;:]$/g, "")
    .replace(/\s+/g, " ");
  const semanticDesc = sanitizeProductTitle(cleaned)
    .toLowerCase()
    .replace(/[.,!?;:]$/g, "")
    .replace(/\s+/g, " ");

  if (semanticDesc === semanticName) {
    return null;
  }

  return cleaned;
}

export function createProductPresentation(
  input: ProductPresentationInput
): ProductPresentation {
  const displayName = sanitizeProductTitle(input.name);

  const publicDescription = getPublicDescription(input.description, input.name);

  const rawStructuredBrand = extractStructuredBrand(input.specifications);
  const structuredBrand = rawStructuredBrand ? cleanStructuredBrandValue(rawStructuredBrand) : null;

  const { resolvedBrand, brandConflict } = resolveBrandConflict(input.brand, structuredBrand);

  const displaySpecifications: Array<[string, string]> = [];

  if (input.specifications && typeof input.specifications === "object") {
    for (const [key, value] of Object.entries(input.specifications)) {
      const cleanedValue = cleanSpecificationValue(value, key);
      displaySpecifications.push([key, cleanedValue]);
    }
  }

  return {
    displayName,
    publicDescription,
    displaySpecifications,
    structuredBrand,
    resolvedBrand,
    brandConflict,
  };
}
