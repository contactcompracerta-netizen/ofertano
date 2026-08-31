import type { CanonicalOffer, CanonicalProduct } from "./types";

export function usableEquivalentOffers(product: CanonicalProduct): CanonicalOffer[] {
  if (product.rankTier >= 3) {
    return [];
  }

  return product.offers.filter(
    (offer) =>
      Boolean(offer.title.trim()) &&
      Boolean(offer.url.trim()) &&
      Number.isFinite(offer.price) &&
      offer.price > 0,
  );
}

export function countDistinctMarketplaces(offers: CanonicalOffer[]): number {
  return new Set(offers.map((offer) => offer.marketplace)).size;
}

export function isPublicationAllowed(product: CanonicalProduct): boolean {
  const offers = usableEquivalentOffers(product);
  const distinctStoreCount = countDistinctMarketplaces(offers);

  if (distinctStoreCount === 0) {
    return false;
  }

  const coverageStatus = product.coverageStatus ?? "INCOMPLETE";

  return (
    distinctStoreCount >= 2 ||
    (distinctStoreCount === 1 && coverageStatus === "COMPLETE")
  );
}

export function isSearchVisible(product: CanonicalProduct): boolean {
  return isPublicationAllowed(product);
}

export function isClusterPublishable(product: CanonicalProduct): boolean {
  return isPublicationAllowed(product);
}

export function publicationStatusForProduct(
  product: CanonicalProduct,
): "LIVE_COMPLETE" | "LIVE_PARTIAL" | "DRAFT" {
  if (!isPublicationAllowed(product)) {
    return "DRAFT";
  }

  const coverageStatus = product.coverageStatus ?? "INCOMPLETE";
  const distinctStoreCount = countDistinctMarketplaces(
    usableEquivalentOffers(product),
  );

  if (coverageStatus === "COMPLETE" && distinctStoreCount >= 2) {
    return "LIVE_COMPLETE";
  }

  if (distinctStoreCount >= 2) {
    return "LIVE_PARTIAL";
  }

  return coverageStatus === "COMPLETE" ? "LIVE_COMPLETE" : "DRAFT";
}
