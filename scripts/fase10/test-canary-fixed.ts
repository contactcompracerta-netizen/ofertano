import prisma from "@/lib/prisma";
import { runMarketplacePublicSync } from "@/services/architecture/v1/publicSync/runner";
import { createPrismaPublicOfferCommitter } from "@/services/architecture/v1/publicSync/offerWriter";
import {
  createBlockingKeyLookup,
  createKnownBindingLookup,
  createProductListingLoader,
  evaluateIdentityConfidence,
} from "@/services/architecture/v1/publicSync/prismaDeps";
import { magaluPublicSyncConfig } from "@/services/architecture/v1/publicSync/connectors/magaluPublicSync";
import { authorizePublicSync } from "@/services/architecture/v1/publicSync/flags";
import { readShadowFlags } from "@/services/architecture/v1/shadow/flags";
import { publicationWeightFor } from "@/services/architecture/v1/publication/shadowWeight";

async function snapshot() {
  const rows = await prisma.$queryRaw<
    Array<{
      products: number;
      offers: number;
      magalu_offers: number;
      auto_active_lt2: number;
      blocking_keys: number;
    }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM "Product") AS "products",
      (SELECT COUNT(*)::int FROM "MarketplaceOffer") AS "offers",
      (SELECT COUNT(*)::int FROM "MarketplaceOffer" WHERE marketplace = 'MAGAZINE_LUIZA') AS "magalu_offers",
      (SELECT COUNT(*)::int FROM "CandidateBlockingKey") AS "blocking_keys",
      (
        SELECT COUNT(*)::int FROM "Product" p
         WHERE p."autoCreated" = true AND p.active = true
           AND (
             SELECT COUNT(DISTINCT o.marketplace) FROM "MarketplaceOffer" o
              WHERE o."productId" = p.id AND o.active = true
                AND o."matchStatus" = 'EXACT' AND o.available = true
                AND o.price > 0 AND o.status <> 'UNAVAILABLE' AND o.status <> 'ERROR'
           ) < 2
      ) AS "auto_active_lt2"`;
  const row = rows[0];
  return {
    PRODUCTS: row.products,
    OFFERS: row.offers,
    MAGALU_OFFERS: row.magalu_offers,
    BLOCKING_KEYS: row.blocking_keys,
    AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES: row.auto_active_lt2,
  };
}

async function main() {
  const APPLY = true;
  const LIMIT = 1;

  const authorization = authorizePublicSync("magazine_luiza");
  if (!authorization.authorized) {
    console.log("NOT AUTHORIZED:", authorization.reason);
    process.exitCode = 1;
    return;
  }

  const shadow = readShadowFlags();
  const magaluWeight = publicationWeightFor("magazine_luiza", shadow);
  const globalCutover = process.env.CATALOG_V1_GLOBAL_CUTOVER === "true";

  const before = await snapshot();

  const config = magaluPublicSyncConfig({
    maxListings: LIMIT,
    brandLexicon: new Set<string>(),
  });

  const startedAt = new Date().toISOString();
  const report = await runMarketplacePublicSync(
    config,
    {
      keys: createBlockingKeyLookup(prisma),
      knownBindings: createKnownBindingLookup(prisma),
      products: createProductListingLoader(prisma),
      evaluate: evaluateIdentityConfidence,
      writer: createPrismaPublicOfferCommitter(prisma),
    },
    { dryRun: !APPLY, maxListings: LIMIT },
  );

  const finishedAt = new Date().toISOString();
  const after = await snapshot();

  const output = {
    MODE: APPLY ? "APPLY" : "DRY_RUN",
    STARTED_AT: startedAt,
    FINISHED_AT: finishedAt,
    MAGALU_PUBLICATION_WEIGHT: magaluWeight,
    GLOBAL_CUTOVER: globalCutover ? "YES" : "NO",
    REPORT: report,
    SNAPSHOT_BEFORE: before,
    SNAPSHOT_AFTER: after,
    SNAPSHOT_DELTA: {
      PRODUCTS: after.PRODUCTS - before.PRODUCTS,
      OFFERS: after.OFFERS - before.OFFERS,
      MAGALU_OFFERS: after.MAGALU_OFFERS - before.MAGALU_OFFERS,
      BLOCKING_KEYS: after.BLOCKING_KEYS - before.BLOCKING_KEYS,
      AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES:
        after.AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES -
        before.AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(async (e) => {
  console.error(JSON.stringify({ FATAL: String(e).slice(0, 400) }, null, 2));
  process.exitCode = 1;
});
