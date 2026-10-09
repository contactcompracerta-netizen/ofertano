/**
 * CATALOG_WAVE 1 - FASE M: DRY RUN COMPLETO COM FIXTURES DOS 4 MERCHANTS.
 *
 * Uso: npx tsx src/lib/catalog/runWave1DryRun.ts
 *
 * Garantias desta execução:
 *   - modo DRY_RUN explícito, writeEnabled=false, gateway InMemory
 *   - leitura do banco é APENAS leitura (findMany/count)
 *   - DATABASE_WRITES=0 verificado por writeAttempts do gateway
 *   - contagem de catálogo (antes/depois) idêntica
 *
 * Sai com código != 0 se qualquer invariante quebrar.
 */
import "dotenv/config";
import prisma from "../prisma";
import { WAVE1_FIXTURES, totalFixtureRows } from "./fixtures";
import { CatalogImporterV1 } from "./importer";
import type { CatalogImportFlags } from "./featureFlags";
import { InMemoryStagingStore } from "./staging";
import { InMemoryCatalogGateway } from "./transaction";
import type {
  ExistingOfferRef,
  ExistingProductRef,
  MerchantSlug,
} from "./types";

const EXPECTED_PRODUCTS = 26;
const EXPECTED_OFFERS = 55;

interface MerchantMetrics {
  merchant: MerchantSlug;
  items: number;
  createProducts: number;
  matchProducts: number;
  createOffers: number;
  updateOffers: number;
  unchanged: number;
  review: number;
  reject: number;
  duplicates: number;
  valid: number;
  partial: number;
  invalid: number;
  identityA: number;
  identityB: number;
  identityC: number;
  identityD: number;
}

function fail(message: string): never {
  console.error(`DRY_RUN_FAIL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  try {
    const productCountBefore = await prisma.product.count();
    const offerCountBefore = await prisma.marketplaceOffer.count();

    // Snapshot somente-leitura do catálogo existente (matcher + plan).
    const productRows = await prisma.product.findMany({
      select: {
        id: true,
        name: true,
        brand: true,
        gtin: true,
        ean: true,
        mpn: true,
        modelNumber: true,
        category: true,
      },
      take: 500,
    });
    const existingProducts: ExistingProductRef[] = productRows;

    const offerRows = await prisma.marketplaceOffer.findMany({
      select: {
        id: true,
        productId: true,
        externalId: true,
        price: true,
        active: true,
        marketplace: true,
      },
      take: 2000,
    });
    const existingOffers: ExistingOfferRef[] = offerRows.map((o) => ({
      id: o.id,
      productId: o.productId,
      merchant: o.marketplace,
      externalId: o.externalId ?? "",
      price: o.price,
      active: o.active,
    }));

    const flags: CatalogImportFlags = {
      catalogImportEnabled: true,
      awinWave1Enabled: true,
      awinWave1WriteEnabled: false,
      awinWave1LiveEnabled: false,
      mode: "DRY_RUN",
    };

    const gateway = new InMemoryCatalogGateway();
    const stagingStore = new InMemoryStagingStore();
    const importer = new CatalogImporterV1({
      flags,
      stagingStore,
      gateway,
      existingProducts,
      existingOffers,
    });

    console.log("=== CATALOG_WAVE1 FASE M - DRY RUN (fixtures sintéticas) ===");

    const allMetrics: MerchantMetrics[] = [];

    for (const fixture of WAVE1_FIXTURES) {
      const result = await importer.run(fixture.rows, fixture.merchant);
      const counters = result.plan.counters;

      const metrics: MerchantMetrics = {
        merchant: fixture.merchant,
        items: result.plan.items.length,
        createProducts: counters.wouldCreateProducts,
        matchProducts: counters.wouldMatchProducts,
        createOffers: counters.wouldCreateOffers,
        updateOffers: counters.wouldUpdateOffers,
        unchanged: counters.wouldRemainUnchanged,
        review: counters.wouldReview,
        reject: counters.wouldReject,
        duplicates: result.plan.duplicateExternalIds,
        valid: countBy(result, "validationStatus", "VALID"),
        partial: countBy(result, "validationStatus", "PARTIAL"),
        invalid: countBy(result, "validationStatus", "INVALID"),
        identityA: countBy(result, "identityLevel", "A"),
        identityB: countBy(result, "identityLevel", "B"),
        identityC: countBy(result, "identityLevel", "C"),
        identityD: countBy(result, "identityLevel", "D"),
      };
      allMetrics.push(metrics);

      console.log(
        [
          `MERCHANT=${metrics.merchant}`,
          `MODE=${result.mode}`,
          `items=${metrics.items}`,
          `wouldCreateProducts=${metrics.createProducts}`,
          `wouldMatchProducts=${metrics.matchProducts}`,
          `wouldCreateOffers=${metrics.createOffers}`,
          `wouldUpdateOffers=${metrics.updateOffers}`,
          `wouldRemainUnchanged=${metrics.unchanged}`,
          `wouldReview=${metrics.review}`,
          `wouldReject=${metrics.reject}`,
          `duplicates=${metrics.duplicates}`,
          `valid=${metrics.valid}`,
          `partial=${metrics.partial}`,
          `invalid=${metrics.invalid}`,
          `identityA=${metrics.identityA}`,
          `identityB=${metrics.identityB}`,
          `identityC=${metrics.identityC}`,
          `identityD=${metrics.identityD}`,
        ].join(" "),
      );

      if (result.apply !== null) {
        fail(`DRY_RUN retornou apply != null (modo ${result.mode})`);
      }
    }

    const productCountAfter = await prisma.product.count();
    const offerCountAfter = await prisma.marketplaceOffer.count();
    const stagingRows = await stagingStore.count();
    const databaseWrites = gateway.writeAttempts;

    const totalItems = allMetrics.reduce((a, m) => a + m.items, 0);
    const totals = allMetrics.reduce(
      (acc, m) => {
        acc.create += m.createProducts;
        acc.match += m.matchProducts;
        acc.createOffers += m.createOffers;
        acc.updateOffers += m.updateOffers;
        acc.unchanged += m.unchanged;
        acc.review += m.review;
        acc.reject += m.reject;
        return acc;
      },
      { create: 0, match: 0, createOffers: 0, updateOffers: 0, unchanged: 0, review: 0, reject: 0 },
    );

    console.log(
      `TOTAL items=${totalItems} wouldCreateProducts=${totals.create} ` +
        `wouldMatchProducts=${totals.match} wouldCreateOffers=${totals.createOffers} ` +
        `wouldUpdateOffers=${totals.updateOffers} wouldRemainUnchanged=${totals.unchanged} ` +
        `wouldReview=${totals.review} wouldReject=${totals.reject}`,
    );
    console.log(`FIXTURE_ROWS_INPUT=${totalFixtureRows()}`);
    console.log(`STAGING_ROWS=${stagingRows}`);
    console.log(`PRODUCT_COUNT_BEFORE=${productCountBefore}`);
    console.log(`PRODUCT_COUNT_AFTER=${productCountAfter}`);
    console.log(`OFFER_COUNT_BEFORE=${offerCountBefore}`);
    console.log(`OFFER_COUNT_AFTER=${offerCountAfter}`);
    console.log(`DATABASE_WRITES=${databaseWrites}`);

    const catalogChanged =
      productCountBefore !== productCountAfter ||
      offerCountBefore !== offerCountAfter;
    console.log(`CATALOG_CHANGED=${catalogChanged ? "YES" : "NO"}`);

    if (databaseWrites !== 0) {
      fail(`DATABASE_WRITES=${databaseWrites} (esperado 0)`);
    }
    if (productCountBefore !== EXPECTED_PRODUCTS) {
      fail(`PRODUCT_COUNT_BEFORE=${productCountBefore} (esperado ${EXPECTED_PRODUCTS})`);
    }
    if (productCountAfter !== EXPECTED_PRODUCTS) {
      fail(`PRODUCT_COUNT_AFTER=${productCountAfter} (esperado ${EXPECTED_PRODUCTS})`);
    }
    if (offerCountBefore !== EXPECTED_OFFERS) {
      fail(`OFFER_COUNT_BEFORE=${offerCountBefore} (esperado ${EXPECTED_OFFERS})`);
    }
    if (offerCountAfter !== EXPECTED_OFFERS) {
      fail(`OFFER_COUNT_AFTER=${offerCountAfter} (esperado ${EXPECTED_OFFERS})`);
    }
    if (catalogChanged) {
      fail("CATALOG_CHANGED=YES");
    }
    // Idempotência do staging: 19 linhas de input, 1 duplicada => 18 chaves.
    const expectedStaging = totalFixtureRows() - 1;
    if (stagingRows !== expectedStaging) {
      fail(`STAGING_ROWS=${stagingRows} (esperado ${expectedStaging})`);
    }

    console.log("DRY_RUN_STATUS=PASS");
  } finally {
    await prisma.$disconnect();
  }
}

function countBy(
  result: { plan: { items: Array<{ validationStatus: string; identityLevel: string }> } },
  field: "validationStatus" | "identityLevel",
  value: string,
): number {
  return result.plan.items.filter((i) => i[field] === value).length;
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (err) {
    console.error("DRY_RUN_FAIL:", err);
    process.exit(1);
  }
})();
