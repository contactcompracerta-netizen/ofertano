/**
 * CATALOG_WAVE 1 - MATCHING ENGINE (FASE H).
 *
 * Prioridade: 1) GTIN exato  2) brand+MPN  3) brand+model
 *             4) atributos estruturados  5) título/spec
 *
 * Conservadorismo obrigatório:
 *   - nunca casar automaticamente com brands diferentes
 *   - nunca casar com GTIN conflitante
 *   - nunca casar com modelo incompatível
 *   - título sozinho NUNCA alcança faixa AUTO (cap 0.84)
 *
 * Faixas: >= 0.95 AUTO_MATCH | 0.85-0.949 REVIEW | < 0.85 NEW/REJECT
 */
import type { CatalogFeedItem, ExistingProductRef, ReasonCode } from "./types";
import { isValidGtin, normalizeToken } from "./identity";

export const AUTO_MATCH_THRESHOLD = 0.95;
export const REVIEW_THRESHOLD = 0.85;

export type MatchRule =
  | "GTIN_EXACT"
  | "BRAND_MPN"
  | "BRAND_MODEL"
  | "ATTRIBUTES"
  | "TITLE_SIM";

export interface MatchEvidence {
  rule: MatchRule;
  confidence: number;
}

export interface MatchResult {
  /** Produto candidato (null = nenhum ou candidato rejeitado). */
  productId: string | null;
  confidence: number;
  rule: MatchRule | null;
  evidence: MatchEvidence[];
  reasonCodes: ReasonCode[];
  /** GTIN do item conflita com marca do candidato: bloqueia auto-merge. */
  conflict: boolean;
}

const NO_MATCH: MatchResult = {
  productId: null,
  confidence: 0,
  rule: null,
  evidence: [],
  reasonCodes: [],
  conflict: false,
};

/** Similaridade de Dice sobre tokens normalizados (0..1). */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

function tokenize(value: string): string[] {
  // Normaliza caixa/acento MANTENDO separadores para tokenizar por palavra.
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized.match(/[a-z0-9]{2,}/g) ?? [];
}

function brandsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * Tenta casar o item com o catálogo existente.
 * `existing` é um snapshot (read-only) fornecido pelo chamador.
 */
export function matchToCatalog(
  item: CatalogFeedItem,
  existing: readonly ExistingProductRef[],
): MatchResult {
  const reasonCodes: ReasonCode[] = [];
  const gtinValue =
    item.gtin && isValidGtin(item.gtin)
      ? item.gtin.replace(/[\s-]/g, "")
      : null;

  let best: MatchResult | null = null;
  let conflictDetected = false;
  const modelIncompatible = new Set<string>();
  const crossBrand = new Set<string>();

  for (const product of existing) {
    const productGtin =
      product.gtin && isValidGtin(product.gtin)
        ? product.gtin.replace(/[\s-]/g, "")
        : product.ean && isValidGtin(product.ean)
          ? product.ean.replace(/[\s-]/g, "")
          : null;

    // 1) GTIN exato -------------------------------------------------------
    if (gtinValue && productGtin && gtinValue === productGtin) {
      if (
        item.brand &&
        product.brand &&
        !brandsEqual(item.brand, product.brand)
      ) {
        // Mesmo GTIN, marcas diferentes => conflito. Nunca auto-merge.
        conflictDetected = true;
        continue;
      }
      best = {
        productId: product.id,
        confidence: 0.99,
        rule: "GTIN_EXACT",
        evidence: [{ rule: "GTIN_EXACT", confidence: 0.99 }],
        reasonCodes: ["MATCH_GTIN_EXACT"],
        conflict: false,
      };
      break;
    }

    const sameBrand = brandsEqual(item.brand, product.brand);

    // Bloqueios: modelo incompatível e cross-brand ---------------------------
    if (sameBrand && item.model && product.modelNumber) {
      const mi = normalizeToken(item.model);
      const mp = normalizeToken(product.modelNumber);
      if (mi && mp && mi !== mp) {
        modelIncompatible.add(product.id);
        continue;
      }
    }
    if (!sameBrand && item.brand && product.brand) {
      // Marcas presentes e diferentes: título nunca casa (cross-brand).
      crossBrand.add(product.id);
      continue;
    }

    // 2) brand + MPN --------------------------------------------------------
    if (sameBrand && item.mpn && product.mpn) {
      const mi = normalizeToken(item.mpn);
      const mp = normalizeToken(product.mpn);
      if (mi && mp && mi === mp) {
        const candidate: MatchResult = {
          productId: product.id,
          confidence: 0.96,
          rule: "BRAND_MPN",
          evidence: [{ rule: "BRAND_MPN", confidence: 0.96 }],
          reasonCodes: ["MATCH_BRAND_MPN"],
          conflict: false,
        };
        if (!best || candidate.confidence > best.confidence) best = candidate;
        continue;
      }
    }

    // 3) brand + model ------------------------------------------------------
    if (sameBrand && item.model && product.modelNumber) {
      const mi = normalizeToken(item.model);
      const mp = normalizeToken(product.modelNumber);
      if (mi && mp && mi === mp) {
        const candidate: MatchResult = {
          productId: product.id,
          confidence: 0.93,
          rule: "BRAND_MODEL",
          evidence: [{ rule: "BRAND_MODEL", confidence: 0.93 }],
          reasonCodes: ["MATCH_BRAND_MODEL"],
          conflict: false,
        };
        if (!best || candidate.confidence > best.confidence) best = candidate;
        continue;
      }
    }

    // 4) atributos estruturados (brand + categoria + título muito próximo) --
    if (
      sameBrand &&
      item.category &&
      product.category &&
      normalizeToken(item.category) === normalizeToken(product.category)
    ) {
      const sim = titleSimilarity(item.title, product.name);
      if (sim >= 0.9) {
        const conf = Math.min(0.9, 0.85 + (sim - 0.9) * 0.5);
        const candidate: MatchResult = {
          productId: product.id,
          confidence: Number(conf.toFixed(4)),
          rule: "ATTRIBUTES",
          evidence: [{ rule: "ATTRIBUTES", confidence: Number(conf.toFixed(4)) }],
          reasonCodes: ["MATCH_ATTRIBUTES"],
          conflict: false,
        };
        if (!best || candidate.confidence > best.confidence) best = candidate;
        continue;
      }
    }

    // 5) título/spec (fallback; cap abaixo da faixa AUTO) -------------------
    const sim = titleSimilarity(item.title, product.name);
    if (sim >= 0.6) {
      const conf = Math.min(0.84, Number((sim * 0.84).toFixed(4)));
      const candidate: MatchResult = {
        productId: product.id,
        confidence: conf,
        rule: "TITLE_SIM",
        evidence: [{ rule: "TITLE_SIM", confidence: conf }],
        reasonCodes: ["MATCH_TITLE_SIMILARITY"],
        conflict: false,
      };
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }
  }

  if (conflictDetected) {
    return {
      ...NO_MATCH,
      reasonCodes: ["GTIN_CONFLICT"],
      conflict: true,
    };
  }

  if (!best) {
    if (crossBrand.size > 0) {
      reasonCodes.push("CROSS_BRAND_NO_MATCH");
    } else if (modelIncompatible.size > 0) {
      reasonCodes.push("MODEL_INCOMPATIBLE");
    }
    return { ...NO_MATCH, reasonCodes };
  }

  // Candidato de título que passou por produto de outra marca => descarta.
  if (best.rule === "TITLE_SIM" && crossBrand.has(best.productId ?? "")) {
    return { ...NO_MATCH, reasonCodes: ["CROSS_BRAND_NO_MATCH"] };
  }

  const codes = [...best.reasonCodes];
  if (crossBrand.size > 0) codes.push("CROSS_BRAND_NO_MATCH");
  else if (modelIncompatible.size > 0) codes.push("MODEL_INCOMPATIBLE");
  return { ...best, reasonCodes: codes };
}
