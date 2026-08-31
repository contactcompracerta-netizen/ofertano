import type {
  CanonicalOffer,
  CanonicalProduct,
  ProductCluster,
} from "./types";
import type { MarketplaceCode } from "./types";
import {
  affiliateRank,
  classifyListingAffiliate,
  traceAffiliateAssessment,
} from "./affiliateEligibility";
import { clusterRankTier } from "./rank";

function completeness(offer: {
  image: string | null;
  price: number | null;
  url: string;
  affiliateLink: string | null;
}): number {
  return (
    Number(Boolean(offer.image?.trim())) * 3 +
    Number(offer.price !== null && offer.price > 0) * 3 +
    Number(Boolean(offer.url.trim())) * 2 +
    Number(Boolean(offer.affiliateLink?.trim()))
  );
}

function preferOffer(
  current: CanonicalOffer,
  next: CanonicalOffer,
): CanonicalOffer {
  if (
    current.marketplace === "MERCADO_LIVRE" &&
    next.marketplace === "MERCADO_LIVRE"
  ) {
    const currentRank = affiliateRank(current.affiliateStatus);
    const nextRank = affiliateRank(next.affiliateStatus);
    if (nextRank !== currentRank) {
      return nextRank > currentRank ? next : current;
    }
  }

  const currentScore = completeness(current);
  const nextScore = completeness(next);
  if (
    nextScore > currentScore ||
    (nextScore === currentScore && next.price < current.price)
  ) {
    return next;
  }

  return current;
}

export function canonicalizeCluster(
  cluster: ProductCluster,
): CanonicalProduct | null {
  const byMarketplace = new Map<string, CanonicalOffer>();

  for (const member of cluster.members) {
    const raw = member.candidate.normalized.raw;
    const price = raw.price;
    const url = raw.url?.trim() ?? "";
    const image = raw.image?.trim() || "";
    const title = raw.title.trim();

    if (!url || !title || price == null || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    const assessment = classifyListingAffiliate({
      marketplace: raw.marketplace,
      sourceUrl: url,
      affiliateLink: raw.affiliateLink,
      declaredStatus: raw.affiliateStatus,
    });
    raw.affiliateLink = assessment.affiliateLink;
    raw.affiliateStatus = assessment.status;

    const offer: CanonicalOffer = {
      marketplace: raw.marketplace,
      marketplaceName: raw.marketplaceName,
      externalId: raw.externalId,
      title,
      url,
      image,
      price,
      oldPrice: null,
      brand: raw.brand,
      affiliateLink: assessment.affiliateLink,
      affiliateStatus: assessment.status,
      attributes: raw.attributes,
      seller: raw.seller,
    };

    const current = byMarketplace.get(raw.marketplace);
    const selected = current ? preferOffer(current, offer) : offer;
    byMarketplace.set(raw.marketplace, selected);

    if (raw.marketplace === "MERCADO_LIVRE") {
      traceAffiliateAssessment({
        marketplace: raw.marketplace,
        externalId: raw.externalId,
        sourceUrl: url,
        affiliateLink: assessment.affiliateLink,
        status: assessment.status,
        fallbackAttempt: Boolean(current),
        selectedForCluster: selected.externalId === offer.externalId,
        reason: assessment.reason,
      });
    }
  }

  const offers = Array.from(byMarketplace.values()).sort(
    (first, second) => first.price - second.price,
  );

  if (offers.length === 0) {
    return null;
  }

  const withImage = offers.find((offer) => offer.image) ?? offers[0]!;
  const cheapest = offers[0]!;
  const title =
    [...offers].sort((first, second) => second.title.length - first.title.length)[0]!.title;

  return {
    clusterId: cluster.clusterId,
    title,
    image: withImage.image,
    description: null,
    brand: cluster.identity.brand.value,
    price: cheapest.price,
    oldPrice: cheapest.oldPrice,
    primaryMarketplace: cheapest.marketplaceName,
    offers,
    marketplaces: offers.map((offer) => offer.marketplace),
    confidence: cluster.confidence,
    rankTier: clusterRankTier(cluster.members.map((member) => member.candidate)),
  };
}

export function marketplaceLabel(code: MarketplaceCode): string {
  switch (code) {
    case "MERCADO_LIVRE":
      return "Mercado Livre";
    case "AMAZON":
      return "Amazon";
    case "SHOPEE":
      return "Shopee";
    case "MAGAZINE_LUIZA":
      return "Magazine Luiza";
    case "ALIEXPRESS":
      return "AliExpress";
    default:
      return code;
  }
}
