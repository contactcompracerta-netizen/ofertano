/**
 * CATALOG_WAVE 1 - STAGING (FASE D).
 *
 * Pipeline: AWIN FEED -> NORMALIZER -> VALIDATOR -> IDENTITY -> MATCHER
 *           -> STAGING -> CATALOG WRITER
 *
 * O staging NUNCA publica direto do parser. Este módulo define o registro
 * e um store idempotente (chave: source + merchant + externalId).
 *
 * A store em memória é usada em testes/dry-run (DATABASE_WRITES=0).
 * A store Prisma (tabela CatalogImportStagingItem) será usada pelo shadow
 * real quando os feeds chegarem — mesma interface, mesmo contrato.
 */
import type {
  CatalogSource,
  AffiliateNetwork,
  ImportDecision,
  IdentityLevel,
  MerchantSlug,
  ReasonCode,
  StagingRecord,
  ValidationStatus,
} from "./types";
import { AWIN_AFFILIATE_NETWORK, CATALOG_SOURCE } from "./types";

export interface StagingStore {
  upsert(record: StagingRecord): Promise<StagingRecord>;
  get(
    source: string,
    merchant: string,
    externalId: string,
  ): Promise<StagingRecord | null>;
  count(): Promise<number>;
  all(): Promise<StagingRecord[]>;
}

export function stagingKey(
  source: string,
  merchant: string,
  externalId: string,
): string {
  return `${source}|${merchant}|${externalId}`;
}

/** Store em memória: upsert idempotente pela chave única. */
export class InMemoryStagingStore implements StagingStore {
  private readonly rows = new Map<string, StagingRecord>();

  async upsert(record: StagingRecord): Promise<StagingRecord> {
    const key = stagingKey(record.source, record.merchant, record.externalId);
    this.rows.set(key, { ...record, reasonCodes: [...record.reasonCodes] });
    return this.rows.get(key) as StagingRecord;
  }

  async get(
    source: string,
    merchant: string,
    externalId: string,
  ): Promise<StagingRecord | null> {
    return this.rows.get(stagingKey(source, merchant, externalId)) ?? null;
  }

  async count(): Promise<number> {
    return this.rows.size;
  }

  async all(): Promise<StagingRecord[]> {
    return [...this.rows.values()];
  }
}

export interface BuildStagingInput {
  merchant: MerchantSlug;
  externalId: string;
  title: string;
  description?: string;
  brand?: string;
  gtin?: string;
  mpn?: string;
  model?: string;
  category?: string;
  price: number | null;
  currency: string;
  imageUrl?: string;
  destinationUrl?: string;
  affiliateUrl?: string;
  attributes?: Record<string, unknown>;
  validationStatus: ValidationStatus;
  identityLevel: IdentityLevel;
  matchCandidateProductId: string | null;
  matchConfidence: number | null;
  decision: ImportDecision;
  reasonCodes: ReasonCode[];
  runId?: string;
}

export function buildStagingRecord(input: BuildStagingInput): StagingRecord {
  const record: StagingRecord = {
    source: CATALOG_SOURCE as CatalogSource,
    affiliateNetwork: AWIN_AFFILIATE_NETWORK as AffiliateNetwork,
    merchant: input.merchant,
    externalId: input.externalId,
    title: input.title,
    price: input.price,
    currency: input.currency,
    validationStatus: input.validationStatus,
    identityLevel: input.identityLevel,
    matchCandidateProductId: input.matchCandidateProductId,
    matchConfidence: input.matchConfidence,
    decision: input.decision,
    reasonCodes: [...input.reasonCodes],
  };

  if (input.description !== undefined) record.description = input.description;
  if (input.brand !== undefined) record.brand = input.brand;
  if (input.gtin !== undefined) record.gtin = input.gtin;
  if (input.mpn !== undefined) record.mpn = input.mpn;
  if (input.model !== undefined) record.model = input.model;
  if (input.category !== undefined) record.category = input.category;
  if (input.imageUrl !== undefined) record.imageUrl = input.imageUrl;
  if (input.destinationUrl !== undefined) record.destinationUrl = input.destinationUrl;
  if (input.affiliateUrl !== undefined) record.affiliateUrl = input.affiliateUrl;
  if (input.attributes !== undefined) record.attributes = input.attributes;
  if (input.runId !== undefined) record.runId = input.runId;

  return record;
}
