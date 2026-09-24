/**
 * CATALOG_ARCHITECTURE_V1 — COLLECTION / INVENTORY PIPELINE (FASE H).
 *
 * Dois caminhos internos oficiais:
 *
 *  CATALOG / COLLECTION PATH (estrutural)
 *    Raw -> parse -> normalize -> validation -> catalogHash -> geração de
 *    candidatos -> resolução de identidade -> Product/Variant/Listing ->
 *    avaliação de publicação.
 *
 *  FAST OFFER / INVENTORY PATH
 *    Listing conhecida -> offerHash -> atualizar preço/estoque/disponibilidade
 *    -> PriceHistory se necessário -> freshness -> reavaliação de publicação
 *    somente quando pertinente.
 *
 *  NOOP idempotente quando catalogHash e offerHash não mudaram.
 *
 * O pipeline é agnóstico de marketplace: opera sobre marketplaceId string.
 * Hooks estruturais/comerciais são injetados pela camada de integração
 * (default: nenhum — caminho shadow/desligado).
 */

import { classifyHashChange, computeHashPair } from "../hashing";
import type { HashPairV1, HashComparisonDecisionV1 } from "../hashing";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import { sourceListingKeyV1 } from "../types/normalizedListingV1";
import type { RawListingRepositoryV1 } from "./rawRepository";
import type { CatalogMetrics } from "../observability/metrics";

export type PipelinePathV1 = HashComparisonDecisionV1;

export interface PipelineContextV1 {
  repository: RawListingRepositoryV1;
  metrics: CatalogMetrics;
  /** Hook estrutural (CATALOG/COLLECTION PATH). Opcional; shadow por padrão. */
  onStructural?: (input: StructuralHookInputV1) => Promise<void>;
  /** Hook comercial (FAST OFFER PATH). Opcional; shadow por padrão. */
  onOfferOnly?: (input: OfferOnlyHookInputV1) => Promise<void>;
}

export interface StructuralHookInputV1 {
  listing: NormalizedMarketplaceListingV1;
  hashes: HashPairV1;
  created: boolean;
  previousCatalogHash: string | null;
}

export interface OfferOnlyHookInputV1 {
  listing: NormalizedMarketplaceListingV1;
  hashes: HashPairV1;
  previousOfferHash: string | null;
}

export interface PipelineResultV1 {
  path: PipelinePathV1;
  created: boolean;
  accepted: boolean;
  reasonCodes: string[];
  previousCatalogHash: string | null;
  previousOfferHash: string | null;
  hashes: HashPairV1;
}

export interface RawIngestInputV1 {
  listing: NormalizedMarketplaceListingV1;
  /** Payload bruto da fonte, preservado para reprocessamento (FASE I). */
  rawPayload: unknown;
}

/**
 * Processa uma listing normalizada pelo pipeline oficial.
 * Idempotente por (marketplaceId, externalListingId).
 */
export async function processNormalizedListing(
  ctx: PipelineContextV1,
  input: RawIngestInputV1,
  brandFallback = "",
): Promise<PipelineResultV1> {
  const { listing, rawPayload } = input;
  const key = sourceListingKeyV1(
    listing.marketplaceId,
    listing.externalListingId,
  );

  ctx.metrics.inc("ingestion_received_total", { marketplaceId: listing.marketplaceId });

  const hashes = computeHashPair(listing, rawPayload, brandFallback);

  const existing = await ctx.repository.findListing(key);
  const decision = classifyHashChange(
    existing
      ? {
          catalogHash: existing.catalogHash,
          offerHash: existing.offerHash,
          rawHash: existing.rawHash,
        }
      : null,
    hashes,
  );

  const upsert = await ctx.repository.upsertListing(listing, hashes);

  switch (decision) {
    case "STRUCTURAL": {
      ctx.metrics.inc("catalog_hash_changed_total", {
        marketplaceId: listing.marketplaceId,
      });
      ctx.metrics.inc(
        upsert.created ? "ingestion_changed_total" : "ingestion_noop_total",
        { marketplaceId: listing.marketplaceId },
      );
      if (ctx.onStructural) {
        await ctx.onStructural({
          listing,
          hashes,
          created: upsert.created,
          previousCatalogHash: upsert.previousCatalogHash,
        });
      }
      break;
    }
    case "OFFER_ONLY": {
      ctx.metrics.inc("offer_hash_changed_total", {
        marketplaceId: listing.marketplaceId,
      });
      ctx.metrics.inc("ingestion_changed_total", { marketplaceId: listing.marketplaceId });
      if (ctx.onOfferOnly) {
        await ctx.onOfferOnly({
          listing,
          hashes,
          previousOfferHash: upsert.previousOfferHash,
        });
      }
      break;
    }
    case "NOOP": {
      ctx.metrics.inc("ingestion_noop_total", { marketplaceId: listing.marketplaceId });
      ctx.metrics.inc("duplicate_prevented_total", {
        marketplaceId: listing.marketplaceId,
      });
      break;
    }
  }

  return {
    path: decision,
    created: upsert.created,
    accepted: true,
    reasonCodes: [],
    previousCatalogHash: upsert.previousCatalogHash,
    previousOfferHash: upsert.previousOfferHash,
    hashes,
  };
}

/**
 * Valida um payload normalizado antes de aceitá-lo.
 * Retorna a própria listing + reasonCodes (vazio = aceito).
 */
export function validateNormalizedListing(
  listing: NormalizedMarketplaceListingV1,
): { ok: boolean; reasonCodes: string[] } {
  const codes: string[] = [];
  if (!listing.marketplaceId) codes.push("MISSING_MARKETPLACE_ID");
  if (!listing.externalListingId) codes.push("MISSING_EXTERNAL_LISTING_ID");
  if (!Number.isFinite(listing.commerce.price) || listing.commerce.price <= 0) {
    codes.push("INVALID_PRICE");
  }
  if (!listing.catalog.title && !listing.catalog.category) {
    codes.push("MISSING_CATALOG_SIGNAL");
  }
  return { ok: codes.length === 0, reasonCodes: codes };
}

/**
 * Escreve no repositório um payload bruto que deve ser reprocessado (FASE I).
 * Idempotente: re-executar com o mesmo payload não altera o resultado.
 */
export async function persistRawForReprocess(
  ctx: PipelineContextV1,
  input: RawIngestInputV1,
): Promise<void> {
  const hashes = computeHashPair(input.listing, input.rawPayload);
  await ctx.repository.upsertListing(input.listing, hashes);
}