import { gunzipSync } from "node:zlib";

import {
  parseAwinCsv,
  parseCsvDocument,
  type RawAwinFeedItem,
} from "../feed/awinAdapter";

const FEED_LIST_ORIGIN = "https://productdata.awin.com";
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "productdata.awin.com",
  "datafeed.api.productserve.com",
]);

export interface AwinFeedDescriptor {
  advertiserId: string;
  advertiserName: string;
  primaryRegion: string;
  membershipStatus: string;
  feedId: string;
  feedName: string;
  language: string;
  vertical: string;
  lastImported: string;
  downloadUrl: string;
}

export interface AwinFeedFetchOptions {
  timeoutMs?: number;
  /** Limite do payload transferido (comprimido, quando aplicável). */
  maxBytes?: number;
  /** Limite após descompressão/decodificação. */
  maxDecodedBytes?: number;
  fetchImpl?: typeof fetch;
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function valueByHeader(
  row: Record<string, string>,
  aliases: readonly string[],
): string {
  for (const alias of aliases) {
    const value = row[normalizedHeader(alias)];
    if (value?.trim()) return value.trim();
  }
  return "";
}

export function parseAwinFeedListCsv(input: string): AwinFeedDescriptor[] {
  const rows = parseCsvDocument(input);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizedHeader);
  const output: AwinFeedDescriptor[] = [];

  for (const values of rows.slice(1)) {
    if (values.length !== headers.length) continue;
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = values[i] ?? "";
    }

    const advertiserId = valueByHeader(row, ["Advertiser ID", "Merchant ID"]);
    const feedId = valueByHeader(row, ["Feed ID"]);
    const downloadUrl = valueByHeader(row, ["URL", "Download URL"]);
    if (!advertiserId || !feedId || !downloadUrl) continue;

    output.push({
      advertiserId,
      advertiserName: valueByHeader(row, ["Advertiser Name", "Merchant Name"]),
      primaryRegion: valueByHeader(row, ["Primary Region", "Region"]),
      membershipStatus: valueByHeader(row, ["Membership Status", "Membership"]),
      feedId,
      feedName: valueByHeader(row, ["Feed Name"]),
      language: valueByHeader(row, ["Language"]),
      vertical: valueByHeader(row, ["Vertical"]),
      lastImported: valueByHeader(row, ["Last Imported", "Last Updated"]),
      downloadUrl,
    });
  }

  return output;
}

export function isAllowedAwinDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_DOWNLOAD_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function feedListUrl(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) throw new Error("AWIN_DATAFEED_API_KEY_MISSING");
  return `${FEED_LIST_ORIGIN}/datafeed/list/apikey/${encodeURIComponent(key)}`;
}

async function fetchWithLimits(
  url: string,
  options: AwinFeedFetchOptions = {},
): Promise<Uint8Array> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Ofertano-CatalogWave1/1.0",
        accept: "text/csv,application/gzip,application/octet-stream;q=0.9,*/*;q=0.1",
      },
    });

    if (!response.ok) {
      throw new Error(`AWIN_HTTP_${response.status}`);
    }

    // fetch() segue redirects; valide também o destino FINAL para não
    // transformar um redirect externo em fonte implicitamente aprovada.
    if (response.url && !isAllowedAwinDownloadUrl(response.url)) {
      throw new Error("AWIN_REDIRECT_URL_BLOCKED");
    }

    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`AWIN_FEED_TOO_LARGE:${declaredLength}`);
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(`AWIN_FEED_TOO_LARGE:${buffer.byteLength}`);
    }
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

function decodeMaybeGzip(
  bytes: Uint8Array,
  maxDecodedBytes: number,
): string {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const decoded = isGzip
    ? gunzipSync(bytes, { maxOutputLength: maxDecodedBytes })
    : bytes;

  if (decoded.byteLength > maxDecodedBytes) {
    throw new Error(`AWIN_DECODED_FEED_TOO_LARGE:${decoded.byteLength}`);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(decoded);
}

export async function fetchAwinFeedList(
  apiKey: string,
  options: AwinFeedFetchOptions = {},
): Promise<AwinFeedDescriptor[]> {
  const bytes = await fetchWithLimits(feedListUrl(apiKey), {
    ...options,
    maxBytes: Math.min(options.maxBytes ?? 8 * 1024 * 1024, 8 * 1024 * 1024),
  });
  const maxDecodedBytes = Math.min(
    options.maxDecodedBytes ?? 16 * 1024 * 1024,
    16 * 1024 * 1024,
  );
  return parseAwinFeedListCsv(decodeMaybeGzip(bytes, maxDecodedBytes));
}

export function selectAwinFeed(
  feeds: readonly AwinFeedDescriptor[],
  advertiserId: string,
  feedId?: string | null,
): AwinFeedDescriptor {
  const byAdvertiser = feeds.filter(
    (feed) => feed.advertiserId === advertiserId.trim(),
  );

  const candidates = feedId?.trim()
    ? byAdvertiser.filter((feed) => feed.feedId === feedId.trim())
    : byAdvertiser;

  if (candidates.length === 0) {
    throw new Error(
      `AWIN_FEED_NOT_FOUND:advertiser=${advertiserId}:feed=${feedId ?? "auto"}`,
    );
  }
  if (!feedId && candidates.length > 1) {
    throw new Error(
      `AWIN_FEED_AMBIGUOUS:advertiser=${advertiserId}:count=${candidates.length}`,
    );
  }

  const selected = candidates[0];
  if (selected.membershipStatus.trim().toLowerCase() !== "joined") {
    throw new Error(
      `AWIN_ADVERTISER_NOT_JOINED:advertiser=${selected.advertiserId}:status=${selected.membershipStatus || "unknown"}`,
    );
  }
  if (!isAllowedAwinDownloadUrl(selected.downloadUrl)) {
    throw new Error("AWIN_FEED_URL_BLOCKED");
  }
  return selected;
}

export async function downloadAwinFeedRows(
  feed: AwinFeedDescriptor,
  options: AwinFeedFetchOptions & { maxRows?: number } = {},
): Promise<RawAwinFeedItem[]> {
  if (!isAllowedAwinDownloadUrl(feed.downloadUrl)) {
    throw new Error("AWIN_FEED_URL_BLOCKED");
  }

  const bytes = await fetchWithLimits(feed.downloadUrl, options);
  const maxDecodedBytes = Math.min(
    options.maxDecodedBytes ?? 128 * 1024 * 1024,
    256 * 1024 * 1024,
  );
  const text = decodeMaybeGzip(bytes, maxDecodedBytes);
  const rows = parseAwinCsv(text);
  const maxRows = Math.max(1, Math.min(options.maxRows ?? 500, 5000));
  return rows.slice(0, maxRows);
}
