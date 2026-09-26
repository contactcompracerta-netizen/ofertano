/**
 * FASE 8 — SNAPSHOT READ-ONLY (FASE A / FASE T) + EVIDENCIA CROSS-MARKET (FASE S).
 *
 * Este script NUNCA escreve. Ele:
 *   - fotografa o estado atual (FASE A) antes de qualquer mudanca;
 *   - le o estado do autopilot do Mercado Livre (FASE T) sem tocar nele;
 *   - procura evidencia real de produto presente em dois marketplaces (FASE S).
 *
 * Regra: apenas SELECT. Nenhum INSERT/UPDATE/DELETE neste arquivo.
 */

import prisma from "../lib/prisma";

async function countOf(label: string, run: () => Promise<number>) {
  try {
    return { [label]: await run() };
  } catch (error) {
    return {
      [label]: null,
      [`${label}_error`]:
        error instanceof Error ? error.name : "UNKNOWN",
    };
  }
}

async function main() {
  const out: Record<string, unknown> = { MODE: "READ_ONLY" };

  /* --- FASE A: snapshot de volume ------------------------------------- */
  Object.assign(
    out,
    await countOf("PRODUCT_TOTAL", () => prisma.product.count()),
    await countOf("MARKETPLACE_OFFER_TOTAL", () => prisma.marketplaceOffer.count()),
    await countOf("PRICE_HISTORY_TOTAL", () => prisma.priceHistory.count()),
    await countOf("RAW_LISTING_TOTAL", () => prisma.rawMarketplaceListing.count()),
    await countOf("IMPORT_RUN_TOTAL", () => prisma.importRun.count()),
    await countOf("IMPORT_BATCH_TOTAL", () => prisma.importBatch.count()),
    await countOf("CATALOG_CUTOVER_ROLLOUT_TOTAL", () =>
      prisma.catalogCutoverRollout.count(),
    ),
    await countOf("CATALOG_CUTOVER_AUTOPILOT_TOTAL", () =>
      prisma.catalogCutoverAutopilot.count(),
    ),
    await countOf("CATALOG_CUTOVER_AUTOPILOT_RUN_TOTAL", () =>
      prisma.catalogCutoverAutopilotRun.count(),
    ),
    await countOf("CATALOG_CUTOVER_STAGE_METRIC_TOTAL", () =>
      prisma.catalogCutoverStageMetric.count(),
    ),
  );

  /* --- Ofertas por marketplace (visibilidade publica) ----------------- */
  try {
    const byMarketplace = await prisma.$queryRaw<
      Array<{ marketplace: string; total: number; active: number; exact: number }>
    >`SELECT marketplace::text AS marketplace,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE active)::int AS active,
             COUNT(*) FILTER (WHERE "matchStatus" = 'EXACT')::int AS exact
        FROM "MarketplaceOffer"
       GROUP BY marketplace::text
       ORDER BY marketplace::text`;
    out.OFFERS_BY_MARKETPLACE = byMarketplace;
  } catch (error) {
    out.OFFERS_BY_MARKETPLACE_ERROR =
      error instanceof Error ? error.name : "UNKNOWN";
  }

  /* --- FASE T: autopilot do Mercado Livre (leitura pura) ---------------- */
  try {
    const autopilot = await prisma.catalogCutoverAutopilot.findMany({
      take: 50,
      orderBy: { updatedAt: "desc" },
    });
    out.ML_AUTOPILOT_ROWS = autopilot.map((row) => ({
      marketplaceId: row.marketplaceId,
      state: row.state,
      stage: row.stage,
      enabled: row.enabled,
      lastDecision: row.lastDecision,
      lastReason: row.lastReason,
      tripReason: row.tripReason,
      trippedAt: row.trippedAt,
      lastRunAt: row.lastRunAt,
      cooldownUntil: row.cooldownUntil,
      updatedAt: row.updatedAt,
    }));
    const ml = autopilot.find((row) => row.marketplaceId === "mercado_livre");
    out.ML_AUTOPILOT_STATE_BEFORE = ml?.state ?? null;
    out.ML_STAGE_BEFORE = ml?.stage ?? null;
    out.ML_ENABLED_BEFORE = ml?.enabled ?? null;
    out.ML_BREAKER_BEFORE = ml?.tripReason ?? null;
    out.ML_TRIPPED_AT_BEFORE = ml?.trippedAt ?? null;
    out.ML_LAST_RUN_AT_BEFORE = ml?.lastRunAt ?? null;

    /* Teto/uso de escritas vivem no StageMetric por (marketplaceId, stage). */
    const stageMetric = ml
      ? await prisma.catalogCutoverStageMetric.findFirst({
          where: { marketplaceId: ml.marketplaceId, stage: ml.stage },
        })
      : null;
    out.ML_MAX_WRITES_BEFORE = stageMetric?.maxWrites ?? null;
    out.ML_USED_WRITES_BEFORE = stageMetric?.usedWrites ?? null;
  } catch (error) {
    out.ML_AUTOPILOT_ERROR = error instanceof Error ? error.name : "UNKNOWN";
  }

  /* --- FASE J: quantos produtos publicos existem hoje ------------------ */
  try {
    const autoActive = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total
        FROM "Product" p
       WHERE p."autoCreated" = true
         AND p.active = true
         AND (
           SELECT COUNT(DISTINCT o.marketplace::text)
             FROM "MarketplaceOffer" o
            WHERE o."productId" = p.id
              AND o.active = true
              AND o."matchStatus" = 'EXACT'
              AND o.available = true
              AND o.status NOT IN ('UNAVAILABLE','ERROR')
              AND o.price > 0
         ) < 2`;
    out.AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES = autoActive[0]?.total ?? null;
  } catch (error) {
    out.AUTO_ACTIVE_LT2_ERROR =
      error instanceof Error ? error.name : "UNKNOWN";
  }

  /* --- FASE S: produtos com ofertas em 2+ marketplaces ------------------ */
  try {
    const multi = await prisma.$queryRaw<
      Array<{ n: number; marketplaces: string }>
    >`
      SELECT COUNT(*)::int AS n, string_agg(DISTINCT marketplaces, ',') AS marketplaces
        FROM (
          SELECT o."productId",
                 COUNT(DISTINCT o.marketplace::text) AS n,
                 string_agg(DISTINCT o.marketplace::text, ',') AS marketplaces
            FROM "MarketplaceOffer" o
           WHERE o.active = true
             AND o."matchStatus" = 'EXACT'
             AND o.available = true
             AND o.price > 0
           GROUP BY o."productId"
        ) t
       WHERE t.n >= 2`;
    out.REAL_MULTISTORE_PRODUCTS = multi[0]?.n ?? 0;
    out.REAL_MULTISTORE_MARKETPLACES = multi[0]?.marketplaces ?? null;
  } catch (error) {
    out.REAL_MULTISTORE_ERROR =
      error instanceof Error ? error.name : "UNKNOWN";
  }

  /* --- FASE S: produto real presente em 2 marketplaces ------------------- */
  try {
    const evidence = await prisma.$queryRaw<
      Array<{
        productId: string;
        name: string;
        marketplaces: string;
        sources: number;
      }>
    >`
      SELECT p.id::text AS "productId",
             p.name       AS name,
             string_agg(DISTINCT o.marketplace::text, ',') AS marketplaces,
             COUNT(DISTINCT o.marketplace::text)::int      AS sources
        FROM "Product" p
        JOIN "MarketplaceOffer" o ON o."productId" = p.id
       WHERE o.active = true
         AND o."matchStatus" = 'EXACT'
         AND o.available = true
         AND o.price > 0
       GROUP BY p.id, p.name
      HAVING COUNT(DISTINCT o.marketplace::text) >= 2
      ORDER BY sources DESC, p.name
      LIMIT 25`;
    out.REAL_CROSS_MARKET_PRODUCT_MATCHES = evidence.length;
    out.REAL_CROSS_MARKET_EVIDENCE = evidence;
  } catch (error) {
    out.REAL_CROSS_MARKET_ERROR =
      error instanceof Error ? error.name : "UNKNOWN";
  }

  /* --- Ofertas SHOPEE ja existentes (legado) --------------------------- */
  try {
    const shopee = await prisma.$queryRaw<
      Array<{ marketplace: string; total: number }>
    >`SELECT marketplace::text AS marketplace, COUNT(*)::int AS total
          FROM "MarketplaceOffer" WHERE marketplace::text = 'SHOPEE'
         GROUP BY marketplace::text`;
    out.SHOPEE_OFFERS_LEGACY = shopee[0]?.total ?? 0;
  } catch {
    out.SHOPEE_OFFERS_LEGACY = null;
  }

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((error) => {
    console.error("SNAPSHOT_FAILED", error instanceof Error ? error.name : "UNKNOWN");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
