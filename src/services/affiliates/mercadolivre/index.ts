export {
  generateMercadoLivreAffiliateLink,
  extractItemId,
} from "./generator";
export type {
  GenerateOutcome,
  MercadoLivreAffiliateInput,
} from "./generator";

export {
  listPendingMercadoLivreOffers,
  createPrismaMercadoLivrePendingStore,
} from "./pending";
export type {
  MercadoLivrePending,
  MercadoLivrePendingStore,
  MercadoLivreApplyStore,
} from "./pending";

export { runMercadoLivreWorker } from "./worker";
export type {
  GeneratorFn,
  HydrateItemFn,
  WorkerConfig,
  WorkerItemResult,
  WorkerRunResult,
} from "./worker";

export {
  hydrateExactItemPermalink,
  canonicalizarMlb,
  permalinkProvaAnuncio,
  AFFILIATE_INPUT_MODE_EXACT_ITEM,
} from "./itemHydration";
export type {
  AffiliateInputMode,
  ItemHydrationResult,
} from "./itemHydration";

export {
  validateExactOfferTarget,
  collectTargetEvidence,
  extractCatalogMlId,
  extractExactItemMlId,
  extrairItemIdsDosFiltros,
} from "./strictTarget";
export type { StrictTargetVerdict, TargetEvidence } from "./strictTarget";

export {
  createPrismaMercadoLivreApplyStore,
  createPrismaMercadoLivreWorkerStores,
} from "./prisma";

export {
  createMercadoLivreAffiliateDaemon,
  acquireInstanceLock,
} from "./daemon";
export type {
  DaemonState,
  ItemTone,
  DaemonConfig,
  DaemonDeps,
  CycleSummary,
  DaemonRuntimeEvents,
  MercadoLivreAffiliateDaemon,
  InstanceLock,
} from "./daemon";
