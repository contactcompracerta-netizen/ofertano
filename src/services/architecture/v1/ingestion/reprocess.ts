/**
 * CATALOG_ARCHITECTURE_V1 — RAW REPROCESS (FASE I).
 *
 * Todo dado aceito pelo ingestion contract deve poder ser reprocessado no
 * futuro. O Raw preserva:
 *   marketplaceId, externalListingId, payload original, payload/schema version,
 *   receivedAt, rawHash, processing status/reason.
 *
 * reprocess(rawId): re-parse do rawPayload com a payloadVersion registrada,
 * re-normatização via conector e re-entrada no pipeline (estrutural ou oferta).
 * Idempotente: payload idêntico => NOOP; mudanças detectadas pelos hashes.
 */

import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import type {
  MarketplaceConnector,
} from "../types/connector";
import type { RawListingRecordV1 } from "./rawRepository";
import { processNormalizedListing } from "./pipeline";
import type { PipelineContextV1 } from "./pipeline";

export interface ReprocessResultV1 {
  reprocessed: boolean;
  path: "STRUCTURAL" | "OFFER_ONLY" | "NOOP" | "REJECTED";
  reasonCodes: string[];
}

export interface ReprocessContextV1 extends PipelineContextV1 {
  /** Conector capaz de re-normalizar o payload bruto (mesmo marketplace). */
  connector: MarketplaceConnector;
}

function assertConnectorMatchesMarketplace(
  connector: MarketplaceConnector,
  record: RawListingRecordV1,
): void {
  if (connector.marketplaceId !== record.key.marketplaceId) {
    throw new Error(
      `reprocess: connector "${connector.id}" (${connector.marketplaceId}) ` +
        `não pode reprocessar listing ${record.key.marketplaceId}:${record.key.externalListingId}.`,
    );
  }
}

/**
 * Reprocessa uma listing existente a partir do rawPayload preservado.
 * - rawPayload ausente/inválido => REJECTED (fail-closed).
 * - re-normaliza, recalcula hashes e re-roda o pipeline (idempotente).
 */
export async function reprocessRawListing(
  ctx: ReprocessContextV1,
  record: RawListingRecordV1,
  raw: unknown = record.rawPayload,
): Promise<ReprocessResultV1> {
  assertConnectorMatchesMarketplace(ctx.connector, record);

  ctx.metrics.inc("raw_reprocess_total", {
    marketplaceId: record.key.marketplaceId,
  });

  if (raw === null || raw === undefined) {
    return { reprocessed: false, path: "REJECTED", reasonCodes: ["MISSING_RAW_PAYLOAD"] };
  }

  let listing: NormalizedMarketplaceListingV1;
  try {
    listing = ctx.connector.normalize(raw);
  } catch (err) {
    return {
      reprocessed: false,
      path: "REJECTED",
      reasonCodes: ["NORMALIZE_FAILED", (err as Error).message],
    };
  }

  // Garante que a re-normalização não troque a identidade da listing.
  if (
    listing.marketplaceId !== record.key.marketplaceId ||
    listing.externalListingId !== record.key.externalListingId
  ) {
    return {
      reprocessed: false,
      path: "REJECTED",
      reasonCodes: ["REPROCESS_IDENTITY_MISMATCH"],
    };
  }

  const result = await processNormalizedListing(ctx, {
    listing,
    rawPayload: raw,
  });

  await ctx.repository.recordReprocess(record.key);

  return {
    reprocessed: result.accepted,
    path: result.path,
    reasonCodes: result.reasonCodes,
  };
}