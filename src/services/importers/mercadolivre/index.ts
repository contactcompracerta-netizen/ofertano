import type { ProductImport } from "../core/types";

import {
  getCatalogItems,
  getCatalogProduct,
  getCategory,
  getDescription,
  getReviews,
} from "./api";

import { parseMercadoLivre } from "./parser";

import type {
  MercadoLivreCatalogOffer,
  MercadoLivreResolvedProduct,
} from "./types";

function normalizarId(
  id: string
): string {
  return id
    .replace("-", "")
    .toUpperCase();
}

function decodificarLink(
  link: string
): string {
  try {
    return decodeURIComponent(link);
  } catch {
    return link;
  }
}

function extrairIds(
  link: string
): {
  itemId: string | null;
  catalogId: string | null;
} {
  const decoded =
    decodificarLink(link);

  let url: URL;

  try {
    url = new URL(link);
  } catch {
    throw new Error(
      "O link informado não é válido."
    );
  }

  /*
   * Links de páginas de catálogo possuem:
   *
   * /p/MLB12345678
   *
   * Esses links têm prioridade mesmo quando
   * também existe um parâmetro wid no endereço.
   */
  const catalogPath =
    url.pathname.match(
      /\/p\/(MLB-?\d+)/i
    );

  if (catalogPath?.[1]) {
    return {
      itemId: null,
      catalogId:
        normalizarId(
          catalogPath[1]
        ),
    };
  }

  /*
   * Alguns links podem trazer o código do
   * produto de catálogo em parâmetros.
   */
  const catalogParam =
    decoded.match(
      /(?:catalog_product_id|product_id)\s*(?:=|:)\s*(MLB-?\d+)/i
    );

  if (catalogParam?.[1]) {
    return {
      itemId: null,
      catalogId:
        normalizarId(
          catalogParam[1]
        ),
    };
  }

  /*
   * O parâmetro wid identifica um anúncio
   * específico de um vendedor.
   */
  const itemParam =
    decoded.match(
      /(?:wid|item_id)\s*(?:=|:)\s*(MLB-?\d+)/i
    );

  if (itemParam?.[1]) {
    return {
      itemId:
        normalizarId(
          itemParam[1]
        ),
      catalogId: null,
    };
  }

  /*
   * Links antigos de anúncio podem possuir
   * o MLB diretamente no caminho.
   */
  const itemPath =
    url.pathname.match(
      /\/(MLB-?\d+)(?:-|\/|$)/i
    );

  if (itemPath?.[1]) {
    return {
      itemId:
        normalizarId(
          itemPath[1]
        ),
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
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      "O link informado não é válido."
    );
  }

  const hostname =
    url.hostname.toLowerCase();

  if (
    hostname !== "meli.la" &&
    !hostname.endsWith(".meli.la")
  ) {
    return rawUrl;
  }

  const response =
    await fetch(rawUrl, {
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
  ofertas:
    MercadoLivreCatalogOffer[],
  winnerItemId?: string
): MercadoLivreCatalogOffer {
  const validas =
    ofertas.filter(
      (oferta) =>
        typeof oferta.item_id ===
          "string" &&
        typeof oferta.price ===
          "number" &&
        oferta.price > 0 &&
        oferta.status !==
          "inactive" &&
        oferta.status !==
          "closed"
    );

  if (validas.length === 0) {
    throw new Error(
      "Nenhum anúncio ativo foi encontrado para este produto."
    );
  }

  if (winnerItemId) {
    const vencedora =
      validas.find(
        (oferta) =>
          oferta.item_id ===
          winnerItemId
      );

    if (vencedora) {
      return vencedora;
    }
  }

  return validas.sort(
    (a, b) =>
      (
        a.price ??
        Number.MAX_VALUE
      ) -
      (
        b.price ??
        Number.MAX_VALUE
      )
  )[0];
}

async function importarCatalogo(
  catalogId: string,
  originalUrl: string
): Promise<ProductImport> {
  const [
    catalog,
    catalogItems,
  ] = await Promise.all([
    getCatalogProduct(
      catalogId
    ),

    getCatalogItems(
      catalogId
    ),
  ]);

  const oferta =
    escolherOferta(
      catalogItems.results ?? [],
      catalog.buy_box_winner
        ?.item_id
    );

  const itemId =
    oferta.item_id;

  if (!itemId) {
    throw new Error(
      "O Mercado Livre não retornou o código da oferta."
    );
  }

  const [
    category,
    description,
    reviews,
  ] = await Promise.all([
    oferta.category_id
      ? tentar(
          getCategory(
            oferta.category_id
          )
        )
      : Promise.resolve(null),

    tentar(
      getDescription(itemId)
    ),

    tentar(
      getReviews(itemId)
    ),
  ]);

  const price =
    oferta.price;

  if (
    typeof price !== "number" ||
    price <= 0
  ) {
    throw new Error(
      "O Mercado Livre não retornou um preço válido."
    );
  }

  const originalPrice =
    typeof oferta.original_price ===
      "number" &&
    oferta.original_price > price
      ? oferta.original_price
      : null;

  const resolved:
    MercadoLivreResolvedProduct = {
    itemId,

    title:
      catalog.name?.trim() ||
      catalog.family_name?.trim() ||
      `Produto ${catalogId}`,

    price,

    originalPrice,

    categoryName:
      category?.name?.trim() ||
      "Ofertas",

    sellerId:
      typeof oferta.seller_id ===
      "number"
        ? oferta.seller_id
        : null,

    availableQuantity:
      typeof oferta.available_quantity ===
      "number"
        ? oferta.available_quantity
        : null,

    soldQuantity:
      typeof oferta.sold_quantity ===
      "number"
        ? oferta.sold_quantity
        : null,

    condition:
      oferta.condition ?? null,

    warranty:
      oferta.warranty ?? null,

    pictures:
      catalog.pictures ?? [],

    attributes:
      catalog.attributes ?? [],

    description:
      description
        ?.plain_text
        ?.trim() ||
      description
        ?.text
        ?.trim() ||
      null,

    rating:
      typeof reviews
        ?.rating_average ===
      "number"
        ? reviews.rating_average
        : null,

    reviews:
      typeof reviews?.total ===
      "number"
        ? reviews.total
        : typeof reviews
              ?.paging
              ?.total ===
            "number"
          ? reviews.paging.total
          : null,
  };

  return parseMercadoLivre(
    resolved,
    originalUrl
  );
}

function criarErroLinkDeAnuncio(
  itemId: string
): Error {
  return new Error(
    `O link informado é de um anúncio individual (${itemId}). ` +
      "O Mercado Livre não permite que o Ofertano consulte esse tipo de anúncio pela API. " +
      "Abra a página principal do produto e copie o endereço que contém /p/MLB."
  );
}

export async function importarMercadoLivre(
  rawUrl: string
): Promise<ProductImport> {
  const originalUrl =
    rawUrl.trim();

  if (!originalUrl) {
    throw new Error(
      "Cole o link do produto do Mercado Livre."
    );
  }

  const resolvedUrl =
    await resolverLinkCurto(
      originalUrl
    );

  const {
    itemId,
    catalogId,
  } = extrairIds(
    resolvedUrl
  );

  if (catalogId) {
    return importarCatalogo(
      catalogId,
      originalUrl
    );
  }

  if (itemId) {
    throw criarErroLinkDeAnuncio(
      itemId
    );
  }

  throw new Error(
    "Não foi possível identificar o produto."
  );
}