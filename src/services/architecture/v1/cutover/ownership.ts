/**
 * CATALOG_ARCHITECTURE_V1 — SINGLE-WRITE OWNERSHIP (FASE D).
 *
 * Regra de escrita única por evento de listing:
 *
 *   1. V1 tenta PRIMEIRO.
 *   2. V1 commitou -> o legado NÃO escreve (nunca).
 *   3. V1 falhou ANTES do commit (falha pré-commit) E a falha é
 *      fallback-eligible E o modo permite fallback E fallback está
 *      habilitado -> o legado pode assumir (exatamente 1 write).
 *   4. Caso contrário: nenhuma escrita é emitida (fail-closed).
 *
 * "Commit point" é definido pelo chamador: sucesso da função v1Write
 * (transação $transaction do saveProduct fechada / fast-path aplicado).
 * Uma falha pós-commit (ex.: escrita de hashes falhou depois do catálogo
 * commitado) NÃO permite fallback: o catálogo JÁ foi escrito e o legado
 * duplicaria.
 */

import type { V1FailureCode } from "./classifier";
import { allowsLegacyFallbackForCode } from "./classifier";
import type { CutoverMetrics } from "./metrics";
import type { CatalogWriterMode } from "./policy";
import { allowsLegacyFallback, isV1AuthoritativeMode } from "./policy";

export type SingleWriteOutcome =
  | {
      kind: "V1_COMMITTED";
      productId: string | null;
    }
  | {
      kind: "LEGACY_FALLBACK_COMMITTED";
      productId: string | null;
      failureCode: V1FailureCode;
    }
  | {
      kind: "NO_WRITE";
      failureCode: V1FailureCode;
      reason: string;
    };

export type SingleWriteInput = {
  marketplaceId: string;
  mode: CatalogWriterMode;
  fallbackEnabled: boolean;
  metrics: CutoverMetrics;
  /** Realiza a escrita V1. Deve lançar ANTES do commit em caso de falha. */
  v1Write: () => Promise<{ productId: string | null }>;
  /** Escrita legada (fallback). Só é chamada em falha pré-commit elegível. */
  legacyWrite: () => Promise<{ productId: string | null }>;
  classify: (error: unknown) => V1FailureCode;
};

export async function runWithSingleWriteOwnership(
  input: SingleWriteInput,
): Promise<SingleWriteOutcome> {
  const { marketplaceId, mode, metrics, classify } = input;

  if (!isV1AuthoritativeMode(mode)) {
    return {
      kind: "NO_WRITE",
      failureCode: "UNEXPECTED_V1_FAILURE",
      reason: `mode-${mode}-nao-autoritativo`,
    };
  }

  metrics.incV1Attempt(marketplaceId);

  try {
    const result = await input.v1Write();
    // Commit point alcançado: o legado NUNCA escreve nesta execução.
    metrics.incV1Success(marketplaceId);
    return { kind: "V1_COMMITTED", productId: result.productId };
  } catch (error) {
    const failureCode = classify(error);
    metrics.incV1Failure(marketplaceId);

    const canFallback =
      allowsLegacyFallbackForCode(failureCode) &&
      allowsLegacyFallback(mode) &&
      input.fallbackEnabled;

    if (!canFallback) {
      return {
        kind: "NO_WRITE",
        failureCode,
        reason: `falha-pre-commit-v1:${failureCode}-sem-fallback`,
      };
    }

    // Legado assume: exatamente 1 write.
    metrics.incLegacyFallback(marketplaceId);
    try {
      const result = await input.legacyWrite();
      metrics.incLegacyFallbackSuccess(marketplaceId);
      return {
        kind: "LEGACY_FALLBACK_COMMITTED",
        productId: result.productId,
        failureCode,
      };
    } catch (legacyError) {
      return {
        kind: "NO_WRITE",
        failureCode,
        reason: `falha-legacy-fallback:${classify(legacyError)}`,
      };
    }
  }
}