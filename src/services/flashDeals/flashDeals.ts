import type { MarketplaceOffer, Product } from "@prisma/client";
import { resolverHrefProprioOfertaPublica } from "@/lib/affiliates/publicPurchase";
import { hasPublicMultiStore, isUsablePublicOffer } from "@/services/publicVisibility/multiStoreVisibility";

export type FlashDealOffer = Pick<MarketplaceOffer,
  "id" | "marketplace" | "price" | "oldPrice" | "title" | "image" |
  "externalId" | "sourceUrl" | "affiliateLink" | "status" | "available" | "rawPayload"
>;
export type FlashDealProduct = Pick<Product, "id" | "name" | "image"> & {
  offers: FlashDealOffer[];
};
export type FlashDeal = {
  id: string;
  productId: string;
  title: string;
  image: string;
  currentPrice: number;
  originalPrice: number | null;
  discountPercent: number | null;
  marketplace: MarketplaceOffer["marketplace"];
  listingUrl: string;
  affiliateUrl: string;
  expiresAt: string | null;
  validUntil: string;
  available: true;
};
export interface FlashDealsProvider {
  marketplace: MarketplaceOffer["marketplace"];
  select(products: readonly FlashDealProduct[], now: number): FlashDeal[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

// Only explicit, listing-bound evidence from ingestion qualifies. Neither a
// product discount nor a catalog product is evidence of a flash promotion.
export const mercadoLivreFlashDealsProvider: FlashDealsProvider = {
  marketplace: "MERCADO_LIVRE",
  select(products, now) {
    const deals: FlashDeal[] = [];
    const seen = new Set<string>();
    for (const product of products) {
      if (!hasPublicMultiStore(product)) continue;
      for (const offer of product.offers) {
        if (offer.marketplace !== this.marketplace || !isUsablePublicOffer(offer)) continue;
        const evidence = record(record(offer.rawPayload)?.flashDeal);
        if (!evidence || evidence.kind !== "FLASH_DEAL" || evidence.listingId !== offer.externalId) continue;
        const verifiedAt = timestamp(evidence.verifiedAt);
        const validUntil = timestamp(evidence.validUntil);
        if (verifiedAt === null || validUntil === null || verifiedAt > now || validUntil <= now || validUntil <= verifiedAt) continue;
        const endsAt = evidence.endsAt == null ? null : timestamp(evidence.endsAt);
        if (evidence.endsAt != null && (endsAt === null || endsAt <= now)) continue;
        const href = resolverHrefProprioOfertaPublica(offer);
        // Preserve the existing ML purchase policy: no raw URL or generic
        // affiliate fallback when this listing has no confirmed affiliate.
        if (!href || !offer.sourceUrl || !offer.externalId || seen.has(offer.externalId)) continue;
        const title = offer.title?.trim() || product.name.trim();
        const image = offer.image?.trim() || product.image.trim();
        if (!title || !image) continue;
        const originalPrice = Number.isFinite(offer.oldPrice) && offer.oldPrice! > offer.price ? offer.oldPrice : null;
        const discount = originalPrice ? Math.floor((1 - offer.price / originalPrice) * 100) : null;
        deals.push({
          id: offer.id, productId: product.id, title, image,
          currentPrice: offer.price, originalPrice,
          discountPercent: discount && discount > 0 && discount < 100 ? discount : null,
          marketplace: offer.marketplace, listingUrl: offer.sourceUrl, affiliateUrl: href,
          expiresAt: endsAt === null ? null : new Date(endsAt).toISOString(), available: true,
          validUntil: new Date(validUntil).toISOString(),
        });
        seen.add(offer.externalId);
        if (deals.length === 6) return deals;
      }
    }
    return deals;
  },
};

export function getHomeFlashDeals(
  products: readonly FlashDealProduct[],
  provider: FlashDealsProvider = mercadoLivreFlashDealsProvider,
  now = Date.now(),
): FlashDeal[] {
  return provider.select(products, now).slice(0, 6);
}
