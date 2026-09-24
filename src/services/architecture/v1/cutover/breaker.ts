/**
 * CATALOG_ARCHITECTURE_V1 — CUTOVER BREAKER (FASE P).
 *
 * Breaker automático do cutover. Trip por condições de segurança:
 *
 *   DUPLICATE_UNEXPECTED          — duplicata inesperada > 0 no banco.
 *   PUBLICATION_VIOLATION         — violação de publicação (produto público
 *                                   errado / single-store ativo / bypass gate).
 *   PARITY_DIFF_UNEXPECTED        — diferença de paridade inesperada > 0.
 *   V1_ERRORS_ABOVE_LIMIT         — erros V1 acima do limite seguro.
 *   IDENTITY_CORRUPTION           — corrupção de identidade detectada.
 *   WRITE_BUDGET_EXCEEDED         — orçamento de escrita excedido.
 *
 * Ao trip, a resolução de modo daquele marketplace passa a LEGACY_ONLY
 * (rollback config-only) e o motivo fica registrado.
 */

import type { CatalogWriterMode } from "./policy";

export type CutoverBreakerReason =
  | "DUPLICATE_UNEXPECTED"
  | "PUBLICATION_VIOLATION"
  | "PARITY_DIFF_UNEXPECTED"
  | "V1_ERRORS_ABOVE_LIMIT"
  | "IDENTITY_CORRUPTION"
  | "WRITE_BUDGET_EXCEEDED";

export type CutoverBreakerState = {
  tripped: boolean;
  reason: CutoverBreakerReason | null;
  trippedAt: string | null;
};

export const SAFE_V1_ERROR_LIMIT = 3;

export interface CutoverBreaker {
  trip(reason: CutoverBreakerReason): void;
  isTripped(): boolean;
  state(): CutoverBreakerState;
  /**
   * Avaliação de segurança por lote/run.
   *
   * Nota: `writeBudgetSkipped` NÃO trip o breaker — exaurir o orçamento no
   * canário é comportamento ESPERADO (rows seguintes são skip, nunca write).
   * Violação é escrever ALÉM do orçamento (`writeBudgetExceeded > 0`).
   */
  evaluate(input: {
    v1Failures: number;
    duplicates: number;
    publicationViolations: number;
    parityDifferencesUnexpected: number;
    writeBudgetExceeded: number;
    identityCorruption: boolean;
    v1ErrorSafeLimit?: number;
  }): CutoverBreakerReason | null;
  reset(): void;
}

function createCutoverBreaker(): CutoverBreaker {
  let state: CutoverBreakerState = {
    tripped: false,
    reason: null,
    trippedAt: null,
  };

  return {
    trip(reason) {
      if (!state.tripped) {
        state = {
          tripped: true,
          reason,
          trippedAt: new Date().toISOString(),
        };
      }
    },
    isTripped() {
      return state.tripped;
    },
    state() {
      return { ...state };
    },
    evaluate(input) {
      const safeLimit =
        input.v1ErrorSafeLimit ?? SAFE_V1_ERROR_LIMIT;

      if (input.identityCorruption) {
        this.trip("IDENTITY_CORRUPTION");
        return "IDENTITY_CORRUPTION";
      }
      if (input.duplicates > 0) {
        this.trip("DUPLICATE_UNEXPECTED");
        return "DUPLICATE_UNEXPECTED";
      }
      if (input.publicationViolations > 0) {
        this.trip("PUBLICATION_VIOLATION");
        return "PUBLICATION_VIOLATION";
      }
      if (input.parityDifferencesUnexpected > 0) {
        this.trip("PARITY_DIFF_UNEXPECTED");
        return "PARITY_DIFF_UNEXPECTED";
      }
      if (input.writeBudgetExceeded > 0) {
        this.trip("WRITE_BUDGET_EXCEEDED");
        return "WRITE_BUDGET_EXCEEDED";
      }
      if (input.v1Failures >= safeLimit) {
        this.trip("V1_ERRORS_ABOVE_LIMIT");
        return "V1_ERRORS_ABOVE_LIMIT";
      }
      return null;
    },
    reset() {
      state = {
        tripped: false,
        reason: null,
        trippedAt: null,
      };
    },
  };
}

let cutoverBreaker: CutoverBreaker | null = null;

export function getCutoverBreaker(): CutoverBreaker {
  cutoverBreaker ??= createCutoverBreaker();
  return cutoverBreaker;
}

export function resetCutoverBreaker(): void {
  getCutoverBreaker().reset();
}

/**
 * Rollback config-only: dado um breaker tripado, o modo efetivo do
 * marketplace passa a LEGACY_ONLY. Nada é apagado do banco.
 */
export function effectiveModeAfterBreaker(
  _requestedMode: CatalogWriterMode,
): CatalogWriterMode {
  // Rollback config-only: o breaker tripado retorna o marketplace a
  // LEGACY_ONLY, independentemente do modo solicitado.
  void _requestedMode;
  return "LEGACY_ONLY";
}