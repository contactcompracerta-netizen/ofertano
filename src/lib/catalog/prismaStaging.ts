import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  CatalogSource,
  AffiliateNetwork,
  IdentityLevel,
  ImportDecision,
  MerchantSlug,
  ReasonCode,
  StagingRecord,
  ValidationStatus,
} from "./types";
import type { StagingStore } from "./staging";

type StagingDb = Pick<PrismaClient, "catalogImportStagingItem">;

function toRecord(row: {
  source: string;
  affiliateNetwork: string;
  merchant: string;
  externalId: string;
  title: string;
  description: string | null;
  brand: string | null;
  gtin: string | null;
  mpn: string | null;
  model: string | null;
  category: string | null;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  destinationUrl: string | null;
  affiliateUrl: string | null;
  attributes: unknown;
  validationStatus: string;
  identityLevel: string;
  matchCandidateProductId: string | null;
  matchConfidence: number | null;
  decision: string;
  reasonCodes: string[];
  runId: string | null;
}): StagingRecord {
  return {
    source: row.source as CatalogSource,
    affiliateNetwork: row.affiliateNetwork as AffiliateNetwork,
    merchant: row.merchant as MerchantSlug,
    externalId: row.externalId,
    title: row.title,
    price: row.price,
    currency: row.currency,
    validationStatus: row.validationStatus as ValidationStatus,
    identityLevel: row.identityLevel as IdentityLevel,
    matchCandidateProductId: row.matchCandidateProductId,
    matchConfidence: row.matchConfidence,
    decision: row.decision as ImportDecision,
    reasonCodes: row.reasonCodes as ReasonCode[],
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.brand !== null ? { brand: row.brand } : {}),
    ...(row.gtin !== null ? { gtin: row.gtin } : {}),
    ...(row.mpn !== null ? { mpn: row.mpn } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    ...(row.category !== null ? { category: row.category } : {}),
    ...(row.imageUrl !== null ? { imageUrl: row.imageUrl } : {}),
    ...(row.destinationUrl !== null ? { destinationUrl: row.destinationUrl } : {}),
    ...(row.affiliateUrl !== null ? { affiliateUrl: row.affiliateUrl } : {}),
    ...(row.attributes !== null
      ? { attributes: row.attributes as Record<string, unknown> }
      : {}),
    ...(row.runId !== null ? { runId: row.runId } : {}),
  };
}

function jsonValue(
  attributes: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  return attributes as Prisma.InputJsonValue | undefined;
}

/**
 * Staging persistente da Wave 1.
 *
 * Esta store grava SOMENTE CatalogImportStagingItem. Ela não conhece
 * Product nem MarketplaceOffer, então o modo SHADOW não pode publicar
 * catálogo por acidente.
 */
export class PrismaStagingStore implements StagingStore {
  constructor(private readonly db: StagingDb) {}

  async upsert(record: StagingRecord): Promise<StagingRecord> {
    const data = {
      source: record.source,
      affiliateNetwork: record.affiliateNetwork,
      merchant: record.merchant,
      externalId: record.externalId,
      title: record.title,
      description: record.description ?? null,
      brand: record.brand ?? null,
      gtin: record.gtin ?? null,
      mpn: record.mpn ?? null,
      model: record.model ?? null,
      category: record.category ?? null,
      price: record.price,
      currency: record.currency,
      imageUrl: record.imageUrl ?? null,
      destinationUrl: record.destinationUrl ?? null,
      affiliateUrl: record.affiliateUrl ?? null,
      attributes: jsonValue(record.attributes),
      validationStatus: record.validationStatus,
      identityLevel: record.identityLevel,
      matchCandidateProductId: record.matchCandidateProductId,
      matchConfidence: record.matchConfidence,
      decision: record.decision,
      reasonCodes: record.reasonCodes,
      runId: record.runId ?? null,
    };

    const row = await this.db.catalogImportStagingItem.upsert({
      where: {
        source_merchant_externalId: {
          source: record.source,
          merchant: record.merchant,
          externalId: record.externalId,
        },
      },
      create: data,
      update: data,
    });

    return toRecord(row);
  }

  async get(
    source: string,
    merchant: string,
    externalId: string,
  ): Promise<StagingRecord | null> {
    const row = await this.db.catalogImportStagingItem.findUnique({
      where: {
        source_merchant_externalId: {
          source,
          merchant,
          externalId,
        },
      },
    });
    return row ? toRecord(row) : null;
  }

  async count(): Promise<number> {
    return this.db.catalogImportStagingItem.count();
  }

  async all(): Promise<StagingRecord[]> {
    const rows = await this.db.catalogImportStagingItem.findMany({
      orderBy: [{ merchant: "asc" }, { externalId: "asc" }],
    });
    return rows.map(toRecord);
  }
}
