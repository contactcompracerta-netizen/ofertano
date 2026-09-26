/**
 * CATALOG_ARCHITECTURE_V1 — CROSS-MARKET MATCHING (FASE 8 / FASE K, L, M).
 *
 * O ponto de um comparador de precos: a MESMA variante sendo vendida em
 * marketplaces diferentes. Este modulo classifica o par de listings de
 * marketplaces distintos como EXACT / REVIEW / REJECT.
 *
 * ORDEM OBRIGATORIA (nunca invertida):
 *
 *   1. CANDIDATE GENERATION por EVIDENCIA (nunca "todo contra todo").
 *      So vira candidato quem compartilha pelo menos uma evidencia forte:
 *      GTIN, brand+model, MPN ou manufacturerModel. Sem evidencia, o par
 *      nunca e comparado — e nao existe busca cartesiana no catalogo inteiro.
 *
 *   2. HARD CONFLICTS (FASE L) — 256GB != 512GB, 127V != 220V,
 *      43" != 50", modelo A != modelo B. Um hard conflict DERROTA
 *      similaridade textual alta. Nao ha excecao.
 *
 *   3. SIMILARIDADE TEXTUAL (FASE K) — so e consultada depois dos conflitos.
 *
 * Decisao final:
 *   hard conflict                      => REJECT
 *   sem evidencia forte suficiente     => REJECT (fail-closed)
 *   evidencia forte + coerencia alta   => EXACT
 *   evidencia forte + ambiguidade      => REVIEW
 *
 * REGRA CRITICA (FASE M / FASE J): enquanto uma fonte esta SHADOW, NENHUMA
 * classificacao altera a superficie publica. Este modulo e PURO: ele classifica
 * e conta. Quem decide publicacao e o gate central, que ignora fontes shadow.
 *
 * Nenhuma regra aqui conhece nome de marketplace: o par chega por
 * (marketplaceId, externalListingId) e a decisao e por evidencia.
 */

import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import { UNKNOWN } from "../types/normalizedListingV1";

/* ------------------------------------------------------------------ */
/* FASE L — HARD CONFLICTS                                             */
/* ------------------------------------------------------------------ */

export type HardConflictKind =
  | "GTIN_MISMATCH"
  | "STORAGE_MISMATCH"
  | "MEMORY_MISMATCH"
  | "VOLTAGE_MISMATCH"
  | "SIZE_MISMATCH"
  | "COLOR_MISMATCH"
  | "MODEL_MISMATCH"
  | "BRAND_MISMATCH"
  | "MPN_MISMATCH"
  | "VARIANT_MISMATCH";

export interface HardConflictV1 {
  kind: HardConflictKind;
  field: string;
  left: string;
  right: string;
}

/** Valor utilizavel: string nao vazia e diferente de UNKNOWN. */
function usable(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "" || text === UNKNOWN) return null;
    return text.toLowerCase();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * Eixos de medida comparados no texto. Separar por eixo e obrigatorio: sem
 * isso, "256GB 127V" vs "512GB 127V" pareceriam iguais por causa do 127V
 * compartilhado, e um conflito real de armazenamento passaria.
 */
type MeasureDimension = "storage" | "memory" | "voltage" | "size";

const MEASURE_PATTERNS: Record<MeasureDimension, RegExp> = {
  storage: /(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)\b/g,
  memory: /(\d+(?:[.,]\d+)?)\s*gb\b/g,
  voltage: /(\d+(?:[.,]\d+)?)\s*v(?:olt)?\b/g,
  size: /(\d+(?:[.,]\d+)?)\s*(polegadas|pol|inch)\b/g,
};

function newTokenSet(): Set<string> {
  return new Set<string>();
}

/** Tokens de medida por eixo, extraidos do texto informado. */
function measureTokensByDimension(
  text: string | null | unknown,
): Map<MeasureDimension, Set<string>> {
  const value = usable(text);
  const out = new Map<MeasureDimension, Set<string>>();
  if (value === null) return out;

  for (const [dimension, pattern] of Object.entries(
    MEASURE_PATTERNS,
  ) as Array<[MeasureDimension, RegExp]>) {
    const tokens = newTokenSet();
    const matcher = new RegExp(pattern.source, "g");
    let match = matcher.exec(value);
    while (match !== null) {
      tokens.add(`${match[1].replace(",", ".")}${match[2]}`);
      match = matcher.exec(value);
    }
    if (tokens.size > 0) {
      out.set(dimension, tokens);
    }
  }
  return out;
}

/** Conflito quando o MESMO eixo tem grandezas diferentes dos dois lados. */
function measureTokensConflict(
  left: Set<string>,
  right: Set<string>,
): boolean {
  for (const token of left) {
    if (right.has(token)) return false;
  }
  return true;
}

/**
 * GTIN: quando as DUAS fontes informam GTIN e os conjuntos nao se intersectam,
 * sao produtos fisicos diferentes. Conflito duro.
 */
function gtinConflicts(
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
): HardConflictV1[] {
  const leftGtin = new Set(
    (left.identity.gtin ?? []).map((g) => g.trim().toLowerCase()).filter(Boolean),
  );
  const rightGtin = new Set(
    (right.identity.gtin ?? []).map((g) => g.trim().toLowerCase()).filter(Boolean),
  );
  if (leftGtin.size === 0 || rightGtin.size === 0) return [];
  for (const value of leftGtin) {
    if (rightGtin.has(value)) return [];
  }
  return [
    {
      kind: "GTIN_MISMATCH",
      field: "identity.gtin",
      left: [...leftGtin].join(","),
      right: [...rightGtin].join(","),
    },
  ];
}

/**
 * Campo escalar de variante: conflito apenas quando AMBOS informam um valor
 * utilizavel e os valores normalizados diferem.
 */
function scalarConflict(
  kind: HardConflictKind,
  field: string,
  leftValue: unknown,
  rightValue: unknown,
): HardConflictV1[] {
  const left = usable(leftValue);
  const right = usable(rightValue);
  if (left === null || right === null) return [];
  if (left === right) return [];
  return [{ kind, field, left: String(leftValue), right: String(rightValue) }];
}

/**
 * Deteccao de modelo no texto livre (titulo + atributos).
 * Compara os "modelos" extraidos; A != B e conflito duro.
 */
function extractModelTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  // Modelos containem letras E digitos (A54, SM-S911B, Redmi-Note-12).
  const pattern = /\b([a-z]{1,6}[- ]?\d{1,5}[a-z]{0,4})\b/g;
  let match = pattern.exec(text);
  while (match !== null) {
    tokens.add(match[1].replace(/[- ]/g, "").toLowerCase());
    match = pattern.exec(text);
  }
  return tokens;
}

function identityText(listing: NormalizedMarketplaceListingV1): string {
  return [
    usable(listing.identity.manufacturerModel) ?? "",
    usable(listing.identity.model) ?? "",
    usable(listing.identity.mpn) ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function modelConflicts(
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
): HardConflictV1[] {
  const conflicts: HardConflictV1[] = [];

  // MPN e evidencia estruturada: quando ambos informam e diferem, conflicto.
  conflicts.push(
    ...scalarConflict(
      "MPN_MISMATCH",
      "identity.mpn",
      left.identity.mpn,
      right.identity.mpn,
    ),
  );
  conflicts.push(
    ...scalarConflict(
      "MODEL_MISMATCH",
      "identity.manufacturerModel",
      left.identity.manufacturerModel,
      right.identity.manufacturerModel,
    ),
  );

  // Modelos extraidos de texto: se ha intersecao => nao ha conflito de modelo.
  const leftModels = extractModelTokens(
    `${identityText(left)} ${usable(left.catalog.title) ?? ""}`,
  );
  const rightModels = extractModelTokens(
    `${identityText(right)} ${usable(right.catalog.title) ?? ""}`,
  );
  if (leftModels.size > 0 && rightModels.size > 0) {
    let shared = false;
    for (const token of leftModels) {
      if (rightModels.has(token)) {
        shared = true;
        break;
      }
    }
    if (!shared) {
      conflicts.push({
        kind: "MODEL_MISMATCH",
        field: "identity.model",
        left: [...leftModels].join(","),
        right: [...rightModels].join(","),
      });
    }
  }
  return conflicts;
}

/**
 * FASE L — varre TODOS os eixos de variante e de identidade e devolve a lista
 * de hard conflicts. Chamado ANTES de qualquer similaridade textual.
 */
export function detectHardConflicts(
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
): HardConflictV1[] {
  const conflicts: HardConflictV1[] = [
    ...gtinConflicts(left, right),
    ...scalarConflict(
      "BRAND_MISMATCH",
      "identity.brand",
      left.identity.brand,
      right.identity.brand,
    ),
    ...modelConflicts(left, right),
    ...scalarConflict(
      "STORAGE_MISMATCH",
      "variant.storage",
      left.variant.storage,
      right.variant.storage,
    ),
    ...scalarConflict(
      "MEMORY_MISMATCH",
      "variant.memory",
      left.variant.memory,
      right.variant.memory,
    ),
    ...scalarConflict(
      "VOLTAGE_MISMATCH",
      "variant.voltage",
      left.variant.voltage,
      right.variant.voltage,
    ),
    ...scalarConflict(
      "SIZE_MISMATCH",
      "variant.size",
      left.variant.size,
      right.variant.size,
    ),
    ...scalarConflict(
      "COLOR_MISMATCH",
      "variant.color",
      left.variant.color,
      right.variant.color,
    ),
  ];

  /*
   * Medidas presentes no TEXTO tambem conflitam: sem isto, "256GB" vs "512GB"
   * em titulos passaria como EXACT. So olhamos o texto quando o eixo
   * estruturado NAO foi declarado por nenhum dos dois lados (a autoritativa
   * ja foi tratada acima).
   */
  const titleConflicts = measureConflictsInText(left, right);
  conflicts.push(...titleConflicts);

  return conflicts;
}

/**
 * Compara as medidas (armazenamento, voltagem, tamanho) extraidas do titulo
 * quando nenhum dos lados declarou o eixo estruturado.
 */
function measureConflictsInText(
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
): HardConflictV1[] {
  const leftTitle = usable(left.catalog.title) ?? "";
  const rightTitle = usable(right.catalog.title) ?? "";

  const dimensions: Array<{
    kind: HardConflictKind;
    field: string;
    axis: MeasureDimension;
    leftStructured: unknown;
    rightStructured: unknown;
  }> = [
    {
      kind: "STORAGE_MISMATCH",
      field: "catalog.title:storage",
      axis: "storage",
      leftStructured: left.variant.storage,
      rightStructured: right.variant.storage,
    },
    {
      kind: "MEMORY_MISMATCH",
      field: "catalog.title:memory",
      axis: "memory",
      leftStructured: left.variant.memory,
      rightStructured: right.variant.memory,
    },
    {
      kind: "VOLTAGE_MISMATCH",
      field: "catalog.title:voltage",
      axis: "voltage",
      leftStructured: left.variant.voltage,
      rightStructured: right.variant.voltage,
    },
    {
      kind: "SIZE_MISMATCH",
      field: "catalog.title:size",
      axis: "size",
      leftStructured: left.variant.size,
      rightStructured: right.variant.size,
    },
  ];

  const conflicts: HardConflictV1[] = [];

  // Extrai uma vez por lado, por eixo. Comparar POR EIXO e obrigatorio:
  // "256GB 127V" vs "512GB 127V" tem 127V em comum, mas o armazenamento
  // conflita — e o armazenamento e o que barra o EXACT.
  const leftMeasures = measureTokensByDimension(leftTitle);
  const rightMeasures = measureTokensByDimension(rightTitle);

  for (const dimension of dimensions) {
    if (usable(dimension.leftStructured) !== null) continue;
    if (usable(dimension.rightStructured) !== null) continue;

    const leftTokens = leftMeasures.get(dimension.axis);
    const rightTokens = rightMeasures.get(dimension.axis);
    if (!leftTokens || !rightTokens) continue;
    if (leftTokens.size === 0 || rightTokens.size === 0) continue;

    if (measureTokensConflict(leftTokens, rightTokens)) {
      conflicts.push({
        kind: dimension.kind,
        field: dimension.field,
        left: [...leftTokens].join(","),
        right: [...rightTokens].join(","),
      });
    }
  }
  return conflicts;
}

/* ------------------------------------------------------------------ */
/* FASE K — CANDIDATE GENERATION POR EVIDENCIA                         */
/* ------------------------------------------------------------------ */

export type EvidenceKind =
  | "GTIN"
  | "BRAND_MODEL"
  | "MPN"
  | "MANUFACTURER_MODEL"
  | "MODEL_TOKEN";

export interface CandidateEvidenceV1 {
  kind: EvidenceKind;
  value: string;
}

/**
 * Gera candidatos por EVIDENCIA. Never full-catalog: recebe um indice ja
 * construido por evidencia e devolve apenas pares de marketplaces distintos
 * que compartilham ao menos uma evidencia forte.
 */
export function buildEvidenceIndex(
  listings: NormalizedMarketplaceListingV1[],
): Map<string, NormalizedMarketplaceListingV1[]> {
  const index = new Map<string, NormalizedMarketplaceListingV1[]>();
  const add = (key: string, listing: NormalizedMarketplaceListingV1) => {
    const bucket = index.get(key) ?? [];
    bucket.push(listing);
    index.set(key, bucket);
  };

  for (const listing of listings) {
    for (const gtin of listing.identity.gtin ?? []) {
      const value = gtin.trim().toLowerCase();
      if (value) add(`GTIN:${value}`, listing);
    }
    const brand = usable(listing.identity.brand);
    const model = usable(listing.identity.model);
    if (brand && model) add(`BRAND_MODEL:${brand}|${model}`, listing);
    const mpn = usable(listing.identity.mpn);
    if (mpn) add(`MPN:${mpn}`, listing);
    const manufacturerModel = usable(listing.identity.manufacturerModel);
    if (manufacturerModel) {
      add(`MANUFACTURER_MODEL:${manufacturerModel}`, listing);
    }
  }
  return index;
}

/** Evidencias compartilhadas por um par (usado na explicabilidade). */
export function sharedEvidence(
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
): CandidateEvidenceV1[] {
  const out: CandidateEvidenceV1[] = [];
  const leftGtin = new Set(
    (left.identity.gtin ?? []).map((g) => g.trim().toLowerCase()).filter(Boolean),
  );
  for (const gtin of right.identity.gtin ?? []) {
    const value = gtin.trim().toLowerCase();
    if (value && leftGtin.has(value)) out.push({ kind: "GTIN", value });
  }
  const pair = (field: string, a: unknown, b: unknown, kind: EvidenceKind) => {
    const leftValue = usable(a);
    const rightValue = usable(b);
    if (leftValue && leftValue === rightValue) {
      out.push({ kind, value: leftValue });
    }
  };
  pair("model", left.identity.model, right.identity.model, "BRAND_MODEL");
  pair("mpn", left.identity.mpn, right.identity.mpn, "MPN");
  pair(
    "manufacturerModel",
    left.identity.manufacturerModel,
    right.identity.manufacturerModel,
    "MANUFACTURER_MODEL",
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* FASE K — SIMILARIDADE TEXTUAL (so depois dos conflitos)              */
/* ------------------------------------------------------------------ */

function tokenize(text: string | null | unknown): string[] {
  const value = usable(text);
  if (value === null) return [];
  return value
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1);
}

/** Jaccard de tokens: 0..1, simetrico e deterministico. */
export function textSimilarity(
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
): number {
  const leftTokens = new Set(tokenize(left.catalog.title));
  const rightTokens = new Set(tokenize(right.catalog.title));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = leftTokens.size + rightTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/* ------------------------------------------------------------------ */
/* FASE M — CLASSIFICACAO                                              */
/* ------------------------------------------------------------------ */

export type CrossMarketDecision = "EXACT" | "REVIEW" | "REJECT";

export interface CrossMarketMatchV1 {
  leftKey: string;
  rightKey: string;
  leftMarketplaceId: string;
  rightMarketplaceId: string;
  decision: CrossMarketDecision;
  hardConflicts: HardConflictV1[];
  evidence: CandidateEvidenceV1[];
  textSimilarity: number;
}

function keyOf(listing: NormalizedMarketplaceListingV1): string {
  return `${listing.marketplaceId}:${listing.externalListingId}`;
}

/** Limiar de EXACT: evidencia forte + texto muito similar. */
export const EXACT_TEXT_SIMILARITY = 0.6;

/**
 * Classifica UM par de listings de marketplaces DISTINTOS.
 * Ordem: hard conflicts -> evidencia -> similaridade. Nao inverte.
 */
export function classifyCrossMarketPair(
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
): CrossMarketMatchV1 {
  const base = {
    leftKey: keyOf(left),
    rightKey: keyOf(right),
    leftMarketplaceId: left.marketplaceId,
    rightMarketplaceId: right.marketplaceId,
  };

  // 0. Par do mesmo marketplace nao e cross-market.
  if (left.marketplaceId === right.marketplaceId) {
    return {
      ...base,
      decision: "REJECT",
      hardConflicts: [],
      evidence: [],
      textSimilarity: 0,
    };
  }

  // 1. HARD CONFLICTS primeiro: derrota qualquer similaridade.
  const hardConflicts = detectHardConflicts(left, right);
  if (hardConflicts.length > 0) {
    return {
      ...base,
      decision: "REJECT",
      hardConflicts,
      evidence: sharedEvidence(left, right),
      textSimilarity: textSimilarity(left, right),
    };
  }

  // 2. Evidencia forte (candidate generation ja filtering, mas re-confirma).
  const evidence = sharedEvidence(left, right);
  if (evidence.length === 0) {
    return {
      ...base,
      decision: "REJECT",
      hardConflicts: [],
      evidence,
      textSimilarity: textSimilarity(left, right),
    };
  }

  // 3. Similaridade textual (so agora).
  const similarity = textSimilarity(left, right);

  // Evidencia de GTIN e authoritativa: mesmo GTIN, sem conflito => EXACT.
  const hasGtin = evidence.some((item) => item.kind === "GTIN");
  if (hasGtin && similarity >= EXACT_TEXT_SIMILARITY) {
    return { ...base, decision: "EXACT", hardConflicts: [], evidence, textSimilarity: similarity };
  }

  if (hasGtin && similarity > 0) {
    // Mesmo GTIN mas texto muito diferente: ainda EXACT (GTIN vence),
    // porem com registro de divergencia textual.
    return { ...base, decision: "EXACT", hardConflicts: [], evidence, textSimilarity: similarity };
  }

  if (similarity >= EXACT_TEXT_SIMILARITY) {
    return { ...base, decision: "EXACT", hardConflicts: [], evidence, textSimilarity: similarity };
  }

  return { ...base, decision: "REVIEW", hardConflicts: [], evidence, textSimilarity: similarity };
}

/**
 * Executa o matching cross-market sobre um conjunto de listings, gerando
 * candidatos APENAS por evidencia (nunca cartesiano).
 */
export function matchCrossMarket(
  listings: NormalizedMarketplaceListingV1[],
): CrossMarketMatchV1[] {
  const index = buildEvidenceIndex(listings);
  const seen = new Set<string>();
  const results: CrossMarketMatchV1[] = [];

  for (const bucket of index.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const left = bucket[i];
        const right = bucket[j];
        if (left.marketplaceId === right.marketplaceId) continue;
        const pairKey = [keyOf(left), keyOf(right)].sort().join("||");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        results.push(classifyCrossMarketPair(left, right));
      }
    }
  }
  return results;
}
