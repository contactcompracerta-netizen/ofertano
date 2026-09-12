import { traceMultiloja } from "@/services/multiloja/trace";

import {
  normalizeQuery,
  searchCatalogLocal,
  type CatalogSearchHit,
  type CatalogSearchOptions,
  type CatalogSearchProduct,
} from "./index";

export const CATALOG_SHADOW_DEFAULT_TIMEOUT_MS = 1_200;

export type CatalogShadowStatus = "HIT" | "MISS" | "ERROR";
export type CatalogShadowComparisonStatus = "MATCH" | "PARTIAL" | "DIFFERENT" | "UNKNOWN";

export type CatalogShadowResult = {
  query: string;
  normalizedQuery: string;
  executed: boolean;
  enabled: boolean;
  status: CatalogShadowStatus;
  elapsedMs: number;
  hitCount: number;
  comparableCount: number;
  singleCount: number;
  topMarketplaceCount: number;
  topProductId?: string;
  error?: string;
};

export type CatalogShadowPublicResult = {
  source?: string;
  products?: Array<{
    id?: string;
    offers?: Array<{
      marketplace?: string | null;
    }>;
  }>;
};

export type CatalogShadowComparison = {
  status: CatalogShadowComparisonStatus;
  catalogHit: boolean;
  publicHit: boolean;
  catalogCount: number;
  publicCount: number;
  catalogTopProductId?: string;
  publicTopProductId?: string;
  topProductAgreement: "MATCH" | "DIFFERENT" | "UNKNOWN";
  catalogMarketplaceCount: number;
  publicMarketplaceCount: number;
};

function hashQuery(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return String(hash);
}

export function isCatalogShadowSearchEnabled(): boolean {
  const value = process.env.CATALOG_SHADOW_SEARCH_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function getCatalogShadowTimeoutMs(): number {
  const configured = Number.parseInt(
    process.env.CATALOG_SHADOW_TIMEOUT_MS ?? String(CATALOG_SHADOW_DEFAULT_TIMEOUT_MS),
    10,
  );

  if (!Number.isFinite(configured) || configured <= 0) {
    return CATALOG_SHADOW_DEFAULT_TIMEOUT_MS;
  }

  return Math.min(configured, 5_000);
}

function summarizeHits(hits: CatalogSearchHit[]): {
  hitCount: number;
  comparableCount: number;
  singleCount: number;
  topMarketplaceCount: number;
  topProductId?: string;
} {
  const comparableCount = hits.filter((hit) => hit.kind === "COMPARABLE").length;
  const singleCount = hits.filter((hit) => hit.kind === "SINGLE_MARKETPLACE").length;
  const topMarketplaceCount = hits.reduce(
    (max, hit) => Math.max(max, hit.marketplaceCount),
    0,
  );
  const topProductId = hits[0]?.product.id;

  return {
    hitCount: hits.length,
    comparableCount,
    singleCount,
    topMarketplaceCount,
    topProductId,
  };
}

export async function runCatalogShadowSearch(
  query: string,
  options: {
    repository?: CatalogSearchOptions["repository"];
    publicResult?: CatalogShadowPublicResult;
  } = {},
): Promise<CatalogShadowResult> {
  const normalizedQuery = normalizeQuery(query);

  if (!isCatalogShadowSearchEnabled()) {
    return {
      query: normalizedQuery,
      normalizedQuery,
      executed: false,
      enabled: false,
      status: "MISS",
      elapsedMs: 0,
      hitCount: 0,
      comparableCount: 0,
      singleCount: 0,
      topMarketplaceCount: 0,
    };
  }

  if (normalizedQuery.length < 2) {
    return {
      query: normalizedQuery,
      normalizedQuery,
      executed: false,
      enabled: true,
      status: "MISS",
      elapsedMs: 0,
      hitCount: 0,
      comparableCount: 0,
      singleCount: 0,
      topMarketplaceCount: 0,
    };
  }

  const allowedMs = getCatalogShadowTimeoutMs();
  const startedAt = Date.now();

  try {
    const result = await Promise.race([
      searchCatalogLocal(normalizedQuery, {
        ...options,
        repository: options.repository,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("CATALOG_SHADOW_TIMEOUT")), allowedMs);
      }),
    ]);

    const summary = summarizeHits(result.hits);
    const nextResult: CatalogShadowResult = {
      query: normalizedQuery,
      normalizedQuery,
      executed: true,
      enabled: true,
      status: summary.hitCount > 0 ? "HIT" : "MISS",
      elapsedMs: Date.now() - startedAt,
      ...summary,
    };

    traceMultiloja("catalog-shadow-search", {
      queryHash: hashQuery(normalizedQuery),
      status: nextResult.status,
      elapsedMs: nextResult.elapsedMs,
      hitCount: nextResult.hitCount,
      comparableCount: nextResult.comparableCount,
      singleCount: nextResult.singleCount,
      topMarketplaceCount: nextResult.topMarketplaceCount,
      publicSource: options.publicResult?.source,
      publicHitCount: options.publicResult?.products?.length ?? 0,
    });

    return nextResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown catalog shadow error";
    const failed: CatalogShadowResult = {
      query: normalizedQuery,
      normalizedQuery,
      executed: true,
      enabled: true,
      status: "ERROR",
      elapsedMs: Date.now() - startedAt,
      hitCount: 0,
      comparableCount: 0,
      singleCount: 0,
      topMarketplaceCount: 0,
      error: message,
    };

    console.warn("[CATALOG-SHADOW] fallback sem quebrar a busca pública:", {
      query: normalizedQuery,
      reason: message,
      timeoutMs: allowedMs,
    });

    traceMultiloja("catalog-shadow-search", {
      queryHash: hashQuery(normalizedQuery),
      status: "ERROR",
      elapsedMs: failed.elapsedMs,
      hitCount: 0,
      comparableCount: 0,
      singleCount: 0,
      topMarketplaceCount: 0,
      publicSource: options.publicResult?.source,
      publicHitCount: options.publicResult?.products?.length ?? 0,
    });

    return failed;
  }
}

export function compareCatalogShadowToPublic(
  catalog: CatalogShadowResult,
  publicResult?: CatalogShadowPublicResult,
): CatalogShadowComparison {
  const publicProducts = publicResult?.products ?? [];
  const publicCount = publicProducts.length;
  const publicHit = publicCount > 0;
  const publicTopProductId = publicProducts[0]?.id;
  const publicMarketplaceCount = publicProducts.reduce((count, product) => {
    const marketplaces = new Set(
      (product.offers ?? [])
        .map((offer) => String(offer.marketplace ?? "").trim())
        .filter(Boolean),
    );

    return Math.max(count, marketplaces.size);
  }, 0);

  const catalogHit = catalog.status === "HIT" && catalog.hitCount > 0;
  const catalogTopProductId = catalog.topProductId;

  let status: CatalogShadowComparisonStatus = "UNKNOWN";
  let topProductAgreement: "MATCH" | "DIFFERENT" | "UNKNOWN" = "UNKNOWN";

  if (!catalogHit && !publicHit) {
    status = "MATCH";
    topProductAgreement = "MATCH";
  } else if (catalogHit && publicHit) {
    if (
      catalogTopProductId &&
      publicTopProductId &&
      catalogTopProductId === publicTopProductId
    ) {
      status = "MATCH";
      topProductAgreement = "MATCH";
    } else if (
      catalogTopProductId &&
      publicTopProductId &&
      catalogTopProductId !== publicTopProductId
    ) {
      status = "PARTIAL";
      topProductAgreement = "DIFFERENT";
    } else {
      status = "PARTIAL";
      topProductAgreement = "UNKNOWN";
    }
  } else if (catalogHit !== publicHit) {
    status = "DIFFERENT";
    topProductAgreement = "DIFFERENT";
  }

  return {
    status,
    catalogHit,
    publicHit,
    catalogCount: catalog.hitCount,
    publicCount: publicCount,
    catalogTopProductId,
    publicTopProductId,
    topProductAgreement,
    catalogMarketplaceCount: catalog.topMarketplaceCount,
    publicMarketplaceCount,
  };
}
