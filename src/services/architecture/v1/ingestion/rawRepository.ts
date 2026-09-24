/**
 * CATALOG_ARCHITECTURE_V1 — RAW LISTING REPOSITORY CONTRACT (FASE F/I).
 *
 * Persistência idempotente e reprocessável de listings.
 *
 * Invariantes:
 *  - UNIQUE(marketplaceId, externalListingId): a listing não vira outra quando
 *    título/preço/imagem/vendedor/atributos mudam (FASE F).
 *  - rawPayload é preservado integralmente para reprocessamento futuro (FASE I).
 *  - NUNCA apaga dados; atualiza somente metadados de observação.
 */

import type {
  NormalizedMarketplaceListingV1,
  SourceListingKeyV1,
} from "../types/normalizedListingV1";
import type { HashPairV1 } from "../hashing";

export type RawListingStatusV1 =
  | "DISCOVERED"
  | "NORMALIZED"
  | "MATCHED"
  | "UNMATCHED"
  | "STALE"
  | "ARCHIVED"
  | "ERROR";

export interface RawListingRecordV1 {
  key: SourceListingKeyV1;
  source: string;
  payloadVersion: string;
  rawPayload: unknown;
  /** Hash do payload bruto (detecta payload idêntico reentregue). */
  rawHash: string;
  catalogHash: string | null;
  offerHash: string | null;
  status: RawListingStatusV1;
  lastSeenAt: string;
  firstSeenAt: string;
  reprocessCount: number;
  reprocessedAt: string | null;
}

export interface RawListingWriteOptions {
  /** Marca a listing como ativa/visível. Default true. */
  active?: boolean;
  /** Status de processamento. Default NORMALIZED. */
  status?: RawListingStatusV1;
}

export interface RawListingUpsertResult {
  /** true quando a row NÃO existia antes (primeira observação). */
  created: boolean;
  /** Catalogs hash anterior (null quando é a primeira vez). */
  previousCatalogHash: string | null;
  previousOfferHash: string | null;
  record: RawListingRecordV1;
}

/** Repositório injetável (Prisma real ou InMemory nos testes). */
export interface RawListingRepositoryV1 {
  findListing(
    key: SourceListingKeyV1,
  ): Promise<RawListingRecordV1 | null>;

  /**
   * Upsert idempotente pela chave (marketplaceId, externalListingId).
   * Preserva rawPayload; atualiza lastSeenAt e hashes.
   */
  upsertListing(
    listing: NormalizedMarketplaceListingV1,
    hashes: HashPairV1,
    options?: RawListingWriteOptions,
  ): Promise<RawListingUpsertResult>;

  /** Marca a listing como STALE (vista faltando num snapshot). */
  markListingStale(
    key: SourceListingKeyV1,
    reason?: string,
  ): Promise<void>;

  /** Lista as listings vistas (chaves + lastSeenAt) para reconciliação. */
  listSeenKeys(
    marketplaceId: string,
    sinceIso?: string,
  ): Promise<Array<{ key: SourceListingKeyV1; lastSeenAt: string }>>;

  /** Incrementa o contador de reprocessamentos. */
  recordReprocess(key: SourceListingKeyV1): Promise<void>;
}

/** Chave canônica string de uma listing (para logs/dedup). */
export function listingKeyToString(key: SourceListingKeyV1): string {
  return `${key.marketplaceId}:${key.externalListingId}`;
}

/** Equivalência real com a tabela legada RawMarketplaceListing. */
export const LEGACY_RAW_UNIQUE = "RawMarketplaceListing(@@unique[marketplace, externalId])";