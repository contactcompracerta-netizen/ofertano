/**
 * Reexporta o essencial da shadow para os scripts de prova da FASE 8.1.
 * Existe para que o script de cross-market leia o MESMO peso que o runtime
 * usa — sem reimplementar a regra (e sem arriscar divergir dela).
 */
export {
  countPublicMarketplacesWithWeight,
  publicationWeightFor,
  isShadowMarketplace,
} from "../services/architecture/v1/publication/shadowWeight";
export { readShadowFlags as readShadowFlagsProbe } from "../services/architecture/v1/shadow/flags";
