import prisma from "@/lib/prisma";
import { createMagaluConnector } from "@/services/architecture/v1/connectors/magaluConnector";
import { createPrismaPublicOfferCommitter } from "@/services/architecture/v1/publicSync/offerWriter";
import { resolvePurchaseLinks } from "@/services/architecture/v1/publicSync/purchaseLinks";
import type { NormalizedMarketplaceListingV1 } from "@/services/architecture/v1/types/normalizedListingV1";

// inlined from runner.ts
function toOfferDraft(
  listing: NormalizedMarketplaceListingV1,
  productId: string,
  links: ReturnType<typeof resolvePurchaseLinks>,
  externalId?: string,
) {
  return {
    marketplaceId: listing.marketplaceId,
    productId,
    externalId: externalId ?? listing.externalListingId,
    title: listing.catalog.title,
    seller: typeof listing.seller.name === "string" ? listing.seller.name : null,
    image: listing.catalog.primaryImageUrl ?? listing.catalog.images[0] ?? null,
    price: listing.commerce.price,
    sourceUrl: links.sourceUrl,
    affiliateLink: links.affiliateLink,
    available: listing.commerce.availability === "IN_STOCK",
    matchStatus: "EXACT",
    discoverySource: "API",
  };
}

async function main() {
  console.log("=== TESTE DIRETO DE COMMIT ===\n");

  const connector = createMagaluConnector();
  const committer = createPrismaPublicOfferCommitter(prisma);

  // Test with FONE_BT (ee0gdc22g3) - should work
  console.log("--- Testing ee0gdc22g3 ---");
  const listing = await connector.fetchByExternalId("ee0gdc22g3");
  if (!listing) {
    console.log("  fetchByExternalId returned null");
    await prisma.$disconnect();
    return;
  }

  console.log(`  listing.price = ${listing.commerce.price}`);
  console.log(`  listing.available = ${listing.commerce.availability}`);
  console.log(`  listing.title = ${listing.catalog.title}`);

  // Get raw payload for links
  const raw = connector.rawPayloadFor("ee0gdc22g3");
  console.log(`  raw payload: ${raw ? "present" : "null"}`);
  if (raw) {
    const { requestedUrl, finalUrl } =
      raw as { requestedUrl: string; finalUrl: string };
    console.log(`    requestedUrl (affiliate): ${requestedUrl}`);
    console.log(`    finalUrl (source): ${finalUrl}`);
  }

  // Resolve links
  const links = resolvePurchaseLinks({
    affiliateLink: raw
      ? (raw as { requestedUrl: string }).requestedUrl
      : null,
    sourceUrl: raw ? (raw as { finalUrl: string }).finalUrl : null,
  });
  console.log(`  resolved affiliateLink: ${links.affiliateLink} (${links.affiliateState})`);
  console.log(`  resolved sourceUrl: ${links.sourceUrl} (${links.sourceState})`);

  // Create draft
  const draft = toOfferDraft(listing, "1e515132-e3b8-4ac4-a2d3-30f3e4f8c636", links, "ee0gdc22g3");
  console.log(`  draft.price = ${draft.price}`);
  console.log(`  draft.externalId = ${draft.externalId}`);
  console.log(`  draft.productId = ${draft.productId}`);

  // Try commit in dryRun
  console.log("\n  --- Dry-run commit ---");
  try {
    const result = await committer.commit(draft, { dryRun: true, mode: "REFRESH" });
    console.log(`  Result: ${JSON.stringify(result, null, 2)}`);
  } catch (e) {
    console.log(`  ERROR: ${String(e).slice(0, 300)}`);
  }

  // Try commit for real (APPLY)
  console.log("\n  --- Real commit (APPLY) ---");
  try {
    const result = await committer.commit(draft, { dryRun: false, mode: "REFRESH" });
    console.log(`  Result: ${JSON.stringify(result, null, 2)}`);
  } catch (e) {
    console.log(`  ERROR: ${String(e).slice(0, 300)}`);
  }

  // Check existing offer in DB
  console.log("\n  --- Existing offer in DB ---");
  const existing = await prisma.marketplaceOffer.findFirst({
    where: { marketplace: "MAGAZINE_LUIZA", externalId: "ee0gdc22g3" },
    select: { id: true, productId: true, externalId: true, price: true, affiliateLink: true, sourceUrl: true, status: true, matchStatus: true },
  });
  console.log(`  ${JSON.stringify(existing, null, 2)}`);

  await prisma.$disconnect();
}

main().catch(e => console.error(e));
