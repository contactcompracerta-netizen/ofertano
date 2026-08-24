import type { ProductImport } from "@/services/importers/core/types";
import { saveProduct } from "@/services/database/saveProduct";

import type { CanonicalOffer, CanonicalProduct, MarketplaceCode } from "./types";
import { marketplaceLabel } from "./canonicalize";

function toMarketplaceName(code: MarketplaceCode): ProductImport["marketplace"] {
  return marketplaceLabel(code) as ProductImport["marketplace"];
}

function toProductImport(
  offer: CanonicalOffer,
  fallbackImage = "",
): ProductImport | null {
  const image = offer.image.trim() || fallbackImage.trim();
  if (!image) {
    return null;
  }

  return {
    marketplace: toMarketplaceName(offer.marketplace),
    externalId: offer.externalId,
    url: offer.url,
    affiliateLink: offer.affiliateLink,
    title: offer.title,
    description: null,
    brand: offer.brand,
    category: null,
    image,
    images: [image],
    price: offer.price,
    oldPrice: offer.oldPrice,
    discount: null,
    installments: null,
    rating: null,
    reviews: null,
    sales: null,
    stock: null,
    seller: offer.seller,
    attributes: offer.attributes,
  };
}

export async function persistCanonicalProducts(
  query: string,
  products: CanonicalProduct[],
): Promise<string[]> {
  const ids: string[] = [];

  for (const product of products) {
    const imports = product.offers
      .map((offer) => toProductImport(offer, product.image))
      .filter((item): item is ProductImport => item !== null);

    if (imports.length === 0) {
      ids.push("");
      continue;
    }

    try {
      const [first, ...rest] = imports;
      const saved = await saveProduct(first!, first!.affiliateLink, {
        discoverySource: "ON_DEMAND_SEARCH",
        autoCreated: true,
        sourceQuery: query,
      });

      ids.push(saved.id);

      for (const offer of rest) {
        await saveProduct(offer, offer.affiliateLink, {
          targetProductId: saved.id,
          verifiedExactMatch: true,
          discoverySource: "ON_DEMAND_SEARCH",
          autoCreated: true,
          sourceQuery: query,
        });
      }
    } catch (error) {
      console.error("[MULTISTORE-V2] persistencia falhou para cluster", product.clusterId, error);
      ids.push("");
    }
  }

  return ids;
}
