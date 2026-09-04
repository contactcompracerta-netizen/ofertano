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
  extractBundleQuantity,
  extractModelTokens,
  classGroupOf,
  isAccessoryHead,
  isAttributeWord,
  isCapacityOrQuantityUnit,
  isReplacementHead,
  isDimensionHint,
  isStopWord,
  tokenize,
} from "./normalizeCandidate";
import { buildQueryCore, type QueryCore } from "./queryCore";
import { isApparelDescriptiveToken, isGenericDescriptor } from "./productConcepts";
import { findAdjacentModelNumberMismatch } from "./modelNumberIdentity";

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

  const anchorValues = new Set(core.identityAnchors.map((anchor) => anchor.value));
  const rawTokens = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  const normalizedTokens = rawTokens.map((token) => normalizeMultistoreText(token));
  const compactTokens = rawTokens.map((token) => compactIdentity(token));
  const isTitleCaseNominal = (token: string) =>
    /^[A-ZÀ-ÖØ-Þ][\p{Ll}]+$/u.test(token);

  const structuralCandidates = normalizedTokens.flatMap((token, index) => {
    const previous = compactTokens[index - 1] ?? "";
    const next = compactTokens[index + 1] ?? "";
    const followsNumber = /^\d+$/.test(previous);
    const precededByCode =
      anchorValues.has(previous) && /^\d+[a-z]{1,4}$/.test(previous);
    const followedByCode = anchorValues.has(next);
    const properNameSequence = [0, 1, 2].every((offset) =>
      isTitleCaseNominal(rawTokens[index + offset] ?? ""),
    );
    const excluded =
      token.length < 3 ||
      /\d/.test(token) ||
      token === core.soldHeadToken ||
      isStopWord(token) ||
      isAttributeWord(token) ||
      isAccessoryHead(token) ||
      isReplacementHead(token) ||
      isCapacityOrQuantityUnit(token) ||
      isDimensionHint(token) ||
      isGenericDescriptor(token) ||
      (core.productClass === "apparel" && isApparelDescriptiveToken(token)) ||
      Boolean(classGroupOf(token)) ||
      followsNumber;

    if (
      excluded ||
      !/[a-z]/.test(token) ||
      (!precededByCode && !followedByCode && !properNameSequence)
    ) {
      return [];
    }

    return [{ token, index }];
  });

  return structuralCandidates[0]?.token ?? null;
}

/**
 * Extract model codes (alphanumeric patterns like "520BT", "A55", "GTW").
 * Validates minimum length and digit presence.
 */
function extractModelCodes(query: string, core: QueryCore): string[] {
  const codes: string[] = [];

  // Use existing identity anchors that are alphanumeric codes
  for (const anchor of core.identityAnchors) {
    if (
      anchor.kind === "ALPHANUMERIC" ||
      anchor.kind === "LETTER_NUMBER" ||
      (anchor.kind === "MODEL" && /^[a-z]{3,8}$/.test(anchor.value))
    ) {
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
 * Returns the nominal portion of a product line after structural product
 * tokens and measurable specifications have been removed.
 */
export function extractNominalModelLineTokens(
  text: string,
  core: Pick<QueryCore, "soldHeadToken" | "brand">,
): string[] {
  return tokenize(text).filter((token) => {
    if (
      token === core.soldHeadToken ||
      token === core.brand ||
      /\d/.test(token) ||
      isStopWord(token) ||
      isAttributeWord(token) ||
      isAccessoryHead(token) ||
      isReplacementHead(token) ||
      isCapacityOrQuantityUnit(token) ||
      isDimensionHint(token) ||
      isGenericDescriptor(token) ||
      Boolean(classGroupOf(token))
    ) {
      return false;
    }

    return /[a-z]/.test(token);
  });
}

/**
 * Extract model line (e.g., "GTS Dexter", "Emilly Pop", "Slim", "GTW").
 */
function extractModelLine(query: string, core: QueryCore): string | null {
  const nominalTokens = extractNominalModelLineTokens(query, core);
  return nominalTokens.length > 0 ? nominalTokens.slice(0, 3).join(" ") : null;
}

export function findNominalModelLineMismatch(
  queryIdentity: QueryIdentity,
  candidateTitle: string,
): { queryValue: string; candidateValue: string } | null {
  const queryLine = queryIdentity.strongIdentity.modelLine;
  if (!queryLine) {
    return null;
  }

  const queryTokens = tokenize(queryLine);
  if (queryTokens.length < 2) {
    return null;
  }

  const candidateTokens = extractNominalModelLineTokens(
    candidateTitle,
    queryIdentity.queryCore,
  );
  if (candidateTokens.length < 2) {
    return null;
  }

  const sharesNominalToken = queryTokens.some((token) =>
    candidateTokens.includes(token),
  );
  if (sharesNominalToken) {
    return null;
  }

  return {
    queryValue: queryTokens.join(" "),
    candidateValue: candidateTokens.slice(0, 3).join(" "),
  };
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
 * Extract generic terms (product classes: "sofá", "aspirador", "bicicleta").
 */
function extractGenericTerms(query: string, core: QueryCore): string[] {
  const terms: string[] = [];

  if (core.productCoreLabels && core.productCoreLabels.length > 0) {
    terms.push(...core.productCoreLabels.map((l) =>
      normalizeMultistoreText(l).toLowerCase(),
    ));
  } else {
    // Keep the source product wording available to relevance when no semantic
    // product concept has been classified yet.
    terms.push(
      ...core.distinctiveTokens.filter(
        (token) =>
          !isGenericDescriptor(token) &&
          !isAttributeWord(token) &&
          !isCapacityOrQuantityUnit(token) &&
          !isDimensionHint(token),
      ),
    );
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
    bundleQuantity: extractBundleQuantity(sanitizedQuery),
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
      return { conflict: true, reason: `brand:${brand} not in candidate` };
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
    const compactQueryVoltage = queryVoltage.replace(/\s+/g, "");
    if (!candidateNorm.includes(queryVoltage)) {
      const voltageMatch = candidateNorm.match(/(\d+)\s*v(?![a-z0-9])/i);
      if (
        voltageMatch &&
        voltageMatch[0].toLowerCase().replace(/\s+/g, "") !== compactQueryVoltage
      ) {
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

  const modelLineMismatch = findNominalModelLineMismatch(
    queryIdentity,
    candidateTitle,
  );

  const modelNumberMismatch = findAdjacentModelNumberMismatch({
    query: queryIdentity.sanitizedQuery,
    candidate: candidateTitle,
    modelLine: queryIdentity.strongIdentity.modelLine,
    identityNumbers: queryIdentity.queryCore.identityNumbers,
  });
  if (modelNumberMismatch) {
    return {
      conflict: true,
      reason: `modelNumber:${modelNumberMismatch.queryNumber}!=${modelNumberMismatch.candidateNumber}`,
    };
  }

  if (modelLineMismatch) {
    return {
      conflict: true,
      reason: `modelLine:${modelLineMismatch.queryValue}!=${modelLineMismatch.candidateValue}`,
    };
  }

  // Hard conflict: bundle quantity mismatch when material
  if (queryIdentity.strongIdentity.bundleQuantity && queryIdentity.strongIdentity.bundleQuantity > 1) {
    const queryQty = queryIdentity.strongIdentity.bundleQuantity;
    const candidateQty = extractBundleQuantity(candidateTitle);
    if (candidateQty && candidateQty !== queryQty) {
      return {
        conflict: true,
        reason: `bundleQuantity:${queryQty}!=${candidateQty}`,
      };
    }
  }

  return { conflict: false };
}
