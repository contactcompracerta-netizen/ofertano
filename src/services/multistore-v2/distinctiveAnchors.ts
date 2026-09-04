/**
 * PHASE 3 — DISTINCTIVE IDENTITY ANCHORS
 *
 * Detects generic identity conflicts between query and candidate.
 * Conservative: only rejects explicit incompatibilities without hardcoding.
 *
 * Handles:
 * - Brand conflicts (Lubeck ≠ Beegees)
 * - Storage conflicts (1TB ≠ 500GB)
 * - Voltage conflicts (220V ≠ 110V)
 * - Bundle quantity conflicts (4 pack ≠ single unit)
 * - Model code conflicts (PS4 ≠ PS5)
 * - Dimension conflicts (Aro 29 ≠ Aro 26)
 */

import type { QueryIdentity } from "./queryIdentity";
import { findNominalModelLineMismatch } from "./queryIdentity";
import { findAdjacentModelNumberMismatch } from "./modelNumberIdentity";
import {
  extractBundleQuantity,
  normalizeMultistoreText,
} from "./normalizeCandidate";
import {
  alphanumericCodeOccurs,
  extractIdentityAnchors,
} from "./identityAnchors";

export type IdentityConflictReason =
  | "brand_mismatch"
  | "model_code_mismatch"
  | "storage_mismatch"
  | "voltage_mismatch"
  | "bundle_quantity_mismatch"
  | "dimension_mismatch"
  | "condition_mismatch"
  | "model_line_mismatch"
  | "capacity_mismatch";

export type IdentityConflictDetail = {
  conflict: boolean;
  reason?: IdentityConflictReason;
  description?: string;
  queryValue?: string;
  candidateValue?: string;
};

/**
 * Extract numeric value and unit from storage string (e.g., "1TB" → { value: 1, unit: "TB" }).
 */
function parseStorageValue(storage: string | null): { value: number; unit: string } | null {
  if (!storage) return null;

  const match = storage.match(/^(\d+(?:\.\d+)?)\s*([gt]b)$/i);
  if (!match) return null;

  return {
    value: parseFloat(match[1]),
    unit: match[2].toUpperCase(),
  };
}

/**
 * Normalize storage values to same unit for comparison.
 * 1TB = 1024GB for strict comparison.
 */
function normalizeStorageToGB(parsed: { value: number; unit: string }): number {
  if (parsed.unit === "TB") {
    return parsed.value * 1024;
  }
  return parsed.value;
}

/**
 * Extract numeric value from voltage (e.g., "220V" → 220).
 */
function parseVoltage(voltage: string | null): number | null {
  if (!voltage) return null;

  const match = voltage.match(/^(\d+)\s*v?$/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Detect if a value appears in candidate text.
 * Handles alphanumeric codes with presentation variations.
 */
function appearsinCandidate(value: string, candidate: string): boolean {
  const normalized = normalizeMultistoreText(candidate).toLowerCase();
  const searchValue = normalizeMultistoreText(value).toLowerCase();

  // Exact substring match after normalization
  if (normalized.includes(searchValue)) {
    return true;
  }

  // For alphanumeric codes, use special matching rules
  if (/^[a-z]\d+[a-z]?$/i.test(value)) {
    return alphanumericCodeOccurs(candidate, value, "alnum");
  }

  return false;
}

/**
 * Extract storage value from candidate title.
 * Looks for patterns like "1TB", "500GB", "256GB", etc.
 */
function extractStorageFromCandidate(candidate: string): string | null {
  const normalized = normalizeMultistoreText(candidate).toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*([gt]b)(?![a-z0-9])/);
  return match ? match[0] : null;
}

/**
 * Extract voltage from candidate title.
 */
function extractVoltageFromCandidate(candidate: string): string | null {
  const normalized = normalizeMultistoreText(candidate).toLowerCase();
  const match = normalized.match(/(\d+)\s*v(?![a-z0-9])/);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Extract dimensions from candidate (e.g., "Aro 29", "Quadro 21").
 */
function extractDimensionsFromCandidate(candidate: string): string | null {
  const normalized = normalizeMultistoreText(candidate).toLowerCase();
  const match = normalized.match(
    /(aro|quadro|tamanho|frame)\s+(\d+(?:[.,]\d+)?)/i,
  );
  return match ? match[0] : null;
}

/**
 * Detect brand mismatch.
 * Conservative: only flag if query has explicit brand AND candidate has DIFFERENT brand.
 */
function checkBrandConflict(
  queryIdentity: QueryIdentity,
  candidate: string,
): IdentityConflictDetail | null {
  const brand = queryIdentity.strongIdentity.brand;
  if (!brand) return null;

  // Check if brand appears in candidate
  if (appearsinCandidate(brand, candidate)) {
    return null; // No conflict
  }

  // Any extracted brand is an explicit requirement for the query unless it is
  // clearly not a brand-like token. Prefer the conservative rule: if the brand
  // was extracted from the query, a different candidate brand is a hard conflict.
  const brandIsRequired = true;

  if (!brandIsRequired) {
    return null;
  }

  return {
    conflict: true,
    reason: "brand_mismatch",
    description: `Query requires brand "${brand}" but candidate does not contain it`,
    queryValue: brand,
  };
}

/**
 * Detect storage mismatch (e.g., "1TB" vs "500GB").
 * Strict: if query specifies storage, candidate must match or have compatible storage.
 */
function checkStorageConflict(
  queryIdentity: QueryIdentity,
  candidate: string,
): IdentityConflictDetail | null {
  const queryStorage = queryIdentity.strongIdentity.storage;
  if (!queryStorage) return null;

  // Check if query storage appears in candidate
  if (appearsinCandidate(queryStorage, candidate)) {
    return null; // No conflict
  }

  // Extract candidate storage
  const candidateStorage = extractStorageFromCandidate(candidate);
  if (!candidateStorage) {
    // No storage in candidate — could be compatible or not
    // Conservative: don't reject (missing field ≠ conflict)
    return null;
  }

  // Parse both
  const queryParsed = parseStorageValue(queryStorage);
  const candidateParsed = parseStorageValue(candidateStorage);

  if (queryParsed && candidateParsed) {
    const queryGB = normalizeStorageToGB(queryParsed);
    const candidateGB = normalizeStorageToGB(candidateParsed);

    if (queryGB !== candidateGB) {
      return {
        conflict: true,
        reason: "storage_mismatch",
        description: `Query requires ${queryStorage} but candidate offers ${candidateStorage}`,
        queryValue: queryStorage,
        candidateValue: candidateStorage,
      };
    }
  }

  return null;
}

/**
 * Detect voltage mismatch (e.g., "220V" vs "110V").
 * Strict: electrical appliances must match voltage specification.
 */
function checkVoltageConflict(
  queryIdentity: QueryIdentity,
  candidate: string,
): IdentityConflictDetail | null {
  const queryVoltage = queryIdentity.strongIdentity.voltage;
  if (!queryVoltage) return null;

  // Check if query voltage appears in candidate
  if (appearsinCandidate(queryVoltage, candidate)) {
    return null; // No conflict
  }

  // Extract candidate voltage
  const candidateVoltage = extractVoltageFromCandidate(candidate);
  if (!candidateVoltage) {
    // No voltage in candidate — conservative, don't reject
    return null;
  }

  // Compare numeric values
  const queryVolts = parseVoltage(queryVoltage);
  const candidateVolts = parseVoltage(candidateVoltage);

  if (queryVolts && candidateVolts && queryVolts !== candidateVolts) {
    return {
      conflict: true,
      reason: "voltage_mismatch",
      description: `Query requires ${queryVoltage} but candidate offers ${candidateVoltage}`,
      queryValue: queryVoltage,
      candidateValue: candidateVoltage,
    };
  }

  return null;
}

/**
 * Detect bundle quantity mismatch.
 * Strict: if query specifies bundle quantity (KIT 4, 2-pack), candidate must provide same.
 */
function checkBundleQuantityConflict(
  queryIdentity: QueryIdentity,
  candidate: string,
): IdentityConflictDetail | null {
  const queryQty = queryIdentity.strongIdentity.bundleQuantity;
  if (!queryQty || queryQty <= 1) return null;

  const candidateQty = extractBundleQuantity(candidate);
  if (candidateQty && candidateQty !== queryQty) {
    return {
      conflict: true,
      reason: "bundle_quantity_mismatch",
      description: `Query requires ${queryQty}-pack but candidate offers ${candidateQty}`,
      queryValue: String(queryQty),
      candidateValue: String(candidateQty),
    };
  }

  return null;
}

/**
 * Detect model code mismatch (e.g., "PS4" vs "PS5").
 * Strict if query specifies explicit model codes.
 */
function checkModelCodeConflict(
  queryIdentity: QueryIdentity,
  candidate: string,
): IdentityConflictDetail | null {
  const codes = queryIdentity.strongIdentity.modelCodes;
  if (codes.length === 0) return null;

  // Check if ANY query code appears in candidate
  for (const code of codes) {
    if (appearsinCandidate(code, candidate)) {
      return null; // At least one code matches
    }
  }

  // All codes are absent. Check if candidate has CONFLICTING code.
  const candidateCodes = extractIdentityAnchors(candidate)
    .filter((anchor) =>
      anchor.kind === "ALPHANUMERIC" ||
      anchor.kind === "LETTER_NUMBER" ||
      anchor.kind === "MODEL",
    )
    .map((anchor) => anchor.value);

  const conflictingCode = candidateCodes.find(
    (candidateCode) =>
      !codes.some(
        (code) =>
          normalizeMultistoreText(code).toLowerCase() ===
          normalizeMultistoreText(candidateCode).toLowerCase(),
      ),
  );

  if (conflictingCode) {
    return {
      conflict: true,
      reason: "model_code_mismatch",
      description: `Query requires model ${codes.join(" or ")} but candidate appears to be ${conflictingCode}`,
      queryValue: codes[0],
      candidateValue: conflictingCode,
    };
  }

  return null;
}

function checkModelLineConflict(
  queryIdentity: QueryIdentity,
  candidate: string,
): IdentityConflictDetail | null {
  const modelNumberMismatch = findAdjacentModelNumberMismatch({
    query: queryIdentity.sanitizedQuery,
    candidate,
    modelLine: queryIdentity.strongIdentity.modelLine,
    identityNumbers: queryIdentity.queryCore.identityNumbers,
  });
  if (modelNumberMismatch) {
    return {
      conflict: true,
      reason: "model_line_mismatch",
      description: `Query requires model ${modelNumberMismatch.queryNumber} but candidate offers ${modelNumberMismatch.candidateNumber}`,
      queryValue: modelNumberMismatch.queryNumber,
      candidateValue: modelNumberMismatch.candidateNumber,
    };
  }

  const mismatch = findNominalModelLineMismatch(queryIdentity, candidate);
  if (!mismatch) {
    return null;
  }

  return {
    conflict: true,
    reason: "model_line_mismatch",
    description: `Query requires model line ${mismatch.queryValue} but candidate offers ${mismatch.candidateValue}`,
    queryValue: mismatch.queryValue,
    candidateValue: mismatch.candidateValue,
  };
}

/**
 * Detect dimension mismatch (e.g., "Aro 29" vs "Aro 26").
 * Used for vehicles, furniture, etc.
 */
function checkDimensionConflict(
  queryIdentity: QueryIdentity,
  candidate: string,
): IdentityConflictDetail | null {
  const queryDim = queryIdentity.descriptiveContext.dimensions;
  if (!queryDim) return null;

  // Check if query dimension appears in candidate
  if (appearsinCandidate(queryDim, candidate)) {
    return null; // No conflict
  }

  // Extract candidate dimension
  const candidateDim = extractDimensionsFromCandidate(candidate);
  if (!candidateDim) {
    // No dimension in candidate — conservative, don't reject
    return null;
  }

  // Parse both for numeric comparison
  const queryDimMatch = queryDim.match(/(\d+)/);
  const candidateDimMatch = candidateDim.match(/(\d+)/);

  if (queryDimMatch && candidateDimMatch) {
    if (queryDimMatch[1] !== candidateDimMatch[1]) {
      return {
        conflict: true,
        reason: "dimension_mismatch",
        description: `Query requires ${queryDim} but candidate offers ${candidateDim}`,
        queryValue: queryDim,
        candidateValue: candidateDim,
      };
    }
  }

  return null;
}

/**
 * Detect capacity mismatch (e.g., "12L" vs "20L").
 */
function checkCapacityConflict(
  queryIdentity: QueryIdentity,
  candidate: string,
): IdentityConflictDetail | null {
  const queryCapacity = queryIdentity.strongIdentity.capacity;
  if (!queryCapacity) return null;

  // Check if query capacity appears in candidate
  if (appearsinCandidate(queryCapacity, candidate)) {
    return null;
  }

  // Extract candidate capacity
  const normalized = normalizeMultistoreText(candidate).toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*([lmk]l)(?![a-z0-9])/);
  if (!match) return null;

  const candidateCapacity = match[0];
  if (candidateCapacity.toLowerCase() !== queryCapacity.toLowerCase()) {
    return {
      conflict: true,
      reason: "capacity_mismatch",
      description: `Query requires ${queryCapacity} but candidate offers ${candidateCapacity}`,
      queryValue: queryCapacity,
      candidateValue: candidateCapacity,
    };
  }

  return null;
}

/**
 * Comprehensive identity conflict detection.
 * Returns first hard conflict found, or null if compatible.
 */
export function detectDistinctiveConflict(
  queryIdentity: QueryIdentity,
  candidateTitle: string,
): IdentityConflictDetail {
  // Check each conflict type in priority order
  const checks = [
    () => checkBrandConflict(queryIdentity, candidateTitle),
    () => checkModelCodeConflict(queryIdentity, candidateTitle),
    () => checkModelLineConflict(queryIdentity, candidateTitle),
    () => checkStorageConflict(queryIdentity, candidateTitle),
    () => checkVoltageConflict(queryIdentity, candidateTitle),
    () => checkBundleQuantityConflict(queryIdentity, candidateTitle),
    () => checkDimensionConflict(queryIdentity, candidateTitle),
    () => checkCapacityConflict(queryIdentity, candidateTitle),
  ];

  for (const check of checks) {
    const result = check();
    if (result) {
      return result;
    }
  }

  // No conflicts detected
  return { conflict: false };
}
