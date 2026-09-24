/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW PROCESSOR (FASE 5 — SHADOW REAL CONTROLADO).
 *
 * Orquestra UMA listing observada no fluxo REAL (saveProduct ou replay) através
 * do pipeline oficial V1, SEM nenhum efeito público:
 *  - Prerequisitos fail-closed: flag ligada, marketplace na allowlist, payload
 *    válido, orçamento de escrita (dry-run / maxWrites).
 *  - Escreve SOMENTE RawMarketplaceListing (hashes) / rawPayload — nunca
 *    Product, MarketplaceOffer ou publicação.
 *  - Mede paridade (smoke) por listing; a paridade PROFUNDA por produto vive
 *    no runner (com as ofertas reais lidas read-only).
 */

import {
  processNormalizedListing,
  validateNormalizedListing,
  type PipelineContextV1,
  type PipelinePathV1,
} from "../ingestion/pipeline";
import type { HashPairV1 } from "../hashing";
import {
  evaluatePublicationEligibility,
} from "../publication/publicationEligibility";
import { type PublicOfferLike } from "../../../publicVisibility/multiStoreVisibility";
import { resolveMarketplaceIdFromLegacyEnum } from "../marketplaceRegistry";
import { CatalogMetrics } from "../observability/metrics";
import {
  buildShadowListingFromSaveContext,
  type LegacyShadowSaveContext,
} from "./adapter";
import {
  classifyShadowParity,
  type LegacyPublicationOutcome,
  type ShadowParityVerdict,
} from "./parityEngine";
import {
  createInMemoryRawListingRepository,
  type ShadowRepositoryBundle,
} from "./repository";
import {
  readShadowFlags,
  type ShadowFlags,
} from "./flags";
import {
  getShadowMetrics,
  type ShadowMetrics,
} from "./metrics";

export type ShadowSkippedReason =
  | "shadow-disabled"
  | "marketplace-not-in-allowlist"
  | "marketplace-unknown"
  | "listing-invalid"
  | null;

export type ShadowRunResultV1 = {
  handled: boolean;
  marketplaceId: string;
  externalListingId: string;
  skippedReason: ShadowSkippedReason;
  dryRun: boolean;
  wroteRaw: boolean;
  wroteHashes: boolean;
  path: PipelinePathV1 | null;
  created: boolean;
  hashes: HashPairV1 | null;
  parity: ShadowParityVerdict | null;
  error: string | null;
};

export type ShadowIngestInput = LegacyShadowSaveContext & {
  /** Estado de publicação observado no fluxo legado (mesma observação). */
  legacyOutcome: LegacyPublicationOutcome;
  /** true quando a shadow vê apenas parte das ofertas legadas (smoke). */
  partialView?: boolean;
  /**
   * Payload bruto determinístico a usar no rawHash. Default: o contexto da
   * observação (sem timestamps). O runner injeta a linha RAW real.
   */
  rawPayloadOverride?: unknown;
};

export type ShadowProcessorDeps = {
  flags?: ShadowFlags;
  metrics?: ShadowMetrics;
  /** Repos REAIS (Prisma). Quando ausente e a shadow precisa escrever, o
   *  processador usa dry-run in-memory (fail-closed). */
  realRepos?: ShadowRepositoryBundle;
  /** Roda a paridade smoke por-listing. Default true. */
  runParity?: boolean;
};

function notHandled(input: {
  marketplaceId: string;
  externalListingId: string;
  skippedReason: ShadowSkippedReason;
  dryRun: boolean;
}): ShadowRunResultV1 {
  return {
    handled: false,
    marketplaceId: input.marketplaceId,
    externalListingId: input.externalListingId,
    skippedReason: input.skippedReason,
    dryRun: input.dryRun,
    wroteRaw: false,
    wroteHashes: false,
    path: null,
    created: false,
    hashes: null,
    parity: null,
    error: null,
  };
}

function offerFromListing(listing: {
  marketplaceId: string;
  commerce: {
    availability: string;
    price: number;
  };
}): PublicOfferLike {
  const unavailable =
    listing.commerce.availability === "OUT_OF_STOCK" ||
    listing.commerce.availability === "UNAVAILABLE";
  return {
    marketplace: listing.marketplaceId,
    active: true,
    available: !unavailable,
    status: unavailable ? "UNAVAILABLE" : "ACTIVE",
    matchStatus: "EXACT",
    price: listing.commerce.price,
  };
}

/**
 * Processa uma única observação legada na shadow. Nunca lança: erro de
 * pipeline vira resultado com `error` preenchido (o fluxo REAL não pode ser
 * afetado de nenhuma forma).
 */
export async function processShadowListing(
  deps: ShadowProcessorDeps,
  input: ShadowIngestInput,
): Promise<ShadowRunResultV1> {
  const flags = deps.flags ?? readShadowFlags();
  const metrics = deps.metrics ?? getShadowMetrics();
  const runParity = deps.runParity ?? true;

  const marketplaceId =
    resolveMarketplaceIdFromLegacyEnum(input.marketplace) ?? "";

  if (!marketplaceId) {
    metrics.incAttempted("unknown");
    metrics.incSkippedInvalid("unknown");
    return notHandled({
      marketplaceId: "unknown",
      externalListingId: input.externalId,
      skippedReason: "marketplace-unknown",
      dryRun: flags.dryRun,
    });
  }
  metrics.incAttempted(marketplaceId);

  if (!flags.enabled) {
    metrics.incSkippedDisabled(marketplaceId);
    return notHandled({
      marketplaceId,
      externalListingId: input.externalId,
      skippedReason: "shadow-disabled",
      dryRun: flags.dryRun,
    });
  }

  if (!flags.marketplaceIds.includes(marketplaceId)) {
    metrics.incSkippedMarketplace(marketplaceId);
    return notHandled({
      marketplaceId,
      externalListingId: input.externalId,
      skippedReason: "marketplace-not-in-allowlist",
      dryRun: flags.dryRun,
    });
  }

  const rawPayload: unknown =
    input.rawPayloadOverride ??
    ({
      contract: "legacy-save-product",
      context: {
        marketplace: input.marketplace,
        externalId: input.externalId,
        sourceUrl: input.sourceUrl,
        title: input.title ?? null,
        price: input.price ?? null,
        canonicalProductId: input.canonicalProductId ?? null,
      },
    });

  const listing = buildShadowListingFromSaveContext(input);
  if (!listing) {
    // Marketplace resolvido acima, mas a conectora negou — inalcançável em
    // condições normais; mantido por fail-closed.
    metrics.incSkippedInvalid(marketplaceId);
    return notHandled({
      marketplaceId,
      externalListingId: input.externalId,
      skippedReason: "marketplace-unknown",
      dryRun: flags.dryRun,
    });
  }

  const validation = validateNormalizedListing(listing);
  if (!validation.ok) {
    metrics.incSkippedInvalid(marketplaceId);
    return notHandled({
      marketplaceId,
      externalListingId: input.externalId,
      skippedReason: "listing-invalid",
      dryRun: flags.dryRun,
    });
  }

  // Orçamento canário: `_MAX_WRITES` é um TETO REAL de escritas por processo
  // (fail-closed). Além do teto, o processador cai para in-memory (dry-run
  // equivalente) sem tocar o banco. No runner o teto também limita as linhas
  // lidas; aqui ele vale para o caminho do hook (saveProduct) por instância.
  const budgetRemaining =
    flags.maxWrites - metrics.snapshot().writeSuccess;

  const wouldWrite =
    !flags.dryRun &&
    (flags.persistRaw || flags.persistHashes) &&
    budgetRemaining > 0;

  // DRY-RUN ou sem persist => repositório in-memory (zero escrita no banco).
  const repository = wouldWrite && deps.realRepos
    ? deps.realRepos.raw
    : createInMemoryRawListingRepository();

  const pipelineContext: PipelineContextV1 = {
    repository,
    metrics: new CatalogMetrics(),
  };

  let pipeline;
  try {
    pipeline = await processNormalizedListing(
      pipelineContext,
      { listing, rawPayload },
      "",
    );
  } catch (error) {
    metrics.incWriteFailed(marketplaceId);
    return {
      handled: true,
      marketplaceId,
      externalListingId: input.externalId,
      skippedReason: null,
      dryRun: flags.dryRun,
      wroteRaw: false,
      wroteHashes: false,
      path: null,
      created: false,
      hashes: null,
      parity: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // FASE 6: listing processada pela pipeline V1 oficial (handled, sem skip).
  metrics.incProcessed(marketplaceId);

  if (wouldWrite && deps.realRepos) {
    metrics.incWriteSuccess(marketplaceId);
    if (flags.persistRaw) {
      metrics.incRawWrite(marketplaceId);
    }
    if (flags.persistHashes) {
      metrics.incHashWrite(marketplaceId);
    }
  } else if (flags.dryRun) {
    metrics.incSkippedDryRun(marketplaceId);
  } else if (budgetRemaining <= 0) {
    // Orçamento canário exausto (fail-closed): observado, reprocessado em
    // memória, zero escrita no banco.
    metrics.incSkippedMaxWrites(marketplaceId);
  }

  let parity: ShadowParityVerdict | null = null;
  if (runParity) {
    const v1 = evaluatePublicationEligibility({
      autoCreated: input.legacyOutcome.autoCreated,
      offers: [offerFromListing(listing)],
    });
    parity = classifyShadowParity({
      legacy: input.legacyOutcome,
      v1Eligible: v1.eligible,
      v1ReasonCodes: v1.reasonCodes,
      partialView: input.partialView ?? true,
    });
    if (parity.code === "PARITY_MATCH") {
      metrics.incParityMatch();
    } else if (parity.v1MorePermissiveThanLegacy) {
      metrics.incParityV1MorePermissive();
    } else if (parity.unexpectedMismatch) {
      metrics.incParityUnexpectedMismatch();
    } else if (parity.code === "SKIP_PARTIAL_VIEW") {
      metrics.incParitySkipPartialView();
    }
  }

  return {
    handled: true,
    marketplaceId,
    externalListingId: input.externalId,
    skippedReason: null,
    dryRun: flags.dryRun,
    wroteRaw: wouldWrite && flags.persistRaw,
    wroteHashes: wouldWrite && flags.persistHashes,
    path: pipeline.path,
    created: pipeline.created,
    hashes: pipeline.hashes,
    parity,
    error: null,
  };
}