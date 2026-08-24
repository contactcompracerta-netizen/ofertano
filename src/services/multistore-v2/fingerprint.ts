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
  inferRole,
  normalizeMultistoreText,
  tokenize,
} from "./normalizeCandidate";

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
  const hostTokens = split.host ? tokenize(split.host) : [];
  const role = inferRole(title);
  const soldClass = classifyProductClass(split.sold);
  const modelTokens = [
    ...extractModelTokens(soldTokens),
    ...(candidate.structuredModel
      ? [normalizeMultistoreText(candidate.structuredModel).replace(/\s+/g, "")]
      : []),
  ];
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
  const model = sku || modelTokens[0] || null;
  const family = soldClass !== "UNKNOWN" ? soldClass : null;

  return {
    soldItem: field(
      tokenize(split.sold).slice(0, 3).join(" ") || null,
      split.sold ? "MEDIUM" : "NONE",
      "TITLE",
    ),
    hostItem: field(
      split.host ? hostTokens.slice(0, 4).join(" ") : null,
      split.host ? "MEDIUM" : "NONE",
      split.host ? "TITLE" : "UNKNOWN",
    ),
    role: field<ProductRole>(
      role,
      role === "UNKNOWN" ? "NONE" : "HIGH",
      "TITLE",
    ),
    productClass: field(
      soldClass === "UNKNOWN" ? null : soldClass,
      soldClass === "UNKNOWN" ? "NONE" : "HIGH",
      soldClass === "UNKNOWN" ? "UNKNOWN" : "TITLE",
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
    size: emptyField<string>(),
    color: field(color, color ? "MEDIUM" : "NONE", color ? "TITLE" : "UNKNOWN"),
    quantity: field(quantity, quantity ? "HIGH" : "NONE", quantity ? "TITLE" : "UNKNOWN"),
    material: field(material, material ? "MEDIUM" : "NONE", material ? "TITLE" : "UNKNOWN"),
    condition: field("new", "LOW", "INFERRED"),
    importantAttributes: {
      ...(capacity ? { capacity } : {}),
      ...(quantity ? { quantity } : {}),
      ...(color ? { color } : {}),
      ...(material ? { material } : {}),
    },
    distinctiveTokens: distinctiveTokensOf(soldTokens),
    identityNumbers: extractIdentityNumbers(soldTokens),
    lexicalSignature: soldTokens,
  };
}
