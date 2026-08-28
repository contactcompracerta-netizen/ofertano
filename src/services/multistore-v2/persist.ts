import type { ProductImport } from "@/services/importers/core/types";
import {
  saveProduct,
  type SaveProductOptions,
} from "@/services/database/saveProduct";

import type { CanonicalOffer, CanonicalProduct, MarketplaceCode } from "./types";
import { marketplaceLabel } from "./canonicalize";
import type { SearchDeadline } from "./timeBudget";

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
  persistTransientHeads?: boolean;
  findExistingProductId?: (
    product: CanonicalProduct,
  ) => Promise<string | null | undefined>;
};

/*
 * Busca visivel != publicacao final.
 * TIER 0/1 PRIMARY e TIER 2 ACCESSORY separado podem aparecer na pesquisa
 * mesmo com coverage INCOMPLETE. TIER 3 ambiguo nao entra.
 */
export function isSearchVisible(product: CanonicalProduct): boolean {
  if (product.rankTier === 3) {
    return false;
  }

  return product.offers.length > 0;
}

/*
 * Publicacao != relevancia.
 * TIER 0/1 PRIMARY e TIER 2 ACCESSORY separado podem publicar.
 * TIER 3 ambiguo nao vira oferta confirmada.
 * Publicacao exige coverageStatus COMPLETE e pelo menos 1 oferta valida.
 * INCOMPLETE (TIMEOUT/BLOCKED/ERROR/UNUSABLE/NOT_RUN) nunca publica,
 * mesmo com 2+ ofertas: a menor oferta so e final apos cobertura completa.
 */
export function isClusterPublishable(product: CanonicalProduct): boolean {
  if (!isSearchVisible(product)) {
    return false;
  }

  return product.coverageStatus === "COMPLETE";
}

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

  /*
   * persistProduct injetado (testes) nao deve abrir Prisma.
   * Em producao o default e saveProduct: a chave e marketplace+externalId
   * de qualquer oferta do cluster, inclusive HEAD DRAFT/active=false.
   */
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
    if (!searchVisible || (!publishable && !options.persistTransientHeads)) {
      ids.push("");
      continue;
    }

    if (!canStartPersistWrite(options.deadline)) {
      ids.push("");
      continue;
    }

    const imports = product.offers
      .map((offer) => toProductImport(offer, product.image))
      .filter((item): item is ProductImport => item !== null);

    if (imports.length === 0) {
      ids.push("");
      continue;
    }

    const persistOptions = {
      discoverySource: "ON_DEMAND_SEARCH" as const,
      autoCreated: true,
      sourceQuery: query,
      deferPublication: !publishable,
    };

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

      if (!savedId) {
        if (!canStartPersistWrite(options.deadline)) {
          ids.push("");
          recorded = true;
          continue;
        }

        const saved = await persistProduct(first, first.affiliateLink, persistOptions);
        savedId = saved.id;
      } else if (!fromThisRequest && (!headsOnly || publishable)) {
        /*
         * Product de busca anterior (inclusive DRAFT). A oferta mais barata
         * desta cobertura precisa ir para o mesmo UUID; senao Shopee cria
         * outro Product e o DRAFT fica orfao.
         * existingIds desta resposta ja persistiu a cabeca: after() so anexa tails.
         */
        if (canStartPersistWrite(options.deadline)) {
          await persistProduct(first, first.affiliateLink, {
            ...persistOptions,
            targetProductId: savedId,
            verifiedExactMatch: true,
          });
        }
      }

      ids.push(savedId);
      recorded = true;

      if (headsOnly) {
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
        });
      }
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
  const selected = products.slice(0, limit);
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
