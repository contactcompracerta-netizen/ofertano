import type {
  EvidenceField,
  NormalizedCandidate,
  ProductFingerprint,
  ProductRole,
} from "./types";
import {
  classifyProductClass,
  detectHostSplit,
  distinctiveTokensOf,
  emptyField,
  extractCapacity,
  extractColor,
  extractIdentityNumbers,
  extractMaterial,
  extractModelTokens,
  extractBrand,
  extractQuantity,
  extractSize,
  extractVoltage,
  inferRole,
  isQuantitativeCompactToken,
  normalizeMultistoreText,
  tokenize,
} from "./normalizeCandidate";
import { extractIdentityAnchors } from "./identityAnchors";
import { interpretMarketplaceCategory } from "./marketplaceCategory";

function field<T>(
  value: T | null,
  confidence: EvidenceField<T>["confidence"],
  source: EvidenceField<T>["source"],
): EvidenceField<T> {
  if (value === null || (Array.isArray(value) && value.length === 0)) {
    return emptyField<T>();
  }

  return { value, confidence, source };
}

export function buildFingerprint(
  candidate: NormalizedCandidate,
): ProductFingerprint {
  const title = candidate.rawText;
  const normalized = normalizeMultistoreText(title);
  const split = detectHostSplit(normalized);
  const soldTokens = tokenize(split.sold);
  const role = inferRole(title);
  const soldClass = classifyProductClass(split.sold);
  const category = interpretMarketplaceCategory(candidate.raw.category);
  const categoryClass =
    category.kind === "TEXT" && category.conceptId !== "UNKNOWN"
      ? category.conceptId
      : null;
  const titleClass = soldClass !== "UNKNOWN" ? soldClass : null;
  const resolvedClass = titleClass ?? categoryClass;
  const classSource = titleClass
    ? "TITLE"
    : categoryClass
      ? "STRUCTURED_ATTRIBUTE"
      : "UNKNOWN";
  const classConfidence = titleClass
    ? "HIGH"
    : categoryClass
      ? "MEDIUM"
      : "NONE";
  const modelTokens = [
    ...extractModelTokens(soldTokens),
    ...(candidate.structuredModel
      ? [normalizeMultistoreText(candidate.structuredModel).replace(/\s+/g, "")]
      : []),
  ].filter((token) => token && !isQuantitativeCompactToken(token));
  const sku = candidate.structuredSku
    ? normalizeMultistoreText(candidate.structuredSku).replace(/\s+/g, "")
    : null;
  const brand =
    (candidate.structuredBrand
      ? normalizeMultistoreText(candidate.structuredBrand)
      : null) || extractBrand(title);
  const capacity = extractCapacity(soldTokens);
  const quantity = extractQuantity(soldTokens);
  const color = extractColor(soldTokens);
  const material = extractMaterial(soldTokens);
  const size = extractSize(soldTokens);
  const structuredVoltage = candidate.structuredVoltage ?? null;
  const voltage = structuredVoltage ?? extractVoltage(title);
  const model = sku || modelTokens[0] || null;
  const family = resolvedClass ?? null;

  return {
    soldItem: field(
      split.sold || null,
      split.sold ? "MEDIUM" : "NONE",
      "TITLE",
    ),
    hostItem: field(
      split.host || null,
      split.host ? "MEDIUM" : "NONE",
      split.host ? "TITLE" : "UNKNOWN",
    ),
    role: field<ProductRole>(
      role,
      role === "UNKNOWN" ? "NONE" : "HIGH",
      "TITLE",
    ),
    productClass: field(
      resolvedClass,
      classConfidence,
      classSource,
    ),
    brand: field(
      brand,
      brand ? "HIGH" : "NONE",
      brand ? "STRUCTURED_ATTRIBUTE" : "UNKNOWN",
    ),
    family: field(family, family ? "MEDIUM" : "NONE", family ? "TITLE" : "UNKNOWN"),
    model: field(
      model,
      sku ? "HIGH" : model ? "MEDIUM" : "NONE",
      sku ? "STRUCTURED_ATTRIBUTE" : model ? "TITLE" : "UNKNOWN",
    ),
    manufacturerSku: field(
      sku,
      sku ? "HIGH" : "NONE",
      sku ? "STRUCTURED_ATTRIBUTE" : "UNKNOWN",
    ),
    variantCodes: field(
      modelTokens,
      modelTokens.length > 0 ? "MEDIUM" : "NONE",
      "TITLE",
    ),
    capacity: field(capacity, capacity ? "HIGH" : "NONE", capacity ? "TITLE" : "UNKNOWN"),
    size: field(size, size ? "HIGH" : "NONE", size ? "TITLE" : "UNKNOWN"),
    color: field(color, color ? "MEDIUM" : "NONE", color ? "TITLE" : "UNKNOWN"),
    quantity: field(quantity, quantity ? "HIGH" : "NONE", quantity ? "TITLE" : "UNKNOWN"),
    material: field(material, material ? "MEDIUM" : "NONE", material ? "TITLE" : "UNKNOWN"),
    condition: field("new", "LOW", "INFERRED"),
    importantAttributes: {
      ...(capacity ? { capacity } : {}),
      ...(quantity ? { quantity } : {}),
      ...(color ? { color } : {}),
      ...(material ? { material } : {}),
      ...(size ? { size } : {}),
      ...(voltage ? { voltage } : {}),
    },
    distinctiveTokens: distinctiveTokensOf(soldTokens),
    identityNumbers: extractIdentityNumbers(soldTokens),
    identityAnchors: extractIdentityAnchors(title).map((anchor) => anchor.value),
    lexicalSignature: soldTokens,
    marketplaceCategory: field(
      category.raw,
      category.kind === "NUMERIC_ID" || category.kind === "CODE"
        ? "NONE"
        : category.kind === "TEXT"
          ? "MEDIUM"
          : "NONE",
      category.raw ? "STRUCTURED_ATTRIBUTE" : "UNKNOWN",
    ),
  };
}
