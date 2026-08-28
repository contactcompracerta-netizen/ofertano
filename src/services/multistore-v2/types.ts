export type MarketplaceCode =
  | "MERCADO_LIVRE"
  | "AMAZON"
  | "SHOPEE"
  | "MAGAZINE_LUIZA"
  | "ALIEXPRESS";

export type AcquisitionStatus =
  | "SUCCESS"
  | "EMPTY"
  | "BLOCKED"
  | "ERROR"
  | "UNUSABLE"
  | "TIMEOUT"
  | "NOT_RUN";

export type IdentityAnchorKind =
  | "MODEL"
  | "SKU"
  | "ALPHANUMERIC"
  | "LETTER_NUMBER"
  | "BOUND_NUMBER";

export type IdentityAnchor = {
  value: string;
  kind: IdentityAnchorKind;
  required: boolean;
};

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type FieldSource =
  | "STRUCTURED_ATTRIBUTE"
  | "TITLE"
  | "QUERY"
  | "INFERRED"
  | "UNKNOWN";

export type ProductRole =
  | "MAIN"
  | "ACCESSORY"
  | "REPLACEMENT_PART"
  | "UNKNOWN";

export type RankTier = 0 | 1 | 2 | 3;

export type AffiliateStatus =
  | "READY"
  | "INELIGIBLE"
  | "UNKNOWN"
  | "ERROR";

export type EvidenceField<T> = {
  value: T | null;
  confidence: Confidence;
  source: FieldSource;
};

export type QueryIntent = {
  rawQuery: string;
  normalizedQuery: string;
  requestedRole: ProductRole;
  productClass: string;
  brand: string | null;
  modelTokens: string[];
  variantTokens: string[];
  importantAttributes: Record<string, string>;
  normalizedTokens: string[];
  distinctiveTokens: string[];
  distinctiveContext: string[];
  identityNumbers: string[];
  identityAnchors: IdentityAnchor[];
  hasStrongIdentity: boolean;
  productCore: string[];
  compatibilityTarget: string | null;
  soldText: string;
  hostText: string | null;
  productClassConfidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  weakModifiers: string[];
};

export type RawCandidate = {
  marketplace: MarketplaceCode;
  marketplaceName: string;
  externalId: string;
  title: string;
  price: number | null;
  url: string;
  image: string | null;
  brand: string | null;
  category: string | null;
  seller: string | null;
  affiliateLink: string | null;
  affiliateStatus?: AffiliateStatus;
  attributes: Record<string, string>;
  raw?: unknown;
};

export type MarketplaceAcquisition = {
  marketplace: MarketplaceCode;
  marketplaceName: string;
  status: AcquisitionStatus;
  raw: number;
  usable: number;
  error: string | null;
  elapsedMs: number;
  candidates: RawCandidate[];
};

export type NormalizedCandidate = {
  id: string;
  raw: RawCandidate;
  rawText: string;
  normalizedText: string;
  tokens: string[];
  structuredBrand: string | null;
  structuredModel: string | null;
  structuredSku: string | null;
  attributes: Record<string, string>;
};

export type ProductFingerprint = {
  soldItem: EvidenceField<string>;
  hostItem: EvidenceField<string>;
  role: EvidenceField<ProductRole>;
  productClass: EvidenceField<string>;
  brand: EvidenceField<string>;
  family: EvidenceField<string>;
  model: EvidenceField<string>;
  manufacturerSku: EvidenceField<string>;
  variantCodes: EvidenceField<string[]>;
  capacity: EvidenceField<string>;
  size: EvidenceField<string>;
  color: EvidenceField<string>;
  quantity: EvidenceField<string>;
  material: EvidenceField<string>;
  condition: EvidenceField<string>;
  importantAttributes: Record<string, string>;
  distinctiveTokens: string[];
  identityNumbers: string[];
  identityAnchors: string[];
  lexicalSignature: string[];
  marketplaceCategory: EvidenceField<string>;
};

export type RelevanceEvidenceState = "MATCH" | "UNKNOWN" | "CONFLICT" | "MISSING";

export type QueryRelevanceEvidence = {
  accepted: boolean;
  productClassCompatibility: RelevanceEvidenceState;
  productCoreCoverage: RelevanceEvidenceState;
  brandCompatibility: RelevanceEvidenceState;
  strongIdentityCompatibility: RelevanceEvidenceState;
  attributeMatches: string[];
  attributeMissing: string[];
  attributeConflicts: string[];
  compatibilityMatches: string[];
  compatibilityConflicts: string[];
  distinctiveTermsMatched: string[];
  distinctiveTermsMissing: string[];
  weakTokenContribution: number;
  roleCompatibility: RelevanceEvidenceState;
};

export type ScoredCandidate = {
  id: string;
  normalized: NormalizedCandidate;
  fingerprint: ProductFingerprint;
  queryRelevance: number;
  matchedTerms: string[];
  missingTerms: string[];
  extraTerms: string[];
  hardConflicts: string[];
  status: "RELEVANT" | "REJECTED";
  reason: string;
  evidence: QueryRelevanceEvidence;
  rankTier: RankTier;
};

export type PairRelation = "SAME" | "DIFFERENT" | "UNKNOWN";

export type PairVerdict = {
  relation: PairRelation;
  hardConflicts: string[];
  positiveEvidence: string[];
  confidence: number;
};

export type ClusterMember = {
  candidate: ScoredCandidate;
};

export type ProductCluster = {
  clusterId: string;
  identity: ProductFingerprint;
  members: ClusterMember[];
  confidence: number;
};

export type CanonicalProduct = {
  clusterId: string;
  title: string;
  image: string;
  description: string | null;
  brand: string | null;
  price: number;
  oldPrice: number | null;
  primaryMarketplace: string;
  offers: CanonicalOffer[];
  marketplaces: string[];
  confidence: number;
  rankTier: RankTier;
  coverageStatus?: "COMPLETE" | "INCOMPLETE";
  searchVisible?: boolean;
  publishable?: boolean;
};

export type CanonicalOffer = {
  marketplace: MarketplaceCode;
  marketplaceName: string;
  externalId: string;
  title: string;
  url: string;
  image: string;
  price: number;
  oldPrice: number | null;
  brand: string | null;
  affiliateLink: string | null;
  affiliateStatus?: AffiliateStatus;
  attributes: Record<string, string>;
  seller: string | null;
};

export type PublicProductView = {
  id: string;
  name: string;
  image: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  store: string;
  brand: string | null;
  offers: Array<{ marketplace: string }>;
};

export type MultistoreV2Result = {
  query: string;
  intent: QueryIntent;
  acquisitions: MarketplaceAcquisition[];
  rawCandidates: number;
  relevantCandidates: ScoredCandidate[];
  clusters: ProductCluster[];
  products: CanonicalProduct[];
  views: PublicProductView[];
  persistedProductIds: string[];
  marketplacesAttempted: MarketplaceCode[];
  marketplacesSucceeded: MarketplaceCode[];
  multiStoreClusters: number;
  singleStoreClusters: number;
};
