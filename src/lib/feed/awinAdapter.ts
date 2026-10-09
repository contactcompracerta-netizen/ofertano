/**
 * Feed Ingestion Engine V1 - AWIN Feed Adapter.
 *
 * Generic AWIN adapter. KaBuM is an advertiser/merchant within AWIN.
 * source = 'awin', metadata contains advertiserId and advertiserName.
 *
 * Pure function, deterministic, no network/DNS.
 * CATALOG REMAINS FROZEN.
 */

import { toSafeExternalUrl } from "./urlSafety";
import {
  normalizePrice,
  normalizeCurrency,
  normalizeString,
  normalizeGTIN,
  type NormalizedPriceResult,
  type NormalizedCurrencyResult,
  type NormalizedGTINResult,
  type SafeUrlResult,
} from "./normalization";

/**
 * Raw AWIN feed item structure (CSV columns mapped to object).
 * Only defined fields that we actually handle.
 */
export interface RawAwinFeedItem {
  /** Generic row ID (fallback when productId/sku are absent) */
  id?: string;
  /** AWIN program ID */
  programId?: string;
  /** Advertiser ID */
  advertiserId?: string;
  /** Advertiser name */
  advertiserName?: string;
  /** Product external ID (SKU, product ID) */
  productId?: string;
  /** Product SKU */
  sku?: string;
  /** Product title */
  title?: string;
  /** Product description */
  description?: string;
  /** Brand */
  brand?: string;
  /** Model */
  model?: string;
  /** MPN (Manufacturer Part Number) */
  mpn?: string;
  /** GTIN/EAN/UPC */
  gtin?: string;
  /** Price (current) */
  price?: string;
  /** Original price (before discount) */
  oldPrice?: string;
  /** Currency code */
  currency?: string;
  /** Product URL (destination) */
  productUrl?: string;
  /** Affiliate/deep link URL */
  affiliateUrl?: string;
  /** Image URLs (semicolon or comma separated) */
  imageUrls?: string;
  /** Category path */
  category?: string;
  /** Availability */
  availability?: string;
  /** Additional attributes (JSON string or semicolon separated) */
  attributes?: string;
  /** Raw row for debugging */
  _raw?: unknown;
}

/**
 * Normalized feed item after AWIN adapter processing.
 */
export interface NormalizedAwinFeedItem {
  /** Unique identifier from feed */
  externalId: string;
  /** Product title */
  title: string;
  /** Product description */
  description?: string;
  /** Brand */
  brand?: string;
  /** Model */
  model?: string;
  /** MPN */
  mpn?: string;
  /** GTIN (only when explicitly provided) */
  gtin?: string;
  /** Current price */
  price?: number;
  /** Original price */
  oldPrice?: number;
  /** Currency (normalized to BRL) */
  currency?: string;
  /** Product destination URL (safe) */
  productUrl?: string;
  /** Affiliate URL (safe) */
  affiliateUrl?: string;
  /** Image URLs (safe, deduped) */
  imageUrls: string[];
  /** Category */
  category?: string;
  /** Availability */
  availability?: string;
  /** Normalized attributes */
  attributes?: Record<string, unknown>;
  /** Metadata: advertiser info */
  metadata: {
    source: "awin";
    advertiserId: string;
    advertiserName: string;
    programId?: string;
  };
}

/**
 * Validation result for a normalized item.
 */
export interface ValidationResult {
  valid: boolean;
  reason?:
    | "NONE"
    | "INVALID_PRICE"
    | "INVALID_URL"
    | "INVALID_GTIN"
    | "MISSING_EXTERNAL_ID"
    | "INVALID_CURRENCY"
    | "INVALID_ATTRIBUTES"
    | "DUPLICATE_EXTERNAL_ID";
  diagnostics?: Record<string, unknown>;
}

/**
 * Parse image URLs from semicolon/comma separated string.
 * Returns array of valid safe URLs.
 */
function parseImageUrls(raw: string | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];

  const parts = raw.split(/[;,]\s*/);
  const urls: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const result: SafeUrlResult = toSafeExternalUrl(trimmed);
    if (result.status === "VALID") {
      urls.push(result.value);
    }
  }

  return urls;
}

/**
 * Parse attributes from JSON string or key=value pairs.
 * Returns undefined if unable to parse.
 */
function parseAttributes(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "string") return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Try JSON first
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Not JSON, try key=value pairs
  }

  // Try semicolon/comma separated key=value
  const parts = trimmed.split(/[;,]\s*/);
  const result: Record<string, unknown> = {};

  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex > 0) {
      const key = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();
      if (key) result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Extract external ID from raw item.
 * Priority: productId > sku > id
 */
function extractExternalId(raw: RawAwinFeedItem): string | undefined {
  return raw.productId ?? raw.sku ?? raw.id;
}

/**
 * Normalize a raw AWIN feed item to our internal structure.
 * Does NOT validate - only transforms.
 */
export function normalizeAwinFeedItem(
  raw: RawAwinFeedItem,
): NormalizedAwinFeedItem {
  const externalId = extractExternalId(raw);

  // Advertiser metadata
  const advertiserId = String(raw.advertiserId ?? raw.programId ?? "unknown");
  const advertiserName = String(raw.advertiserName ?? "Unknown Advertiser");

  // Price normalization
  let price: number | undefined;
  const priceRaw = raw.price ?? raw.oldPrice;
  if (priceRaw !== undefined && priceRaw !== null) {
    const priceResult: NormalizedPriceResult = normalizePrice(String(priceRaw));
    if (priceResult.status === "VALID") {
      price = priceResult.value;
    }
  }

  let oldPrice: number | undefined;
  if (raw.oldPrice !== undefined && raw.oldPrice !== null && raw.oldPrice !== raw.price) {
    const oldPriceResult: NormalizedPriceResult = normalizePrice(String(raw.oldPrice));
    if (oldPriceResult.status === "VALID") {
      oldPrice = oldPriceResult.value;
    }
  }

  // Currency normalization
  let currency: string | undefined;
  if (raw.currency !== undefined && raw.currency !== null) {
    const currencyResult: NormalizedCurrencyResult = normalizeCurrency(String(raw.currency));
    if (currencyResult.status === "VALID") {
      currency = currencyResult.value;
    }
  }

  // URLs
  let productUrl: string | undefined;
  if (raw.productUrl !== undefined && raw.productUrl !== null) {
    const urlResult: SafeUrlResult = toSafeExternalUrl(String(raw.productUrl));
    if (urlResult.status === "VALID") {
      productUrl = urlResult.value;
    }
  }

  let affiliateUrl: string | undefined;
  if (raw.affiliateUrl !== undefined && raw.affiliateUrl !== null) {
    const urlResult: SafeUrlResult = toSafeExternalUrl(String(raw.affiliateUrl));
    if (urlResult.status === "VALID") {
      affiliateUrl = urlResult.value;
    }
  }

  // Images
  const imageUrls = parseImageUrls(raw.imageUrls);

  // GTIN
  let gtin: string | undefined;
  if (raw.gtin !== undefined && raw.gtin !== null) {
    const gtinResult: NormalizedGTINResult = normalizeGTIN(String(raw.gtin));
    if (gtinResult.status === "VALID") {
      gtin = gtinResult.value;
    }
  }

  // Brand
  let brand: string | undefined;
  if (raw.brand !== undefined && raw.brand !== null) {
    const brandResult = normalizeString(String(raw.brand));
    if (brandResult.status === "VALID") {
      brand = brandResult.value;
    }
  }

  // Model
  let model: string | undefined;
  if (raw.model !== undefined && raw.model !== null) {
    const modelResult = normalizeString(String(raw.model));
    if (modelResult.status === "VALID") {
      model = modelResult.value;
    }
  }

  // MPN
  let mpn: string | undefined;
  if (raw.mpn !== undefined && raw.mpn !== null) {
    const mpnResult = normalizeString(String(raw.mpn));
    if (mpnResult.status === "VALID") {
      mpn = mpnResult.value;
    }
  }

  // Description
  let description: string | undefined;
  if (raw.description !== undefined && raw.description !== null) {
    const descResult = normalizeString(String(raw.description));
    if (descResult.status === "VALID") {
      description = descResult.value;
    }
  }

  // Attributes
  let attributes: Record<string, unknown> | undefined;
  if (raw.attributes !== undefined && raw.attributes !== null) {
    attributes = parseAttributes(String(raw.attributes));
  }

  // Title (required)
  const titleRaw = raw.title ?? raw.description ?? "Untitled Product";
  const titleResult = normalizeString(String(titleRaw));
  const title = titleResult.status === "VALID" ? titleResult.value : "Untitled Product";

  return {
    externalId: externalId ?? "",
    title,
    description,
    brand,
    model,
    mpn,
    gtin,
    price,
    oldPrice,
    currency,
    productUrl,
    affiliateUrl,
    imageUrls,
    category: raw.category,
    availability: raw.availability,
    attributes,
    metadata: {
      source: "awin",
      advertiserId,
      advertiserName,
      programId: raw.programId,
    },
  };
}

/**
 * Validate a normalized AWIN feed item.
 * Returns validation result with specific failure reason.
 */
export function validateNormalizedAwinFeedItem(
  item: NormalizedAwinFeedItem,
): ValidationResult {
  // Check externalId
  if (!item.externalId || item.externalId === "") {
    return {
      valid: false,
      reason: "MISSING_EXTERNAL_ID",
      diagnostics: { missing: "externalId" },
    };
  }

  // Check price
  if (item.price === undefined || item.price === null) {
    return {
      valid: false,
      reason: "INVALID_PRICE",
      diagnostics: { missing: "price" },
    };
  }

  // Check currency
  if (!item.currency || item.currency === "") {
    return {
      valid: false,
      reason: "INVALID_CURRENCY",
      diagnostics: { missing: "currency" },
    };
  }

  // Check product URL
  if (!item.productUrl || item.productUrl === "") {
    return {
      valid: false,
      reason: "INVALID_URL",
      diagnostics: { missing: "productUrl" },
    };
  }

  // Check GTIN if present (only validates format if we want)
  if (item.gtin !== undefined && item.gtin !== null && item.gtin === "") {
    return {
      valid: false,
      reason: "INVALID_GTIN",
      diagnostics: { gtin: item.gtin },
    };
  }

  return {
    valid: true,
    reason: "NONE",
    diagnostics: {},
  };
}

/**
 * Source adapter interface for AWIN.
 */
export interface FeedSourceAdapter {
  source: string;
  parse(input: string): RawAwinFeedItem[];
  normalize(raw: RawAwinFeedItem): NormalizedAwinFeedItem;
  validate(item: NormalizedAwinFeedItem): ValidationResult;
}

/**
 * AWIN Feed Source Adapter.
 * Parses CSV, normalizes, validates.
 */
export const awinFeedAdapter: FeedSourceAdapter = {
  source: "awin",

  parse(input: string): RawAwinFeedItem[] {
    return parseAwinCsv(input);
  },

  normalize(raw: RawAwinFeedItem): NormalizedAwinFeedItem {
    return normalizeAwinFeedItem(raw);
  },

  validate(item: NormalizedAwinFeedItem): ValidationResult {
    return validateNormalizedAwinFeedItem(item);
  },
};

/**
 * Parser CSV de documento inteiro.
 * Suporta vírgula, tab e ponto-e-vírgula, aspas escapadas e quebras
 * de linha dentro de campos entre aspas.
 */
export function parseCsvDocument(input: string): string[][] {
  if (!input || input.trim() === "") return [];

  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function detectDelimiter(input: string): "," | "\t" | ";" {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", "\t", ";"] as const;
  let best: "," | "\t" | ";" = ",";
  let bestCount = -1;

  for (const candidate of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i += 1) {
      if (firstLine[i] === '"') {
        if (inQuotes && firstLine[i + 1] === '"') i += 1;
        else inQuotes = !inQuotes;
      } else if (!inQuotes && firstLine[i] === candidate) {
        count += 1;
      }
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function first(row: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function joinImages(row: Record<string, string>): string | undefined {
  const values = [
    first(row, ["large_image"]),
    first(row, ["merchant_image_url"]),
    first(row, ["aw_image_url"]),
    first(row, ["alternate_image"]),
    first(row, ["alternate_image_two"]),
    first(row, ["alternate_image_three"]),
    first(row, ["merchant_thumb_url"]),
    first(row, ["aw_thumb_url"]),
    first(row, ["imageUrls", "image_url"]),
  ].filter((value): value is string => Boolean(value));

  return values.length > 0 ? [...new Set(values)].join(";") : undefined;
}

/**
 * Converte colunas reais do Product Feed AWIN para o contrato interno.
 * Mantém aliases legados para fixtures e compatibilidade.
 */
export function mapAwinCsvRow(row: Record<string, string>): RawAwinFeedItem {
  const advertiserId = first(row, ["merchant_id", "advertiser_id", "advertiserId"]);
  const advertiserName = first(row, ["merchant_name", "advertiser_name", "advertiserName"]);
  const productId = first(row, [
    "merchant_product_id",
    "aw_product_id",
    "product_id",
    "productId",
  ]);

  return {
    id: first(row, ["id", "aw_product_id"]),
    productId,
    sku: first(row, ["sku"]),
    programId: advertiserId,
    advertiserId,
    advertiserName,
    title: first(row, ["product_name", "title", "name"]),
    description: first(row, ["description", "product_short_description"]),
    brand: first(row, ["brand_name", "brand"]),
    model: first(row, ["product_model", "model_number", "model"]),
    mpn: first(row, ["mpn"]),
    gtin: first(row, ["product_GTIN", "product_gtin", "ean", "upc", "gtin"]),
    price: first(row, ["search_price", "store_price", "price"]),
    oldPrice: first(row, ["product_price_old", "rrp_price", "oldPrice"]),
    currency: first(row, ["currency"]),
    productUrl: first(row, ["merchant_deep_link", "product_url", "productUrl"]),
    affiliateUrl: first(row, ["aw_deep_link", "affiliate_url", "affiliateUrl"]),
    imageUrls: joinImages(row),
    category: first(row, [
      "merchant_product_category_path",
      "merchant_category",
      "category_name",
      "category",
    ]),
    availability: first(row, ["stock_status", "in_stock", "is_for_sale", "availability"]),
    attributes: first(row, ["specifications", "attributes"]),
    _raw: row,
  };
}

export function parseAwinCsv(input: string): RawAwinFeedItem[] {
  const rows = parseCsvDocument(input);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.trim());
  const results: RawAwinFeedItem[] = [];

  for (const values of rows.slice(1)) {
    if (values.length !== headers.length) continue;
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = values[i] ?? "";
    }
    results.push(mapAwinCsvRow(row));
  }

  return results;
}

/**
 * Registry of feed adapters.
 * Separate from affiliate provider registry.
 */
export const feedAdapterRegistry = new Map<string, FeedSourceAdapter>();

feedAdapterRegistry.set("awin", awinFeedAdapter);

export function getFeedAdapter(source: string): FeedSourceAdapter | undefined {
  return feedAdapterRegistry.get(source.toLowerCase());
}

export function getRegisteredFeedSources(): string[] {
  return Array.from(feedAdapterRegistry.keys());
}
