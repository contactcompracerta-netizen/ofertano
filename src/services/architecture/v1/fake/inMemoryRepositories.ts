/**
 * CATALOG_ARCHITECTURE_V1 — IN-MEMORY REPOSITORIES (testes + benchmark).
 *
 * Implementações em memória dos contratos de repositório, para:
 *  - contract tests (FASE P/Q)
 *  - benchmark local sintético (FASE V)
 * NUNCA persistem em banco e nunca são usadas em produção.
 */

import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import { sourceListingKeyV1 } from "../types/normalizedListingV1";
import type { SourceListingKeyV1 } from "../types/normalizedListingV1";
import type { HashPairV1 } from "../hashing";
import type {
  RawListingRecordV1,
  RawListingRepositoryV1,
  RawListingUpsertResult,
} from "../ingestion/rawRepository";
import { listingKeyToString } from "../ingestion/rawRepository";
import type {
  ImportBatchRecordV1,
  ImportRunRecordV1,
  ImportRunRepositoryV1,
  ImportRunStatusV1,
} from "../ingestion/importRun";

export class InMemoryRawListingRepository implements RawListingRepositoryV1 {
  private readonly rows = new Map<string, RawListingRecordV1>();

  async findListing(key: SourceListingKeyV1): Promise<RawListingRecordV1 | null> {
    return this.rows.get(listingKeyToString(key)) ?? null;
  }

  async upsertListing(
    listing: NormalizedMarketplaceListingV1,
    hashes: HashPairV1,
  ): Promise<RawListingUpsertResult> {
    const key = sourceListingKeyV1(
      listing.marketplaceId,
      listing.externalListingId,
    );
    const mapKey = listingKeyToString(key);
    const existing = this.rows.get(mapKey) ?? null;
    const now = new Date().toISOString();
    const record: RawListingRecordV1 = {
      key,
      source: listing.source,
      payloadVersion: listing.metadata.payloadVersion,
      rawPayload: null, // nível de repositório não guarda payload em memória
      rawHash: hashes.rawHash,
      catalogHash: hashes.catalogHash,
      offerHash: hashes.offerHash,
      status: "NORMALIZED",
      lastSeenAt: now,
      firstSeenAt: existing?.firstSeenAt ?? now,
      reprocessCount: existing?.reprocessCount ?? 0,
      reprocessedAt: existing?.reprocessedAt ?? null,
    };
    this.rows.set(mapKey, record);
    return {
      created: existing === null,
      previousCatalogHash: existing?.catalogHash ?? null,
      previousOfferHash: existing?.offerHash ?? null,
      record,
    };
  }

  async markListingStale(key: SourceListingKeyV1): Promise<void> {
    const mapKey = listingKeyToString(key);
    const row = this.rows.get(mapKey);
    if (row) {
      this.rows.set(mapKey, { ...row, status: "STALE" });
    }
  }

  async listSeenKeys(marketplaceId: string, sinceIso?: string): Promise<Array<{
    key: SourceListingKeyV1;
    lastSeenAt: string;
  }>> {
    const since = sinceIso ? Date.parse(sinceIso) : null;
    const out: Array<{ key: SourceListingKeyV1; lastSeenAt: string }> = [];
    for (const row of this.rows.values()) {
      if (row.key.marketplaceId !== marketplaceId) continue;
      if (since !== null && Date.parse(row.lastSeenAt) < since) continue;
      out.push({ key: row.key, lastSeenAt: row.lastSeenAt });
    }
    return out;
  }

  async recordReprocess(key: SourceListingKeyV1): Promise<void> {
    const mapKey = listingKeyToString(key);
    const row = this.rows.get(mapKey);
    if (row) {
      this.rows.set(mapKey, {
        ...row,
        reprocessCount: row.reprocessCount + 1,
        reprocessedAt: new Date().toISOString(),
      });
    }
  }

  allRecords(): RawListingRecordV1[] {
    return [...this.rows.values()];
  }

  seed(record: RawListingRecordV1): void {
    this.rows.set(listingKeyToString(record.key), record);
  }
}

export class InMemoryImportRunRepository implements ImportRunRepositoryV1 {
  private readonly runs = new Map<string, ImportRunRecordV1>();
  private readonly batches = new Map<string, ImportBatchRecordV1[]>();
  private nextId = 1;

  private id(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  async createRun(input: Omit<ImportRunRecordV1, "id" | "startedAt" | "status"> & {
    id?: string;
    startedAt?: string;
    status?: ImportRunStatusV1;
  }): Promise<ImportRunRecordV1> {
    const run: ImportRunRecordV1 = {
      ...input,
      id: input.id ?? this.id("run"),
      status: input.status ?? "RUNNING",
      startedAt: input.startedAt ?? new Date().toISOString(),
    };
    this.runs.set(run.id, run);
    return run;
  }

  async getRun(runId: string): Promise<ImportRunRecordV1 | null> {
    return this.runs.get(runId) ?? null;
  }

  async findLastRun(marketplaceId: string, source?: string): Promise<ImportRunRecordV1 | null> {
    const matches = [...this.runs.values()]
      .filter(
        (r) =>
          r.marketplaceId === marketplaceId &&
          (source === undefined || r.source === source),
      )
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    return matches[0] ?? null;
  }

  async addBatch(
    runId: string,
    input: Partial<ImportBatchRecordV1>,
  ): Promise<ImportBatchRecordV1> {
    const list = this.batches.get(runId) ?? [];
    const batch: ImportBatchRecordV1 = {
      id: input.id ?? this.id("batch"),
      runId,
      index: input.index ?? list.length,
      status: input.status ?? "PENDING",
      cursorStart: input.cursorStart ?? null,
      cursorEnd: input.cursorEnd ?? null,
      itemsReceived: input.itemsReceived ?? 0,
      itemsChanged: input.itemsChanged ?? 0,
      itemsUnchanged: input.itemsUnchanged ?? 0,
      itemsRejected: input.itemsRejected ?? 0,
      itemsFailed: input.itemsFailed ?? 0,
      startedAt: input.startedAt ?? new Date().toISOString(),
      finishedAt: input.finishedAt ?? null,
      lastSeenAt: input.lastSeenAt ?? null,
    };
    list.push(batch);
    this.batches.set(runId, list);
    return batch;
  }

  async listBatches(runId: string): Promise<ImportBatchRecordV1[]> {
    return this.batches.get(runId) ?? [];
  }

  async completeRun(
    runId: string,
    totals: { received: number; changed: number; unchanged: number; rejected: number; failed: number },
    opts?: { status?: ImportRunStatusV1; lastSeenAt?: string; cursor?: string },
  ): Promise<ImportRunRecordV1> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    const next: ImportRunRecordV1 = {
      ...run,
      ...totals,
      status: opts?.status ?? "COMPLETED",
      finishedAt: new Date().toISOString(),
      lastSeenAt: opts?.lastSeenAt ?? run.lastSeenAt,
      cursor: opts?.cursor ?? run.cursor,
    };
    this.runs.set(runId, next);
    return next;
  }

  async completeBatch(
    runId: string,
    index: number,
    totals: { received: number; changed: number; unchanged: number; rejected: number; failed: number },
  ): Promise<ImportBatchRecordV1> {
    const list = this.batches.get(runId) ?? [];
    const batch = list.find((b) => b.index === index);
    if (!batch) throw new Error(`batch ${runId}#${index} not found`);
    const next: ImportBatchRecordV1 = {
      ...batch,
      ...totals,
      status: "COMPLETED",
      finishedAt: new Date().toISOString(),
    };
    this.batches.set(runId, list.map((b) => (b.index === index ? next : b)));
    return next;
  }

  async failRun(runId: string, _reason: string): Promise<ImportRunRecordV1> {
    void _reason;
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    const next: ImportRunRecordV1 = {
      ...run,
      status: "FAILED",
      finishedAt: new Date().toISOString(),
    };
    this.runs.set(runId, next);
    return next;
  }

  allRuns(): ImportRunRecordV1[] {
    return [...this.runs.values()];
  }
}

export type { ImportRunStatusV1 } from "../ingestion/importRun";