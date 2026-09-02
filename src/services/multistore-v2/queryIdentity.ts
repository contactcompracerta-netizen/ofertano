/**
 * PHASE 2 — QUERY IDENTITY
 *
 * Extracts structured identity components from sanitized queries.
 * Distinguishes STRONG_IDENTITY (must be preserved in variants) from
 * DESCRIPTIVE_CONTEXT (can vary but absence is a penalty).
 *
 * NO HARDCODING: Brand names, model names, lines, etc. appear ONLY in tests.
 */

import type { IdentityAnchor } from "./types";
import {
  alphanumericCodeOccurs,
  compactIdentity,
  humanizeAnchor,
} from "./identityAnchors";
import { 
  normalizeMultistoreText,
  extractModelTokens,
  tokenize,
} from "./normalizeCandidate";
import { buildQueryCore, type QueryCore } from "./queryCore";

/**
 * STRONG_IDENTITY: Must be preserved across all query variants.
 * Absence = hard conflict if explicitly required by user.
 */
export type StrongIdentity = {
  brand: string | null;
  modelCodes: string[]; // alphanumeric codes like "520BT", "55G"
  modelName: string | null;
  modelLine: string | null;
  capacity: string | null; // "1TB", "500GB", "12L"
  storage: string | null; // "256GB", "512GB"
  voltage: string | null; // "110V", "220V", "127V"
  color: string | null;
  condition: "refurbished" | "used" | "repackaged" | null; // from sanitizer
  bundleQuantity: number | null; // 2, 4, etc. when significant
};

/**
 * DESCRIPTIVE_CONTEXT: Enrichment data; absence is penalty, not hard conflict.
 * Used for ranking and fast-path optimization.
 */
export type DescriptiveContext = {
  genericTerms: string[]; // "sofá", "aspirador", "bicicleta"
  dimensions: string | null; // "aro 29", "quadro 21"
  bundleInclusions: string[]; // "jogos", "controles", "cupom"
  hostContext: string | null; // vehicle model, appliance brand for products
  roleClass: "MAIN" | "ACCESSORY" | "REPLACEMENT_PART"; // product role
};

/**
 * Complete structured identity for a query.
 * Combines strong identity (must preserve) with descriptive context (enrichment).
 */
export type QueryIdentity = {
  rawQuery: string;
  sanitizedQuery: string;

  strongIdentity: StrongIdentity;
  descriptiveContext: DescriptiveContext;

  // Confidence in identity extraction
  confidence: "HIGH" | "MEDIUM" | "LOW";

  // Extracted identity anchors (from existing system)
  identityAnchors: IdentityAnchor[];

  // Query core for variant generation
  queryCore: QueryCore;
};

/**
 * Extract brand from query using existing tokenization.
 * Very conservative to avoid false positives.
 */
function extractBrand(query: string, core: QueryCore): string | null {
  if (core.brand) {
    return core.brand;
  }
  return null;
}

/**
 * Extract model codes (alphanumeric patterns like "520BT", "A55", "GTW").
 * Validates minimum length and digit presence.
 */
function extractModelCodes(query: string, core: QueryCore): string[] {
  const codes: string[] = [];

  // Use existing identity anchors that are alphanumeric codes
  for (const anchor of core.identityAnchors) {
    if (anchor.kind === "ALPHANUMERIC" || anchor.kind === "LETTER_NUMBER") {
      codes.push(anchor.value);
    }
  }

  return [...new Set(codes)]; // deduplicate
}

/**
 * Extract model name (common patterns: "Slim", "Pro", "Max", "Plus", "Pop").
 * Must appear after brand and be substantial.
 */
function extractModelName(query: string, core: QueryCore): string | null {
  const normalized = normalizeMultistoreText(query);
  const tokens = tokenize(query);

  // Look for capitalized tokens that could be model names
  const modelTokens = extractModelTokens(tokens);
  if (modelTokens && modelTokens.length > 0) {
    return modelTokens[0];
  }

  return null;
}

/**
 * Extract model line (e.g., "GTS Dexter", "Emilly Pop", "Slim", "GTW").
 * Appears in soldText or identity anchors.
 */
function extractModelLine(query: string, core: QueryCore): string | null {
  const normalized = normalizeMultistoreText(query);

  // Check for specific line patterns in sold text
  if (core.soldText) {
    const soldTokens = core.soldText.split(/\s+/);
    // Often first 2-3 tokens after brand
    if (soldTokens.length >= 2) {
      const line = soldTokens.slice(0, 3).join(" ");
      if (line.length >= 4) {
        return line;
      }
    }
  }

  return null;
}

/**
 * Extract capacity (volume, liquid measure: "1L", "12L", "500ml").
 */
function extractCapacity(query: string, core: QueryCore): string | null {
  const attr = core.attributes.capacity;
  if (attr) {
    return attr;
  }
  return null;
}

/**
 * Extract storage (data: "256GB", "512GB", "1TB", "500GB").
 */
function extractStorage(query: string, core: QueryCore): string | null {
  // Look for storage-specific patterns in attributes or identity anchors
  const normalized = normalizeMultistoreText(query).toLowerCase();

  const storageMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(gb|tb|mb)(?![a-z0-9])/i,
  );
  if (storageMatch) {
    return storageMatch[0];
  }

  return null;
}

/**
 * Extract voltage (electrical supply: "110V", "220V", "127V").
 */
function extractVoltage(query: string, core: QueryCore): string | null {
  const attr = core.attributes.voltage;
  if (attr) {
    return attr;
  }

  // Also check identity anchors for voltage patterns
  const normalized = normalizeMultistoreText(query).toLowerCase();
  const voltageMatch = normalized.match(/(\d+)\s*v(?![\w])/i);
  if (voltageMatch) {
    return voltageMatch[0].toUpperCase();
  }

  return null;
}

/**
 * Extract color attribute.
 */
function extractColor(query: string, core: QueryCore): string | null {
  const attr = core.attributes.color;
  if (attr) {
    return attr;
  }
  return null;
}

/**
 * Extract bundle quantity (2, 4, etc.) when it's significant to the product.
 * Only extract if explicitly present and material to the product.
 */
function extractBundleQuantity(query: string, core: QueryCore): number | null {
  const attr = core.attributes.quantity;
  if (attr) {
    const match = attr.match(/^(\d+)/);
    if (match) {
      const qty = parseInt(match[1], 10);
      // Only meaningful quantities (2-99)
      if (qty >= 2 && qty <= 99) {
        return qty;
      }
    }
  }
  return null;
}

/**
 * Extract generic terms (product classes: "sofá", "aspirador", "bicicleta").
 */
function extractGenericTerms(query: string, core: QueryCore): string[] {
  const terms: string[] = [];

  if (core.productCoreLabels && core.productCoreLabels.length > 0) {
    terms.push(...core.productCoreLabels.map((l) =>
      normalizeMultistoreText(l).toLowerCase(),
    ));
  }

  // Add product class if known
  if (core.productClass && core.productClass !== "UNKNOWN") {
    terms.push(core.productClass.toLowerCase());
  }

  return [...new Set(terms)];
}

/**
 * Extract dimensions (e.g., "aro 29", "quadro 21").
 * For vehicles specifically: frame size, wheel size, etc.
 */
function extractDimensions(query: string, core: QueryCore): string | null {
  const size = core.attributes.size;
  if (size) {
    return size;
  }

  // Look for size patterns: "aro NN", "quadro NN"
  const normalized = normalizeMultistoreText(query).toLowerCase();
  const dimMatch = normalized.match(
    /(aro|quadro|tamanho|tamanho)\s+(\d+(?:[.,]\d+)?)/i,
  );
  if (dimMatch) {
    return dimMatch[0];
  }

  return null;
}

/**
 * Extract bundle inclusions (extra items: "jogos", "controles", "cupom").
 */
function extractBundleInclusions(query: string, core: QueryCore): string[] {
  const inclusions: string[] = [];
  const normalized = normalizeMultistoreText(query).toLowerCase();

  // Common inclusion patterns
  const patterns = [
    /jogos?(?:\s+\(.*?\))?/,
    /controles?/,
    /cupom/,
    /jogo\s+(?:de\s+)?/,
    /cabo(?:s)?/,
    /carregador/,
  ];

  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      const match = normalized.match(pattern);
      if (match) {
        inclusions.push(match[0]);
      }
    }
  }

  return [...new Set(inclusions)];
}

/**
 * Extract host context (vehicle model, appliance brand).
 * Used for vehicle accessories or appliance components.
 */
function extractHostContext(query: string, core: QueryCore): string | null {
  if (core.hostText) {
    return core.hostText;
  }
  return null;
}

/**
 * Determine product role based on query content.
 */
function determineRole(query: string, core: QueryCore): "MAIN" | "ACCESSORY" | "REPLACEMENT_PART" {
  const normalized = normalizeMultistoreText(query).toLowerCase();

  // Check for accessory indicators
  if (
    /(?:estojo|capa|case|cover|cabo|carregador|adaptador|protetor|filtro|saco|refill)/i.test(
      normalized,
    )
  ) {
    return "ACCESSORY";
  }

  // Check for replacement part indicators
  if (/(?:reposição|substituição|refil|peça|lâmina|cobertor)/i.test(normalized)) {
    return "REPLACEMENT_PART";
  }

  return "MAIN";
}

/**
 * Calculate confidence in identity extraction.
 * HIGH: brand + model/line + strong identity anchors
 * MEDIUM: partial identity
 * LOW: few identity signals
 */
function calculateConfidence(identity: StrongIdentity, anchors: IdentityAnchor[]): "HIGH" | "MEDIUM" | "LOW" {
  let signals = 0;

  if (identity.brand) signals++;
  if (identity.modelName) signals++;
  if (identity.modelLine) signals++;
  if (identity.modelCodes.length > 0) signals += Math.min(identity.modelCodes.length, 2);
  if (identity.capacity) signals++;
  if (identity.storage) signals++;
  if (identity.voltage) signals++;
  if (identity.color) signals++;
  if (identity.bundleQuantity) signals++;

  signals += Math.min(anchors.length, 3);

  if (signals >= 5) return "HIGH";
  if (signals >= 2) return "MEDIUM";
  return "LOW";
}

/**
 * Extract complete structured identity from a sanitized query.
 * Reuses existing QueryCore infrastructure and identity anchor extraction.
 */
export function extractQueryIdentity(sanitizedQuery: string): QueryIdentity {
  const core = buildQueryCore(sanitizedQuery);

  const strongIdentity: StrongIdentity = {
    brand: extractBrand(sanitizedQuery, core),
    modelCodes: extractModelCodes(sanitizedQuery, core),
    modelName: extractModelName(sanitizedQuery, core),
    modelLine: extractModelLine(sanitizedQuery, core),
    capacity: extractCapacity(sanitizedQuery, core),
    storage: extractStorage(sanitizedQuery, core),
    voltage: extractVoltage(sanitizedQuery, core),
    color: extractColor(sanitizedQuery, core),
    condition: null, // will be set by caller from sanitizer
    bundleQuantity: extractBundleQuantity(sanitizedQuery, core),
  };

  const descriptiveContext: DescriptiveContext = {
    genericTerms: extractGenericTerms(sanitizedQuery, core),
    dimensions: extractDimensions(sanitizedQuery, core),
    bundleInclusions: extractBundleInclusions(sanitizedQuery, core),
    hostContext: extractHostContext(sanitizedQuery, core),
    roleClass: determineRole(sanitizedQuery, core),
  };

  const confidence = calculateConfidence(strongIdentity, core.identityAnchors);

  return {
    rawQuery: sanitizedQuery,
    sanitizedQuery,
    strongIdentity,
    descriptiveContext,
    confidence,
    identityAnchors: core.identityAnchors,
    queryCore: core,
  };
}

/**
 * Detect explicit hard conflict between query identity and candidate identity.
 * Conservative: only reject when there's CONCRETE incompatibility evidence.
 *
 * Hard conflicts:
 * - brand mismatch (e.g., "Lubeck" query != "Beegees" candidate)
 * - storage mismatch (e.g., "1TB" query != "500GB" candidate)
 * - voltage mismatch (e.g., "220V" query != "110V" candidate)
 * - bundle quantity mismatch when material (e.g., "4 pack" != "1 unit")
 * - model code mismatch (e.g., "PS4" query != "PS5" candidate)
 *
 * NOT conflicts:
 * - missing descriptive context (penalty, not rejection)
 * - unknown identity fields (absence of evidence ≠ evidence of absence)
 */
export function detectIdentityConflict(
  queryIdentity: QueryIdentity,
  candidateTitle: string,
): { conflict: boolean; reason?: string } {
  const candidateNorm = normalizeMultistoreText(candidateTitle).toLowerCase();

  // Hard conflict: brand mismatch
  if (queryIdentity.strongIdentity.brand) {
    const brand = queryIdentity.strongIdentity.brand.toLowerCase();
    if (!candidateNorm.includes(brand)) {
      // But only if brand is explicitly required (strong anchor)
      const brandIsStrong = queryIdentity.identityAnchors.some(
        (a) => a.value.toLowerCase() === brand && a.required,
      );
      if (brandIsStrong) {
        return { conflict: true, reason: `brand:${brand} not in candidate` };
      }
    }
  }

  // Hard conflict: storage mismatch
  if (queryIdentity.strongIdentity.storage) {
    const queryStorage = queryIdentity.strongIdentity.storage.toLowerCase();
    if (!candidateNorm.includes(queryStorage)) {
      // Check if candidate has DIFFERENT storage
      const storageMatch = candidateNorm.match(/(\d+(?:\.\d+)?)\s*(?:gb|tb)(?![a-z0-9])/i);
      if (storageMatch && storageMatch[0].toLowerCase() !== queryStorage) {
        return {
          conflict: true,
          reason: `storage:${queryStorage}!=${storageMatch[0]}`,
        };
      }
    }
  }

  // Hard conflict: voltage mismatch
  if (queryIdentity.strongIdentity.voltage) {
    const queryVoltage = queryIdentity.strongIdentity.voltage.toLowerCase();
    if (!candidateNorm.includes(queryVoltage)) {
      const voltageMatch = candidateNorm.match(/(\d+)\s*v(?![a-z0-9])/i);
      if (voltageMatch && voltageMatch[0].toLowerCase() !== queryVoltage) {
        return {
          conflict: true,
          reason: `voltage:${queryVoltage}!=${voltageMatch[0]}`,
        };
      }
    }
  }

  // Hard conflict: model code mismatch
  if (queryIdentity.strongIdentity.modelCodes.length > 0) {
    const codes = queryIdentity.strongIdentity.modelCodes.map((c) => c.toLowerCase());
    const hasSomeCode = codes.some((code) => candidateNorm.includes(code));

    if (!hasSomeCode) {
      // Check if candidate has CONFLICTING model code
      const codePattern = /(?:^|[^a-z0-9])([a-z]\d+[a-z]?)(?![a-z0-9])/i;
      const candidateCode = candidateNorm.match(codePattern);
      if (candidateCode && !codes.includes(candidateCode[1].toLowerCase())) {
        return {
          conflict: true,
          reason: `modelCode:${codes[0]}!=${candidateCode[1]}`,
        };
      }
    }
  }

  // Hard conflict: bundle quantity mismatch when material
  if (queryIdentity.strongIdentity.bundleQuantity && queryIdentity.strongIdentity.bundleQuantity > 1) {
    const queryQty = queryIdentity.strongIdentity.bundleQuantity;
    // Only reject if candidate shows DIFFERENT bundle quantity
    const qtyMatch = candidateNorm.match(/(?:kit\s+)?(\d+)\s+(?:pack|unidades?|peças?|un\.?)/i);
    if (qtyMatch) {
      const candidateQty = parseInt(qtyMatch[1], 10);
      if (candidateQty !== queryQty && candidateQty === 1) {
        // Query wants bundle but candidate is single unit
        return {
          conflict: true,
          reason: `bundleQuantity:${queryQty}!=1`,
        };
      }
    }
  }

  return { conflict: false };
}
