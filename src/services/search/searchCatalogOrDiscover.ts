import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { descobrirProdutos } from "@/services/discovery";
import { importarCandidatoDiscovery } from "@/services/discovery/importCandidate";
import {
  avaliarCompatibilidadeComConsulta,
  pontuarEspecificidadeDaConsulta,
} from "@/services/identity";
import { persistPublicSearchCluster } from "@/services/search/persistPublicSearchCluster";
import { listarDiscoveryAdaptersAtivos } from "@/services/discovery/core/registry";
import type { DiscoveryCandidate } from "@/services/discovery/core/types";
import type { ProductImport } from "@/services/importers/core/types";
import { traceMultiloja } from "@/services/multiloja/trace";

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

function termVariants(term: string): string[] {
  const cleaned = term.trim();

  if (!cleaned) {
    return [];
  }

  const capacity = cleaned.match(
    /^(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)$/i,
  );

  if (capacity) {
    const amount = capacity[1];
    const unit = capacity[2].toUpperCase();

    return Array.from(
      new Set([`${amount}${unit}`, `${amount} ${unit}`]),
    );
  }

  return [cleaned];
}

function textFilters(value: string): Prisma.ProductWhereInput[] {
  return [
    { name: { contains: value, mode: "insensitive" } },
    { canonicalName: { contains: value, mode: "insensitive" } },
    { brand: { contains: value, mode: "insensitive" } },
    { modelNumber: { contains: value, mode: "insensitive" } },
    { category: { contains: value, mode: "insensitive" } },
  ];
}

function catalogFilter(query: string): Prisma.ProductWhereInput {
  const terms = query.split(/\s+/).map((term) => term.trim()).filter(Boolean);

  return {
    active: true,
    price: { gt: 0 },
    image: { not: "" },
    OR: [
      ...textFilters(query),
      {
        AND: terms.map((term) => ({
          OR: termVariants(term).flatMap((variant) => textFilters(variant)),
        })),
      },
    ],
  };
}

function storeCount(product: { offers: Array<{ marketplace: string }> }): number {
  return new Set(
    product.offers.map((offer) => offer.marketplace.trim()).filter(Boolean),
  ).size;
}

type CatalogIdentityProduct = {
  name: string;
  canonicalName: string | null;
  brand: string | null;
  specifications: unknown;
  modelNumber: string | null;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  color: string | null;
  voltage: string | null;
  size: string | null;
};

function catalogIdentityAttributes(
  product: CatalogIdentityProduct,
): Record<string, string> {
  const base =
    product.specifications &&
    typeof product.specifications === "object" &&
    !Array.isArray(product.specifications)
      ? Object.fromEntries(
          Object.entries(product.specifications as Record<string, unknown>)
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => [key, String(value)]),
        )
      : {};

  return {
    ...base,
    ...(product.modelNumber ? { MODEL: product.modelNumber } : {}),
    ...(product.ean ? { EAN: product.ean } : {}),
    ...(product.gtin ? { GTIN: product.gtin } : {}),
    ...(product.mpn ? { MPN: product.mpn } : {}),
    ...(product.color ? { COLOR: product.color } : {}),
    ...(product.voltage ? { VOLTAGE: product.voltage } : {}),
    ...(product.size ? { SIZE: product.size } : {}),
  };
}

function matchesQuery(
  product: CatalogIdentityProduct,
  query: string,
): boolean {
  return avaliarCompatibilidadeComConsulta(query, {
    title: product.canonicalName?.trim() || product.name,
    brand: product.brand,
    attributes: catalogIdentityAttributes(product),
  }).compatible;
}

async function searchCatalog(query: string) {
  const candidates = await prisma.product.findMany({
    where: catalogFilter(query),
    include: {
      offers: {
        where: {
          active: true,
          matchStatus: "EXACT",
        },
        select: {
          marketplace: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { price: "asc" }],
    take: 120,
  });

  return candidates
    .filter((product) => matchesQuery(product, query))
    .sort((first, second) => {
      const storeDifference = storeCount(second) - storeCount(first);

      if (storeDifference !== 0) {
        return storeDifference;
      }

      return first.price - second.price;
    })
    .slice(0, 40);
}

export type SearchCatalogOrDiscoverResult = {
  query: string;
  source: "CATALOG" | "DISCOVERY" | "NOT_FOUND";
  products: Awaited<ReturnType<typeof searchCatalog>>;
  discovery?: Awaited<ReturnType<typeof descobrirProdutos>>;
};

function rankDiscoveryCandidates(
  query: string,
  candidates: DiscoveryCandidate[],
) {
  return candidates
    .map((candidate) => ({
      candidate,
      match: avaliarCompatibilidadeComConsulta(query, {
        title: candidate.title,
        brand: candidate.brand ?? null,
        attributes: candidate.attributes ?? {},
      }),
      specificity: pontuarEspecificidadeDaConsulta(query, {
        title: candidate.title,
        brand: candidate.brand ?? null,
        attributes: candidate.attributes ?? {},
      }),
    }))
    .filter(
      ({ candidate, match }) =>
        candidate.status === "FOUND" &&
        Boolean(candidate.sourceUrl?.trim()) &&
        Boolean(candidate.title.trim()) &&
        match.compatible,
    )
    .sort((first, second) => {
      if (first.match.score !== second.match.score) {
        return second.match.score - first.match.score;
      }

      if (first.specificity !== second.specificity) {
        return second.specificity - first.specificity;
      }

      if (first.match.matchedBy !== second.match.matchedBy) {
        if (first.match.matchedBy === "MODEL") {
          return -1;
        }
        if (second.match.matchedBy === "MODEL") {
          return 1;
        }
      }

      const firstHasLink = Number(Boolean(first.candidate.affiliateLink?.trim()));
      const secondHasLink = Number(Boolean(second.candidate.affiliateLink?.trim()));

      if (firstHasLink !== secondHasLink) {
        return secondHasLink - firstHasLink;
      }

      return (
        (first.candidate.price ?? Number.POSITIVE_INFINITY) -
        (second.candidate.price ?? Number.POSITIVE_INFINITY)
      );
    });
}

function pickCandidatesForImport(
  ranked: ReturnType<typeof rankDiscoveryCandidates>,
): DiscoveryCandidate[] {
  const selected: DiscoveryCandidate[] = [];
  const perMarketplace = new Map<string, number>();

  for (const { candidate } of ranked) {
    const taken = perMarketplace.get(candidate.marketplace) ?? 0;

    if (taken >= 4) {
      continue;
    }

    perMarketplace.set(candidate.marketplace, taken + 1);
    selected.push(candidate);
  }

  return selected;
}

function offerFromDiscoveryCandidate(
  candidate: DiscoveryCandidate | undefined,
  query: string,
): { product: ProductImport; affiliateLink?: string | null } | null {
  if (!candidate) {
    return null;
  }

  const sourceUrl = candidate.sourceUrl?.trim() || "";
  const externalId = candidate.externalId?.trim() || "";
  const title = candidate.title.trim();
  const image = candidate.image?.trim() || "";
  const price = candidate.price;

  if (!sourceUrl || !externalId || !title || !image) {
    return null;
  }

  if (price == null || !Number.isFinite(price) || price <= 0) {
    return null;
  }

  const product: ProductImport = {
    marketplace: candidate.marketplaceName,
    externalId,
    url: sourceUrl,
    affiliateLink: candidate.affiliateLink ?? null,
    title,
    description: null,
    brand: candidate.brand ?? null,
    category: candidate.category ?? null,
    image,
    images: [image],
    price,
    oldPrice: candidate.oldPrice,
    discount: null,
    installments: null,
    rating: null,
    reviews: null,
    sales: null,
    stock: null,
    seller: candidate.seller ?? null,
    attributes: candidate.attributes ?? {},
  };

  const match = avaliarCompatibilidadeComConsulta(query, {
    title: product.title,
    brand: product.brand,
    attributes: product.attributes,
  });

  if (!match.compatible) {
    return null;
  }

  return {
    product,
    affiliateLink: product.affiliateLink,
  };
}

async function importExactOffers(
  query: string,
  candidates: DiscoveryCandidate[],
): Promise<Array<{ product: ProductImport; affiliateLink?: string | null }>> {
  const imported = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const result = await importarCandidatoDiscovery(candidate);
      const match = avaliarCompatibilidadeComConsulta(query, {
        title: result.product.title,
        brand: result.product.brand ?? null,
        attributes: result.product.attributes,
      });

      if (!match.compatible) {
        throw new Error(match.reason);
      }

      return {
        product: result.product,
        affiliateLink:
          result.product.affiliateLink ??
          candidate.affiliateLink ??
          null,
      };
    }),
  );

  return imported.flatMap((result, index) => {
    const candidate = candidates[index];

    if (result.status !== "fulfilled") {
      const fallback = offerFromDiscoveryCandidate(candidate, query);

      if (fallback) {
        return [fallback];
      }

      return [];
    }

    return [result.value];
  });
}

export async function searchCatalogOrDiscover(
  query: string,
  discoveryLimit = 5,
): Promise<SearchCatalogOrDiscoverResult> {
  const search = normalizeQuery(query);

  if (search.length < 2) {
    return {
      query: search,
      source: "NOT_FOUND",
      products: [],
    };
  }

  traceMultiloja("query", { query: search });

  /*
   * MULTI LOJA DA PESQUISA PUBLICA
   *
   * Os resultados brutos das marketplaces nunca viram Products separados.
   * Discovery so produz candidatos temporarios. O motor de identidade
   * agrupa EXACT e a persistencia grava UM Product + N MarketplaceOffer
   * com o mesmo productId. Nenhuma loja e ancora.
   */
  const existing = await searchCatalog(search);
  const existingMultiStore = existing.filter((product) => storeCount(product) >= 2);
  const marketplacesAtivas = listarDiscoveryAdaptersAtivos().length;
  const catalogCompleto =
    Boolean(existingMultiStore[0]) &&
    storeCount(existingMultiStore[0]!) >= marketplacesAtivas;

  if (catalogCompleto) {
    return {
      query: search,
      source: "CATALOG",
      products: existingMultiStore,
    };
  }

  let discovery: Awaited<ReturnType<typeof descobrirProdutos>>;

  try {
    discovery = await descobrirProdutos(search, Math.max(discoveryLimit, 5), {
      mode: "MULTILOJA",
    });
  } catch (error) {
    console.error("[Search Multi Loja] Discovery falhou:", error);

    if (existingMultiStore.length > 0) {
      return {
        query: search,
        source: "CATALOG",
        products: existingMultiStore,
      };
    }

    return {
      query: search,
      source: "NOT_FOUND",
      products: [],
    };
  }

  const ranked = rankDiscoveryCandidates(search, discovery.candidates);
  const toImport = pickCandidatesForImport(ranked);
  const offers = await importExactOffers(search, toImport);
  const coverage = {
    enabledMarketplaces: listarDiscoveryAdaptersAtivos().map(
      (adapter) => adapter.marketplace,
    ),
    results: discovery.results,
  };

  try {
    const persisted = await persistPublicSearchCluster(
      search,
      offers,
      existingMultiStore[0]?.id ?? existing[0]?.id ?? null,
      coverage,
    );

    if (persisted) {
      const publishedProduct = await prisma.product.findUnique({
        where: { id: persisted.productId },
        include: {
          offers: {
            where: {
              active: true,
              matchStatus: "EXACT",
            },
            select: {
              marketplace: true,
            },
          },
        },
      });

      if (publishedProduct?.active) {
        return {
          query: search,
          source: existing.length > 0 ? "CATALOG" : "DISCOVERY",
          products: [publishedProduct],
          discovery,
        };
      }
    }
  } catch (error) {
    console.error(
      "[Search Multi Loja] Falha ao persistir cluster EXACT:",
      error,
    );
  }

  if (existingMultiStore.length > 0) {
    return {
      query: search,
      source: "CATALOG",
      products: existingMultiStore,
      discovery,
    };
  }

  return {
    query: search,
    source: "NOT_FOUND",
    products: [],
    discovery,
  };
}
