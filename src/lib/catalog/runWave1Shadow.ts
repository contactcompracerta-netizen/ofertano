/**
 * CATALOG_WAVE 1 — SHADOW REAL AWIN.
 *
 * Requisitos de ambiente:
 *   CATALOG_IMPORT_ENABLED=true
 *   AWIN_WAVE1_ENABLED=true
 *   AWIN_WAVE1_STAGING_WRITE_ENABLED=true
 *   CATALOG_IMPORT_MODE=SHADOW
 *   AWIN_DATAFEED_API_KEY=<chave de Product Feed, não Partner API token>
 *
 * Por merchant:
 *   AWIN_KABUM_ADVERTISER_ID
 *   AWIN_KABUM_FEED_ID (opcional se houver um único feed)
 *   AWIN_CAMA_IN_BOX_ADVERTISER_ID
 *   AWIN_CAMA_IN_BOX_FEED_ID
 *   AWIN_OLYMPIKUS_ADVERTISER_ID
 *   AWIN_OLYMPIKUS_FEED_ID
 *   AWIN_LEVEROS_ADVERTISER_ID
 *   AWIN_LEVEROS_FEED_ID
 *
 * O modo SHADOW pode escrever SOMENTE CatalogImportStagingItem.
 * Product e MarketplaceOffer são auditados antes/depois e DEVEM permanecer
 * idênticos. Qualquer alteração aborta com status FAIL.
 */
import "dotenv/config";

import prisma from "../prisma";
import {
  downloadAwinFeedRows,
  fetchAwinFeedList,
  selectAwinFeed,
} from "./awinFeedSource";
import { readCatalogImportFlags, isStagingWriteEnabled } from "./featureFlags";
import { CatalogImporterV1 } from "./importer";
import { PrismaStagingStore } from "./prismaStaging";
import { NoWriteGateway } from "./transaction";
import type {
  ExistingOfferRef,
  ExistingProductRef,
  MerchantSlug,
} from "./types";

interface MerchantEnv {
  slug: MerchantSlug;
  advertiserKey: string;
  feedKey: string;
}

const MERCHANTS: readonly MerchantEnv[] = [
  {
    slug: "kabum",
    advertiserKey: "AWIN_KABUM_ADVERTISER_ID",
    feedKey: "AWIN_KABUM_FEED_ID",
  },
  {
    slug: "cama-in-box",
    advertiserKey: "AWIN_CAMA_IN_BOX_ADVERTISER_ID",
    feedKey: "AWIN_CAMA_IN_BOX_FEED_ID",
  },
  {
    slug: "olympikus",
    advertiserKey: "AWIN_OLYMPIKUS_ADVERTISER_ID",
    feedKey: "AWIN_OLYMPIKUS_FEED_ID",
  },
  {
    slug: "leveros",
    advertiserKey: "AWIN_LEVEROS_ADVERTISER_ID",
    feedKey: "AWIN_LEVEROS_FEED_ID",
  },
];

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function merchantFromMarketplace(value: string): MerchantSlug | null {
  if (value === "KABUM") return "kabum";
  return null;
}

function countersLine(
  merchant: string,
  result: Awaited<ReturnType<CatalogImporterV1["run"]>>,
): string {
  const c = result.plan.counters;
  return [
    `MERCHANT=${merchant}`,
    `items=${result.plan.items.length}`,
    `wouldCreateProducts=${c.wouldCreateProducts}`,
    `wouldMatchProducts=${c.wouldMatchProducts}`,
    `wouldCreateOffers=${c.wouldCreateOffers}`,
    `wouldUpdateOffers=${c.wouldUpdateOffers}`,
    `wouldRemainUnchanged=${c.wouldRemainUnchanged}`,
    `wouldReview=${c.wouldReview}`,
    `wouldReject=${c.wouldReject}`,
    `duplicates=${result.plan.duplicateExternalIds}`,
  ].join(" ");
}

async function main(): Promise<void> {
  const flags = readCatalogImportFlags();
  if (flags.mode !== "SHADOW") {
    throw new Error(`SHADOW_MODE_REQUIRED: got ${flags.mode}`);
  }
  if (!isStagingWriteEnabled(flags)) {
    throw new Error("SHADOW_STAGING_WRITE_BLOCKED");
  }
  if (flags.awinWave1WriteEnabled || flags.awinWave1LiveEnabled) {
    throw new Error("SHADOW_CATALOG_WRITE_FLAGS_MUST_BE_OFF");
  }

  const apiKey = process.env.AWIN_DATAFEED_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("AWIN_DATAFEED_API_KEY_MISSING");
  }

  const maxRows = intEnv("AWIN_WAVE1_SHADOW_MAX_ROWS", 500, 1, 5000);
  const maxBytes = intEnv(
    "AWIN_WAVE1_MAX_DOWNLOAD_BYTES",
    64 * 1024 * 1024,
    1024 * 1024,
    256 * 1024 * 1024,
  );
  const runId =
    process.env.AWIN_WAVE1_RUN_ID?.trim() ||
    `awin-shadow-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const productCountBefore = await prisma.product.count();
  const offerCountBefore = await prisma.marketplaceOffer.count();
  const stagingCountBefore = await prisma.catalogImportStagingItem.count();

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
    take: 10_000,
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
    take: 20_000,
  });
  const existingOffers: ExistingOfferRef[] = offerRows.flatMap((offer) => {
    const merchant = merchantFromMarketplace(offer.marketplace);
    if (!merchant) return [];
    return [
      {
        id: offer.id,
        productId: offer.productId,
        merchant,
        externalId: offer.externalId ?? "",
        price: offer.price,
        active: offer.active,
      },
    ];
  });

  const feeds = await fetchAwinFeedList(apiKey, { maxBytes: 8 * 1024 * 1024 });
  if (feeds.length === 0) {
    throw new Error("AWIN_FEED_LIST_EMPTY");
  }

  const stagingStore = new PrismaStagingStore(prisma);
  const blocked: string[] = [];
  let processed = 0;

  for (const merchant of MERCHANTS) {
    const advertiserId = process.env[merchant.advertiserKey]?.trim();
    const feedId = process.env[merchant.feedKey]?.trim();

    if (!advertiserId) {
      blocked.push(`${merchant.slug}:MISSING_ADVERTISER_ID`);
      console.log(`MERCHANT=${merchant.slug} STATUS=BLOCKED REASON=MISSING_ADVERTISER_ID`);
      continue;
    }

    const feed = selectAwinFeed(feeds, advertiserId, feedId);
    const rows = await downloadAwinFeedRows(feed, {
      maxRows,
      maxBytes,
      timeoutMs: 60_000,
    });

    if (rows.length === 0) {
      blocked.push(`${merchant.slug}:EMPTY_FEED_SAMPLE`);
      console.log(`MERCHANT=${merchant.slug} STATUS=BLOCKED REASON=EMPTY_FEED_SAMPLE`);
      continue;
    }

    const importer = new CatalogImporterV1({
      flags,
      stagingStore,
      gateway: new NoWriteGateway(),
      existingProducts,
      existingOffers,
      runId,
    });
    const result = await importer.run(rows, merchant.slug);
    if (result.apply !== null) {
      throw new Error(`SHADOW_APPLY_MUST_BE_NULL:${merchant.slug}`);
    }

    processed += 1;
    console.log(countersLine(merchant.slug, result));
  }

  const productCountAfter = await prisma.product.count();
  const offerCountAfter = await prisma.marketplaceOffer.count();
  const stagingCountAfter = await prisma.catalogImportStagingItem.count();

  console.log(`RUN_ID=${runId}`);
  console.log(`PRODUCT_COUNT_BEFORE=${productCountBefore}`);
  console.log(`PRODUCT_COUNT_AFTER=${productCountAfter}`);
  console.log(`OFFER_COUNT_BEFORE=${offerCountBefore}`);
  console.log(`OFFER_COUNT_AFTER=${offerCountAfter}`);
  console.log(`STAGING_COUNT_BEFORE=${stagingCountBefore}`);
  console.log(`STAGING_COUNT_AFTER=${stagingCountAfter}`);
  console.log("PRODUCT_WRITES=0");
  console.log("OFFER_WRITES=0");
  console.log(`MERCHANTS_PROCESSED=${processed}`);
  console.log(`MERCHANTS_BLOCKED=${blocked.length}`);

  if (
    productCountBefore !== productCountAfter ||
    offerCountBefore !== offerCountAfter
  ) {
    throw new Error("CATALOG_CHANGED_DURING_SHADOW");
  }

  if (processed === 0) {
    throw new Error(
      `SHADOW_BLOCKED_NO_CONFIGURED_MERCHANTS:${blocked.join(",")}`,
    );
  }

  console.log(blocked.length > 0 ? "SHADOW_STATUS=PARTIAL" : "SHADOW_STATUS=PASS");
}

void main()
  .catch((error) => {
    console.error(
      "SHADOW_STATUS=BLOCKED",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 2;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
