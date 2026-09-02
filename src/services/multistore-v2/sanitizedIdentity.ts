/**
 * INTEGRATION: Sanitizer + Identity Extraction
 *
 * Combines PHASE 1 (Query Sanitizer) and PHASE 2 (Query Identity)
 * into a single pipeline operation.
 */

import { sanitizeCommerceQuery, inferConditionFromQuery } from "./querySanitizer";
import { extractQueryIdentity, type QueryIdentity } from "./queryIdentity";

export type SanitizedIdentity = QueryIdentity & {
  removedNoise: string[];
  changed: boolean;
};

/**
 * Full pipeline: sanitize query → extract identity → set condition.
 * Returns complete identity with noise tracking.
 */
export function extractSanitizedIdentity(rawQuery: string): SanitizedIdentity {
  // Phase 1: Sanitize
  const sanitization = sanitizeCommerceQuery(rawQuery);

  // Phase 2: Extract identity from sanitized query
  const identity = extractQueryIdentity(sanitization.sanitizedQuery);

  // Set condition from sanitized query
  const condition = inferConditionFromQuery(sanitization.sanitizedQuery);
  identity.strongIdentity.condition = condition as any;

  return {
    ...identity,
    removedNoise: sanitization.removedNoise,
    changed: sanitization.changed,
  };
}
