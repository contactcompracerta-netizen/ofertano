import type { ProductImport } from "../core/types";

import {
  getCatalogItems,
  getCatalogProduct,
  getCategory,
  getDescription,
  getItem,
  getReviews,
  getUserProduct,
  searchUserProductItems,
} from "./api";

import { parseMercadoLivre } from "./parser";

import type {
  MercadoLivreCatalogOffer,
  MercadoLivreResolvedProduct,
} from "./types";

function normalizarId(id: string): string {
  return id
    .replace("-", "")
    .toUpperCase();
}

function decodificarLink(link: string): string {
  try {
    return decodeURIComponent(link);
  } catch {
    return link;
  }
}

function extrairIds(link: string): {
  itemId: string | null;
  catalogId: string | null;
  userProductId: string | null;
} {
  const decoded = decodificarLink(link);
  const url = new URL(link);

  const userProductPath =
    url.pathname.match(
      /\/up\/(MLBU-?\d+)/i
    );

  if (userProductPath?.[1]) {
    /*
     * URLs /up/ podem trazer no próprio link
     * o anúncio público correspondente:
     *
     * /up/MLBU...?...&wid=MLB...
     *
     * O endpoint /user-products/{MLBU...}
     * pode retornar 403 para produtos de terceiros.
     *
     * Quando houver wid, preferimos o item público,
     * que pode ser consultado por /items/{MLB...}.
     */
    const itemParamUserProduct =
      decoded.match(
        /(?:wid|item_id)\s*(?:=|:)\s*(MLB-?\d+)/i
      );

    if (itemParamUserProduct?.[1]) {
      return {
        itemId: normalizarId(
          itemParamUserProduct[1]
        ),
        catalogId: null,
        userProductId: null,
      };
    }

    return {
      itemId: null,
      catalogId: null,
      userProductId: normalizarId(
        userProductPath[1]
      ),
    };
  }

  /*
   * Em páginas /p/ do Mercado Livre, o fragmento da URL
   * pode trazer um wid de uma oferta específica.
   *
   * Esse wid pode estar restrito pela API mesmo quando o
   * produto de catálogo continua público e possui outras
   * ofertas válidas. Por isso o catálogo deve ter prioridade.
   */
  const catalogPath = url.pathname.match(
    /\/p\/(MLB-?\d+)/i
  );

  if (catalogPath?.[1]) {
    return {
      itemId: null,
      catalogId: normalizarId(catalogPath[1]),
      userProductId: null,
    };
  }

  const itemParam = decoded.match(
    /(?:wid|item_id)\s*(?:=|:)\s*(MLB-?\d+)/i
  );

  if (itemParam?.[1]) {
    return {
      itemId: normalizarId(itemParam[1]),
      catalogId: null,
      userProductId: null,
    };
  }

  const itemPath = url.pathname.match(
    /\/(MLB-?\d+)(?:-|\/|$)/i
  );

  if (itemPath?.[1]) {
    return {
      itemId: normalizarId(itemPath[1]),
      catalogId: null,
      userProductId: null,
    };
  }

  throw new Error(
    "Não foi possível identificar o produto no link informado."
  );
}

async function resolverLinkCurto(
  rawUrl: string
): Promise<string> {
  const url = new URL(rawUrl);

  if (
    url.hostname !== "meli.la" &&
    !url.hostname.endsWith(".meli.la")
  ) {
    return rawUrl;
  }

  const response = await fetch(rawUrl, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
  });

  return response.url || rawUrl;
}

async function tentar<T>(
  promise: Promise<T>
): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function escolherOferta(
  ofertas: MercadoLivreCatalogOffer[],
  winnerItemId?: string
): MercadoLivreCatalogOffer {
  const validas = ofertas.filter(
    (oferta) =>
      typeof oferta.item_id === "string" &&
      typeof oferta.price === "number" &&
      oferta.price > 0 &&
      oferta.status !== "inactive" &&
      oferta.status !== "closed"
  );

  if (validas.length === 0) {
    throw new Error(
      "Nenhum anúncio ativo foi encontrado para este produto."
    );
  }

  if (winnerItemId) {
    const vencedora = validas.find(
      (oferta) =>
        oferta.item_id === winnerItemId
    );

    if (vencedora) {
      return vencedora;
    }
  }

  return validas.sort(
    (a, b) =>
      (a.price ?? Number.MAX_VALUE) -
      (b.price ?? Number.MAX_VALUE)
  )[0];
}

async function importarCatalogo(
  catalogId: string,
  originalUrl: string
): Promise<ProductImport> {
  const [catalog, catalogItems] =
    await Promise.all([
      getCatalogProduct(catalogId),
      tentar(getCatalogItems(catalogId)),
    ]);

  const winnerItemId =
    catalog.buy_box_winner?.item_id;

  /*
   * Em alguns produtos de catálogo o Mercado Livre
   * responde "No winners found" em /products/{id}/items.
   *
   * Se ainda houver buy_box_winner no produto de catálogo,
   * usamos o anúncio vencedor diretamente.
   */
  if (
    (!catalogItems?.results ||
      catalogItems.results.length === 0) &&
    winnerItemId
  ) {
    return importarAnuncio(
      winnerItemId,
      originalUrl
    );
  }

  if (
    !catalogItems?.results ||
    catalogItems.results.length === 0
  ) {
    throw new Error(
      "Este produto de catálogo existe no Mercado Livre, mas nenhuma oferta ativa foi retornada pela API. Abra uma oferta de um vendedor para este mesmo produto e importe o link do anúncio."
    );
  }

  const oferta = escolherOferta(
    catalogItems.results,
    winnerItemId
  );

  const itemId = oferta.item_id!;

  const [category, description, reviews] =
    await Promise.all([
      oferta.category_id
        ? tentar(getCategory(oferta.category_id))
        : Promise.resolve(null),

      tentar(getDescription(itemId)),
      tentar(getReviews(itemId)),
    ]);

  const resolved: MercadoLivreResolvedProduct = {
    itemId,
    title:
      catalog.name?.trim() ||
      catalog.family_name?.trim() ||
      `Produto ${catalogId}`,
    price: oferta.price!,
    originalPrice:
      typeof oferta.original_price === "number" &&
      oferta.original_price > oferta.price!
        ? oferta.original_price
        : null,
    categoryName:
      category?.name?.trim() || "Ofertas",
    sellerId:
      typeof oferta.seller_id === "number"
        ? oferta.seller_id
        : null,
    availableQuantity:
      typeof oferta.available_quantity === "number"
        ? oferta.available_quantity
        : null,
    soldQuantity:
      typeof oferta.sold_quantity === "number"
        ? oferta.sold_quantity
        : null,
    condition: oferta.condition ?? null,
    warranty: oferta.warranty ?? null,
    pictures: catalog.pictures ?? [],
    attributes: catalog.attributes ?? [],
    description:
      description?.plain_text?.trim() ||
      description?.text?.trim() ||
      null,
    rating:
      typeof reviews?.rating_average === "number"
        ? reviews.rating_average
        : null,
    reviews:
      typeof reviews?.total === "number"
        ? reviews.total
        : typeof reviews?.paging?.total === "number"
          ? reviews.paging.total
          : null,
  };

  return parseMercadoLivre(
    resolved,
    originalUrl
  );
}

async function importarUserProduct(
  userProductId: string,
  originalUrl: string
): Promise<ProductImport> {
  const userProduct =
    await getUserProduct(userProductId);

  if (
    !userProduct.id ||
    typeof userProduct.user_id !== "number"
  ) {
    throw new Error(
      "O Mercado Livre não retornou os dados necessários deste User Product."
    );
  }

  const search =
    await searchUserProductItems(
      userProduct.user_id,
      userProductId
    );

  const itemIds = [
    ...new Set(
      (search.results ?? [])
        .map((id) => id.trim().toUpperCase())
        .filter((id) => /^MLB\d+$/.test(id))
    ),
  ];

  if (itemIds.length === 0) {
    throw new Error(
      "Este User Product existe no Mercado Livre, mas nenhuma oferta ativa foi localizada."
    );
  }

  const itens = (
    await Promise.all(
      itemIds.slice(0, 30).map((id) =>
        tentar(getItem(id))
      )
    )
  ).filter(
    (
      item
    ): item is NonNullable<
      Awaited<ReturnType<typeof getItem>>
    > => Boolean(item)
  );

  const ativos = itens
    .filter(
      (item) =>
        typeof item.id === "string" &&
        typeof item.price === "number" &&
        item.price > 0 &&
        item.status !== "inactive" &&
        item.status !== "closed"
    )
    .sort(
      (a, b) =>
        (a.price ?? Number.MAX_VALUE) -
        (b.price ?? Number.MAX_VALUE)
    );

  const melhorItem = ativos[0];

  if (!melhorItem?.id) {
    throw new Error(
      "Este User Product existe no Mercado Livre, mas nenhuma oferta comprável foi retornada pela API."
    );
  }

  return importarAnuncio(
    melhorItem.id,
    originalUrl
  );
}

async function importarAnuncio(
  itemId: string,
  originalUrl: string
): Promise<ProductImport> {
  const item = await getItem(itemId);

  if (!item.id) {
    throw new Error(
      "O Mercado Livre não retornou o código do anúncio."
    );
  }

  const catalog = item.catalog_product_id
    ? await tentar(
        getCatalogProduct(item.catalog_product_id)
      )
    : null;

  const [category, description, reviews] =
    await Promise.all([
      item.category_id
        ? tentar(getCategory(item.category_id))
        : Promise.resolve(null),

      tentar(getDescription(item.id)),
      tentar(getReviews(item.id)),
    ]);

  const pictures =
    item.pictures?.length
      ? item.pictures
      : catalog?.pictures?.length
        ? catalog.pictures
        : [
            {
              secure_url:
                item.secure_thumbnail ||
                item.thumbnail,
            },
          ];

  const attributes =
    item.attributes?.length
      ? item.attributes
      : catalog?.attributes ?? [];

  const price =
    typeof item.price === "number"
      ? item.price
      : 0;

  const originalPrice =
    typeof item.original_price === "number" &&
    item.original_price > price
      ? item.original_price
      : null;

  const resolved: MercadoLivreResolvedProduct = {
    itemId: item.id,
    title:
      item.title?.trim() ||
      catalog?.name?.trim() ||
      `Produto ${item.id}`,
    price,
    originalPrice,
    categoryName:
      category?.name?.trim() || "Ofertas",
    sellerId:
      typeof item.seller_id === "number"
        ? item.seller_id
        : null,
    availableQuantity:
      typeof item.available_quantity === "number"
        ? item.available_quantity
        : null,
    soldQuantity:
      typeof item.sold_quantity === "number"
        ? item.sold_quantity
        : null,
    condition: item.condition ?? null,
    warranty: item.warranty ?? null,
    pictures,
    attributes,
    description:
      description?.plain_text?.trim() ||
      description?.text?.trim() ||
      null,
    rating:
      typeof reviews?.rating_average === "number"
        ? reviews.rating_average
        : null,
    reviews:
      typeof reviews?.total === "number"
        ? reviews.total
        : typeof reviews?.paging?.total === "number"
          ? reviews.paging.total
          : null,
  };

  return parseMercadoLivre(
    resolved,
    originalUrl
  );
}

export async function importarMercadoLivre(
  rawUrl: string
): Promise<ProductImport> {
  const originalUrl = rawUrl.trim();

  if (!originalUrl) {
    throw new Error(
      "Cole o link do produto do Mercado Livre."
    );
  }

  const resolvedUrl =
    await resolverLinkCurto(originalUrl);

  const {
    itemId,
    catalogId,
    userProductId,
  } = extrairIds(resolvedUrl);

  if (itemId) {
    return importarAnuncio(
      itemId,
      originalUrl
    );
  }

  if (userProductId) {
    return importarUserProduct(
      userProductId,
      originalUrl
    );
  }

  if (catalogId) {
    return importarCatalogo(
      catalogId,
      originalUrl
    );
  }

  throw new Error(
    "Não foi possível identificar o produto."
  );
}
