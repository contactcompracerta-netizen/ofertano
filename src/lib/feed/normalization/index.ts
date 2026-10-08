/**
 * Feed Ingestion Engine V1 - Normalization Core.
 *
 * Pure functions, deterministic, no network/DNS.
 * CATALOG REMAINS FROZEN.
 *
 * Preserva a diferença entre ABSENT, VALID e INVALID.
 * Não apagar silenciosamente input inválido.
 */

export type NormalizedPriceResult =
  | { status: 'ABSENT' }
  | { status: 'VALID'; value: number }
  | { status: 'INVALID' };

/**
 * Normaliza um preço de string para number.
 *
 - aceita: "1299.90", "1299,90", "1.299,90", "R$ 1.299,90", 1299.90
 - rejeita: "abc", "R$", NaN, Infinity, 0, negativo
 */
export function normalizePrice(
  value: string | number | undefined | null
): NormalizedPriceResult {
  let num: number;

  if (value === undefined || value === null) {
    return { status: 'ABSENT' };
  }

  if (typeof value === 'number') {
    num = value;
  } else {
    const s = String(value).trim();

    if (s === '' || s === 'R$') {
      return { status: 'INVALID' };
    }

    // Remover "R $" e espaços
    let cleaned = s.replace(/^R\s?\$?\s*/i, '').trim();

    // Substituir vírgula por ponto (formatos BR)
    cleaned = cleaned.replace(',', '.');

    // Remover pontos de milhar (ex: "1.299,90" -> "1299.90")
    // Mas cuidar do caso "1.299,90" onde o ponto é milhar e vírgula é decimal
    // Strategy: se há vírgula, o último ponto é milhar, remova-o
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');

    if (lastComma > lastDot && lastDot > 0) {
      // Tem vírgula depois do último ponto => ponto é milhar
      cleaned = cleaned.slice(0, lastDot) + cleaned.slice(lastDot + 1);
    }

    // Se sobrou mais de um ponto (milhar), remova-os todos exceto o último
    // Actually, let's be simpler: after replacing comma with dot,
    // remove any remaining dots that are thousand separators
    // Pattern: dot followed by 3 digits then end or another dot
    cleaned = cleaned.replace(/\.(?=\d{3})/g, '');

    num = Number(cleaned);
  }

  // Validar resultado
  if (!Number.isFinite(num) || num <= 0) {
    return { status: 'INVALID' };
  }

  // Verificar se o parse perdeu informação (ex: "abc" -> NaN)
  if (!Number.isFinite(num)) {
    return { status: 'INVALID' };
  }

  return { status: 'VALID', value: num };
}

/**
 * Valida e normaliza string de moeda.
 *
 - "brl" -> "BRL"
 - " BRL " -> "BRL"
 - "R$" -> INVALID_CURRENCY (não transformar silenciosamente)
 - valores inválidos preservam status INVALID
 */
export type NormalizedCurrencyResult =
  | { status: 'ABSENT' }
  | { status: 'VALID'; value: string }
  | { status: 'INVALID_CURRENCY' };

export function normalizeCurrency(
  value: string | undefined | null
): NormalizedCurrencyResult {
  if (value === undefined || value === null) {
    return { status: 'ABSENT' };
  }

  const s = String(value).trim();

  if (s === '') {
    return { status: 'INVALID_CURRENCY' };
  }

  if (s.toLowerCase() === 'brl') {
    return { status: 'VALID', value: 'BRL' };
  }

  // Não transformar "R$" em absent ou válido - preservar como INVALID
  if (s.toUpperCase() === 'R$' || s.toLowerCase() === 'r$') {
    return { status: 'INVALID_CURRENCY' };
  }

  // Qualquer outro valor que não seja BRL lowercase é inválido para nosso domínio
  return { status: 'INVALID_CURRENCY' };
}

/**
 * Normaliza uma URL usando a função segura do feed.
 * Não cria política própria - reutiliza toSafeExternalUrl().
 */
import { toSafeExternalUrl, type SafeUrlResult } from "../urlSafety";

/**
 * Re-export SafeUrlResult for consumers.
 */
export { type SafeUrlResult } from "../urlSafety";

export function normalizeExternalUrl(
  value: string | undefined | null
): SafeUrlResult {
  return toSafeExternalUrl(value);
}

/**
 * Normaliza uma string: undefined/null -> undefined, "" -> undefined, trim.
 */
export type NormalizedStringResult =
  | { status: 'ABSENT'; value: undefined }
  | { status: 'VALID'; value: string };

export function normalizeString(
  value: string | undefined | null
): NormalizedStringResult {
  if (value === undefined || value === null) {
    return { status: 'ABSENT', value: undefined };
  }

  const trimmed = value.trim();

  if (trimmed === '') {
    return { status: 'ABSENT', value: undefined };
  }

  return { status: 'VALID', value: trimmed };
}

/**
 * Normaliza external ID (mesma regra de string).
 */
export function normalizeExternalId(
  value: string | undefined | null
): NormalizedStringResult {
  return normalizeString(value);
}

/**
 * Normaliza GTIN/Model/MPN: apenas valores explicitamente fornecidos.
 * NÃO inferir, NÃO extrair do título, NÃO usar IA.
 */
export type NormalizedGTINResult =
  | { status: 'ABSENT' }
  | { status: 'VALID'; value: string }
  | { status: 'INVALID' };

export function normalizeGTIN(
  value: string | undefined | null
): NormalizedGTINResult {
  if (value === undefined || value === null) {
    return { status: 'ABSENT' };
  }

  const s = String(value).trim();

  if (s === '') {
    return { status: 'ABSENT' };
  }

  // Apenas normalizar: remover espaços, converter para maiúsculas
  // NÃO validar formato GTIN (essa é regra de negócio do validator)
  const normalized = s.toUpperCase().replace(/\s+/g, '');

  if (normalized === '') {
    return { status: 'INVALID' };
  }

  return { status: 'VALID', value: normalized };
}

/**
 * Normaliza attributes: somente Record<string, unknown>, array rejeitado.
 */
export type NormalizedAttributesResult =
  | { status: 'ABSENT' }
  | { status: 'VALID'; value: Record<string, unknown> }
  | { status: 'INVALID' };

export function normalizeAttributes(
  value: Record<string, unknown> | unknown[] | undefined | null
): NormalizedAttributesResult {
  if (value === undefined || value === null) {
    return { status: 'ABSENT' };
  }

  if (Array.isArray(value)) {
    return { status: 'INVALID' };
  }

  if (typeof value !== 'object') {
    return { status: 'INVALID' };
  }

  // É um objeto simples - retornar cópia para não mutar
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = val;
  }

  return { status: 'VALID', value: result };
}

/**
 * Deduplicates an array of SafeUrlResult values deterministically.
 * Only keeps VALID entries, preserves order, removes duplicates.
 * (SafeUrlResult já é importado no topo do módulo — linha 122.)
 */
export function deduplicateUrls(
  results: Array<SafeUrlResult>
): Array<{ status: 'VALID'; value: string } | { status: 'ABSENT' }> {
  const seen = new Set<string>();
  const out: Array<{ status: 'VALID'; value: string } | { status: 'ABSENT' }> = [];

  for (const r of results) {
    if (r.status === 'VALID') {
      if (!seen.has(r.value)) {
        seen.add(r.value);
        out.push(r as { status: 'VALID'; value: string });
      }
    } else if (r.status === 'ABSENT') {
      out.push({ status: 'ABSENT' });
    }
    // INVALID entries are silently discarded (fail-closed)
  }

  return out;
}
