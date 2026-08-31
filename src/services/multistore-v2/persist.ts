import type { ProductImport } from "@/services/importers/core/types";
import {
  saveProduct,
  type SaveProductOptions,
} from "@/services/database/saveProduct";

import type { CanonicalOffer, CanonicalProduct, MarketplaceCode } from "./types";
import { marketplaceLabel } from "./canonicalize";
import type { SearchDeadline } from "./timeBudget";
import {
  countDistinctMarketplaces,
  isClusterPublishable,
  isSearchVisible,
  usableEquivalentOffers,
} from "./publicationBarrier";

export type PersistProductFn = (
  product: ProductImport,
  affiliateLink?: string | null,
  options?: SaveProductOptions,
) => Promise<{ id: string }>;

export type PersistDeadline = Pick<
  SearchDeadline,
  "expired" | "remainingMs"
> & {
  budget?: Pick<SearchDeadline["budget"], "hangGraceMs">;
};

export type PersistCanonicalOptions = {
  limit?: number;
  deadline?: PersistDeadline;
  persistProduct?: PersistProductFn;
  headsOnly?: boolean;
  existingIds?: string[];
  findExistingProductId?: (
    product: CanonicalProduct,
  ) => Promise<string | null | undefined>;
};

export {
  countDistinctMarketplaces,
  isClusterPublishable,
  isSearchVisible,
  usableEquivalentOffers,
} from "./publicationBarrier";

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

async function findExistingProductIdFromOffers(
  offers: CanonicalOffer[],
): Promise<string> {
  try {
    const prisma = (await import("@/lib/prisma")).default;
    for (const offer of offers) {
      const existing = await prisma.marketplaceOffer.findUnique({
        where: {
          marketplace_externalId: {
            marketplace: offer.marketplace,
            externalId: offer.externalId,
          },
        },
        select: {
          productId: true,
        },
      });
      if (existing?.productId) {
        return existing.productId;
      }
    }
  } catch (error) {
    console.error("[MULTISTORE-V2] lookup de Product existente falhou", error);
  }

  return "";
}

async function resolveExistingProductId(
  product: CanonicalProduct,
  options: PersistCanonicalOptions,
): Promise<string> {
  if (options.findExistingProductId) {
    return (await options.findExistingProductId(product))?.trim() || "";
  }

  if (options.persistProduct) {
    return "";
  }

  return findExistingProductIdFromOffers(product.offers);
}

function canStartPersistWrite(deadline?: PersistDeadline): boolean {
  if (!deadline) {
    return true;
  }

  if (deadline.expired()) {
    return false;
  }

  const floor = deadline.budget?.hangGraceMs ?? 0;
  return deadline.remainingMs() > floor;
}

function buildPersistOptions(query: string, publishable: boolean) {
  return {
    discoverySource: "ON_DEMAND_SEARCH" as const,
    autoCreated: true,
    sourceQuery: query,
    deferPublication: !publishable,
  };
}

async function promoteClusterProduct(
  persistProduct: PersistProductFn,
  query: string,
  product: CanonicalProduct,
  savedId: string,
  head: ProductImport,
  affiliateLink: string | null | undefined,
  allowAffiliateOpportunity: boolean,
): Promise<void> {
  await persistProduct(head, affiliateLink, {
    ...buildPersistOptions(query, true),
    targetProductId: savedId,
    verifiedExactMatch: true,
    deferPublication: false,
  });

  if (
    !allowAffiliateOpportunity ||
    !product.offers.some((offer) => offer.marketplace === "MERCADO_LIVRE")
  ) {
    return;
  }

  const { ensureMercadoLivreLowestPriceAffiliateOpportunitySafe } = await import(
    "@/services/opportunities/lowestPriceAffiliateOpportunity"
  );
  await ensureMercadoLivreLowestPriceAffiliateOpportunitySafe(savedId);
}

/*
 * saveProduct abre uma transacao Prisma longa, sem AbortSignal.
 * Nao usamos Promise.race(timeout): o write continuaria em background
 * e geraria efeito colateral orfao. A estrategia e nao iniciar novas
 * gravacoes quando o budget acabou, e esperar as que ja comecaram.
 */
export async function persistCanonicalProducts(
  query: string,
  products: CanonicalProduct[],
  options: PersistCanonicalOptions = {},
): Promise<string[]> {
  const persistProduct = options.persistProduct ?? saveProduct;
  const limit =
    options.limit === undefined
      ? products.length
      : Math.max(0, Math.min(options.limit, products.length));
  const selected = products.slice(0, limit);
  const ids: string[] = [];
  const existingIds = options.existingIds ?? [];
  const headsOnly = options.headsOnly === true;

  for (const product of selected) {
    const publishable = isClusterPublishable(product);
    const searchVisible = isSearchVisible(product);
    if (!searchVisible) {
      ids.push("");
      continue;
    }

    if (!canStartPersistWrite(options.deadline)) {
      ids.push("");
      continue;
    }

    const equivalentOffers = usableEquivalentOffers(product);
    const imports = equivalentOffers
      .map((offer) => toProductImport(offer, product.image))
      .filter((item): item is ProductImport => item !== null);

    if (imports.length === 0) {
      ids.push("");
      continue;
    }

    const distinctStores = countDistinctMarketplaces(equivalentOffers);
    const persistOptions = buildPersistOptions(query, publishable);

    let recorded = false;
    try {
      const [first, ...rest] = imports;
      if (!first) {
        ids.push("");
        recorded = true;
        continue;
      }

      let savedId = existingIds[ids.length]?.trim() || "";
      const fromThisRequest = Boolean(savedId);
      if (!savedId) {
        savedId = await resolveExistingProductId(product, options);
      }

      const multiStore = distinctStores >= 2;
      const attachOnly = multiStore || headsOnly;

      if (!savedId) {
        if (!canStartPersistWrite(options.deadline)) {
          ids.push("");
          recorded = true;
          continue;
        }

        const saved = await persistProduct(first, first.affiliateLink, {
          ...persistOptions,
          deferPublication: multiStore ? true : !publishable,
        });
        savedId = saved.id;
      } else if (!fromThisRequest && (!headsOnly || publishable)) {
        if (canStartPersistWrite(options.deadline)) {
          await persistProduct(first, first.affiliateLink, {
            ...persistOptions,
            targetProductId: savedId,
            verifiedExactMatch: true,
            suppressPublicationSync: attachOnly,
            deferPublication: multiStore ? true : !publishable,
          });
        }
      }

      if (headsOnly) {
        ids.push(publishable ? savedId : "");
        recorded = true;
        continue;
      }

      for (const offer of rest) {
        if (!canStartPersistWrite(options.deadline)) {
          break;
        }

        await persistProduct(offer, offer.affiliateLink, {
          ...persistOptions,
          targetProductId: savedId,
          verifiedExactMatch: true,
          suppressPublicationSync: true,
          deferPublication: true,
        });
      }

      const attachedStores = countDistinctMarketplaces(equivalentOffers.slice(0, 1 + rest.length));
      const promotionAllowed =
        publishable &&
        attachedStores >= distinctStores &&
        (distinctStores >= 2 || product.coverageStatus === "COMPLETE");

      if (promotionAllowed && canStartPersistWrite(options.deadline)) {
        if (multiStore) {
          await promoteClusterProduct(
            persistProduct,
            query,
            product,
            savedId,
            first,
            first.affiliateLink,
            !options.persistProduct,
          );
        }
        ids.push(savedId);
      } else {
        ids.push("");
      }

      recorded = true;
    } catch (error) {
      console.error("[MULTISTORE-V2] persistencia falhou para cluster", product.clusterId, error);
      if (!recorded) {
        ids.push("");
      }
    }
  }

  return ids;
}

export async function persistSelectedSearchClusters(
  query: string,
  products: CanonicalProduct[],
  options: PersistCanonicalOptions = {},
): Promise<string[]> {
  const limit =
    options.limit === undefined
      ? products.length
      : Math.max(0, Math.min(options.limit, products.length));
  const selected = products.slice(0, limit);

  try {
    return await persistCanonicalProducts(query, selected, {
      ...options,
      limit: selected.length,
    });
  } catch (error) {
    console.error("[MULTISTORE-V2] persistencia pos-resposta falhou", error);
    return selected.map(() => "");
  }
}

export function scheduleSelectedClusterPersist(
  schedule: (task: () => Promise<void>) => void,
  query: string,
  products: CanonicalProduct[],
  options: PersistCanonicalOptions = {},
): number {
  const limit =
    options.limit === undefined
      ? products.length
      : Math.max(0, Math.min(options.limit, products.length));
  const selected = products.slice(0, limit).filter(isSearchVisible);
  if (selected.length === 0) {
    return 0;
  }

  schedule(async () => {
    await persistSelectedSearchClusters(query, selected, {
      ...options,
      limit: selected.length,
    });
  });

  return selected.length;
}
