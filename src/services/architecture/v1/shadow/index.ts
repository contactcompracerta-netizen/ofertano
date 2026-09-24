/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW (FASE 5 — SHADOW REAL + DUAL-WRITE
 * CONTROLADO + PROVA DE PARIDADE).
 *
 * Barrel público dos módulos shadow + o hook INERTE para o fim do
 * saveProduct legado.
 *
 * Garantias do hook (`runArchitectureV1ShadowHook`):
 *  - INERTE por default: flags OFF => retorna imediatamente, sem I/O.
 *  - Escreve somente RawMarketplaceListing (hashes/rawPayload conforme
 *    flags) e nunca Product/MarketplaceOffer/publicação.
 *  - Nunca lança para o fluxo REAL (o chamador ainda envolve em try/catch).
 */

import prisma from "@/lib/prisma";

import {
  createPrismaShadowRepositories,
  type ShadowPrismaClient,
} from "./repository";
import {
  processShadowListing,
  type ShadowRunResultV1,
} from "./shadowProcessor";
import type { LegacyPublicationOutcome } from "./parityEngine";
import type { LegacyShadowSaveContext } from "./adapter";
import { readShadowFlags } from "./flags";

export * from "./flags";
export * from "./metrics";
export * from "./adapter";
export * from "./parityEngine";
export * from "./repository";
export * from "./shadowProcessor";
export * from "./runner";

export type ShadowHookInput = {
  /** Contexto observável da listing no fluxo REAL (saveProduct). */
  context: LegacyShadowSaveContext;
  /** Estado de publicação legado PARA A MESMA observação. */
  legacyOutcome: LegacyPublicationOutcome;
};

/**
 * Hook inerte da shadow no fim do saveProduct.
 * - Flags OFF => `handled:false`, `skippedReason:"shadow-disabled"`, sem I/O.
 * - DRY-RUN ou persist desligado => reprocessa em memória (zero escrita).
 * - Escrita real => Prisma (RAW + hashes/rawPayload), dentro do orçamento.
 */
export async function runArchitectureV1ShadowHook(
  input: ShadowHookInput,
): Promise<ShadowRunResultV1> {
  const flags = readShadowFlags();

  // Fail-closed: flag OFF => nem constrói repositórios reais.
  const wouldWrite =
    !flags.dryRun && (flags.persistRaw || flags.persistHashes);

  const realRepos = wouldWrite
    ? createPrismaShadowRepositories(
        prisma as unknown as ShadowPrismaClient,
        {
          persistRaw: flags.persistRaw,
          persistHashes: flags.persistHashes,
        },
      )
    : undefined;

  return processShadowListing(
    { flags, realRepos, runParity: true },
    {
      ...input.context,
      legacyOutcome: input.legacyOutcome,
      partialView: true,
    },
  );
}