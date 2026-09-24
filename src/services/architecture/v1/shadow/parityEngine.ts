/**
 * CATALOG_ARCHITECTURE_V1 — PARITY ENGINE (FASE 5 — PROVA DE PARIDADE).
 *
 * Compara a decisão de publicação do caminho LEGADO (saveProduct) com o
 * veredicto de PublicationEligibility da Architecture V1 para a MESMA
 * observação.
 *
 * Classes de paridade (códigos estáveis):
 *  - PARITY_MATCH: legado e V1 concordam (publicado/não publicado).
 *  - V1_MORE_PERMISSIVE_THAN_LEGACY: V1 publicaria onde o legado não
 *    publicou. BLOQUEIA readiness — é o risco de cutover.
 *  - PUBLICATION_UNEXPLAINED_MISMATCH: legado publicou onde o V1 não
 *    publicaria e não há explicação (ex.: fluxo MANUAL). Readiness exige 0.
 *  - EXPLAINED_BY_MANUAL_FLOW: legado publicou e V1 negou por política,
 *    mas o produto é MANUAL (comportamento legado preservado).
 *  - SKIP_PARTIAL_VIEW: a shadow só enxerga UMA oferta (visão parcial);
 *    não conta como mismatch (nem positivo nem negativo).
 *
 * A shadow NUNCA altera a publicação; apenas classifica e contabiliza.
 */

export type LegacyPublicationOutcome = {
  autoCreated: boolean;
  active: boolean;
  publicationStatus?: string | null;
  /** Ofertas válidas distintas observadas pelo legado. */
  distinctPublicMarketplaces?: number;
  validOfferCount?: number;
  /** Ofertas REAIS do produto legado (paridade profunda — leitura read-only). */
  offers?: PublicOfferLikeLegacy[];
};

/** Forma mínima de oferta para a paridade (mesmo predicado da página pública). */
export type PublicOfferLikeLegacy = {
  marketplace: string;
  active?: boolean;
  available?: boolean;
  status?: string;
  matchStatus?: string;
  price?: number | null;
};

export type ShadowParityVerdictCode =
  | "PARITY_MATCH"
  | "V1_MORE_PERMISSIVE_THAN_LEGACY"
  | "PUBLICATION_UNEXPLAINED_MISMATCH"
  | "EXPLAINED_BY_MANUAL_FLOW"
  | "EXPLAINED_BY_MANUAL_DRAFT"
  | "SKIP_PARTIAL_VIEW";

export type ShadowParityVerdict = {
  code: ShadowParityVerdictCode;
  match: boolean;
  /** true quando a divergência é explicada (não bloqueia readiness). */
  explained: boolean;
  /** V1 publicaria onde o legado não publicou (bloqueia readiness). */
  v1MorePermissiveThanLegacy: boolean;
  /** Mismatch não explicado de publicação (readiness exige 0). */
  unexpectedMismatch: boolean;
  reasonCodes: string[];
};

export type ShadowParityInput = {
  legacy: LegacyPublicationOutcome;
  /** Veredicto V1 para a MESMA observação. */
  v1Eligible: boolean;
  v1ReasonCodes?: string[];
  /** true quando a shadow tem visão parcial (ex.: apenas 1 oferta do save). */
  partialView?: boolean;
};

/** Códigos de razão da política V1 que explicam divergência. */
export const EXPLAINED_V1_REASON_CODES = new Set([
  "MANUAL_PRODUCT",
]);

/**
 * Classifica a paridade entre a decisão legada e o veredicto V1.
 * Puro e determinístico — sem I/O.
 */
export function classifyShadowParity(
  input: ShadowParityInput,
): ShadowParityVerdict {
  const {
    legacy,
    v1Eligible,
    v1ReasonCodes = [],
    partialView = false,
  } = input;

  const legacyPublished = legacy.active === true ||
    legacy.publicationStatus === "PUBLISHED";

  // Visão parcial: a shadow não vê o conjunto completo de ofertas legadas.
  // Nunca fabrica mismatch (nem positivo nem negativo) com informação
  // incompleta — apenas registra SKIP_PARTIAL_VIEW.
  if (partialView && legacyPublished && !v1Eligible) {
    return {
      code: "SKIP_PARTIAL_VIEW",
      match: false,
      explained: true,
      v1MorePermissiveThanLegacy: false,
      unexpectedMismatch: false,
      reasonCodes: [...v1ReasonCodes, "PARTIAL_VIEW"],
    };
  }

  if (v1Eligible && !legacyPublished) {
    // V1 publicaria onde o legado NÃO publicou.
    // Produto MANUAL em DRAFT é decisão OPERACIONAL (não divergência de
    // política): o gate V1 trata manual exatamente como o legado. Não bloqueia.
    const manualDraft = v1ReasonCodes.includes("MANUAL_PRODUCT");
    if (manualDraft) {
      return {
        code: "EXPLAINED_BY_MANUAL_DRAFT",
        match: false,
        explained: true,
        v1MorePermissiveThanLegacy: false,
        unexpectedMismatch: false,
        reasonCodes: [...v1ReasonCodes, "EXPLAINED_BY_MANUAL_DRAFT"],
      };
    }
    // Auto-criado: esta é a divergência perigosa => bloqueia readiness.
    return {
      code: "V1_MORE_PERMISSIVE_THAN_LEGACY",
      match: false,
      explained: false,
      v1MorePermissiveThanLegacy: true,
      unexpectedMismatch: false,
      reasonCodes: ["V1_MORE_PERMISSIVE_THAN_LEGACY", ...v1ReasonCodes],
    };
  }

  if (legacyPublished && !v1Eligible) {
    // Legado publicou onde o V1 não publicaria.
    const manualFlow = v1ReasonCodes.some((code) =>
      EXPLAINED_V1_REASON_CODES.has(code),
    );
    if (manualFlow) {
      return {
        code: "EXPLAINED_BY_MANUAL_FLOW",
        match: false,
        explained: true,
        v1MorePermissiveThanLegacy: false,
        unexpectedMismatch: false,
        reasonCodes: [...v1ReasonCodes, "EXPLAINED_BY_MANUAL_FLOW"],
      };
    }
    return {
      code: "PUBLICATION_UNEXPLAINED_MISMATCH",
      match: false,
      explained: false,
      v1MorePermissiveThanLegacy: false,
      unexpectedMismatch: true,
      reasonCodes: ["PUBLICATION_UNEXPLAINED_MISMATCH", ...v1ReasonCodes],
    };
  }

  return {
    code: "PARITY_MATCH",
    match: true,
    explained: true,
    v1MorePermissiveThanLegacy: false,
    unexpectedMismatch: false,
    reasonCodes: [],
  };
}

/**
 * Agrega veredictos de paridade em contadores de readiness.
 * Puro: usado pelo runner para decidir CATALOG_V1_CUTOVER_READY.
 */
export type ParityAggregate = {
  total: number;
  match: number;
  v1MorePermissiveThanLegacy: number;
  unexpectedMismatch: number;
  explained: number;
  skippedPartialView: number;
};

export function aggregateParityVerdicts(
  verdicts: ShadowParityVerdict[],
): ParityAggregate {
  let match = 0;
  let v1MorePermissiveThanLegacy = 0;
  let unexpectedMismatch = 0;
  let explained = 0;
  let skippedPartialView = 0;

  for (const verdict of verdicts) {
    if (verdict.match) match += 1;
    if (verdict.v1MorePermissiveThanLegacy) v1MorePermissiveThanLegacy += 1;
    if (verdict.unexpectedMismatch) unexpectedMismatch += 1;
    if (verdict.explained) explained += 1;
    if (verdict.code === "SKIP_PARTIAL_VIEW") skippedPartialView += 1;
  }

  return {
    total: verdicts.length,
    match,
    v1MorePermissiveThanLegacy,
    unexpectedMismatch,
    explained,
    skippedPartialView,
  };
}

/**
 * Criterio central de readiness da shadow (sem cutover, mesmo quando YES).
 * Exige: escrita real exercitada (>=1), zero mismatch inexplicado, zero
 * V1_MORE_PERMISSIVE_THAN_LEGACY e zero falhas de escrita observadas.
 */
export function evaluateShadowReadiness(params: {
  realWrites: number;
  unexpectedMismatch: number;
  v1MorePermissiveThanLegacy: number;
  writeFailed: number;
}): { ready: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];

  if (params.realWrites < 1) {
    reasonCodes.push("NO_REAL_SHADOW_WRITES");
  }
  if (params.unexpectedMismatch > 0) {
    reasonCodes.push("PUBLICATION_UNEXPLAINED_MISMATCH_NOT_ZERO");
  }
  if (params.v1MorePermissiveThanLegacy > 0) {
    reasonCodes.push("V1_MORE_PERMISSIVE_THAN_LEGACY");
  }
  if (params.writeFailed > 0) {
    reasonCodes.push("SHADOW_WRITE_FAILED");
  }

  return {
    ready: reasonCodes.length === 0,
    reasonCodes,
  };
}