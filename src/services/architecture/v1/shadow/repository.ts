/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW REPOSITORIES (FASE 5).
 *
 * Implementações Prisma dos contratos V1 usados pela shadow:
 *  - RawListingRepositoryV1 sobre a tabela REAL RawMarketplaceListing
 *    (aditiva: nunca apaga, nunca sobrescreve payload legado com null).
 *  - ImportRunRepositoryV1 sobre ImportRun/ImportBatch (canário replay).
 *
 * Extensões shadow (fora do contrato, mas necessárias ao canário):
 *  - updateHashes(): backfill LAZY de catalogHash/offerHash.
 *  - listRawRows(): leitura das linhas reais para o replay.
 *  - updatePublicationView(): leitura read-only do estado público legado
 *    (Product + ofertas) para a paridade profunda.
 *
 * Também expõe uma implementação IN-MEMORY (testes + dry-run), que garante
 * que DRY-RUN não toca o banco.
 */

import { resolveLegacyEnumValue } from "../marketplaceRegistry";
import type { HashPairV1 } from "../hashing";
import {
  DEFAULT_PAYLOAD_VERSION,
  type NormalizedMarketplaceListingV1,
} from "../types/normalizedListingV1";
import type {
  RawListingRecordV1,
  RawListingRepositoryV1,
  RawListingUpsertResult,
  RawListingWriteOptions,
} from "../ingestion/rawRepository";
import type {
  ImportBatchRecordV1,
  ImportRunRecordV1,
  ImportRunRepositoryV1,
} from "../ingestion/importRun";
import type { LegacyShadowRawRow } from "./adapter";

/* ------------------------------------------------------------------ */
/* Tipos mínimos do cliente Prisma (mesmo padrão do repo legado).      */
/* ------------------------------------------------------------------ */

export type ShadowRawListingRow = {
  marketplace: string;
  externalId: string;
  sellerId: string | null;
  sellerName: string | null;
  sourceUrl: string | null;
  affiliateLink: string | null;
  title: string | null;
  brand: string | null;
  modelNumber: string | null;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  category: string | null;
  attributes: unknown;
  image: string | null;
  price: number | null;
  oldPrice: number | null;
  stock: number | null;
  available: boolean;
  status: string;
  rawPayload: unknown;
  canonicalProductId: string | null;
  catalogHash: string | null;
  offerHash: string | null;
  payloadVersion: string | null;
  lastSeenAt: string | Date;
};

export type ShadowImportRunRow = ImportRunRecordV1;
export type ShadowImportBatchRow = ImportBatchRecordV1;

/** Normaliza timestamp string|Date -> ISO string (sem narrowing-para-never). */
function asIso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

/** Linha mínima do Product legado para a paridade profunda (read-only). */
export type ShadowLegacyProductRow = {
  id: string;
  autoCreated: boolean;
  active: boolean;
  publicationStatus: string | null;
  offers: Array<{
    marketplace: string;
    active: boolean;
    available: boolean;
    status: string;
    matchStatus: string;
    price: number | null;
  }>;
};

type RawListingDelegate = {
  findUnique(args: unknown): Promise<ShadowRawListingRow | null>;
  upsert(args: unknown): Promise<ShadowRawListingRow>;
  update(args: unknown): Promise<ShadowRawListingRow>;
  findMany(args: unknown): Promise<ShadowRawListingRow[]>;
};

type ImportRunDelegate = {
  create(args: unknown): Promise<ShadowImportRunRow>;
  findUnique(args: unknown): Promise<ShadowImportRunRow | null>;
  findFirst(args: unknown): Promise<ShadowImportRunRow | null>;
  update(args: unknown): Promise<ShadowImportRunRow>;
};

type ImportBatchDelegate = {
  create(args: unknown): Promise<ShadowImportBatchRow>;
  findMany(args: unknown): Promise<ShadowImportBatchRow[]>;
  update(args: unknown): Promise<ShadowImportBatchRow>;
};

type ProductDelegate = {
  findUnique(args: unknown): Promise<ShadowLegacyProductRow | null>;
};

export type ShadowPrismaClient = {
  rawMarketplaceListing: RawListingDelegate;
  importRun: ImportRunDelegate;
  importBatch: ImportBatchDelegate;
  product: ProductDelegate;
};

/* ------------------------------------------------------------------ */
/* Extensão shadow do repositório RAW.                                 */
/* ------------------------------------------------------------------ */

export interface ShadowRawRepositoryV1 extends RawListingRepositoryV1 {
  /** Backfill LAZY: grava hashes calculados numa linha existente. */
  updateHashes(
    key: { marketplaceId: string; externalListingId: string },
    hashes: HashPairV1,
  ): Promise<void>;

  /** Leitura (read-only) das linhas reais para replay/canário. */
  listRawRows(marketplaceId: string, limit: number): Promise<LegacyShadowRawRow[]>;
}

function toRowInput(
  listing: NormalizedMarketplaceListingV1,
  options: RawListingWriteOptions,
): Record<string, unknown> {
  const gtin = listing.identity.gtin[0] ?? null;
  return {
    sellerId:
      typeof listing.seller.externalSellerId === "string"
        ? listing.seller.externalSellerId
        : null,
    sellerName:
      typeof listing.seller.name === "string" ? listing.seller.name : null,
    title:
      typeof listing.catalog.title === "string" ? listing.catalog.title : null,
    brand:
      typeof listing.identity.brand === "string" ? listing.identity.brand : null,
    modelNumber:
      typeof listing.identity.model === "string" ? listing.identity.model : null,
    ean: gtin,
    gtin,
    mpn:
      typeof listing.identity.mpn === "string" ? listing.identity.mpn : null,
    category:
      typeof listing.catalog.category === "string"
        ? listing.catalog.category
        : null,
    attributes: listing.catalog.attributes,
    image: listing.catalog.images[0] ?? null,
    price: listing.commerce.price,
    oldPrice:
      typeof listing.commerce.oldPrice === "number"
        ? listing.commerce.oldPrice
        : null,
    stock:
      typeof listing.commerce.stock === "number" ? listing.commerce.stock : null,
    available: listing.commerce.availability === "IN_STOCK" ||
      listing.commerce.availability === "PRE_ORDER",
    status: options.status ?? "DISCOVERED",
    active: options.active ?? true,
    sourceUrl: null,
    affiliateLink: null,
    canonicalProductId: null,
  };
}

/**
 * Campos ADITIVOS que a shadow V1 grava numa linha EXISTENTE. Fora daqui,
 * nenhum campo legado é reescrito (title/price/seller/URL são do fluxo REAL
 * legado e jamais são clobbered pela shadow).
 */
function toRowUpdatePayload(
  listing: NormalizedMarketplaceListingV1,
  hashes: HashPairV1,
  options: RawListingWriteOptions,
  opts: { persistRaw: boolean; persistHashes: boolean; rawPayloadValue?: unknown },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    lastSeenAt: new Date(),
  };
  if (opts.persistHashes) {
    payload.catalogHash = hashes.catalogHash;
    payload.offerHash = hashes.offerHash;
    payload.payloadVersion = listing.metadata.payloadVersion;
  }
  if (opts.persistRaw && opts.rawPayloadValue !== undefined) {
    payload.rawPayload = opts.rawPayloadValue;
  }
  if (options.status !== undefined) {
    payload.status = options.status;
  }
  if (options.active !== undefined) {
    payload.active = options.active;
  }
  return payload;
}

/** Converte uma linha Prisma em LegacyShadowRawRow (adapter/replay). */
function toLegacyShadowRawRow(row: ShadowRawListingRow): LegacyShadowRawRow {
  return {
    marketplace: row.marketplace,
    externalId: row.externalId,
    sellerId: row.sellerId,
    sellerName: row.sellerName,
    sourceUrl: row.sourceUrl,
    affiliateLink: row.affiliateLink,
    title: row.title,
    brand: row.brand,
    modelNumber: row.modelNumber,
    ean: row.ean,
    gtin: row.gtin,
    mpn: row.mpn,
    category: row.category,
    attributes: (row.attributes as Record<string, string> | null) ?? null,
    image: row.image,
    price: row.price,
    oldPrice: row.oldPrice,
    stock: row.stock,
    available: row.available,
    canonicalProductId: row.canonicalProductId,
  };
}

function supportedEnumMarketplace(legacyEnum: string | null): legacyEnum is string {
  return legacyEnum !== null;
}

/* ------------------------------------------------------------------ */
/* Factory Prisma.                                                     */
/* ------------------------------------------------------------------ */

export interface ShadowRepositoryBundle {
  raw: ShadowRawRepositoryV1;
  importRun: ImportRunRepositoryV1;
}

const REPROCESS_MODE = "REPROCESS";

export function createPrismaShadowRepositories(
  prisma: ShadowPrismaClient,
  opts: { persistRaw?: boolean; persistHashes?: boolean } = {},
): ShadowRepositoryBundle {
  const persistRaw = opts.persistRaw ?? false;
  const persistHashes = opts.persistHashes ?? false;

  const raw: ShadowRawRepositoryV1 = {
    async findListing(key) {
      const marketplaceEnum = resolveLegacyEnumValue(key.marketplaceId);
      if (!supportedEnumMarketplace(marketplaceEnum)) {
        return null;
      }
      const row = await prisma.rawMarketplaceListing.findUnique({
        where: {
          marketplace_externalId: {
            marketplace: marketplaceEnum,
            externalId: key.externalListingId,
          },
        },
      });
      if (!row) {
        return null;
      }
      return {
        key,
        source: "legacy",
        payloadVersion: row.payloadVersion ?? "raw/v1",
        rawPayload: row.rawPayload,
        rawHash: "",
        catalogHash: row.catalogHash,
        offerHash: row.offerHash,
        status: (row.status as RawListingRecordV1["status"]) ?? "NORMALIZED",
        lastSeenAt:
          asIso(row.lastSeenAt) ?? "",
        firstSeenAt:
          asIso(row.lastSeenAt) ?? "",
        reprocessCount: 0,
        reprocessedAt: null,
      };
    },

    async upsertListing(
      listing,
      hashes,
      options: RawListingWriteOptions = {},
    ): Promise<RawListingUpsertResult> {
      const marketplaceEnum = resolveLegacyEnumValue(listing.marketplaceId);
      if (!supportedEnumMarketplace(marketplaceEnum)) {
        throw new Error(
          `SHADOW_RAW_UNSUPPORTED_MARKETPLACE:${listing.marketplaceId}`,
        );
      }

      const where = {
        marketplace_externalId: {
          marketplace: marketplaceEnum,
          externalId: listing.externalListingId,
        },
      };

      const existing = await prisma.rawMarketplaceListing.findUnique({
        where,
      });

      const base = toRowInput(listing, options);

      // Aditivo: nunca sobrescreve payload legado; aninha o V1 quando
      // persistRaw está ligado.
      let rawPayloadValue: unknown = undefined;
      if (persistRaw) {
        // Nunca aninha indefinidamente: se o payload anterior já tinha o
        // formato shadow {legacy, v1}, preserva o legacy ORIGINAL.
        let priorLegacy: unknown = existing?.rawPayload ?? null;
        if (
          existing?.rawPayload != null &&
          typeof existing.rawPayload === "object"
        ) {
          const record = existing.rawPayload as Record<string, unknown>;
          if (record.legacy !== undefined) {
            priorLegacy = record.legacy;
          }
        }
        rawPayloadValue = {
          legacy: priorLegacy,
          v1: listing,
          capturedAt: new Date().toISOString(),
        };
      }

      /*
       * CREATE: linha completa a partir da listing V1 (a row pode não
       * existir quando o dual-write legado está desligado).
       * UPDATE: SOMENTE campos aditivos (hashes/rawPayload/lastSeenAt) —
       * nenhum campo legado é reescrito pela shadow.
       */
      const createData = {
        ...(persistHashes
          ? {
              catalogHash: hashes.catalogHash,
              offerHash: hashes.offerHash,
              payloadVersion: listing.metadata.payloadVersion,
            }
          : {}),
        ...(persistRaw ? { rawPayload: rawPayloadValue } : {}),
      };
      const updateData = toRowUpdatePayload(
        listing,
        hashes,
        options,
        { persistRaw, persistHashes, rawPayloadValue },
      );

      await prisma.rawMarketplaceListing.upsert({
        where,
        create: {
          marketplace: marketplaceEnum,
          externalId: listing.externalListingId,
          ...base,
          ...createData,
        },
        update: updateData,
      });

      return {
        created: existing === null,
        previousCatalogHash: existing?.catalogHash ?? null,
        previousOfferHash: existing?.offerHash ?? null,
        record: {
          key: {
            marketplaceId: listing.marketplaceId,
            externalListingId: listing.externalListingId,
          },
          source: listing.source,
          payloadVersion: listing.metadata.payloadVersion,
          rawPayload: rawPayloadValue ?? existing?.rawPayload,
          rawHash: hashes.rawHash,
          catalogHash: hashes.catalogHash,
          offerHash: hashes.offerHash,
          status: (options.status ?? "NORMALIZED") as RawListingRecordV1["status"],
          lastSeenAt: new Date().toISOString(),
          firstSeenAt: new Date().toISOString(),
          reprocessCount: 0,
          reprocessedAt: null,
        },
      };
    },

    async markListingStale(key, _reason) {
      const marketplaceEnum = resolveLegacyEnumValue(key.marketplaceId);
      if (!supportedEnumMarketplace(marketplaceEnum)) {
        return;
      }
      await prisma.rawMarketplaceListing.update({
        where: {
          marketplace_externalId: {
            marketplace: marketplaceEnum,
            externalId: key.externalListingId,
          },
        },
        data: { status: "STALE" },
      });
    },

    async listSeenKeys(marketplaceId, sinceIso) {
      const marketplaceEnum = resolveLegacyEnumValue(marketplaceId);
      if (!supportedEnumMarketplace(marketplaceEnum)) {
        return [];
      }
      const rows = await prisma.rawMarketplaceListing.findMany({
        where: {
          marketplace: marketplaceEnum,
          ...(sinceIso ? { lastSeenAt: { gte: new Date(sinceIso) } } : {}),
        },
        select: { marketplace: true, externalId: true, lastSeenAt: true },
        orderBy: { lastSeenAt: "desc" },
        take: 5000,
      });
      return rows.map((row) => ({
        key: {
          marketplaceId,
          externalListingId: row.externalId,
        },
        lastSeenAt:
          asIso(row.lastSeenAt) ?? "",
      }));
    },

    async recordReprocess(_key) {
      // O model legado não expõe contadores de reprocessamento; o registro
      // operacional do reprocessamento vive no ImportRun (canário replay).
    },

    async updateHashes(key, hashes) {
      const marketplaceEnum = resolveLegacyEnumValue(key.marketplaceId);
      if (!supportedEnumMarketplace(marketplaceEnum)) {
        return;
      }
      await prisma.rawMarketplaceListing.update({
        where: {
          marketplace_externalId: {
            marketplace: marketplaceEnum,
            externalId: key.externalListingId,
          },
        },
        data: {
          catalogHash: hashes.catalogHash,
          offerHash: hashes.offerHash,
          payloadVersion: DEFAULT_PAYLOAD_VERSION,
          lastCheckedAt: new Date(),
        },
      });
    },

    async listRawRows(marketplaceId, limit) {
      const marketplaceEnum = resolveLegacyEnumValue(marketplaceId);
      if (!supportedEnumMarketplace(marketplaceEnum)) {
        return [];
      }
      const rows = await prisma.rawMarketplaceListing.findMany({
        where: { marketplace: marketplaceEnum },
        orderBy: { lastSeenAt: "asc" },
        take: limit,
      });
      return rows.map(toLegacyShadowRawRow);
    },
  };

  const importRun: ImportRunRepositoryV1 = {
    async createRun(input) {
      const row = await prisma.importRun.create({
        data: {
          source: input.source,
          marketplaceId: input.marketplaceId ?? null,
          mode: input.mode,
          status: input.status ?? "RUNNING",
          gracePeriodMinutes: input.gracePeriodMinutes ?? 1440,
          cursor: input.cursor ?? null,
        },
      });
      return {
        id: row.id,
        source: row.source,
        marketplaceId: row.marketplaceId,
        mode: row.mode,
        status: row.status,
        startedAt:
          asIso(row.startedAt) ?? "",
        finishedAt: row.finishedAt
          ? asIso(row.finishedAt) ?? ""
          : null,
        itemsReceived: row.itemsReceived,
        itemsChanged: row.itemsChanged,
        itemsUnchanged: row.itemsUnchanged,
        itemsRejected: row.itemsRejected,
        itemsFailed: row.itemsFailed,
        lastSeenAt: row.lastSeenAt
          ? asIso(row.lastSeenAt) ?? ""
          : null,
        gracePeriodMinutes: row.gracePeriodMinutes,
        cursor: row.cursor,
      };
    },

    async getRun(runId) {
      const row = await prisma.importRun.findUnique({
        where: { id: runId },
      });
      return row
        ? {
            id: row.id,
            source: row.source,
            marketplaceId: row.marketplaceId,
            mode: row.mode,
            status: row.status,
            startedAt: asIso(row.startedAt) ?? "",
            finishedAt: row.finishedAt
              ? asIso(row.finishedAt) ?? ""
              : null,
            itemsReceived: row.itemsReceived,
            itemsChanged: row.itemsChanged,
            itemsUnchanged: row.itemsUnchanged,
            itemsRejected: row.itemsRejected,
            itemsFailed: row.itemsFailed,
            lastSeenAt: row.lastSeenAt
              ? asIso(row.lastSeenAt) ?? ""
              : null,
            gracePeriodMinutes: row.gracePeriodMinutes,
            cursor: row.cursor,
          }
        : null;
    },

    async findLastRun(marketplaceId, source) {
      const row = await prisma.importRun.findFirst({
        where: {
          marketplaceId,
          ...(source ? { source } : {}),
        },
        orderBy: { startedAt: "desc" },
      });
      return row
        ? {
            id: row.id,
            source: row.source,
            marketplaceId: row.marketplaceId,
            mode: row.mode,
            status: row.status,
            startedAt: asIso(row.startedAt) ?? "",
            finishedAt: row.finishedAt
              ? asIso(row.finishedAt) ?? ""
              : null,
            itemsReceived: row.itemsReceived,
            itemsChanged: row.itemsChanged,
            itemsUnchanged: row.itemsUnchanged,
            itemsRejected: row.itemsRejected,
            itemsFailed: row.itemsFailed,
            lastSeenAt: row.lastSeenAt
              ? asIso(row.lastSeenAt) ?? ""
              : null,
            gracePeriodMinutes: row.gracePeriodMinutes,
            cursor: row.cursor,
          }
        : null;
    },

    async addBatch(runId, input) {
      const row = await prisma.importBatch.create({
        data: {
          runId,
          index: input.index ?? 0,
          status: input.status ?? "PENDING",
        },
      });
      return {
        id: row.id,
        runId: row.runId,
        index: row.index,
        status: row.status,
        cursorStart: row.cursorStart,
        cursorEnd: row.cursorEnd,
        itemsReceived: row.itemsReceived,
        itemsChanged: row.itemsChanged,
        itemsUnchanged: row.itemsUnchanged,
        itemsRejected: row.itemsRejected,
        itemsFailed: row.itemsFailed,
        startedAt: asIso(row.startedAt) ?? "",
        finishedAt: row.finishedAt
          ? asIso(row.finishedAt) ?? ""
          : null,
        lastSeenAt: row.lastSeenAt
          ? asIso(row.lastSeenAt) ?? ""
          : null,
      };
    },

    async listBatches(runId) {
      const rows = await prisma.importBatch.findMany({
        where: { runId },
        orderBy: { index: "asc" },
      });
      return rows.map((row) => ({
        id: row.id,
        runId: row.runId,
        index: row.index,
        status: row.status,
        cursorStart: row.cursorStart,
        cursorEnd: row.cursorEnd,
        itemsReceived: row.itemsReceived,
        itemsChanged: row.itemsChanged,
        itemsUnchanged: row.itemsUnchanged,
        itemsRejected: row.itemsRejected,
        itemsFailed: row.itemsFailed,
        startedAt: asIso(row.startedAt) ?? "",
        finishedAt: row.finishedAt
          ? asIso(row.finishedAt) ?? ""
          : null,
        lastSeenAt: row.lastSeenAt
          ? asIso(row.lastSeenAt) ?? ""
          : null,
      }));
    },

    async completeRun(runId, totals, opts) {
      const row = await prisma.importRun.update({
        where: { id: runId },
        data: {
          itemsReceived: totals.received,
          itemsChanged: totals.changed,
          itemsUnchanged: totals.unchanged,
          itemsRejected: totals.rejected,
          itemsFailed: totals.failed,
          status: opts?.status ?? "COMPLETED",
          lastSeenAt: opts?.lastSeenAt ? new Date(opts.lastSeenAt) : undefined,
          cursor: opts?.cursor,
          finishedAt: new Date(),
        },
      });
      return {
        id: row.id,
        source: row.source,
        marketplaceId: row.marketplaceId,
        mode: row.mode,
        status: row.status,
        startedAt: asIso(row.startedAt) ?? "",
        finishedAt: row.finishedAt
          ? asIso(row.finishedAt) ?? ""
          : null,
        itemsReceived: row.itemsReceived,
        itemsChanged: row.itemsChanged,
        itemsUnchanged: row.itemsUnchanged,
        itemsRejected: row.itemsRejected,
        itemsFailed: row.itemsFailed,
        lastSeenAt: row.lastSeenAt
          ? asIso(row.lastSeenAt) ?? ""
          : null,
        gracePeriodMinutes: row.gracePeriodMinutes,
        cursor: row.cursor,
      };
    },

    async completeBatch(runId, index, totals) {
      const row = await prisma.importBatch.update({
        where: { runId_index: { runId, index } },
        data: {
          itemsReceived: totals.received,
          itemsChanged: totals.changed,
          itemsUnchanged: totals.unchanged,
          itemsRejected: totals.rejected,
          itemsFailed: totals.failed,
          status: "COMPLETED",
          finishedAt: new Date(),
        },
      });
      return {
        id: row.id,
        runId: row.runId,
        index: row.index,
        status: row.status,
        cursorStart: row.cursorStart,
        cursorEnd: row.cursorEnd,
        itemsReceived: row.itemsReceived,
        itemsChanged: row.itemsChanged,
        itemsUnchanged: row.itemsUnchanged,
        itemsRejected: row.itemsRejected,
        itemsFailed: row.itemsFailed,
        startedAt: asIso(row.startedAt) ?? "",
        finishedAt: row.finishedAt
          ? asIso(row.finishedAt) ?? ""
          : null,
        lastSeenAt: row.lastSeenAt
          ? asIso(row.lastSeenAt) ?? ""
          : null,
      };
    },

    async failRun(runId, _reason) {
      const row = await prisma.importRun.update({
        where: { id: runId },
        data: { status: "FAILED", finishedAt: new Date() },
      });
      return {
        id: row.id,
        source: row.source,
        marketplaceId: row.marketplaceId,
        mode: row.mode,
        status: row.status,
        startedAt: asIso(row.startedAt) ?? "",
        finishedAt: row.finishedAt
          ? asIso(row.finishedAt) ?? ""
          : null,
        itemsReceived: row.itemsReceived,
        itemsChanged: row.itemsChanged,
        itemsUnchanged: row.itemsUnchanged,
        itemsRejected: row.itemsRejected,
        itemsFailed: row.itemsFailed,
        lastSeenAt: row.lastSeenAt
          ? asIso(row.lastSeenAt) ?? ""
          : null,
        gracePeriodMinutes: row.gracePeriodMinutes,
        cursor: row.cursor,
      };
    },
  };

  return { raw, importRun };
}

/* ------------------------------------------------------------------ */
/* In-Memory RAW repository (testes + dry-run).                        */
/* ------------------------------------------------------------------ */

export function createInMemoryRawListingRepository(): ShadowRawRepositoryV1 {
  const rows = new Map<
    string,
    {
      listing: NormalizedMarketplaceListingV1;
      hashes: HashPairV1;
      stale?: boolean;
      reprocessed: number;
    }
  >();

  const keyOf = (marketplaceId: string, externalListingId: string) =>
    `${marketplaceId}:${externalListingId}`;

  return {
    async findListing(key) {
      const entry = rows.get(keyOf(key.marketplaceId, key.externalListingId));
      if (!entry) {
        return null;
      }
      return {
        key,
        source: entry.listing.source,
        payloadVersion: entry.listing.metadata.payloadVersion,
        rawPayload: entry.listing,
        rawHash: entry.hashes.rawHash,
        catalogHash: entry.hashes.catalogHash,
        offerHash: entry.hashes.offerHash,
        status: entry.stale
          ? "STALE"
          : ("NORMALIZED" as RawListingRecordV1["status"]),
        lastSeenAt: new Date().toISOString(),
        firstSeenAt: new Date().toISOString(),
        reprocessCount: entry.reprocessed,
        reprocessedAt: entry.reprocessed > 0 ? new Date().toISOString() : null,
      };
    },

    async upsertListing(
      listing,
      hashes,
      options: RawListingWriteOptions = {},
    ): Promise<RawListingUpsertResult> {
      const key = keyOf(listing.marketplaceId, listing.externalListingId);
      const existing = rows.get(key);
      const created = existing === undefined;

      rows.set(key, {
        listing,
        hashes,
        stale: false,
        reprocessed: existing?.reprocessed ?? 0,
      });

      return {
        created,
        previousCatalogHash: existing?.hashes.catalogHash ?? null,
        previousOfferHash: existing?.hashes.offerHash ?? null,
        record: {
          key: {
            marketplaceId: listing.marketplaceId,
            externalListingId: listing.externalListingId,
          },
          source: listing.source,
          payloadVersion: listing.metadata.payloadVersion,
          rawPayload: listing,
          rawHash: hashes.rawHash,
          catalogHash: hashes.catalogHash,
          offerHash: hashes.offerHash,
          status: (options.status ?? "NORMALIZED") as RawListingRecordV1["status"],
          lastSeenAt: new Date().toISOString(),
          firstSeenAt: new Date().toISOString(),
          reprocessCount: existing?.reprocessed ?? 0,
          reprocessedAt: null,
        },
      };
    },

    async markListingStale(key) {
      const entry = rows.get(keyOf(key.marketplaceId, key.externalListingId));
      if (entry) {
        entry.stale = true;
      }
    },

    async listSeenKeys(marketplaceId, _sinceIso) {
      return [...rows.entries()]
        .filter(([key]) => key.startsWith(`${marketplaceId}:`))
        .map(([key]) => ({
          key: {
            marketplaceId: key.split(":")[0],
            externalListingId: key.split(":")[1],
          },
          lastSeenAt: new Date().toISOString(),
        }));
    },

    async recordReprocess(key) {
      const entry = rows.get(keyOf(key.marketplaceId, key.externalListingId));
      if (entry) {
        entry.reprocessed += 1;
      }
    },

    async updateHashes(key, hashes) {
      const entry = rows.get(keyOf(key.marketplaceId, key.externalListingId));
      if (entry) {
        entry.hashes = hashes;
      }
    },

    async listRawRows(marketplaceId, limit) {
      return [...rows.entries()]
        .filter(([key]) => key.startsWith(`${marketplaceId}:`))
        .slice(0, limit)
        .map(([key, entry]) => ({
          marketplaceId: key.split(":")[0],
          externalListingId: key.split(":")[1],
          marketplace:
            resolveLegacyEnumValue(key.split(":")[0]) ?? key.split(":")[0],
          externalId: key.split(":")[1],
          title:
            typeof entry.listing.catalog.title === "string"
              ? entry.listing.catalog.title
              : null,
          brand:
            typeof entry.listing.identity.brand === "string"
              ? entry.listing.identity.brand
              : null,
          price: entry.listing.commerce.price,
          oldPrice:
            typeof entry.listing.commerce.oldPrice === "number"
              ? entry.listing.commerce.oldPrice
              : null,
          stock:
            typeof entry.listing.commerce.stock === "number"
              ? entry.listing.commerce.stock
              : null,
          available: entry.listing.commerce.availability !== "OUT_OF_STOCK",
          canonicalProductId: null,
        }));
    },
  };
}
/* ------------------------------------------------------------------ */
/* Paridade profunda: leitura read-only do estado público legado.      */
/* ------------------------------------------------------------------ */

/**
 * Lê (read-only) o estado de publicação de um Product legado + as ofertas
 * reais. NULL quando o produto não existe. Nunca escreve.
 */
export async function readLegacyPublicationFromPrisma(
  prisma: ShadowPrismaClient,
  canonicalProductId: string,
): Promise<{ autoCreated: boolean; active: boolean; publicationStatus: string | null; offers: Array<{ marketplace: string; active: boolean; available: boolean; status: string; matchStatus: string; price: number | null }> } | null> {
  const row = await prisma.product.findUnique({
    where: { id: canonicalProductId },
    select: {
      autoCreated: true,
      active: true,
      publicationStatus: true,
      offers: {
        select: {
          marketplace: true,
          active: true,
          available: true,
          status: true,
          matchStatus: true,
          price: true,
        },
      },
    },
  });
  if (!row) {
    return null;
  }
  return {
    autoCreated: row.autoCreated,
    active: row.active,
    publicationStatus: row.publicationStatus,
    offers: row.offers.map((offer) => ({
      marketplace: offer.marketplace,
      active: offer.active,
      available: offer.available,
      status: offer.status,
      matchStatus: offer.matchStatus,
      price: offer.price,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* ImportRun repository IN-MEMORY (testes + dry-run).                  */
/* ------------------------------------------------------------------ */

export function createInMemoryImportRunRepository(): ImportRunRepositoryV1 {
  const runs = new Map<string, ShadowImportRunRow>();
  const batches = new Map<string, ShadowImportBatchRow[]>();

  return {
    async createRun(input) {
      const id = input.id ?? `run-${runs.size + 1}`;
      const run: ShadowImportRunRow = {
        id,
        source: input.source,
        marketplaceId: input.marketplaceId ?? null,
        mode: input.mode,
        status: input.status ?? "RUNNING",
        startedAt: input.startedAt ?? new Date().toISOString(),
        finishedAt: null,
        itemsReceived: 0,
        itemsChanged: 0,
        itemsUnchanged: 0,
        itemsRejected: 0,
        itemsFailed: 0,
        lastSeenAt: null,
        gracePeriodMinutes: input.gracePeriodMinutes ?? 1440,
        cursor: input.cursor ?? null,
      };
      runs.set(id, run);
      return run;
    },

    async getRun(runId) {
      return runs.get(runId) ?? null;
    },

    async findLastRun(marketplaceId, source) {
      const candidates = [...runs.values()].filter(
        (run) =>
          run.marketplaceId === marketplaceId &&
          (!source || run.source === source),
      );
      candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return candidates[0] ?? null;
    },

    async addBatch(runId, input) {
      const index = input.index ?? batches.get(runId)?.length ?? 0;
      const batch: ShadowImportBatchRow = {
        id: `batch-${runId}-${index}`,
        runId,
        index,
        status: input.status ?? "PENDING",
        cursorStart: input.cursorStart ?? null,
        cursorEnd: input.cursorEnd ?? null,
        itemsReceived: 0,
        itemsChanged: 0,
        itemsUnchanged: 0,
        itemsRejected: 0,
        itemsFailed: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        lastSeenAt: null,
      };
      const list = batches.get(runId) ?? [];
      list.push(batch);
      batches.set(runId, list);
      return batch;
    },

    async listBatches(runId) {
      return batches.get(runId) ?? [];
    },

    async completeRun(runId, totals, opts) {
      const existing = runs.get(runId);
      if (!existing) {
        throw new Error(`SHADOW_RUN_NOT_FOUND:${runId}`);
      }
      const run: ShadowImportRunRow = {
        ...existing,
        itemsReceived: totals.received,
        itemsChanged: totals.changed,
        itemsUnchanged: totals.unchanged,
        itemsRejected: totals.rejected,
        itemsFailed: totals.failed,
        status: opts?.status ?? "COMPLETED",
        lastSeenAt: opts?.lastSeenAt ?? new Date().toISOString(),
        cursor: opts?.cursor ?? existing.cursor,
        finishedAt: new Date().toISOString(),
      };
      runs.set(runId, run);
      return run;
    },

    async completeBatch(runId, index, totals) {
      const list = batches.get(runId) ?? [];
      const batch = list.find((b) => b.index === index);
      if (!batch) {
        throw new Error(`SHADOW_BATCH_NOT_FOUND:${runId}:${index}`);
      }
      const updated: ShadowImportBatchRow = {
        ...batch,
        itemsReceived: totals.received,
        itemsChanged: totals.changed,
        itemsUnchanged: totals.unchanged,
        itemsRejected: totals.rejected,
        itemsFailed: totals.failed,
        status: "COMPLETED",
        finishedAt: new Date().toISOString(),
      };
      list[list.indexOf(batch)] = updated;
      return updated;
    },

    async failRun(runId) {
      const existing = runs.get(runId);
      if (!existing) {
        throw new Error(`SHADOW_RUN_NOT_FOUND:${runId}`);
      }
      const run: ShadowImportRunRow = {
        ...existing,
        status: "FAILED",
        finishedAt: new Date().toISOString(),
      };
      runs.set(runId, run);
      return run;
    },
  };
}
