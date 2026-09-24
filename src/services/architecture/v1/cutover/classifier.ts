/**
 * CATALOG_ARCHITECTURE_V1 — V1 FAILURE CLASSIFIER (FASE G).
 *
 * Classifica falhas do writer V1 para decidir queda automática
 * (fallback para o writer legado).
 *
 * FALLBACK PERMITIDO (somente):
 *   DB_TRANSIENT                — erro transitório de banco/conexão.
 *   INTERNAL_PROCESSING_FAILURE — falha interna de processamento.
 *   UNEXPECTED_V1_FAILURE       — falha V1 inesperada (genérica).
 *
 * FALLBACK PROIBIDO (NUNCA):
 *   IDENTITY_REJECT          — identidade rejeitada (conservador).
 *   IDENTITY_REVIEW          — identidade em revisão manual.
 *   POLICY_NOT_READY         — política multiloja não pronta.
 *   MULTISTORE_NOT_READY     — gate multiloja (min marketplaces) não pronto.
 *   INVALID_DATA             — dado de entrada inválido.
 *
 * Critério de fallback é uma GARANTIA de segurança: se o classificador
 * não reconhecer a falha, NÃO cai para o legado (fail-closed).
 */

import { NON_RETRYABLE_ENVELOPE_PREFIX } from "@/services/importQueue/retryClassification";
import { POLICY_NOT_READY_TOKEN } from "../observability/outcomeClassifier";

export type V1FailureCode =
  | "DB_TRANSIENT"
  | "INTERNAL_PROCESSING_FAILURE"
  | "UNEXPECTED_V1_FAILURE"
  | "IDENTITY_REJECT"
  | "IDENTITY_REVIEW"
  | "POLICY_NOT_READY"
  | "MULTISTORE_NOT_READY"
  | "INVALID_DATA";

export const FALLBACK_ELIGIBLE_CODES: ReadonlySet<V1FailureCode> = new Set([
  "DB_TRANSIENT",
  "INTERNAL_PROCESSING_FAILURE",
  "UNEXPECTED_V1_FAILURE",
]);

export const NEVER_FALLBACK_CODES: ReadonlySet<V1FailureCode> = new Set([
  "IDENTITY_REJECT",
  "IDENTITY_REVIEW",
  "POLICY_NOT_READY",
  "MULTISTORE_NOT_READY",
  "INVALID_DATA",
]);

export function allowsLegacyFallbackForCode(
  code: V1FailureCode,
): boolean {
  return FALLBACK_ELIGIBLE_CODES.has(code);
}

/** Sinais (tokens) reconhecidos em mensagens de erro/códigos conhecidos. */
const TRANSIENT_TOKENS = [
  "P1001", // conexão indisponível (Prisma)
  "P1002", // timeout de conexão
  "P1008", // timeout de operação
  "P1017", // servidor fechou a conexão
  "P2024", // pool de conexão estourado
  "ECONNRESET",
  "ETIMEDOUT",
  "connection refused",
  "connect econnrefused",
  "database is not accepting",
  "transaction aborted",
];

const IDENTITY_REJECT_TOKENS = [
  "IDENTITY_REJECT",
  "identity_reject",
  "identidade rejeitada",
  "matchStatus REJECTED",
];

const IDENTITY_REVIEW_TOKENS = [
  "IDENTITY_REVIEW",
  "identity_review",
  "em revisão manual",
  "aguardando revisão de identidade",
];

const MULTISTORE_NOT_READY_TOKENS = [
  "MULTISTORE_NOT_READY",
  "multistore_not_ready",
  "PUBLIC_MULTISTORE_MIN_MARKETPLACES",
  "necessário mais marketplaces públicos",
];

const INVALID_DATA_TOKENS = [
  "INVALID_DATA",
  "invalid_data",
  "preço inválido",
  "preco invalido",
  "url ausente",
  "sourceUrl ausente",
  "externalId ausente",
  "dados de entrada inválidos",
];

function hasAnyToken(message: string, tokens: string[]): boolean {
  const normalized = message.toLowerCase();
  return tokens.some((token) => normalized.includes(token.toLowerCase()));
}

/**
 * Classifica uma falha do writer V1.
 *
 * Ordem de precedência (fail-closed):
 *   1. Envelope não-retryável (política/identidade) => POLICY_NOT_READY.
 *   2. POLÍTICA explícita => POLICY_NOT_READY.
 *   3. Dados inválidos => INVALID_DATA.
 *   4. Identidade rejeitada/revisão => IDENTITY_REJECT / IDENTITY_REVIEW.
 *   5. Gate multiloja => MULTISTORE_NOT_READY.
 *   6. Falha transiente de banco => DB_TRANSIENT.
 *   7. Qualquer outra falha => UNEXPECTED_V1_FAILURE (fallback permitido,
 *      pois o V1 falhou de forma inesperada antes do commit).
 */
export function classifyV1Failure(
  error: unknown,
): V1FailureCode {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown");

  if (message.startsWith(NON_RETRYABLE_ENVELOPE_PREFIX)) {
    if (message.includes(POLICY_NOT_READY_TOKEN)) {
      return "POLICY_NOT_READY";
    }
    // Envelope não-retryável — o legado não deve assumir (fail-closed).
    return "POLICY_NOT_READY";
  }

  if (message.includes(POLICY_NOT_READY_TOKEN)) {
    return "POLICY_NOT_READY";
  }

  if (hasAnyToken(message, INVALID_DATA_TOKENS)) {
    return "INVALID_DATA";
  }

  if (hasAnyToken(message, IDENTITY_REJECT_TOKENS)) {
    return "IDENTITY_REJECT";
  }

  if (hasAnyToken(message, IDENTITY_REVIEW_TOKENS)) {
    return "IDENTITY_REVIEW";
  }

  if (hasAnyToken(message, MULTISTORE_NOT_READY_TOKENS)) {
    return "MULTISTORE_NOT_READY";
  }

  if (hasAnyToken(message, TRANSIENT_TOKENS)) {
    return "DB_TRANSIENT";
  }

  return "UNEXPECTED_V1_FAILURE";
}

export function describeV1Failure(code: V1FailureCode): string {
  if (FALLBACK_ELIGIBLE_CODES.has(code)) {
    return `${code} (fallback legado permitido)`;
  }
  return `${code} (fallback NÃO permitido — fail-closed)`;
}