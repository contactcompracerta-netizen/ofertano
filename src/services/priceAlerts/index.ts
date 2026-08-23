export {
  PRICE_ALERT_ERROR_CODES,
  PriceAlertError,
  isPriceAlertError,
} from "./errors";
export { selecionarMenorPrecoExact } from "./menorPrecoExact";
export { criarMemoryPriceAlertStore } from "./memoryStore";
export { prismaPriceAlertStore } from "./prismaStore";
export { criarServicoPriceAlerts } from "./service";
export { PRICE_ALERT_TYPES } from "./types";
export type {
  AlertEvaluationResult,
  CreatePriceAlertResult,
  EvaluateActivePriceAlertsResult,
  ExactOfferSnapshot,
  PriceAlertRecord,
  PriceAlertType,
  PriceAlertWithDetails,
} from "./types";
