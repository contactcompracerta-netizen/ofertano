/**
 * PHASE 4 — SEARCH PLAN VARIANTS
 *
 * Generates search variants from sanitized identity.
 * Maximum 3 variants per mission constraints.
 *
 * Rules:
 * 1. No variant removes STRONG_IDENTITY attributes
 * 2. Variants generated in priority order:
 *    - Variant 1: Sanitized full title
 *    - Variant 2: Identity-rich (brand + model + strong specs)
 *    - Variant 3: Compact identity (minimum viable identity)
 * 3. Deduplicates normalized variants
 * 4. Preserves deterministic ordering for testing
 */

import { normalizeMultistoreText } from "./normalizeCandidate";
import type { SanitizedIdentity } from "./sanitizedIdentity";
import { compactIdentity, humanizeAnchor } from "./identityAnchors";

export type QueryVariant = {
  index: number; // 1, 2, 3
  originalText: string;
  preservedIdentity: {
    brand?: string;
    modelCodes: string[];
    storage?: string;
    voltage?: string;
    capacity?: string;
    bundleQuantity?: number;
    condition?: string;
  };
  reason: "SANITIZED_FULL" | "IDENTITY_RICH" | "COMPACT_IDENTITY";
};

/**
 * Build a variant with brand and model information prioritized.
 * Aims to be specific but shorter than full title.
 */
function buildIdentityRichVariant(identity: SanitizedIdentity): string {
  const parts: string[] = [];

  // Product core (class + model)
  if (identity.queryCore.productCoreLabels[0]) {
    parts.push(identity.queryCore.productCoreLabels[0]);
  }

  // Brand
  if (identity.strongIdentity.brand) {
    parts.push(identity.strongIdentity.brand);
  }

  // Model name or line
  if (identity.strongIdentity.modelName) {
    parts.push(identity.strongIdentity.modelName);
  } else if (identity.strongIdentity.modelLine) {
    parts.push(identity.strongIdentity.modelLine);
  }

  // Model codes
  for (const code of identity.strongIdentity.modelCodes) {
    parts.push(humanizeAnchor(code));
  }

  // Strong specs
  if (identity.strongIdentity.storage) {
    parts.push(identity.strongIdentity.storage);
  }
  if (identity.strongIdentity.capacity) {
    parts.push(identity.strongIdentity.capacity);
  }
  if (identity.strongIdentity.voltage) {
    parts.push(identity.strongIdentity.voltage);
  }
  if (identity.strongIdentity.bundleQuantity && identity.strongIdentity.bundleQuantity > 1) {
    parts.push(`${identity.strongIdentity.bundleQuantity}x`);
  }

  // Condition if present
  if (identity.strongIdentity.condition) {
    parts.push(identity.strongIdentity.condition);
  }

  return parts.filter(Boolean).join(" ").trim();
}

/**
 * Build minimal variant with only essential identity anchors.
 * Used as fallback when full title fails.
 */
function buildCompactIdentityVariant(identity: SanitizedIdentity): string {
  const parts: string[] = [];

  // Product core (essential)
  if (identity.queryCore.productCoreLabels[0]) {
    parts.push(identity.queryCore.productCoreLabels[0]);
  }

  // Brand if present (often critical)
  if (identity.strongIdentity.brand) {
    parts.push(identity.strongIdentity.brand);
  }

  // Primary model code or name
  if (identity.strongIdentity.modelCodes[0]) {
    parts.push(humanizeAnchor(identity.strongIdentity.modelCodes[0]));
  } else if (identity.strongIdentity.modelName) {
    parts.push(identity.strongIdentity.modelName);
  }

  // Storage (often critical for compatibility)
  if (identity.strongIdentity.storage) {
    parts.push(identity.strongIdentity.storage);
  }

  return parts.filter(Boolean).join(" ").trim();
}

/**
 * Verify that a variant preserves all required strong identity elements.
 * Returns preserved elements for tracking.
 */
function extractPreservedIdentity(variant: string, identity: SanitizedIdentity) {
  const normalized = normalizeMultistoreText(variant).toLowerCase();
  const preserved: QueryVariant["preservedIdentity"] = {
    modelCodes: [],
  };

  // Check brand
  if (identity.strongIdentity.brand) {
    if (
      normalized.includes(
        normalizeMultistoreText(identity.strongIdentity.brand).toLowerCase(),
      )
    ) {
      preserved.brand = identity.strongIdentity.brand;
    }
  }

  // Check model codes
  for (const code of identity.strongIdentity.modelCodes) {
    if (
      normalized.includes(normalizeMultistoreText(code).toLowerCase()) ||
      normalized.includes(humanizeAnchor(code).toLowerCase())
    ) {
      preserved.modelCodes.push(code);
    }
  }

  // Check storage
  if (identity.strongIdentity.storage) {
    if (
      normalized.includes(
        normalizeMultistoreText(identity.strongIdentity.storage).toLowerCase(),
      )
    ) {
      preserved.storage = identity.strongIdentity.storage;
    }
  }

  // Check voltage
  if (identity.strongIdentity.voltage) {
    if (
      normalized.includes(
        normalizeMultistoreText(identity.strongIdentity.voltage).toLowerCase(),
      )
    ) {
      preserved.voltage = identity.strongIdentity.voltage;
    }
  }

  // Check capacity
  if (identity.strongIdentity.capacity) {
    if (
      normalized.includes(
        normalizeMultistoreText(identity.strongIdentity.capacity).toLowerCase(),
      )
    ) {
      preserved.capacity = identity.strongIdentity.capacity;
    }
  }

  // Check bundle quantity
  if (identity.strongIdentity.bundleQuantity) {
    if (normalized.includes(String(identity.strongIdentity.bundleQuantity))) {
      preserved.bundleQuantity = identity.strongIdentity.bundleQuantity;
    }
  }

  // Check condition
  if (identity.strongIdentity.condition) {
    if (
      normalized.includes(identity.strongIdentity.condition.toLowerCase())
    ) {
      preserved.condition = identity.strongIdentity.condition;
    }
  }

  return preserved;
}

/**
 * Generate up to 3 search variants from sanitized identity.
 * Returns variants in priority order.
 *
 * Rules:
 * - Variant 1: Sanitized full query (already processed through Phase 1)
 * - Variant 2: Identity-rich variant (specific, shorter)
 * - Variant 3: Compact identity (minimal, fallback)
 * - Max 3 variants
 * - All strong identity elements preserved in each variant
 * - Deduplicated by normalized form
 */
export function buildCommerceSearchPlan(identity: SanitizedIdentity): QueryVariant[] {
  const variants: QueryVariant[] = [];
  const seenNormalized = new Set<string>();

  // Variant 1: Sanitized full query
  const sanitized = identity.sanitizedQuery;
  const sanitizedNorm = compactIdentity(sanitized);
  if (sanitizedNorm && !seenNormalized.has(sanitizedNorm)) {
    seenNormalized.add(sanitizedNorm);
    variants.push({
      index: 1,
      originalText: sanitized,
      preservedIdentity: extractPreservedIdentity(sanitized, identity),
      reason: "SANITIZED_FULL",
    });
  }

  // Variant 2: Identity-rich variant
  if (variants.length < 3) {
    const identityRich = buildIdentityRichVariant(identity);
    if (identityRich && identityRich !== sanitized) {
      const richNorm = compactIdentity(identityRich);
      if (richNorm && !seenNormalized.has(richNorm)) {
        seenNormalized.add(richNorm);
        variants.push({
          index: 2,
          originalText: identityRich,
          preservedIdentity: extractPreservedIdentity(identityRich, identity),
          reason: "IDENTITY_RICH",
        });
      }
    }
  }

  // Variant 3: Compact identity variant
  if (variants.length < 3) {
    const compact = buildCompactIdentityVariant(identity);
    if (compact && compact !== sanitized && compact !== buildIdentityRichVariant(identity)) {
      const compactNorm = compactIdentity(compact);
      if (compactNorm && !seenNormalized.has(compactNorm)) {
        seenNormalized.add(compactNorm);
        variants.push({
          index: 3,
          originalText: compact,
          preservedIdentity: extractPreservedIdentity(compact, identity),
          reason: "COMPACT_IDENTITY",
        });
      }
    }
  }

  // Renumber if any variants were skipped due to deduplication
  variants.forEach((v, i) => {
    v.index = i + 1;
  });

  return variants;
}

/**
 * Validate that variant preserves critical identity.
 * Used by acquisition phases to ensure variant attempts don't drop core identity.
 */
export function variantPreservesCriticalIdentity(
  variant: QueryVariant,
  identity: SanitizedIdentity,
): boolean {
  const preserved = variant.preservedIdentity;

  // If query requires brand, variant must have it
  if (identity.strongIdentity.brand && !preserved.brand) {
    return false;
  }

  // If query has model codes, at least one must be preserved
  if (identity.strongIdentity.modelCodes.length > 0 && preserved.modelCodes.length === 0) {
    return false;
  }

  // If query specifies storage, it must be preserved
  if (identity.strongIdentity.storage && !preserved.storage) {
    return false;
  }

  // If query specifies voltage, it must be preserved
  if (identity.strongIdentity.voltage && !preserved.voltage) {
    return false;
  }

  return true;
}
