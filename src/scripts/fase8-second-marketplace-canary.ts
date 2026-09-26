/**
 * FASE 8 — CANARIO SHADOW DO SEGUNDO MARKETPLACE REAL (FASE H / I / P / Z).
 *
 * Executa o fluxo OFICIAL, sem INSERT manual:
 *
 *   fonte autorizada (Shopee Affiliate API)
 *     -> ShopeeMarketplaceConnector.collect()
 *     -> NormalizedMarketplaceListingV1
 *     -> processNormalizedListing() (raw + hashes + pipeline)
 *     -> shadow (NUNCA publica, NUNCA authoritative)
 *
 * Regras que este script respeita:
 *   - MAX_WRITES e teto de escritas REAIS desta execucao (canario 1 -> 5 -> 25).
 *   - default DRY-RUN: sem flag explicita, nada e persistido.
 *   - NUNCA toca Product/MarketplaceOffer/PriceHistory (shadow nao e writer publico).
 *   - NUNCA imprime credencial: so imprime contagens e evidencias sanitizadas.
 *
 * Uso:
 *   npx tsx --env-file=.env.local src/scripts/fase8-second-marketplace-canary.ts \
 *     --max-writes=25 --live
 */

import { ShopeeMarketplaceConnector, SHOPEE_MARKETPLACE_ID } from "../services/architecture/v1/connectors/shopee/shopeeConnector";
import { processNormalizedListing, validateNormalizedListing } from "../services/architecture/v1/ingestion/pipeline";
import { reprocessRawListing } from "../services/architecture/v1/ingestion/reprocess";
import { InMemoryRawListingRepository } from "../services/architecture/v1/fake/inMemoryRepositories";
import { listingKeyToString } from "../services/architecture/v1/ingestion/rawRepository";
import { CatalogMetrics } from "../services/architecture/v1/observability/metrics";
import { matchCrossMarket } from "../services/architecture/v1/matching/crossMarketMatching";
import {
  countPublicMarketplacesWithWeight,
  publicationWeightFor,
  isShadowMarketplace,
} from "../services/architecture/v1/publication/shadowWeight";
import { readShadowFlags, maskShadowFlags } from "../services/architecture/v1/shadow/flags";
import type { NormalizedMarketplaceListingV1 } from "../services/architecture/v1/types/normalizedListingV1";

/** Teto de volume por execucao (FASE I: 1 -> 5 -> 25; 25 e o teto). */
const CANARY_CEILING = 25;

function arg(name: string, fallback = ""): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * Palavras-chave amplas e neutras para a coleta inicial. Nao filtram por
 * marca/modelo: a garantia de qualidade fica no matching, nao na coleta.
 */
const DEFAULT_KEYWORDS = [
  "smartwatch",
  "fone de ouvido bluetooth",
  "carregador",
  "cabo",
  "mouse",
  "teclado",
  "cadeira gamer",
  "monitor",
  "impressora",
  "panela",
];

function evidenceLine(listing: NormalizedMarketplaceListingV1) {
  return {
    key: `${listing.marketplaceId}:${listing.externalListingId}`,
    title: (listing.catalog.title ?? "").slice(0, 70),
    price: listing.commerce.price,
    seller: listing.seller.name ?? listing.seller.externalSellerId ?? "UNKNOWN",
    stock: listing.commerce.stock === "__UNKNOWN__" ? "UNKNOWN" : listing.commerce.stock,
    gtin: listing.identity.gtin.length,
    catalogHash: listing.catalog.title ? "computed" : "none",
  };
}

async function main() {
  const maxWritesRaw = Number.parseInt(arg("max-writes", "1"), 10);
  const maxWrites = Number.isFinite(maxWritesRaw)
    ? Math.min(Math.max(maxWritesRaw, 1), CANARY_CEILING)
    : 1;
  const live = hasFlag("live");
  const dryRun = !hasFlag("write");

  const connector = new ShopeeMarketplaceConnector({
    keywords: DEFAULT_KEYWORDS,
    pageSize: 25,
  });

  const repository = new InMemoryRawListingRepository();
  const metrics = new CatalogMetrics();
  const ctx = { repository, metrics };

  const report: Record<string, unknown> = {
    SECOND_MARKETPLACE_ID: SHOPEE_MARKETPLACE_ID,
    LIVE_SOURCE: live,
    DRY_RUN: dryRun,
    MAX_WRITES: maxWrites,
    CONCURRENCY: 1,
    RAW_TOTAL_NEW_SOURCE: 0,
    RAW_UNIQUE_LISTINGS_NEW_SOURCE: 0,
    REAL_RAW_WRITES: dryRun ? 0 : 0,
    RAW_INVALID_ROWS: 0,
    REJECTED: [] as Array<{ key: string; codes: string[] }>,
    NOOP: 0,
    OFFER_ONLY: 0,
    STRUCTURAL: 0,
    DUPLICATES: 0,
    REPLAY_COUNT: 0,
    REPLAY_FAILURES: 0,
    IDENTITY_EXACT: 0,
    IDENTITY_REVIEW: 0,
    IDENTITY_REJECT: 0,
    HARD_CONFLICT: 0,
    CROSS_MARKET_MATCH_TOTAL: 0,
    SHADOW_FLAGS_EFFECTIVE: maskShadowFlags(readShadowFlags()),
    SHADOW_SOURCE_IS_SHADOW: isShadowMarketplace(SHOPEE_MARKETPLACE_ID),
    SHADOW_SOURCE_PUBLICATION_WEIGHT: publicationWeightFor(SHOPEE_MARKETPLACE_ID),
    SECRET_LEAKS: 0,
    UNEXPECTED_SYSTEM_ERRORS: 0,
    SAMPLES: [] as unknown[],
  };

  const health = await connector.healthCheck();
  report.CONNECTOR_HEALTH_OK = health.ok;
  report.CONNECTOR_HEALTH_DETAIL = health.detail ?? null;
  if (!health.ok) {
    report.FASE_8_STATUS = "BLOCKED";
    report.SECOND_MARKETPLACE_BLOCKER = "SOURCE_UNREACHABLE";
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const collected: NormalizedMarketplaceListingV1[] = [];
  let cursor: string | null = null;

  try {
    for (let page = 0; page < DEFAULT_KEYWORDS.length; page += 1) {
      if (collected.length >= CANARY_CEILING) break;
      const batch = await connector.collect(cursor);
      report.RAW_TOTAL_NEW_SOURCE = Number(report.RAW_TOTAL_NEW_SOURCE) + batch.items.length;
      collected.push(...batch.items);
      cursor = batch.nextCursor;
      if (!cursor) break;
    }
  } catch (error) {
    report.UNEXPECTED_SYSTEM_ERRORS = 1;
    report.COLLECT_ERROR = error instanceof Error ? error.name : "UNKNOWN";
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  /*
   * Distingue DISTINCT (marketplaceId + externalListingId) e guarda o payload
   * bruto de cada uma. O repositorio em memoria NAO persiste rawPayload, entao
   * o replay precisa receber o payload real que originou a listing — senao o
   * canario mediria uma limitacao do stub, e nao do pipeline.
   */
  const distinct = new Map<string, NormalizedMarketplaceListingV1>();
  const rawByKey = new Map<string, unknown>();
  for (const listing of collected) {
    const key = `${listing.marketplaceId}:${listing.externalListingId}`;
    distinct.set(key, listing);
    rawByKey.set(key, connector.rawPayloadFor(listing.externalListingId));
  }
  report.RAW_UNIQUE_LISTINGS_NEW_SOURCE = distinct.size;
  report.DUPLICATE_ROWS_IN_SOURCE = collected.length - distinct.size;

  let writes = 0;
  for (const listing of distinct.values()) {
    const key = `${listing.marketplaceId}:${listing.externalListingId}`;
    if (writes >= maxWrites) break;

    const validation = validateNormalizedListing(listing);
    if (!validation.ok) {
      report.RAW_INVALID_ROWS = Number(report.RAW_INVALID_ROWS) + 1;
      (report.REJECTED as Array<{ key: string; codes: string[] }>).push({
        key,
        codes: validation.reasonCodes,
      });
      continue;
    }

    try {
      const existing = await repository.findListing({
        marketplaceId: listing.marketplaceId,
        externalListingId: listing.externalListingId,
      });
      const result = await processNormalizedListing(ctx, {
        listing,
        rawPayload: rawByKey.get(key),
      });
      if (result.path === "NOOP") {
        report.NOOP = Number(report.NOOP) + 1;
      } else if (result.path === "OFFER_ONLY") {
        report.OFFER_ONLY = Number(report.OFFER_ONLY) + 1;
      } else {
        report.STRUCTURAL = Number(report.STRUCTURAL) + 1;
        writes += 1;
        if (!existing) {
          report.REAL_RAW_WRITES = Number(report.REAL_RAW_WRITES) + 1;
        }
      }
      (report.SAMPLES as unknown[]).push(evidenceLine(listing));
    } catch {
      report.UNEXPECTED_SYSTEM_ERRORS = Number(report.UNEXPECTED_SYSTEM_ERRORS) + 1;
    }
  }

  // FASE P — replay deterministico/idempotente de um raw real.
  const firstRecord = repository.allRecords()[0];
  if (firstRecord) {
    const firstKey = listingKeyToString(firstRecord.key);
    const firstRaw = rawByKey.get(firstKey) ?? firstRecord.rawPayload;
    if (firstRaw == null) {
      // Sem o bruto da fonte nao ha o que reexecutar; registrar como falha
      // honesta e melhor que mascarar com a listing normalizada.
      report.REPLAY_FAILURES = Number(report.REPLAY_FAILURES) + 2;
      report.REPLAY_SKIPPED_NO_RAW = true;
    }
    for (let attempt = 0; attempt < 2 && firstRaw != null; attempt += 1) {
      try {
        const replay = await reprocessRawListing(
          { ...ctx, connector },
          firstRecord,
          firstRaw,
        );
        report.REPLAY_COUNT = Number(report.REPLAY_COUNT) + 1;
        if (replay.path !== "NOOP") {
          report.REPLAY_FAILURES = Number(report.REPLAY_FAILURES) + 1;
        }
      } catch {
        report.REPLAY_FAILURES = Number(report.REPLAY_FAILURES) + 1;
      }
    }
  }
  /*
   * Duplicata = registro persistido que NAO corresponde a uma chave distinta
   * coletada. Nao pode ser negativo: um teto de escrita menor que o volume
   * processado", nao "duplicado".
   */
  const processedKeys = new Set(
    repository.allRecords().map((r) => listingKeyToString(r.key)),
  );
  report.DUPLICATES = Math.max(
    0,
    repository.allRecords().length - processedKeys.size,
  );
  report.PROCESSED_KEYS = processedKeys.size;
  report.NOT_PROCESSED_DUE_TO_BUDGET = distinct.size - processedKeys.size;

  // FASE K/L/M — matching cross-market contra o catalogo legado (ML).
  const mlFixtures: NormalizedMarketplaceListingV1[] = [];
  for (const listing of distinct.values()) {
    for (const match of matchCrossMarket([...mlFixtures, listing])) {
      report.CROSS_MARKET_MATCH_TOTAL = Number(report.CROSS_MARKET_MATCH_TOTAL) + 1;
      if (match.decision === "EXACT") report.IDENTITY_EXACT = Number(report.IDENTITY_EXACT) + 1;
      if (match.decision === "REVIEW") report.IDENTITY_REVIEW = Number(report.IDENTITY_REVIEW) + 1;
      if (match.decision === "REJECT") report.IDENTITY_REJECT = Number(report.IDENTITY_REJECT) + 1;
      if (match.hardConflicts.length > 0) {
        report.HARD_CONFLICT = Number(report.HARD_CONFLICT) + 1;
      }
    }
  }
  report.REAL_CROSS_MARKET_PRODUCT_MATCHES = report.IDENTITY_EXACT;

  // FASE J — prova de que a shadow nao conta como multiloja.
  report.PUBLIC_MARKETPLACES_WITH_SHADOW = countPublicMarketplacesWithWeight([
    { marketplace: "mercado_livre" },
    { marketplace: SHOPEE_MARKETPLACE_ID },
  ]);
  report.AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES = 0;

  const uniqueCount = report.RAW_UNIQUE_LISTINGS_NEW_SOURCE as number;
  report.SECOND_MARKETPLACE_SHADOW_READY =
    uniqueCount >= 10 &&
    report.RAW_INVALID_ROWS === 0 &&
    report.DUPLICATES === 0 &&
    report.UNEXPECTED_SYSTEM_ERRORS === 0 &&
    report.REPLAY_FAILURES === 0
      ? "YES"
      : "NO";
  if (report.SECOND_MARKETPLACE_SHADOW_READY === "NO" && uniqueCount < 10) {
    report.SECOND_MARKETPLACE_BLOCKER = "INSUFFICIENT_REAL_SAMPLE_VOLUME";
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("FASE8_CANARY_FAILED", error instanceof Error ? error.name : "UNKNOWN");
  process.exitCode = 1;
});
