/**
 * CATALOG_ARCHITECTURE_V1 — IDENTITY CONFIDENCE ENGINE (FASE 8.1 / FASE F).
 *
 * Motor de decisão de identidade cross-market. Entrada: DUAS listings de
 * marketplaces distintos. Saída: EXACT | REVIEW | REJECT + explicação.
 *
 * ORDEM DA DECISÃO (fixa, versionada, auditável):
 *
 *   1. HARD CONFLICT por eixo      -> REJECT   (impede EXACT sempre)
 *   2. EVIDÊNCIA FORTE             -> base para EXACT
 *   3. ATRIBUTO CRÍTICO AUSENTE    -> teto em REVIEW
 *   4.evidência forte + críticos OK-> EXACT
 *
 * Por que nesta ordem: um hard conflict é uma afirmação contraditória das
 * fontes sobre o MESMO eixo. Nenhuma quantidade de evidência forte supera
 * "as duas fontes dizem coisas incompatíveis sobre o armazenamento".
 *
 * Por que "ausente" não é "conflito": ausência é a fonte se calando.
 * Conflito é a fonte falando errado. Tratar ausência como conflito geraria
 * REJECT para toda fonte incompleta (e o sistema perderia informação útil);
 * tratá-la como OK geraria EXACT falso. O meio termo correto é REVIEW.
 */

import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import { UNKNOWN } from "../types/normalizedListingV1";
import {
  detectHardConflicts,
  sharedEvidence,
  textSimilarity,
  type HardConflictV1,
  type CandidateEvidenceV1,
} from "../matching/crossMarketMatching";
import {
  classifyCategory,
  IDENTITY_POLICY_V1,
  type AttributeAxis,
  type CategoryProfile,
  type IdentityConfidence,
  type IdentityPolicyVersion,
} from "./identityPolicy";

/* ------------------------------------------------------------------ */
/* CÓDIGOS DE RAZÃO (estáveis — são contrato de auditoria)            */
/* ------------------------------------------------------------------ */

export const IDENTITY_REASON_CODES = {
  HARD_CONFLICT: "HARD_CONFLICT",
  NO_SHARED_EVIDENCE: "NO_SHARED_EVIDENCE",
  GTIN_MATCH: "GTIN_MATCH",
  MPN_MATCH: "MPN_MATCH",
  MANUFACTURER_MODEL_MATCH: "MANUFACTURER_MODEL_MATCH",
  BRAND_MODEL_MATCH: "BRAND_MODEL_MATCH",
  CRITICAL_ATTRIBUTE_MISSING: "CRITICAL_ATTRIBUTE_MISSING",
  CRITICAL_ATTRIBUTE_UNKNOWN: "CRITICAL_ATTRIBUTE_UNKNOWN",
  TEXT_ONLY: "TEXT_ONLY_EVIDENCE",
  SAME_MARKETPLACE: "SAME_MARKETPLACE",
  CATEGORY_MISMATCH: "CATEGORY_MISMATCH",
} as const;

export type IdentityReasonCode =
  (typeof IDENTITY_REASON_CODES)[keyof typeof IDENTITY_REASON_CODES];

/* ------------------------------------------------------------------ */
/* EIXOS: extração de valor por listing                                */
/* ------------------------------------------------------------------ */

/** Valor utilizável de um eixo, ou null quando a fonte NÃO afirmou nada. */
export type AxisValue = string | null;

/**
 * De ONDE veio o valor do eixo. Isso importa mais do que parece.
 *
 * Um valor ESTRUTURADO ("storage: 256GB" num campo da fonte) é uma
 * afirmação: duas fontes discordando é contradição => HARD CONFLICT.
 *
 * Um valor EXTRAÍDO DO TEXTO do título é um palpite do regex. Duas fontes
 * descreverem o mesmo produto de formas diferentes ("C20W" vs "iPhone 20W")
 * NÃO é contradição — é o mesmo produto. Tratar isso como conflito produz
 * um falso REJECT, que é tão danoso quanto um falso EXACT: um falso
 * REJECT apaga uma comparação válida da superfície.
 *
 * Portanto: SOMENTE valores estruturais geram HARD CONFLICT.
 */
export interface AxisReading {
  value: AxisValue;
  fromText: boolean;
}

function normalizeAxisValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text === "" || text === UNKNOWN) return null;
  return text;
}

/**
 * Extrai o valor de um eixo na listing, na ordem: campo estruturado do
 * contrato V1 -> atributo genérico -> texto do título.
 *
 * A busca por eixo é SEPARADA (nunca agregada): é o que garante que
 * "256GB 127V" vs "512GB 127V" conflite em storage e NÃO em voltagem.
 */
export function readAxis(
  listing: NormalizedMarketplaceListingV1,
  axisKey: string,
): AxisReading {
  const variant = listing.variant;
  const attributes = listing.catalog.attributes ?? {};
  const title = listing.catalog.title ?? "";
  const identity = listing.identity;

  const readAttr = (name: string): string | null => {
    const raw = attributes[name];
    if (typeof raw === "string") return raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    return null;
  };

  /*
   * structured = afirmação da FONTE; text = palpite do regex sobre o título.
   * Só valores estruturados podem gerar HARD CONFLICT (ver AxisReading).
   */
  const structured = (...values: unknown[]): AxisReading => {
    for (const value of values) {
      const normalized = normalizeAxisValue(value);
      if (normalized !== null) return { value: normalized, fromText: false };
    }
    return { value: null, fromText: false };
  };

  const fromText = (pattern: RegExp): AxisReading => {
    const match = pattern.exec(title.toLowerCase());
    if (!match) return { value: null, fromText: false };
    return { value: match[0].replace(/\s+/g, ""), fromText: true };
  };

  /** estruturado primeiro; texto só como último recurso. */
  const either = (structuredValues: unknown[], pattern: RegExp): AxisReading => {
    const found = structured(...structuredValues);
    return found.value !== null ? found : fromText(pattern);
  };

  switch (axisKey) {
    case "storage":
      return either(
        [variant.storage, readAttr("storage"), readAttr("armazenamento")],
        /(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/,
      );
    case "memory":
      return either(
        [variant.memory, readAttr("memory"), readAttr("ram"), readAttr("memoria")],
        /(\d+(?:\.\d+)?)\s*gb\s*(ram|memoria)/,
      );
    case "ram":
      return either(
        [readAttr("ram"), variant.memory],
        /(\d+(?:\.\d+)?)\s*gb\s*(ram|memoria)/,
      );
    case "screenSize":
      return either(
        [variant.size, readAttr("screenSize"), readAttr("tela"), readAttr("polegadas")],
        /(\d+(?:\.\d+)?)\s*(polegadas|pol|")/,
      );
    case "size":
      return either(
        [variant.size, readAttr("size"), readAttr("tamanho")],
        /\b(\d{2,3})\b(?=\s*(cm|mm|gb|pol|polegadas))/,
      );
    case "voltage":
      return either(
        [variant.voltage, readAttr("voltage"), readAttr("voltagem")],
        /(\d+(?:\.\d+)?)\s*v(?:olt)?\b/,
      );
    case "cpu":
      return either(
        [readAttr("cpu"), readAttr("processador")],
        /\b(i[3579]\d{0,3}|ryzen\s?\d)\b/,
      );
    case "version":
      /*
       * version é SEMPRE estrutural, de propósito. Um token como "c20w"
       * extraído do título ("Carregador iPhone 20W") não é afirmação de
       * versão: comparar "c20w" com "iphone20w" e chamar de conflito
       * rejeita o MESMO produto (falso REJECT).
       */
      return structured(readAttr("version"), readAttr("versao"));
    case "model":
      return either(
        [identity.manufacturerModel, identity.model, identity.mpn],
        /\b([a-z]{1,10}[- ]?\d{2,5}[a-z]{0,3})\b/,
      );
    default:
      return { value: null, fromText: false };
  }
}

/** Compatibilidade: só o valor, sem a origem. */
export function readAxisValue(
  listing: NormalizedMarketplaceListingV1,
  axisKey: string,
): AxisValue {
  return readAxis(listing, axisKey).value;
}

/** Dois valores de eixo em escala: "256gb" vs "512gb" sao DIMENSIONALMENTE diferentes. */
function axisValuesConflict(
  left: AxisValue,
  right: AxisValue,
): boolean {
  if (left === null || right === null) return false;
  if (left === right) return false;
  /*
   * Normaliza a unidade para comparar grandezas de forma estavel:
   * 1024gb e 1tb sao a MESMA capacidade (hard conflict seria falso).
   */
  const parseCapacity = (value: string): number | null => {
    const m = /(\d+(?:\.\d+)?)(tb|gb|mb)/.exec(value);
    if (!m) return null;
    const amount = Number(m[1]);
    const unit = m[2];
    if (!Number.isFinite(amount)) return null;
    if (unit === "tb") return amount * 1024;
    if (unit === "mb") return amount / 1024;
    return amount;
  };
  const leftCapacity = parseCapacity(left);
  const rightCapacity = parseCapacity(right);
  if (leftCapacity !== null && rightCapacity !== null) {
    // Tolerancia de 0.5 para float/granularidade, mas 256 != 512.
    return Math.abs(leftCapacity - rightCapacity) > 0.5;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* EVIDÊNCIA FORTE                                                    */
/* ------------------------------------------------------------------ */

/**
 * Evidência forte, ordenada por força. NENHUM campo textual isolado entra
 * aqui: `TEXT_ONLY_EVIDENCE` nunca promove a EXACT.
 */
export interface StrongEvidenceV1 {
  code: IdentityReasonCode;
  weight: number;
  detail: string;
}

const EVIDENCE_WEIGHTS: Record<string, number> = {
  [IDENTITY_REASON_CODES.GTIN_MATCH]: 100,
  [IDENTITY_REASON_CODES.MPN_MATCH]: 60,
  [IDENTITY_REASON_CODES.MANUFACTURER_MODEL_MATCH]: 55,
  [IDENTITY_REASON_CODES.BRAND_MODEL_MATCH]: 40,
};

/** GTIN compartilhado entre as duas fontes = identidade fisica confirmada. */
function hasSharedGtin(
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
): boolean {
  const leftSet = new Set(
    (left.identity.gtin ?? []).map((g) => g.trim().toLowerCase()).filter(Boolean),
  );
  return (right.identity.gtin ?? []).some((g) => {
    const value = g.trim().toLowerCase();
    return value !== "" && leftSet.has(value);
  });
}

export function collectStrongEvidence(
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
): StrongEvidenceV1[] {
  const out: StrongEvidenceV1[] = [];
  const shared = sharedEvidence(left, right);

  const has = (kind: string) => shared.some((item) => item.kind === kind);

  if (hasSharedGtin(left, right)) {
    out.push({
      code: IDENTITY_REASON_CODES.GTIN_MATCH,
      weight: EVIDENCE_WEIGHTS[IDENTITY_REASON_CODES.GTIN_MATCH],
      detail: "GTIN/EAN/UPC compativel nas duas fontes",
    });
  }
  if (has("MPN")) {
    out.push({
      code: IDENTITY_REASON_CODES.MPN_MATCH,
      weight: EVIDENCE_WEIGHTS[IDENTITY_REASON_CODES.MPN_MATCH],
      detail: "MPN identico nas duas fontes",
    });
  }
  if (has("MANUFACTURER_MODEL")) {
    out.push({
      code: IDENTITY_REASON_CODES.MANUFACTURER_MODEL_MATCH,
      weight: EVIDENCE_WEIGHTS[IDENTITY_REASON_CODES.MANUFACTURER_MODEL_MATCH],
      detail: "manufacturerModel identico nas duas fontes",
    });
  }
  if (has("BRAND_MODEL")) {
    out.push({
      code: IDENTITY_REASON_CODES.BRAND_MODEL_MATCH,
      weight: EVIDENCE_WEIGHTS[IDENTITY_REASON_CODES.BRAND_MODEL_MATCH],
      detail: "brand + model identicos nas duas fontes",
    });
  }
  return out;
}

/** Limiar de peso para considerar a evidencia suficiente para EXACT. */
export const EXACT_EVIDENCE_WEIGHT_THRESHOLD =
  EVIDENCE_WEIGHTS[IDENTITY_REASON_CODES.BRAND_MODEL_MATCH];

/* ------------------------------------------------------------------ */
/* AVALIACAO                                                           */
/* ------------------------------------------------------------------ */

export interface MissingCriticalAttributeV1 {
  axis: string;
  label: string;
  /** O que cada lado disse (null = a fonte nao afirmou). */
  left: AxisValue;
  right: AxisValue;
  reason: IdentityReasonCode;
}

export interface AxisComparisonV1 {
  axis: string;
  label: string;
  critical: boolean;
  left: AxisValue;
  right: AxisValue;
  status: "MATCH" | "CONFLICT" | "MISSING_LEFT" | "MISSING_RIGHT" | "MISSING_BOTH";
}

export interface IdentityDecisionV1 {
  confidence: IdentityConfidence;
  reasonCodes: IdentityReasonCode[];
  evidence: StrongEvidenceV1[];
  sharedEvidence: CandidateEvidenceV1[];
  hardConflicts: HardConflictV1[];
  missingCriticalAttributes: MissingCriticalAttributeV1[];
  axisComparisons: AxisComparisonV1[];
  category: string;
  textSimilarity: number;
  policyVersion: IdentityPolicyVersion;
  leftKey: string;
  rightKey: string;
  leftMarketplaceId: string;
  rightMarketplaceId: string;
}

function keyOf(listing: NormalizedMarketplaceListingV1): string {
  return `${listing.marketplaceId}:${listing.externalListingId}`;
}

/** Compara um eixo entre as duas listings. */
function compareAxis(
  listing: NormalizedMarketplaceListingV1,
  other: NormalizedMarketplaceListingV1,
  axis: AttributeAxis,
): AxisComparisonV1 {
  const leftReading = readAxis(listing, axis.key);
  const rightReading = readAxis(other, axis.key);
  const left = leftReading.value;
  const right = rightReading.value;

  let status: AxisComparisonV1["status"];
  if (left === null && right === null) status = "MISSING_BOTH";
  else if (left === null) status = "MISSING_LEFT";
  else if (right === null) status = "MISSING_RIGHT";
  else if (axisValuesConflict(left, right)) {
    /*
     * Divergência só é CONFLICT quando pelo menos UM lado falou de forma
     * ESTRUTURADA. Se os dois valores vieram do título, é divergência de
     * descrição — e descrição divergente NÃO é contradição de produto.
     */
    status =
      leftReading.fromText && rightReading.fromText ? "MATCH" : "CONFLICT";
  } else status = "MATCH";

  return {
    axis: axis.key,
    label: axis.label,
    critical: axis.critical,
    left,
    right,
    status,
  };
}

/**
 * Decide a identidade de um par cross-market.
 *
 * NUNCAlanca excecao: sempre devolve um veredito explicavel.
 */
export function evaluateIdentityConfidence(
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
): IdentityDecisionV1 {
  const leftKey = keyOf(left);
  const rightKey = keyOf(right);
  const leftProfile = classifyCategory(left);
  const rightProfile = classifyCategory(right);
  const similarity = textSimilarity(left, right);

  const base = {
    policyVersion: IDENTITY_POLICY_V1,
    leftKey,
    rightKey,
    leftMarketplaceId: left.marketplaceId,
    rightMarketplaceId: right.marketplaceId,
    category: leftProfile.category,
    textSimilarity: similarity,
  };

  // 0. Par do mesmo marketplace nao e cross-market.
  if (left.marketplaceId === right.marketplaceId) {
    return {
      ...base,
      confidence: "REJECT",
      reasonCodes: [IDENTITY_REASON_CODES.SAME_MARKETPLACE],
      evidence: [],
      sharedEvidence: [],
      hardConflicts: [],
      missingCriticalAttributes: [],
      axisComparisons: [],
    };
  }

  // 1. HARD CONFLICTS (do motor da FASE 8, ja corrigido por eixo) + eixos da politica.
  const structuralConflicts = detectHardConflicts(left, right);
  const axisComparisons: AxisComparisonV1[] = [];
  const axisConflicts: HardConflictV1[] = [];
  const missingCriticalAttributes: MissingCriticalAttributeV1[] = [];

  const seenAxes = new Set<string>();
  const allAxes: AttributeAxis[] = [
    ...leftProfile.criticalAxes,
    ...leftProfile.optionalAxes,
    ...rightProfile.criticalAxes,
    ...rightProfile.optionalAxes,
  ];

  for (const axis of allAxes) {
    if (seenAxes.has(axis.key)) continue;
    seenAxes.add(axis.key);
    const comparison = compareAxis(left, right, axis);
    axisComparisons.push(comparison);

    if (comparison.status === "CONFLICT") {
      axisConflicts.push({
        kind: "VARIANT_MISMATCH",
        field: comparison.axis,
        left: comparison.left ?? "",
        right: comparison.right ?? "",
      });
    }
  }

  const hardConflicts = [...structuralConflicts, ...axisConflicts];

  if (hardConflicts.length > 0) {
    return {
      ...base,
      confidence: "REJECT",
      reasonCodes: [IDENTITY_REASON_CODES.HARD_CONFLICT],
      evidence: [],
      sharedEvidence: sharedEvidence(left, right),
      hardConflicts,
      missingCriticalAttributes,
      axisComparisons,
    };
  }

  // 2. Evidencia forte (NENHUM campo textual sozinho entra aqui).
  const evidence = collectStrongEvidence(left, right);
  const weight = evidence.reduce((sum, item) => sum + item.weight, 0);

  if (evidence.length === 0) {
    return {
      ...base,
      confidence: "REJECT",
      reasonCodes: [
        IDENTITY_REASON_CODES.NO_SHARED_EVIDENCE,
        ...(similarity > 0 ? [IDENTITY_REASON_CODES.TEXT_ONLY] : []),
      ],
      evidence,
      sharedEvidence: sharedEvidence(left, right),
      hardConflicts,
      missingCriticalAttributes,
      axisComparisons,
    };
  }

  // 3. Atributo critico ausente impede EXACT (vira REVIEW).
  /*
   * Deduplica por chave de eixo: os perfis das DUAS pontas podem declarar o
   * mesmo eixo, e reportar "storage ausente" duas vezes só polui a
   * explicação sem adicionar informação.
   */
  const criticalAxes = new Map<string, AttributeAxis>();
  for (const axis of [...leftProfile.criticalAxes, ...rightProfile.criticalAxes]) {
    if (axis.critical) criticalAxes.set(axis.key, axis);
  }
  for (const axis of criticalAxes.values()) {
    const comparison = axisComparisons.find((c) => c.axis === axis.key);
    if (!comparison) continue;
    if (
      comparison.status === "MISSING_LEFT" ||
      comparison.status === "MISSING_RIGHT" ||
      comparison.status === "MISSING_BOTH"
    ) {
      missingCriticalAttributes.push({
        axis: axis.key,
        label: axis.label,
        left: comparison.left,
        right: comparison.right,
        reason: IDENTITY_REASON_CODES.CRITICAL_ATTRIBUTE_MISSING,
      });
    }
  }

  /*
   * GTIN compartido é DEFINITIVO e dispensa os eixos críticos.
   *
   * O GTIN identifica a variante FÍSICA具体: um celular de 256GB e um de
   * 512GB têm GTINs diferentes. Logo, GTIN igual já prova que é a mesma
   * variante — exigir "model" además disso só produziria REVIEW para dados
   * que são na verdade mais fortes do que a policy exige.
   *
   * Consequência que importa: isto NÃO é uma exceção por marketplace. É a
   * mesma política para qualquer fonte que exponha GTIN confiável.
   */
  const gtinIsDefinitive = evidence.some(
    (item) => item.code === IDENTITY_REASON_CODES.GTIN_MATCH,
  );

  if (missingCriticalAttributes.length > 0 && !gtinIsDefinitive) {
    return {
      ...base,
      confidence: "REVIEW",
      reasonCodes: [
        ...evidence.map((item) => item.code),
        IDENTITY_REASON_CODES.CRITICAL_ATTRIBUTE_MISSING,
      ],
      evidence,
      sharedEvidence: sharedEvidence(left, right),
      hardConflicts,
      missingCriticalAttributes,
      axisComparisons,
    };
  }

  // 4. Evidencia forte suficiente + sem ausencias criticas => EXACT.
  const strongEnough =
    gtinIsDefinitive || weight >= EXACT_EVIDENCE_WEIGHT_THRESHOLD;
  if (!strongEnough) {
    return {
      ...base,
      confidence: "REVIEW",
      reasonCodes: evidence.map((item) => item.code),
      evidence,
      sharedEvidence: sharedEvidence(left, right),
      hardConflicts,
      missingCriticalAttributes,
      axisComparisons,
    };
  }

  return {
    ...base,
    confidence: "EXACT",
    reasonCodes: evidence.map((item) => item.code),
    evidence,
    sharedEvidence: sharedEvidence(left, right),
    hardConflicts,
    missingCriticalAttributes,
    axisComparisons,
  };
}
