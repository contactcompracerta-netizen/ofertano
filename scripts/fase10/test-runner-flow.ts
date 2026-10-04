import prisma from "@/lib/prisma";
import { createMagaluConnector } from "@/services/architecture/v1/connectors/magaluConnector";
import { createPrismaPublicOfferCommitter } from "@/services/architecture/v1/publicSync/offerWriter";
import { createBlockingKeyLookup, createKnownBindingLookup, createProductListingLoader, evaluateIdentityConfidence } from "@/services/architecture/v1/publicSync/prismaDeps";
import { resolvePurchaseLinks } from "@/services/architecture/v1/publicSync/purchaseLinks";
import { magaluPublicSyncConfig } from "@/services/architecture/v1/publicSync/connectors/magaluPublicSync";
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
  console.log("=== TESTE FLUXO COMPLETO DO RUNNER (1 binding) ===\n");

  const config = magaluPublicSyncConfig({ maxListings: 1 });
  const deps = {
    keys: createBlockingKeyLookup(prisma),
    knownBindings: createKnownBindingLookup(prisma),
    products: createProductListingLoader(prisma),
    evaluate: evaluateIdentityConfidence,
    commit: createPrismaPublicOfferCommitter(prisma),
  };
  const dryRun = false;

  // Get certified bindings
  const certified = await deps.knownBindings.listCertified(config.marketplaceId);
  console.log(`Certified: ${certified.length}`);

  // Test first binding
  const binding = certified[0];
  console.log(`\n--- Testing ${binding.externalId} ---`);

  // fetchByExternalId
  type CandidateConnector = {
    fetchByExternalId?: (id: string) => Promise<unknown>;
    rawPayloadFor?: (id: string) => unknown;
  };

  const fetchKnown = (connector: CandidateConnector) =>
    typeof connector.fetchByExternalId === "function"
      ? (id: string) => connector.fetchByExternalId!(id)
      : null;

  const readRaw = (connector: CandidateConnector) =>
    typeof connector.rawPayloadFor === "function"
      ? (id: string) => connector.rawPayloadFor!(id)
      : null;

  const listing = await fetchKnown(config.connector)(binding.externalId);
  if (!listing) {
    console.log("  fetchByExternalId returned null");
    await prisma.$disconnect();
    return;
  }
  console.log(`  listing fetched: price=${listing.commerce.price}`);

  // Validate
  const validationErrors = config.connector.validate(listing);
  if (validationErrors.length > 0) {
    console.log(`  validation errors: ${validationErrors.join(", ")}`);
    await prisma.$disconnect();
    return;
  }

  // Get raw payload
  const rawPayload = readRaw(config.connector)(listing.externalListingId);
  const links = rawPayload === null || rawPayload === undefined
    ? { affiliateLink: null, sourceUrl: null, affiliateState: "MISSING", sourceState: "MISSING", affiliateReason: "RAW_PAYLOAD_UNAVAILABLE", sourceReason: "RAW_PAYLOAD_UNAVAILABLE", hasAffiliateLink: false }
    : resolvePurchaseLinks(config.purchaseLinks.extract(rawPayload));

  console.log(`  links: affiliate=${links.affiliateLink} (${links.affiliateState}), source=${links.sourceUrl} (${links.sourceState})`);

  // Build draft
  const draft = toOfferDraft(listing, binding.productId, links, binding.externalId);
  console.log(`  draft: price=${draft.price}, externalId=${draft.externalId}`);

  // Commit
  console.log(`\n  --- Commit (dryRun=${dryRun}) ---`);
  try {
    const result = await deps.commit.commit(draft, { dryRun, mode: "REFRESH" });
    console.log(`  SUCCESS: ${JSON.stringify(result, null, 2)}`);
  } catch (e) {
    console.log(`  ERROR: ${String(e).slice(0, 300)}`);
  }

  await prisma.$disconnect();
}

main().catch(e => console.error(e));
