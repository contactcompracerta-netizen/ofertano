/**
 * PHASE 1 — QUERY SANITIZER
 *
 * Removes commerce interface noise and metadata from raw user queries.
 * Only removes UNAMBIGUOUS UI patterns; preserves all product-relevant content.
 */

import { normalizeMultistoreText } from "./normalizeCandidate";

export type SanitizationResult = {
  rawQuery: string;
  sanitizedQuery: string;
  removedNoise: string[];
  changed: boolean;
};

/**
 * Patterns that are clearly interface metadata, not product content.
 * Each pattern target is tested independently; preserves everything else.
 */
const NOISE_PATTERNS = [
  // Rating/review patterns
  /\b\d+(?:[.,]\d+)?\s*de\s*5\s*estrelas?\b/gi, // "4,5 de 5 estrelas"
  /\b\d+\.\d+\s*de\s*5\b/gi, // "4.5 de 5"
  /\(\s*\d+(?:\s*avaliações?|\s*classificações?|\s*reviews?)\s*\)/gi, // "(5 avaliações)"
  /\b\d+\s*(?:avaliações?|classificações?|reviews?)\b/gi, // "5 avaliações" standalone
  
  // Commerce labels
  /\b(?:mais\s+vendido|escolha\s*(?:do|da)\s*(?:amazon|loja)|patrocinado|exclusivo|premium)\b/gi,
  /\b(?:vendido\s+por|enviado\s+por|entrega\s+(?:por|rápida))\b/gi,
  /\b(?:frete\s*(?:grátis|gratis)|cupom|desconto|parcelado|em\s+\d+x)\b/gi,
  
  // Brand/seller prefix when isolated
  /^(?:marca|vendedor|loja)[\s:-]*(?=[A-Z])/gi,
];

/**
 * Extract individual noise elements for tracking.
 */
function extractNoiseElements(text: string): string[] {
  const noise: string[] = [];
  let remaining = text;

  for (const pattern of NOISE_PATTERNS) {
    const matches = remaining.match(pattern);
    if (matches) {
      noise.push(...matches);
      remaining = remaining.replace(pattern, " ");
    }
  }

  return noise;
}

/**
 * Sanitize a commerce query by removing interface noise.
 *
 * PRESERVES:
 * - Numbers (quantities, capacity: "1TB", "2 controles", "9 portas")
 * - Technical specs (voltagem, cores, etc.)
 * - Bundle indicators ("+", "com", "inclui", "jogos", "controles")
 * - Condition keywords ("recondicionado", "seminovo", "usado", "novo")
 * - Brand, model, line names
 *
 * REMOVES:
 * - Rating format ("4,5 de 5 estrelas", "(5 avaliações)")
 * - Commerce labels ("mais vendido", "escolha do Amazon", "patrocinado")
 * - Frete/payment labels ("frete grátis", "cupom", "parcelado")
 */
export function sanitizeCommerceQuery(rawQuery: string): SanitizationResult {
  const normalized = rawQuery.trim();

  if (!normalized || normalized.length < 2) {
    return {
      rawQuery: normalized,
      sanitizedQuery: normalized,
      removedNoise: [],
      changed: false,
    };
  }

  const noise = extractNoiseElements(normalized);
  let cleaned = normalized;

  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  const changed = cleaned !== normalized && noise.length > 0;

  return {
    rawQuery: normalized,
    sanitizedQuery: cleaned,
    removedNoise: noise,
    changed,
  };
}

/**
 * Test if query looks like it might be a full product listing title.
 * Long, detailed titles from marketplaces typically have:
 * - sufficient length (>= 26 chars)
 * - bundle signals (+, parênteses, "com", "inclui", etc.)
 * - capacity/storage numbers (TB, GB)
 * - quantity indicators (controles, unidades, etc.)
 * - condition keywords
 *
 * Used to decide if query should trigger multiple search variants.
 */
export function looksLikeListingTitle(query: string): boolean {
  const normalized = query.trim();
  if (normalized.length < 26) {
    return false;
  }

  const compact = normalizeMultistoreText(normalized);

  // Bundle signals: "+", "(", ")", "com", "mais", "inclui", "jogos", "controles", etc.
  const hasBundleSignal = /\+|\(|\)|\b(?:com|mais|inclui|jogos?|controles?|voltagem|peças?)\b/.test(compact);

  // Capacity: "1TB", "2 GB", "500gb", etc.
  const hasCapacitySignal = /\b\d+\s*(?:gb|tb|mb)\b/.test(compact);

  // Quantity: "2 controles", "4 unidades", etc.
  const hasQuantitySignal = /\b\d+\s*(?:controles?|unidades?|jogos?|peças?|portas?|gavetas?)\b/.test(compact);

  // Condition: recondicionado, seminovo, usado, novo, etc.
  const hasConditionSignal = /\b(?:recondicionado|seminovo|remanufaturado|refurbished|renewed|usado|novo|new|used)\b/.test(
    compact,
  );

  return hasBundleSignal || hasCapacitySignal || hasQuantitySignal || hasConditionSignal;
}

/**
 * Infer product condition from query text.
 * Returns normalized condition if detected, null otherwise.
 */
export function inferConditionFromQuery(query: string): string | null {
  const normalized = normalizeMultistoreText(query).toLowerCase();

  if (/(recondicionado|remanufaturado|refurbished|renewed)/.test(normalized)) {
    return "refurbished";
  }

  if (/(seminovo|semi novo|usado|used)/.test(normalized)) {
    return "used";
  }

  if (/(reembalado|re-?embalado|caixa aberta|open box|openbox)/.test(normalized)) {
    return "repackaged";
  }

  return null;
}
