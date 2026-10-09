/**
 * CATALOG_WAVE 1 - API pública do módulo de scaffolding.
 *
 * Flags fail-closed: importar este módulo NUNCA liga escrita.
 * Escrita real exige configuração explícita de ambiente
 * (CATALOG_IMPORT_ENABLED / AWIN_WAVE1_ENABLED / flags de staging/write)
 * e feeds reais — ver featureFlags.ts.
 */
export * from "./types";
export {
  readCatalogImportFlags,
  DEFAULT_CATALOG_IMPORT_FLAGS,
  isAnalysisEnabled,
  isStagingWriteEnabled,
  isWriteEnabled,
  isLiveEnabled,
  assertWriteAllowed,
  CatalogDisabledError,
  CatalogWriteBlockedError,
  LiveModeBlockedError,
} from "./featureFlags";
export type { CatalogImportFlags } from "./featureFlags";
export {
  WAVE1_AWIN_ADVERTISERS,
  WAVE1_MERCHANT_SLUGS,
  getAdvertiser,
  isApprovedMerchant,
} from "./advertisers";
export type { AwinAdvertiserConfig } from "./advertisers";
export {
  approveAwinSource,
  isUnapprovedSource,
  UNAPPROVED_SOURCES,
  assertNoForbiddenApprovedSource,
} from "./sourceGuard";
export { computeIdentityLevel, isValidGtin, normalizeToken } from "./identity";
export type { IdentityResult } from "./identity";
export {
  matchToCatalog,
  titleSimilarity,
  AUTO_MATCH_THRESHOLD,
  REVIEW_THRESHOLD,
} from "./matching";
export type { MatchResult, MatchRule, MatchEvidence } from "./matching";
export {
  buildStagingRecord,
  stagingKey,
  InMemoryStagingStore,
} from "./staging";
export type { StagingStore, BuildStagingInput } from "./staging";
export { PrismaStagingStore } from "./prismaStaging";
export {
  fetchAwinFeedList,
  parseAwinFeedListCsv,
  selectAwinFeed,
  downloadAwinFeedRows,
  isAllowedAwinDownloadUrl,
} from "./awinFeedSource";
export type {
  AwinFeedDescriptor,
  AwinFeedFetchOptions,
} from "./awinFeedSource";
export { buildPlan, summarizePlan, emptyCounters } from "./plan";
export type {
  CatalogImportPlan,
  CatalogImportPlanItem,
  CatalogImportPlanCounters,
  MerchantPlanCounters,
} from "./plan";
export {
  InMemoryCatalogGateway,
  NoWriteGateway,
} from "./transaction";
export type {
  CatalogWriteGateway,
  CatalogWriteOps,
  ProductDraft,
  OfferDraft,
} from "./transaction";
export {
  CatalogImporterV1,
  CANARY_MAX_PER_ADVERTISER,
  CANARY_MAX_TOTAL,
} from "./importer";
export type {
  CatalogImporterDeps,
  ImportRunResult,
  ApplyResult,
} from "./importer";
export { WAVE1_FIXTURES, fixtureSetFor, totalFixtureRows } from "./fixtures";
export type { Wave1FixtureSet } from "./fixtures";
