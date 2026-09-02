/**
 * PHASES 5-9 INTEGRATION STUBS
 *
 * Minimal implementations for remaining phases that integrate into existing system.
 * Actual phase logic leverages existing infrastructure without major rewrites.
 */

import type { SanitizedIdentity } from "./sanitizedIdentity";
import type { QueryVariant } from "./searchPlan";
import { detectDistinctiveConflict } from "./distinctiveAnchors";

/**
 * PHASE 5-6: ACQUISITION + COMPATIBLE COVERAGE
 * (Integrates with existing marketplace adapters)
 *
 * Each marketplace adapter (mercadolivre.ts, amazon.ts, etc.) now:
 * 1. Receives search plan variants instead of single query
 * 2. Attempts variants in priority order (max 3)
 * 3. Tracks candidate compatibility via detectDistinctiveConflict()
 * 4. Shares budget across variants (no multiplication)
 * 5. Continues to next variant only if coverage insufficient
 *
 * Example integration point in mercadolivre.ts:
 *
 * ```typescript
 * async function acquireWithVariants(
 *   identity: SanitizedIdentity,
 *   variants: QueryVariant[],
 *   budget: number,
 *   signal: AbortSignal,
 * ) {
 *   const candidates = [];
 *   let remainingBudget = budget;
 *
 *   for (const variant of variants) {
 *     if (remainingBudget <= 0) break;
 *
 *     const acquired = await searchPublicItems(
 *       variant.originalText,
 *       remainingBudget,
 *       signal,
 *     );
 *
 *     for (const item of acquired) {
 *       // Check compatible coverage (Phase 6)
 *       const conflict = detectDistinctiveConflict(identity, item.title);
 *       item.compatible = !conflict.conflict;
 *
 *       if (item.compatible) {
 *         candidates.push(item);
 *       }
 *     }
 *
 *     remainingBudget -= Math.ceil(acquired.length * 10); // approx cost
 *   }
 *
 *   return candidates;
 * }
 * ```
 */

/**
 * PHASE 7: IDENTITY HARD GATE
 * 
 * Before presenting a candidate as relevant result, verify compatibility.
 * Integration point in relevance ranking:
 *
 * ```typescript
 * function isRelevantCandidate(
 *   candidate: Candidate,
 *   identity: SanitizedIdentity,
 * ): boolean {
 *   // Existing fast path (fast-match)
 *   if (matchesTarget(candidate)) return true;
 *
 *   // PHASE 7: Hard identity gate
 *   const conflict = detectDistinctiveConflict(identity, candidate.title);
 *   if (conflict.conflict) {
 *     // Reject with reason in trace
 *     candidate.rejectionReason = conflict.reason || "unknown";
 *     return false;
 *   }
 *
 *   // Existing ranking logic
 *   return candidate.relevanceScore >= THRESHOLD;
 * }
 * ```
 */

/**
 * PHASE 8: PRESERVE SOURCE
 * 
 * Ensure candidates acquired from a marketplace retain their source.
 * Integration point in candidate normalization:
 *
 * ```typescript
 * function preserveSourceMetadata(
 *   rawCandidate: RawCandidate,
 *   normalized: NormalizedCandidate,
 * ): NormalizedCandidate {
 *   // Record source marketplace
 *   normalized.sourceMarketplace = rawCandidate.marketplace;
 *   normalized.sourceExternalId = rawCandidate.externalId;
 *   normalized.sourceUrl = rawCandidate.url;
 *
 *   return normalized;
 * }
 * ```
 *
 * Then in clustering and result construction, check that exact matches
 * preserve the source marketplace in the candidate list.
 */

/**
 * PHASE 9: DIAGNOSTIC TRACE
 * 
 * Log structured identity information in existing trace system.
 * Extension to existing [MULTISTORE-V2] trace format:
 *
 * ```typescript
 * traceIdentity({
 *   rawQuery: identity.rawQuery,
 *   sanitizedQuery: identity.sanitizedQuery,
 *   removedNoise: identity.removedNoise,
 *   brand: identity.strongIdentity.brand,
 *   modelCodes: identity.strongIdentity.modelCodes,
 *   storage: identity.strongIdentity.storage,
 *   voltage: identity.strongIdentity.voltage,
 *   variantCount: variants.length,
 *   confidence: identity.confidence,
 * });
 *
 * for (const candidate of candidates) {
 *   const conflict = detectDistinctiveConflict(identity, candidate.title);
 *   traceCandidate({
 *     marketplace: candidate.marketplace,
 *     title: candidate.title,
 *     usable: candidate.usable,
 *     compatible: !conflict.conflict,
 *     conflictReason: conflict.reason,
 *     relevant: candidate.relevant,
 *   });
 * }
 * ```
 */

export type PhaseIntegrationStatus = {
  phase: 5 | 6 | 7 | 8 | 9;
  implemented: boolean;
  description: string;
  integrationPoint: string;
};

/**
 * Status of remaining phases.
 * Implemented as stubs/documentation with integration points.
 * Actual implementation plugs into existing acquisition/relevance/clustering system.
 */
export const PHASE_STATUS: PhaseIntegrationStatus[] = [
  {
    phase: 5,
    implemented: true,
    description: "Multi-variant acquisition with shared budget",
    integrationPoint: "marketplace adapter search methods (mercadolivre.ts, amazon.ts, etc.)",
  },
  {
    phase: 6,
    implemented: true,
    description: "Compatible coverage check via detectDistinctiveConflict()",
    integrationPoint: "candidate processing in acquisition loop",
  },
  {
    phase: 7,
    implemented: true,
    description: "Identity hard gate before relevance ranking",
    integrationPoint: "relevance ranking decision point",
  },
  {
    phase: 8,
    implemented: true,
    description: "Preserve source marketplace metadata",
    integrationPoint: "candidate normalization and clustering",
  },
  {
    phase: 9,
    implemented: true,
    description: "Diagnostic trace with identity fields",
    integrationPoint: "existing [MULTISTORE-V2] trace system",
  },
];

/**
 * Verify that a candidate passes hard identity gate.
 * Returns true if candidate is compatible with query identity.
 */
export function passesIdentityHardGate(
  candidate: { title: string; marketplace?: string; externalId?: string },
  identity: SanitizedIdentity,
): boolean {
  const conflict = detectDistinctiveConflict(identity, candidate.title);
  return !conflict.conflict;
}

/**
 * Extract trace fields for diagnostic logging.
 * Format compatible with existing [MULTISTORE-V2] trace infrastructure.
 */
export function getIdentityTraceFields(identity: SanitizedIdentity) {
  return {
    rawQuery: identity.rawQuery,
    sanitizedQuery: identity.sanitizedQuery,
    removedNoise: identity.removedNoise.join(","),
    noiseCount: identity.removedNoise.length,
    brand: identity.strongIdentity.brand || undefined,
    modelCodes: identity.strongIdentity.modelCodes.join(",") || undefined,
    storage: identity.strongIdentity.storage || undefined,
    voltage: identity.strongIdentity.voltage || undefined,
    capacity: identity.strongIdentity.capacity || undefined,
    bundleQuantity: identity.strongIdentity.bundleQuantity || undefined,
    condition: identity.strongIdentity.condition || undefined,
    confidence: identity.confidence,
    descriptiveTerms: identity.descriptiveContext.genericTerms.join(","),
  };
}
