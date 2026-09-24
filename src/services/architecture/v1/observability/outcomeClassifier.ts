/**
 * CATALOG_ARCHITECTURE_V1 — OPERATIONAL OUTCOME CLASSIFIER (FASE N).
 *
 * Policy BLOCK ≠ SYSTEM FAILURE.
 *
 * A Fase 3 classificou bloqueios de política como NON_RETRYABLE (terminal).
 * Aqui separamos OBSERVABILIDADE: um item pode estar "não publicado" por
 * política (POLICY BLOCK) ou ter falhado de verdade (SYSTEM FAILURE).
 *
 * Sem alterar a taxonomia funcional validada da Fase 3
 * (NON_RETRYABLE|POLICY_NOT_READY|...).
 */

import { NON_RETRYABLE_ENVELOPE_PREFIX } from "../../../importQueue/retryClassification";

export const POLICY_NOT_READY_TOKEN = "POLICY_NOT_READY";

export const OPERATIONAL_OUTCOME = {
  POLICY_BLOCKED: "policy_blocked",
  SYSTEM_FAILURE: "system_failure",
  SUCCESS: "success",
} as const;

export type OperationalOutcome =
  (typeof OPERATIONAL_OUTCOME)[keyof typeof OPERATIONAL_OUTCOME];

export interface OperationOutcomeVerdict {
  outcome: OperationalOutcome;
  /** true quando a causa é política (dado não bloqueia retry da Fase 3). */
  isPolicyBlock: boolean;
  reasonCodes: string[];
}

/**
 * Classifica o resultado operacional de um item da fila/ingestão.
 * - Envelope NON_RETRYABLE|POLICY_NOT_READY => POLICY_BLOCKED.
 * - Qualquer outro erro (inclusive NON_RETRYABLE por dados inválidos) => SYSTEM_FAILURE.
 * - Sem erro => SUCCESS.
 */
export function classifyOperationOutcome(
  errorMessage: string | null | undefined,
): OperationOutcomeVerdict {
  if (!errorMessage) {
    return { outcome: OPERATIONAL_OUTCOME.SUCCESS, isPolicyBlock: false, reasonCodes: [] };
  }
  const hasEnvelope = errorMessage.startsWith(NON_RETRYABLE_ENVELOPE_PREFIX);
  const tokens = errorMessage.split("|").map((t) => t.trim()).filter(Boolean);
  const isPolicy = hasEnvelope && tokens.includes(POLICY_NOT_READY_TOKEN);

  return {
    outcome: isPolicy
      ? OPERATIONAL_OUTCOME.POLICY_BLOCKED
      : OPERATIONAL_OUTCOME.SYSTEM_FAILURE,
    isPolicyBlock: isPolicy,
    reasonCodes: tokens.slice(1),
  };
}

/** Conta itens por outcome (para dashboard). */
export function summarizeOutcomes(
  items: Array<{ errorMessage?: string | null }>,
): Record<OperationalOutcome, number> {
  const summary: Record<OperationalOutcome, number> = {
    policy_blocked: 0,
    system_failure: 0,
    success: 0,
  };
  for (const item of items) {
    const verdict = classifyOperationOutcome(item.errorMessage);
    summary[verdict.outcome] += 1;
  }
  return summary;
}