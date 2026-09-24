/**
 * CATALOG_ARCHITECTURE_V1 — IDEMPOTENCY KEY (FASE E).
 *
 * Chave determinística de idempotência por (marketplaceId, externalListingId)
 * + hashes/versão. Um retry com a MESMA chave NÃO pode duplicar
 * Product/Variant/SourceListing/OfferCurrent/hash state.
 *
 * A chave é computada SEM I/O: mesmo payload => mesma chave.
 */

import { createHash } from "node:crypto";

export type IdempotencyInputV1 = {
  marketplaceId: string;
  externalListingId: string;
  payloadVersion: string;
  catalogHash: string | null;
  offerHash: string | null;
  rawHash: string | null;
};

export function idempotencyKeyFor(input: IdempotencyInputV1): string {
  const canonical = [
    "cat-v1",
    input.marketplaceId,
    input.externalListingId,
    input.payloadVersion,
    input.catalogHash ?? "",
    input.offerHash ?? "",
    input.rawHash ?? "",
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

/** Compara duas chaves de idempotência. */
export function idempotencyKeysEqual(a: string, b: string): boolean {
  return a === b;
}

export type ProcessedKeyRecordV1 = {
  key: string;
  appliedAt: string;
};

/**
 * Convenção do hash de "versão criada" para o writer V1: representa que
 * a escrita autoritativa daquele catalogHash/offerHash já foi aplicada
 * no banco (evita re-aplicar estruturalmente num retry).
 */
export function idempotencyKeyAfterWrite(
  marketplaceId: string,
  externalListingId: string,
  catalogHash: string,
  offerHash: string,
): string {
  return idempotencyKeyFor({
    marketplaceId,
    externalListingId,
    payloadVersion: "applied",
    catalogHash,
    offerHash,
    rawHash: null,
  });
}