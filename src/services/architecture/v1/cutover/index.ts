/**
 * CATALOG_ARCHITECTURE_V1 — CUTOVER PROGRESSIVO (FASE 7).
 *
 * Barrel público do módulo de cutover do V1 de shadow para writer
 * autoritativo (source-scoped por marketplaceId, cutover GLOBAL proibido).
 *
 * Garantias:
 *  - Fail-closed: flags OFF / marketplace fora da allowlist / modo não
 *    autoritativo / orçamento zero => OK é LEGACY_ONLY, zero writes V1.
 *  - Single-write ownership (FASE D): V1 commitou => legado NÃO escreve;
 *    fallback apenas em falha pré-commit fallback-eligible.
 *  - Idempotência (FASE E): retry da MESMA listing => NOOP por hashes.
 *  - Breaker (FASE P) + métricas FASE Q por marketplaceId.
 */

export * from "./flags";
export * from "./policy";
export * from "./classifier";
export * from "./idempotency";
export * from "./metrics";
export * from "./breaker";
export * from "./ownership";
export * from "./writer";
export * from "./commits";
export * from "./runner";

import type { LegacyShadowSaveContext } from "../shadow/adapter";
import type { LegacyPublicationOutcome } from "../shadow/parityEngine";
import { readAuthoritativeFlags } from "./flags";
import { readCatalogWriterPolicy, resolveCatalogWriterMode } from "./policy";
import { isV1AuthoritativeMode } from "./policy";
import { processAuthoritativeListing } from "./writer";
import type { AuthoritativeWriteResult } from "./writer";
import { resolveMarketplaceIdFromLegacyEnum } from "../marketplaceRegistry";

export type AuthoritativeHookInput = {
  context: LegacyShadowSaveContext;
  legacyOutcome: LegacyPublicationOutcome;
};

export type AuthoritativeHookResult =
  | AuthoritativeWriteResult
  | {
      handled: false;
      skippedReason: string;
    };

/**
 * Hook INERTE do cutover autoritativo no fim do saveProduct.
 *
 * - Flags OFF => `handled:false`, `skippedReason:"authoritative-disabled"`,
 *   sem I/O (o fluxo legado segue intacto).
 * - Marketplace fora do cutover => delegado ao legado (LEGACY_ONLY).
 *
 * NOTA: este hook NÃO dispara o runner canário (orçamento por execução).
 * A decisão do CUTOVER vive no runner autoritativo
 * (`runAuthoritativeCanary`), nunca dentro do saveProduct legado.
 */
export function runArchitectureV1AuthoritativeHook(
  input: AuthoritativeHookInput,
): AuthoritativeHookResult {
  const flags = readAuthoritativeFlags();
  if (flags.enabled !== true) {
    return { handled: false, skippedReason: "authoritative-disabled" };
  }

  const policy = readCatalogWriterPolicy();
  const marketplaceId = resolveMarketplaceIdFromLegacyEnum(
    input.context.marketplace,
  );
  if (!marketplaceId) {
    return { handled: false, skippedReason: "marketplace-desconhecido" };
  }

  if (!flags.marketplaceIds.includes(marketplaceId)) {
    return { handled: false, skippedReason: "marketplace-fora-do-cutover" };
  }

  const mode = resolveCatalogWriterMode(policy, marketplaceId);
  if (!isV1AuthoritativeMode(mode)) {
    return { handled: false, skippedReason: `mode-${mode}-nao-autoritativo` };
  }

  // Não executa escrita aqui (o saveProduct já commitou) e o runner
  // canário é o único lugar que decide/executa o cutover com orçamento.
  return { handled: false, skippedReason: "hook-inerte-runner-executa-cutover" };
}

/** Re-exporta API de decisão de modo para o hook acessar policy+flags. */
export { processAuthoritativeListing };
export type { AuthoritativeListingInput } from "./writer";