import type {
  CanonicalOffer,
  CanonicalProduct,
  ProductCluster,
} from "./types";
import type { MarketplaceCode } from "./types";

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

export function canonicalizeCluster(
  cluster: ProductCluster,
): CanonicalProduct | null {
  const byMarketplace = new Map<string, CanonicalOffer>();

  for (const member of cluster.members) {
    const raw = member.candidate.normalized.raw;
    const price = raw.price;
    const url = raw.url.trim();
    const image = raw.image?.trim() || "";
    const title = raw.title.trim();

    if (!url || !title || price == null || !Number.isFinite(price) || price <= 0) {
      continue;
    }

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
      affiliateLink: raw.affiliateLink,
      attributes: raw.attributes,
      seller: raw.seller,
    };

    const current = byMarketplace.get(raw.marketplace);
    if (!current) {
      byMarketplace.set(raw.marketplace, offer);
      continue;
    }

    const currentScore = completeness(current);
    const nextScore = completeness(offer);
    if (
      nextScore > currentScore ||
      (nextScore === currentScore && offer.price < current.price)
    ) {
      byMarketplace.set(raw.marketplace, offer);
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
