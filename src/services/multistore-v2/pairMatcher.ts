import type { PairVerdict, ProductFingerprint, ProductRole } from "./types";
import { classesAreIncompatible, isQuantitativeCompactToken } from "./normalizeCandidate";

function reliable<T>(
  field: { value: T | null; confidence: string },
): boolean {
  return Boolean(field.value) && (field.confidence === "HIGH" || field.confidence === "MEDIUM");
}

function sameText(first: string | null, second: string | null): boolean {
  if (!first || !second) {
    return false;
  }

  const left = first.replace(/\s+/g, "");
  const right = second.replace(/\s+/g, "");
  return left.length > 0 && left === right;
}

function brandsCompatible(first: string | null, second: string | null): boolean {
  if (!first || !second) {
    return true;
  }

  if (first === second) {
    return true;
  }

  const left = first.split(/\s+/);
  const right = second.split(/\s+/);
  return left.includes(second) || right.includes(first);
}

function modelsCompatible(first: string | null, second: string | null): boolean {
  if (!first || !second) {
    return true;
  }

  if (sameText(first, second)) {
    return true;
  }

  const left = first.replace(/\s+/g, "");
  const right = second.replace(/\s+/g, "");
  return left.includes(right) || right.includes(left);
}

function tokenOverlap(first: string[], second: string[]): number {
  if (first.length === 0 || second.length === 0) {
    return 0;
  }

  const right = new Set(second);
  const intersection = first.filter((token) => right.has(token)).length;
  const union = new Set([...first, ...second]).size;
  return union === 0 ? 0 : intersection / union;
}

function isAccessoryLikeRole(role: ProductRole | null | undefined): boolean {
  return role === "ACCESSORY" || role === "REPLACEMENT_PART";
}

function soldItemsCompatible(
  first: ProductFingerprint,
  second: ProductFingerprint,
): boolean {
  const sameClass =
    Boolean(first.productClass.value) &&
    first.productClass.value === second.productClass.value;
  if (sameClass) {
    return true;
  }

  if (sameText(first.soldItem.value, second.soldItem.value)) {
    return true;
  }

  const soldOverlap = tokenOverlap(first.lexicalSignature, second.lexicalSignature);
  const bothAccessory =
    isAccessoryLikeRole(first.role.value) && isAccessoryLikeRole(second.role.value);

  if (bothAccessory) {
    return soldOverlap >= 0.66;
  }

  if (!first.productClass.value && !second.productClass.value) {
    return soldOverlap >= 0.4;
  }

  return soldOverlap >= 0.5;
}

export function compareFingerprints(
  first: ProductFingerprint,
  second: ProductFingerprint,
): PairVerdict {
  const hardConflicts: string[] = [];
  const positiveEvidence: string[] = [];

  if (
    reliable(first.role) &&
    reliable(second.role) &&
    first.role.value !== second.role.value &&
    (first.role.value === "MAIN" || second.role.value === "MAIN")
  ) {
    hardConflicts.push(`role:${first.role.value}!=${second.role.value}`);
  }

  if (
    first.productClass.value &&
    second.productClass.value &&
    classesAreIncompatible(first.productClass.value, second.productClass.value)
  ) {
    hardConflicts.push(
      `productClass:${first.productClass.value}!=${second.productClass.value}`,
    );
  }

  if (
    first.brand.confidence === "HIGH" &&
    second.brand.confidence === "HIGH" &&
    first.brand.value &&
    second.brand.value &&
    !brandsCompatible(first.brand.value, second.brand.value)
  ) {
    hardConflicts.push(`brand:${first.brand.value}!=${second.brand.value}`);
  }

  if (
    reliable(first.model) &&
    reliable(second.model) &&
    first.model.value &&
    second.model.value &&
    !modelsCompatible(first.model.value, second.model.value) &&
    !(first.variantCodes.value ?? []).some((code) => modelsCompatible(code, second.model.value)) &&
    !(second.variantCodes.value ?? []).some((code) => modelsCompatible(code, first.model.value))
  ) {
    hardConflicts.push(`model:${first.model.value}!=${second.model.value}`);
  }

  if (
    first.manufacturerSku.confidence === "HIGH" &&
    second.manufacturerSku.confidence === "HIGH" &&
    first.manufacturerSku.value &&
    second.manufacturerSku.value &&
    first.manufacturerSku.value !== second.manufacturerSku.value
  ) {
    hardConflicts.push(
      `sku:${first.manufacturerSku.value}!=${second.manufacturerSku.value}`,
    );
  }

  if (
    first.capacity.value &&
    second.capacity.value &&
    first.capacity.value !== second.capacity.value
  ) {
    hardConflicts.push(`capacity:${first.capacity.value}!=${second.capacity.value}`);
  }

  if (
    first.size.value &&
    second.size.value &&
    first.size.value !== second.size.value
  ) {
    hardConflicts.push(`size:${first.size.value}!=${second.size.value}`);
  }

  if (
    first.identityNumbers.length > 0 &&
    second.identityNumbers.length > 0 &&
    first.identityNumbers.every((number) => !second.identityNumbers.includes(number))
  ) {
    hardConflicts.push(
      `identityNumber:${first.identityNumbers.join(",")}!=${second.identityNumbers.join(",")}`,
    );
  }

  const soldCompatible = soldItemsCompatible(first, second);
  const soldOverlap = tokenOverlap(first.lexicalSignature, second.lexicalSignature);
  const sharedAnchorsEarly = (first.identityAnchors ?? []).filter((anchor) =>
    (second.identityAnchors ?? []).includes(anchor),
  );
  const sharedModelLike =
    (Boolean(first.model.value) &&
      Boolean(second.model.value) &&
      modelsCompatible(first.model.value, second.model.value)) ||
    sharedAnchorsEarly.length > 0;

  if (
    sharedModelLike &&
    !soldCompatible &&
    soldOverlap < 0.3 &&
    (Boolean(first.productClass.value) ||
      Boolean(second.productClass.value) ||
      (isAccessoryLikeRole(first.role.value) &&
        isAccessoryLikeRole(second.role.value)) ||
      (first.role.value === "MAIN" && second.role.value === "MAIN"))
  ) {
    hardConflicts.push(
      `soldItem:${first.soldItem.value ?? "?"}!=${second.soldItem.value ?? "?"}`,
    );
  }

  if (hardConflicts.length > 0) {
    return {
      relation: "DIFFERENT",
      hardConflicts,
      positiveEvidence,
      confidence: 0.95,
    };
  }

  if (
    first.manufacturerSku.confidence === "HIGH" &&
    second.manufacturerSku.confidence === "HIGH" &&
    first.manufacturerSku.value &&
    first.manufacturerSku.value === second.manufacturerSku.value
  ) {
    positiveEvidence.push("sku");
    return {
      relation: "SAME",
      hardConflicts,
      positiveEvidence,
      confidence: 0.98,
    };
  }

  const sameBrand =
    Boolean(first.brand.value) &&
    Boolean(second.brand.value) &&
    brandsCompatible(first.brand.value, second.brand.value);
  const brandAligned =
    !first.brand.value ||
    !second.brand.value ||
    brandsCompatible(first.brand.value, second.brand.value);
  const sameModel =
    Boolean(first.model.value) &&
    Boolean(second.model.value) &&
    !isQuantitativeCompactToken(first.model.value) &&
    !isQuantitativeCompactToken(second.model.value) &&
    modelsCompatible(first.model.value, second.model.value);
  const sameClass =
    Boolean(first.productClass.value) &&
    first.productClass.value === second.productClass.value;
  const distinctiveOverlap = tokenOverlap(
    first.distinctiveTokens,
    second.distinctiveTokens,
  );
  const lexicalOverlap = tokenOverlap(
    first.lexicalSignature,
    second.lexicalSignature,
  );

  if (sameBrand && sameModel && soldCompatible) {
    positiveEvidence.push("brand", "model");
    return {
      relation: "SAME",
      hardConflicts,
      positiveEvidence,
      confidence: 0.94,
    };
  }

  if (sameModel && sameClass && soldCompatible) {
    positiveEvidence.push("model", "productClass");
    return {
      relation: "SAME",
      hardConflicts,
      positiveEvidence,
      confidence: 0.9,
    };
  }

  if (
    sameModel &&
    soldCompatible &&
    !first.productClass.value &&
    !second.productClass.value
  ) {
    positiveEvidence.push("model");
    return {
      relation: "SAME",
      hardConflicts,
      positiveEvidence,
      confidence: 0.82,
    };
  }

  const sharedAnchors = (first.identityAnchors ?? []).filter((anchor) =>
    (second.identityAnchors ?? []).includes(anchor),
  );
  if (
    sharedAnchors.length > 0 &&
    brandAligned &&
    soldCompatible &&
    (sameClass || (!first.productClass.value && !second.productClass.value))
  ) {
    positiveEvidence.push("identityAnchor");
    if (sameClass) {
      positiveEvidence.push("productClass");
    }
    return {
      relation: "SAME",
      hardConflicts,
      positiveEvidence,
      confidence: 0.9,
    };
  }

  if (
    first.identityAnchors.length > 0 &&
    second.identityAnchors.length > 0 &&
    sharedAnchors.length === 0
  ) {
    hardConflicts.push(
      `identityAnchor:${first.identityAnchors.join(",")}!=${second.identityAnchors.join(",")}`,
    );
    return {
      relation: "DIFFERENT",
      hardConflicts,
      positiveEvidence,
      confidence: 0.95,
    };
  }

  const sharedStrongIdentityNumber = first.identityNumbers.some(
    (number) =>
      second.identityNumbers.includes(number) &&
      (number.length >= 4 ||
        (first.identityAnchors.some((anchor) => anchor.includes(number)) &&
          second.identityAnchors.some((anchor) => anchor.includes(number)))),
  );

  if (
    sharedStrongIdentityNumber &&
    brandAligned &&
    soldCompatible &&
    (sameClass || (!first.productClass.value && !second.productClass.value))
  ) {
    positiveEvidence.push("identityNumber");
    if (sameClass) {
      positiveEvidence.push("productClass");
    }
    return {
      relation: "SAME",
      hardConflicts,
      positiveEvidence,
      confidence: 0.84,
    };
  }

  const attributeMatches = [
    first.capacity.value && first.capacity.value === second.capacity.value ? "capacity" : null,
    first.quantity.value && first.quantity.value === second.quantity.value ? "quantity" : null,
    first.material.value && first.material.value === second.material.value ? "material" : null,
  ].filter((item): item is string => Boolean(item));
  const identityAttributeMatches = attributeMatches.filter((item) => item !== "capacity");

  if (
    brandAligned &&
    soldCompatible &&
    (sameClass || (!first.productClass.value && !second.productClass.value)) &&
    !first.model.value &&
    !second.model.value &&
    (distinctiveOverlap >= 0.66 ||
      (distinctiveOverlap >= 0.4 && identityAttributeMatches.length >= 1)) &&
    lexicalOverlap >= 0.35
  ) {
    positiveEvidence.push("lexical", ...identityAttributeMatches);
    if (sameClass) {
      positiveEvidence.push("productClass");
    }
    return {
      relation: "SAME",
      hardConflicts,
      positiveEvidence,
      confidence: 0.72,
    };
  }

  const furnitureClass =
    first.productClass.value === "nightstand" ||
    second.productClass.value === "nightstand" ||
    first.productClass.value === "furniture" ||
    second.productClass.value === "furniture";
  const furnitureAttributesAligned =
    furnitureClass &&
    attributeMatches.includes("quantity") &&
    (attributeMatches.includes("material") || attributeMatches.length >= 1);
  if (
    furnitureClass &&
    brandAligned &&
    sameClass &&
    !first.model.value &&
    !second.model.value &&
    furnitureAttributesAligned &&
    (lexicalOverlap >= 0.28 || distinctiveOverlap >= 0.25)
  ) {
    positiveEvidence.push("lexical", ...attributeMatches, "productClass");
    return {
      relation: "SAME",
      hardConflicts,
      positiveEvidence,
      confidence: 0.7,
    };
  }

  if (
    sameBrand &&
    sameClass &&
    !first.model.value &&
    !second.model.value &&
    distinctiveOverlap >= 0.3 &&
    lexicalOverlap >= 0.24
  ) {
    positiveEvidence.push("brand", "productClass", "lexical");
    return {
      relation: "SAME",
      hardConflicts,
      positiveEvidence,
      confidence: 0.68,
    };
  }

  if (sameBrand) {
    positiveEvidence.push("brand");
  }

  if (sameClass) {
    positiveEvidence.push("productClass");
  }

  return {
    relation: "UNKNOWN",
    hardConflicts,
    positiveEvidence,
    confidence: Math.max(distinctiveOverlap, lexicalOverlap) * 0.5,
  };
}

export function mergeFingerprints(
  base: ProductFingerprint,
  extra: ProductFingerprint,
): ProductFingerprint {
  function pick<T>(
    first: { value: T | null; confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE"; source: ProductFingerprint["brand"]["source"] },
    second: { value: T | null; confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE"; source: ProductFingerprint["brand"]["source"] },
  ) {
    if (first.confidence === "HIGH" && first.value !== null) {
      return first;
    }

    if (second.confidence === "HIGH" && second.value !== null) {
      return second;
    }

    if (first.value !== null) {
      return first;
    }

    return second;
  }

  return {
    ...base,
    soldItem: pick(base.soldItem, extra.soldItem),
    hostItem: pick(base.hostItem, extra.hostItem),
    role: pick(base.role, extra.role),
    productClass: pick(base.productClass, extra.productClass),
    brand: pick(base.brand, extra.brand),
    family: pick(base.family, extra.family),
    model: pick(base.model, extra.model),
    manufacturerSku: pick(base.manufacturerSku, extra.manufacturerSku),
    variantCodes: {
      value: Array.from(
        new Set([
          ...(base.variantCodes.value ?? []),
          ...(extra.variantCodes.value ?? []),
        ]),
      ),
      confidence:
        (base.variantCodes.value?.length ?? 0) > 0 ||
        (extra.variantCodes.value?.length ?? 0) > 0
          ? "MEDIUM"
          : "NONE",
      source: "TITLE",
    },
    capacity: pick(base.capacity, extra.capacity),
    size: pick(base.size, extra.size),
    color: pick(base.color, extra.color),
    quantity: pick(base.quantity, extra.quantity),
    material: pick(base.material, extra.material),
    condition: pick(base.condition, extra.condition),
    importantAttributes: {
      ...extra.importantAttributes,
      ...base.importantAttributes,
    },
    distinctiveTokens: Array.from(
      new Set([...base.distinctiveTokens, ...extra.distinctiveTokens]),
    ),
    identityNumbers: Array.from(
      new Set([...base.identityNumbers, ...extra.identityNumbers]),
    ),
    identityAnchors: Array.from(
      new Set([...(base.identityAnchors ?? []), ...(extra.identityAnchors ?? [])]),
    ),
    lexicalSignature: Array.from(
      new Set([...base.lexicalSignature, ...extra.lexicalSignature]),
    ),
    marketplaceCategory: pick(base.marketplaceCategory, extra.marketplaceCategory),
  };
}
