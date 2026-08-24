export { buildQueryIntent } from "./queryIntent";
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
export * from "./types";
