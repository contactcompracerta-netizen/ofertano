import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { isPublicSearchPersistenceEnabled } from "@/lib/featureFlags";
import { descobrirProdutos } from "@/services/discovery";
import { importarCandidatoDiscovery } from "@/services/discovery/importCandidate";
import {
  avaliarCompatibilidadeComConsulta,
  pontuarEspecificidadeDaConsulta,
} from "@/services/identity";
import { persistPublicSearchCluster } from "@/services/search/persistPublicSearchCluster";
import { listarDiscoveryAdaptersAtivos } from "@/services/discovery/core/registry";
import type { DiscoveryAdapter, DiscoveryCandidate } from "@/services/discovery/core/types";
import type { ProductImport } from "@/services/importers/core/types";
import { traceMultiloja } from "@/services/multiloja/trace";
import {
  searchMultistoreV2,
  usarMotorMultistoreV2,
  buildQueryIntent,
  scoreQueryRelevance,
  normalizeCandidate,
  scheduleSelectedClusterPersist,
  persistCanonicalProducts,
  isSearchVisible,
  type PersistCanonicalOptions,
  type PersistProductFn,
} from "@/services/multistore-v2";
import type { SearchBudget } from "@/services/multistore-v2/timeBudget";
import { isWeakModifier, normalizeConceptText } from "@/services/multistore-v2/productConcepts";
import {
  countDistinctNonEmptyMarketplaces,
  hasPublicMultiStore,
  meetsPublicMultiStoreMarketplaceCount,
} from "@/services/publicVisibility/multiStoreVisibility";
import { isValidMercadoLivreListingIdentity } from "@/services/mercadoLivre/listingIdentity";

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
  const terms = query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => {
      if (!term) {
        return false;
      }

      return !isWeakModifier(normalizeConceptText(term));
    });

  return {
    active: true,
    price: { gt: 0 },
    image: { not: "" },
    OR: [
      ...textFilters(query),
      ...(terms.length > 0
        ? [
            {
              AND: terms.map((term) => ({
                OR: termVariants(term).flatMap((variant) => textFilters(variant)),
              })),
            },
          ]
        : []),
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
  const title = product.canonicalName?.trim() || product.name;
  const scored = scoreQueryRelevance(
    buildQueryIntent(query),
    normalizeCandidate({
      marketplace: "AMAZON",
      marketplaceName: "Amazon",
      externalId: `catalog:${title.slice(0, 24)}`,
      title,
      price: 1,
      url: "https://ofertano.local/catalog",
      image: "https://ofertano.local/img.jpg",
      brand: product.brand,
      category: null,
      seller: null,
      affiliateLink: null,
      attributes: catalogIdentityAttributes(product),
    }),
  );

  return scored.status === "RELEVANT";
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
          // FASE P: necessário para isUsablePublicOffer decidir a
          // visibilidade no gate central. O campo mais perigoso é
          // `active`: a checagem é `active === false`, então uma coluna
          // NÃO selecionada chega como `undefined` e PASSA — uma oferta
          // inativa entraria como pública. O mesmo vale para
          // `matchStatus` (a checagem só rejeita quando o valor está
          // definido e não é "EXACT"). `available`/`status`/`price` já
          // fail-closed sozinhos, mas vêm juntos porque a função os usa.
          active: true,
          matchStatus: true,
          available: true,
          status: true,
          price: true,
          // LISTING-FIRST: identidade do anúncio. Sem estes dois campos a
          // busca tratava TODA oferta ML como não publicável (fail-closed
          // silencioso) e a contagem de lojas do card divergia da grade.
          externalId: true,
          sourceUrl: true,
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

type CatalogProduct = Awaited<ReturnType<typeof searchCatalog>>;

/*
 * A busca pública SEMPRE começa pelo catálogo. O motor V2 ao vivo
 * (`searchMultistoreV2`) responde com clusters frescos deste momento e não
 * consulta o banco — sem esta mesclagem, um produto já publicado e visível
 * (Multi Loja) nunca aparecia na busca. O usuário buscava "Redmi Buds" e
 * recebia "Nenhum produto encontrado" mesmo com o produto no ar.
 *
 * O catálogo vem primeiro (é a vitrine canônica) e a descoberta entra depois,
 * deduplicada por `id`.
 */
function mesclarCatalogoComDescoberta(
  catalogo: CatalogProduct,
  descoberta: CatalogProduct,
): CatalogProduct {
  const idsDoCatalogo = new Set(catalogo.map((produto) => produto.id));

  return [
    ...catalogo,
    ...descoberta.filter((produto) => !idsDoCatalogo.has(produto.id)),
  ];
}

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

  /*
   * LISTING-FIRST: este fallback existe para quando o importador falha.
   * Ele NUNCA pode persistir produto de catalogo como oferta ML, entao
   * exige a mesma identidade de listing comprovada do importador.
   */
  if (
    candidate.marketplace === "MERCADO_LIVRE" &&
    !isValidMercadoLivreListingIdentity({
      externalId,
      listingItemId: candidate.listingItemId ?? externalId,
      sourceUrl,
      origin: "listing",
    })
  ) {
    return null;
  }

  const product: ProductImport = {
    marketplace: candidate.marketplaceName,
    externalId,
    catalogProductId: candidate.catalogProductId ?? null,
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

export type PublicSearchOptions = {
  schedulePersist?: (task: () => Promise<void>) => void;
  persistProduct?: PersistProductFn;
  adapters?: DiscoveryAdapter[];
  findExistingProductId?: PersistCanonicalOptions["findExistingProductId"];
  budget?: SearchBudget;
  /*
   * Gancho de teste para a leitura de catálogo (CATALOG-FIRST do motor V2).
   * Em produção o padrão é `searchCatalog`. Existe porque o motor V2 não
   * consulta o catálogo por conta própria: sem injetar essa leitura, a
   * regressão "produto público some da busca" não é observável sem banco.
   */
  searchCatalogFn?: (query: string) => Promise<CatalogProduct>;
};

export async function searchCatalogOrDiscover(
  query: string,
  discoveryLimit = 5,
  options: PublicSearchOptions = {},
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

  if (usarMotorMultistoreV2()) {
    /*
     * CATALOG-FIRST no motor V2.
     *
     * `searchMultistoreV2` faz uma caçada ao vivo e NÃO consulta o catálogo,
     * então um produto já publicado e público (Multi Loja) nunca aparecia na
     * busca: o usuário digitava o nome exato e recebia "Nenhum produto
     * encontrado". Aqui a vitrine canônica é lida primeiro e a descoberta ao
     * vivo entra depois, deduplicada por `id`.
     *
     * A leitura do catálogo é resiliente: se o banco estiver indisponível
     * (por exemplo, ambiente de teste sem `DATABASE_URL`), a busca segue
     * apenas com a descoberta, sem quebrar a rota.
     */
    let catalogoVisivel: CatalogProduct = [];

    try {
      const lerCatalogo = options.searchCatalogFn ?? searchCatalog;
      catalogoVisivel = (await lerCatalogo(search)).filter(
        hasPublicMultiStore,
      );
    } catch (error) {
      console.error(
        "[Search] Catálogo indisponível; seguindo com descoberta:",
        error,
      );
    }

    try {
      const limit = Math.max(discoveryLimit, 12);
      const v2 = await searchMultistoreV2(search, {
        persist: false,
        hunt: true,
        limit,
        adapters: options.adapters,
        budget: options.budget,
      });

      const visibleProducts = v2.products
        .filter(isSearchVisible)
        .filter((product) =>
          meetsPublicMultiStoreMarketplaceCount(product.offers),
        );
      const persistenceEnabled = isPublicSearchPersistenceEnabled();

      if (
        persistenceEnabled &&
        visibleProducts.length > 0 &&
        (options.schedulePersist || options.persistProduct)
      ) {
        const persistedIds = options.schedulePersist
          ? await persistCanonicalProducts(search, visibleProducts, {
              limit,
              headsOnly: true,
              persistProduct: options.persistProduct,
              findExistingProductId: options.findExistingProductId,
            })
          : await persistCanonicalProducts(search, visibleProducts, {
              limit,
              persistProduct: options.persistProduct,
              findExistingProductId: options.findExistingProductId,
            });

        if (options.schedulePersist) {
          scheduleSelectedClusterPersist(
            options.schedulePersist,
            search,
            visibleProducts,
            {
              limit,
              persistProduct: options.persistProduct,
              existingIds: persistedIds,
              findExistingProductId: options.findExistingProductId,
            },
          );
        }

        const views = visibleProducts.flatMap((product, index) => {
          const id = persistedIds[index]?.trim();
          if (!id) {
            return [];
          }

          const view =
            v2.views.find((item, viewIndex) => v2.products[viewIndex]?.clusterId === product.clusterId) ??
            v2.views[index];
          if (!view) {
            return [];
          }

          return [{ ...view, id }];
        });

        if (views.length > 0) {
          return {
            query: search,
            source: "DISCOVERY",
            products: mesclarCatalogoComDescoberta(
              catalogoVisivel,
              views as CatalogProduct,
            ),
          };
        }
      }

      /*
       * SEM PERSISTÊNCIA, o cluster ao vivo NÃO tem página.
       *
       * `v2.views` carrega o id sintético do cluster (`v2-<clusterId>`): não
       * existe `Product` com esse id, então o card renderizado pela Home
       * apontava para `/produto/v2-...` e devolvia 404. Em produção
       * `PUBLIC_SEARCH_PERSISTENCE_ENABLED` está desligado, então esse era o
       * caminho padrão: a busca anunciava "1 produto encontrado / Compare em
       * 2 lojas / R$ 86,46" com link quebrado — produto fabricado na vitrine.
       *
       * Um cluster sem `Product` não é navegável, logo não pode ser card.
       * Aqui a resposta pública é só a vitrine canônica (abaixo), e o
       * cluster volta a ser o que ele é: rastreamento de descoberta.
       */
      if (catalogoVisivel.length > 0) {
        return {
          query: search,
          source: "CATALOG",
          products: catalogoVisivel,
        };
      }

      return {
        query: search,
        source: "NOT_FOUND",
        products: [],
      };
    } catch (error) {
      console.error("[Search Multi Loja V2] Discovery falhou:", error);

      if (catalogoVisivel.length > 0) {
        return {
          query: search,
          source: "CATALOG",
          products: catalogoVisivel,
        };
      }

      return {
        query: search,
        source: "NOT_FOUND",
        products: [],
      };
    }
  }

  /*
   * LEGACY — isolado para rollback via MULTISTORE_ENGINE=legacy
   */
  const existing = await searchCatalog(search);
  /*
   * FASE P — a busca pública é uma das SUPERFÍCIES de leitura, então a
   * decisão final de visibilidade precisa ser o gate central ponderado, não
   * uma contagem local. `storeCount` contava marketplaces distintos crus:
   * sem peso de shadow e sem exigir oferta válida. Com Shopee em SHADOW, um
   * produto MERCADO_LIVRE + SHOPEE (peso real = 1) saía da busca como
   * multi-loja público.
   *
   * `storeCount` continua existindo abaixo, mas só como ORDENACAO e como
   * heurística de "catálogo completo" — nenhuma delas decide visibilidade.
   */
  const existingMultiStore = existing.filter(hasPublicMultiStore);
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

  if (isPublicSearchPersistenceEnabled()) {
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
                // FASE P: o gate central (hasPublicMultiStore) decide
                // visibilidade com isUsablePublicOffer, que precisa tambem de
                // active/matchStatus. Sem eles a checagem seria fail-open.
                active: true,
                matchStatus: true,
                available: true,
                status: true,
                price: true,
                externalId: true,
                sourceUrl: true,
              },
            },
          },
        });

        if (publishedProduct?.active && hasPublicMultiStore(publishedProduct)) {
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
