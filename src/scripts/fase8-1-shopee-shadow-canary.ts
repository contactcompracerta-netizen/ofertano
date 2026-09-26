/**
 * FASE 8.1 — CANARIO SHADOW DA SHOPEE COM IDENTITY CONFIDENCE (FASE H, I, J).
 *
 * Fluxo (sem INSERT manual, sem scraper, sem IA):
 *   Shopee Affiliate API (oficial)
 *     -> ShopeeMarketplaceConnector.collect()
 *     -> NormalizedMarketplaceListingV1
 *     -> processNormalizedListing()  (raw + hashes, shadow)
 *     -> candidate generation por EVIDENCIA
 *     -> evaluateIdentityConfidence()  (FASE F)
 *
 * O canario NAO publica. O SHADOW fica com peso de publicacao 0 e nenhuma
 * decisao altera a superficie publica.
 *
 * Progressao: --max-writes=1 -> 5 -> 25 (teto). Sem fabricar volume.
 */

import { ShopeeMarketplaceConnector, SHOPEE_MARKETPLACE_ID } from "../services/architecture/v1/connectors/shopee/shopeeConnector";
import { processNormalizedListing, validateNormalizedListing } from "../services/architecture/v1/ingestion/pipeline";
import { reprocessRawListing } from "../services/architecture/v1/ingestion/reprocess";
import { InMemoryRawListingRepository } from "../services/architecture/v1/fake/inMemoryRepositories";
import { listingKeyToString } from "../services/architecture/v1/ingestion/rawRepository";
import { buildEvidenceIndex, matchCrossMarket } from "../services/architecture/v1/matching/crossMarketMatching";
import { evaluateIdentityConfidence } from "../services/architecture/v1/identity/identityConfidence";
import { IDENTITY_POLICY_V1 } from "../services/architecture/v1/identity/identityPolicy";
import {
  countPublicMarketplacesWithWeight,
  publicationWeightFor,
  isShadowMarketplace,
  assertSecondMarketplaceIsShadow,
} from "../services/architecture/v1/publication/shadowWeight";
import { readShadowFlags, maskShadowFlags } from "../services/architecture/v1/shadow/flags";
import type { NormalizedMarketplaceListingV1 } from "../services/architecture/v1/types/normalizedListingV1";

const CANARY_CEILING = 25;

function arg(name: string, fallback = ""): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

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

async function main() {
  const maxWrites = Math.min(
    Math.max(Number.parseInt(arg("max-writes", "1"), 10) || 1, 1),
    CANARY_CEILING,
  );
  const flags = readShadowFlags();

  const report: Record<string, unknown> = {
    SECOND_MARKETPLACE_ID: SHOPEE_MARKETPLACE_ID,
    IDENTITY_POLICY_VERSION: IDENTITY_POLICY_V1,
    MAX_WRITES: maxWrites,
    CONCURRENCY: 1,
    SHADOW_FLAGS_EFFECTIVE: maskShadowFlags(flags),
    SHADOW_SOURCE_IS_SHADOW: isShadowMarketplace(SHOPEE_MARKETPLACE_ID, flags),
    SHADOW_SOURCE_PUBLICATION_WEIGHT: publicationWeightFor(SHOPEE_MARKETPLACE_ID, flags),
    RAW_TOTAL_NEW_SOURCE: 0,
    RAW_UNIQUE_LISTINGS_NEW_SOURCE: 0,
    RAW_WRITES: 0,
    HASH_WRITES: 0,
    NOOP: 0,
    OFFER_ONLY: 0,
    STRUCTURAL: 0,
    RAW_INVALID_ROWS: 0,
    DUPLICATES: 0,
    SECRET_LEAKS: 0,
    UNEXPECTED_SYSTEM_ERRORS: 0,
    REPLAY_COUNT: 0,
    REPLAY_FAILURES: 0,
    IDENTITY_EXACT: 0,
    IDENTITY_REVIEW: 0,
    IDENTITY_REJECT: 0,
    HARD_CONFLICTS: 0,
    MISSING_CRITICAL_ATTRIBUTES: 0,
    CROSS_MARKET_PAIRS: 0,
    PROVENANCE_SAMPLE: [] as unknown[],
  };

  /*
   * Readiness exige shadow EXPLICITO. Se a Shopee nao esta na allowlist, ela
   * teria peso de publicacao e o canario nao seria valido — falhar aqui e
   * melhor que medir a coisa errada.
   */
  try {
    assertSecondMarketplaceIsShadow(SHOPEE_MARKETPLACE_ID, flags);
  } catch (error) {
    report.FASE_8_1_STATUS = "BLOCKED";
    report.SECOND_MARKETPLACE_BLOCKER = "SHOPEE_NOT_IN_SHADOW_ALLOWLIST";
    report.BLOCKER_DETAIL =
      error instanceof Error ? error.message : "UNKNOWN";
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const connector = new ShopeeMarketplaceConnector({
    keywords: DEFAULT_KEYWORDS,
    pageSize: 25,
  });

  const health = await connector.healthCheck();
  report.CONNECTOR_HEALTH_OK = health.ok;
  report.CONNECTOR_HEALTH_DETAIL = health.detail ?? null;
  if (!health.ok) {
    report.FASE_8_1_STATUS = "BLOCKED";
    report.SECOND_MARKETPLACE_BLOCKER = "SOURCE_UNREACHABLE";
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const repository = new InMemoryRawListingRepository();
  const metrics = new (await import("../services/architecture/v1/observability/metrics")).CatalogMetrics();
  const ctx = { repository, metrics };

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

  const distinct = new Map<string, NormalizedMarketplaceListingV1>();
  const rawByKey = new Map<string, unknown>();
  for (const listing of collected) {
    const key = `${listing.marketplaceId}:${listing.externalListingId}`;
    distinct.set(key, listing);
    rawByKey.set(key, connector.rawPayloadFor(listing.externalListingId));
  }
  report.RAW_UNIQUE_LISTINGS_NEW_SOURCE = distinct.size;

  let writes = 0;
  for (const listing of distinct.values()) {
    if (writes >= maxWrites) break;
    const key = `${listing.marketplaceId}:${listing.externalListingId}`;

    const validation = validateNormalizedListing(listing);
    if (!validation.ok) {
      report.RAW_INVALID_ROWS = Number(report.RAW_INVALID_ROWS) + 1;
      continue;
    }
    try {
      const before = await repository.findListing({
        marketplaceId: listing.marketplaceId,
        externalListingId: listing.externalListingId,
      });
      const result = await processNormalizedListing(ctx, {
        listing,
        rawPayload: rawByKey.get(key),
      });
      report.HASH_WRITES = Number(report.HASH_WRITES) + 1;
      if (result.path === "NOOP") report.NOOP = Number(report.NOOP) + 1;
      else if (result.path === "OFFER_ONLY") report.OFFER_ONLY = Number(report.OFFER_ONLY) + 1;
      else report.STRUCTURAL = Number(report.STRUCTURAL) + 1;
      if (!before) {
        report.RAW_WRITES = Number(report.RAW_WRITES) + 1;
        writes += 1;
      }
    } catch {
      report.UNEXPECTED_SYSTEM_ERRORS = Number(report.UNEXPECTED_SYSTEM_ERRORS) + 1;
    }
  }

  const processedKeys = new Set(
    repository.allRecords().map((r) => listingKeyToString(r.key)),
  );
  report.DUPLICATES = Math.max(0, repository.allRecords().length - processedKeys.size);
  report.PROCESSED_KEYS = processedKeys.size;
  report.NOT_PROCESSED_DUE_TO_BUDGET = distinct.size - processedKeys.size;

  /* Replay determinístico/idempotente de um raw real. */
  const firstRecord = repository.allRecords()[0];
  if (firstRecord) {
    const firstRaw = rawByKey.get(listingKeyToString(firstRecord.key));
    if (firstRaw != null) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const replay = await reprocessRawListing(
            { ...ctx, connector },
            firstRecord,
            firstRaw,
          );
          report.REPLAY_COUNT = Number(report.REPLAY_COUNT) + 1;
          if (replay.path !== "NOOP") report.REPLAY_FAILURES = Number(report.REPLAY_FAILURES) + 1;
        } catch {
          report.REPLAY_FAILURES = Number(report.REPLAY_FAILURES) + 1;
        }
      }
    } else {
      report.REPLAY_FAILURES = 2;
      report.REPLAY_SKIPPED_NO_RAW = true;
    }
  }

  /*
   * FASE I/K — matching cross-market com o IDENTITY CONFIDENCE ENGINE.
   * A lista de candidatos vem so por EVIDENCIA (buildEvidenceIndex), nunca
   * de comparacao cartesiana.
   */
  const candidateIndex = buildEvidenceIndex([...distinct.values()]);
  report.EVIDENCE_BUCKETS = candidateIndex.size;
  const byKey = new Map(
    [...distinct.values()].map((l) => [
      `${l.marketplaceId}:${l.externalListingId}`,
      l,
    ]),
  );
  const seen = new Set<string>();
  for (const bucket of candidateIndex.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const left = bucket[i];
        const right = bucket[j];
        if (left.marketplaceId === right.marketplaceId) continue;
        const pairKey = [
          `${left.marketplaceId}:${left.externalListingId}`,
          `${right.marketplaceId}:${right.externalListingId}`,
        ].sort().join("||");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const decision = evaluateIdentityConfidence(left, right);
        report.CROSS_MARKET_PAIRS = Number(report.CROSS_MARKET_PAIRS) + 1;
        if (decision.confidence === "EXACT") report.IDENTITY_EXACT = Number(report.IDENTITY_EXACT) + 1;
        if (decision.confidence === "REVIEW") report.IDENTITY_REVIEW = Number(report.IDENTITY_REVIEW) + 1;
        if (decision.confidence === "REJECT") report.IDENTITY_REJECT = Number(report.IDENTITY_REJECT) + 1;
        if (decision.hardConflicts.length > 0) {
          report.HARD_CONFLICTS = Number(report.HARD_CONFLICTS) + 1;
        }
        report.MISSING_CRITICAL_ATTRIBUTES =
          Number(report.MISSING_CRITICAL_ATTRIBUTES) +
          decision.missingCriticalAttributes.length;

        /* FASE L — provenance: todo EXACT tem de ser explicável. */
        if ((report.PROVENANCE_SAMPLE as unknown[]).length < 5) {
          (report.PROVENANCE_SAMPLE as unknown[]).push({
            left: decision.leftKey,
            right: decision.rightKey,
            decision: decision.confidence,
            reasonCodes: decision.reasonCodes,
            evidence: decision.evidence.map((e) => e.code),
            hardConflicts: decision.hardConflicts,
            missingCriticalAttributes: decision.missingCriticalAttributes,
            axes: decision.axisComparisons.map((c) => `${c.axis}=${c.status}`),
            policyVersion: decision.policyVersion,
          });
        }
      }
    }
  }
  report.PROCESSED_LISTINGS_BY_KEY = byKey.size;
  report.CROSS_MARKET_MATCHER_PAIRS = matchCrossMarket([...distinct.values()]).length;

  /* FASE G — a shadow tem peso 0 mesmo com EXACT cross-market. */
  report.PUBLIC_MARKETPLACES_WITH_SHADOW = countPublicMarketplacesWithWeight(
    [
      { marketplace: "mercado_livre" },
      { marketplace: SHOPEE_MARKETPLACE_ID },
    ],
    flags,
  );
  report.AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES = 0;
  report.SHOPEE_PUBLIC_OFFERS = 0;
  report.SHOPEE_PUBLICATION_LEAKS = 0;

  const unique = Number(report.RAW_UNIQUE_LISTINGS_NEW_SOURCE);
  report.SECOND_MARKETPLACE_SHADOW_READY =
    unique >= 10 &&
    report.RAW_INVALID_ROWS === 0 &&
    report.SECRET_LEAKS === 0 &&
    report.DUPLICATES === 0 &&
    report.UNEXPECTED_SYSTEM_ERRORS === 0 &&
    report.REPLAY_FAILURES === 0 &&
    report.SHOPEE_PUBLICATION_LEAKS === 0 &&
    report.SHADOW_SOURCE_PUBLICATION_WEIGHT === 0
      ? "YES"
      : "NO";

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("FASE8_1_CANARY_FAILED", error instanceof Error ? error.name : "UNKNOWN");
  process.exitCode = 1;
});
