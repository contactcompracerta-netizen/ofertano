export { buildQueryIntent } from "./queryIntent";
export { buildQueryCore } from "./queryCore";
export { normalizeCandidate } from "./normalizeCandidate";
export { buildFingerprint } from "./fingerprint";
export { scoreQueryRelevance } from "./queryRelevance";
export { compareFingerprints } from "./pairMatcher";
export { clusterCandidates } from "./cluster";
export { canonicalizeCluster } from "./canonicalize";
export {
  acquireMarketplaces,
  buildSearchPlan,
  processRawCandidates,
  searchMultistoreV2,
  usarMotorMultistoreV2,
} from "./search";
export { persistCanonicalProducts } from "./persist";
export { traceV2 } from "./trace";
export { extractIdentityAnchors, hasStrongIdentity } from "./identityAnchors";
export {
  classifyListingAffiliate,
  isConfirmedAffiliateLink,
} from "./affiliateEligibility";
export { DEFAULT_SEARCH_BUDGET } from "./timeBudget";
export * from "./types";
