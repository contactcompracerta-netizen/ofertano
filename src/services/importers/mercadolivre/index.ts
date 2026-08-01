import type { ProductImport } from "../core/types";

import {
  getCatalogItems,
  getCatalogProduct,
  getCategory,
  getDescription,
  getItem,
  getReviews,
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
} {
  const decoded = decodificarLink(link);
  const url = new URL(link);

  // Links de páginas de produto podem conter também um "wid".
  // O catálogo deve ter prioridade porque o anúncio do wid pode estar restrito.
  const catalogPath = url.pathname.match(
    /\/p\/(MLB-?\d+)/i
  );

  if (catalogPath?.[1]) {
    return {
      itemId: null,
      catalogId: normalizarId(catalogPath[1]),
    };
  }

  const itemParam = decoded.match(
    /(?:wid|item_id)\s*(?:=|:)\s*(MLB-?\d+)/i
  );

  if (itemParam?.[1]) {
    return {
      itemId: normalizarId(itemParam[1]),
      catalogId: null,
    };
  }

  const itemPath = url.pathname.match(
    /\/(MLB-?\d+)(?:-|\/|$)/i
  );

  if (itemPath?.[1]) {
    return {
      itemId: normalizarId(itemPath[1]),
      catalogId: null,
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
      getCatalogItems(catalogId),
    ]);

  const oferta = escolherOferta(
    catalogItems.results ?? [],
    catalog.buy_box_winner?.item_id
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

  const { itemId, catalogId } =
    extrairIds(resolvedUrl);

  if (itemId) {
    return importarAnuncio(
      itemId,
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
