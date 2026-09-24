/**
 * CATALOG_ARCHITECTURE_V1 — AUTHORITATIVE V1 WRITER (FASE D).
 *
 * Orquestrador/decididor do write autoritativo V1. NÃO duplica a lógica
 * canônica: STRUCTURAL reutiliza a semântica canônica do saveProduct
 * (paridade garantida) via commit injetado; OFFER_ONLY usa fast path
 * dedicado (sem heavy matching); NOOP é idempotente.
 *
 * Responsabilidades do writer V1:
 *   - decisão de hash (STRUCTURAL / OFFER_ONLY / NOOP);
 *   - escrita raw/hash APÓS o commit (retry vira NOOP — FASE S);
 *   - idempotência (FASE E);
 *   - orçamento MAX_WRITES e métricas (FASE Q);
 *   - nunca emitir um 2º write legado (single-write ownership FASE D);
 *   - resolução de modo por marketplaceId (FASE B), fail-closed.
 *
 * Os commits (v1Structural / v1FastOffer / legacyWrite) são injetáveis:
 * o runner real injeta saveProduct/prisma; os testes injetam fakes.
 */

import type { HashPairV1 } from "../hashing";
import { classifyHashChange, computeHashPair } from "../hashing";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import type { CatalogWriterMode } from "./policy";
import { isV1AuthoritativeMode, resolveCatalogWriterMode } from "./policy";
import type { AuthoritativeFlags } from "./flags";
import type { CutoverBreaker } from "./breaker";
import type { CutoverMetrics } from "./metrics";
import type { V1FailureCode } from "./classifier";
import { classifyV1Failure } from "./classifier";
import { runWithSingleWriteOwnership } from "./ownership";
import type { CatalogWriterPolicy } from "./policy";

export type AuthoritativeWritePath = "STRUCTURAL" | "OFFER_ONLY" | "NOOP";

export type V1WriteContext = {
  marketplaceId: string;
  externalListingId: string;
  listing: NormalizedMarketplaceListingV1;
  hashes: HashPairV1;
  row: AuthoritativeListingInput;
};

/**
 * Contrato mínimo da row bruta (fonte: RawMarketplaceListing / adapter).
 * Marketplace agnóstico: `marketplace` é o ENUM legado e é resolvido para
 * marketplaceId canônico pelo registry V1 (mesmo molde do adapter shadow).
 */
export type AuthoritativeListingInput = {
  marketplace: string;
  externalId: string;
  sourceUrl?: string | null;
  title?: string | null;
  brand?: string | null;
  category?: string | null;
  image?: string | null;
  price?: number | null;
  oldPrice?: number | null;
  stock?: number | null;
  available?: boolean | null;
  attributes?: unknown;
  canonicalProductId?: string | null;
  hashes?: {
    catalogHash?: string | null;
    offerHash?: string | null;
  } | null;
};

export type V1CommitResult = {
  productId: string | null;
};

export type AuthoritativeWriterDeps = {
  flags: AuthoritativeFlags;
  policy: CatalogWriterPolicy;
  metrics: CutoverMetrics;
  breaker: CutoverBreaker;
  /** Constrói a listing canônica a partir da row (sem I/O). */
  buildListing: (
    row: AuthoritativeListingInput,
  ) => NormalizedMarketplaceListingV1 | null;
  /** Lê a row observada no banco (idempotência de hashes). */
  readRow: (
    marketplaceId: string,
    externalListingId: string,
  ) => Promise<{
    catalogHash: string | null;
    offerHash: string | null;
  } | null>;
  /** Persiste hashes pós-commit. */
  persistHashes: (
    marketplaceId: string,
    externalListingId: string,
    hashes: HashPairV1,
  ) => Promise<void>;
  /** Commit STRUCTURAL canônico (reusa saveProduct no runner real). */
  commitV1Structural: (ctx: V1WriteContext) => Promise<V1CommitResult>;
  /** Fast path OFFER_ONLY (sem heavy matching). */
  commitV1FastOffer: (ctx: V1WriteContext) => Promise<V1CommitResult>;
  /** Fallback legado (1 write, apenas falha pré-commit elegível). */
  legacyWrite: (ctx: V1WriteContext) => Promise<V1CommitResult>;
  /** Limite de writes V1 reais por execução (PROCESS_LOCAL). */
  maxWrites: number;
  /** Total de writes V1 reais consumidos nesta execução. */
  consumedWrites: () => number;
  /** Raw payload determinístico p/ hash (padrão: serialização da row). */
  rawPayload?: (row: AuthoritativeListingInput) => unknown;
  /** Resolve o modo (padrão: policy config-driven). */
  resolveMode?: (marketplaceId: string) => CatalogWriterMode;
};

export type AuthoritativeWriteResult = {
  handled: boolean;
  marketplaceId: string;
  externalListingId: string;
  mode: CatalogWriterMode;
  path: AuthoritativeWritePath | null;
  outcome:
    | "V1_COMMITTED"
    | "LEGACY_FALLBACK_COMMITTED"
    | "NO_WRITE"
    | "BUDGET_SKIPPED"
    | "MODE_NOT_AUTHORITATIVE"
    | "LISTING_INVALID"
    | null;
  failureCode: V1FailureCode | null;
  productId: string | null;
  skippedReason: string | null;
  error: string | null;
};

function defaultRawPayload(row: AuthoritativeListingInput): unknown {
  return {
    contract: "cutover-replay",
    marketplace: row.marketplace,
    externalId: row.externalId,
    sourceUrl: row.sourceUrl ?? null,
    title: row.title ?? null,
    price: row.price ?? null,
    canonicalProductId: row.canonicalProductId ?? null,
  };
}

export async function processAuthoritativeListing(
  deps: AuthoritativeWriterDeps,
  input: AuthoritativeListingInput,
): Promise<AuthoritativeWriteResult> {
  const marketplaceId = input.marketplace.trim().toLowerCase();
  const mode = deps.resolveMode
    ? deps.resolveMode(marketplaceId)
    : resolveCatalogWriterMode(deps.policy, marketplaceId);

  // Fail-closed: breaker tripado => marketplace volta a LEGACY_ONLY.
  if (deps.breaker.isTripped()) {
    return {
      handled: true,
      marketplaceId,
      externalListingId: input.externalId,
      mode: "LEGACY_ONLY",
      path: null,
      outcome: "MODE_NOT_AUTHORITATIVE",
      failureCode: null,
      productId: null,
      skippedReason: `breaker-tripado:${deps.breaker.state().reason}`,
      error: null,
    };
  }

  if (!isV1AuthoritativeMode(mode)) {
    return {
      handled: true,
      marketplaceId,
      externalListingId: input.externalId,
      mode,
      path: null,
      outcome: "MODE_NOT_AUTHORITATIVE",
      failureCode: null,
      productId: null,
      skippedReason: `mode-${mode}-nao-autoritativo`,
      error: null,
    };
  }

  if (deps.flags.enabled !== true) {
    return {
      handled: true,
      marketplaceId,
      externalListingId: input.externalId,
      mode,
      path: null,
      outcome: "MODE_NOT_AUTHORITATIVE",
      failureCode: null,
      productId: null,
      skippedReason: "flags-autoritativas-desabilitadas",
      error: null,
    };
  }

  if (!deps.flags.marketplaceIds.includes(marketplaceId)) {
    return {
      handled: true,
      marketplaceId,
      externalListingId: input.externalId,
      mode,
      path: null,
      outcome: "MODE_NOT_AUTHORITATIVE",
      failureCode: null,
      productId: null,
      skippedReason: "marketplace-fora-do-allowlist-cutover",
      error: null,
    };
  }

  const listing = deps.buildListing(input);
  if (!listing) {
    return {
      handled: true,
      marketplaceId,
      externalListingId: input.externalId,
      mode,
      path: null,
      outcome: "LISTING_INVALID",
      failureCode: "INVALID_DATA",
      productId: null,
      skippedReason: "listing-invalida-ou-marketplace-desconhecido",
      error: null,
    };
  }

  const hashes = computeHashPair(
    listing,
    deps.rawPayload?.(input) ?? defaultRawPayload(input),
  );

  const observed = await deps.readRow(marketplaceId, input.externalId);
  const decision = classifyHashChange(
    {
      catalogHash: observed?.catalogHash ?? null,
      offerHash: observed?.offerHash ?? null,
      rawHash: null,
    },
    hashes,
  );

  if (decision === "NOOP") {
    return {
      handled: true,
      marketplaceId,
      externalListingId: input.externalId,
      mode,
      path: "NOOP",
      outcome: "NO_WRITE",
      failureCode: null,
      productId: null,
      skippedReason: "idempotente-hashes-atuais",
      error: null,
    };
  }

  const budgetRemaining = deps.maxWrites - deps.consumedWrites();
  if (budgetRemaining <= 0) {
    deps.metrics.incWriteBudgetSkipped(marketplaceId);
    return {
      handled: true,
      marketplaceId,
      externalListingId: input.externalId,
      mode,
      path: decision,
      outcome: "BUDGET_SKIPPED",
      failureCode: null,
      productId: null,
      skippedReason: "orcamento-writes-esgotado",
      error: null,
    };
  }

  const ctx: V1WriteContext = {
    marketplaceId,
    externalListingId: input.externalId,
    listing,
    hashes,
    row: input,
  };

  const v1Write =
    decision === "STRUCTURAL"
      ? () => deps.commitV1Structural(ctx)
      : () => deps.commitV1FastOffer(ctx);

  const outcome = await runWithSingleWriteOwnership({
    marketplaceId,
    mode,
    fallbackEnabled: deps.flags.legacyFallbackEnabled,
    metrics: deps.metrics,
    v1Write,
    legacyWrite: () => deps.legacyWrite(ctx),
    classify: classifyV1Failure,
  });

  // Commit point alcançado => persiste hashes (retry vira NOOP).
  if (
    outcome.kind === "V1_COMMITTED" ||
    outcome.kind === "LEGACY_FALLBACK_COMMITTED"
  ) {
    try {
      await deps.persistHashes(marketplaceId, input.externalId, hashes);
    } catch {
      // Pós-commit: hash é best-effort; não gera fallback nem duplicata
      // (idempotência garantida pela chave única do offer/product).
    }
    return {
      handled: true,
      marketplaceId,
      externalListingId: input.externalId,
      mode,
      path: decision,
      outcome:
        outcome.kind === "V1_COMMITTED"
          ? "V1_COMMITTED"
          : "LEGACY_FALLBACK_COMMITTED",
      failureCode: outcome.kind === "LEGACY_FALLBACK_COMMITTED" ? outcome.failureCode : null,
      productId: outcome.productId,
      skippedReason: null,
      error: null,
    };
  }

  return {
    handled: true,
    marketplaceId,
    externalListingId: input.externalId,
    mode,
    path: decision,
    outcome: "NO_WRITE",
    failureCode: outcome.failureCode,
    productId: null,
    skippedReason: outcome.reason,
    error: null,
  };
}