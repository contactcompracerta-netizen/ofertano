import { mercadoLivreFetch } from "@/lib/mercadolivre";

import type {
  MercadoLivreCatalogItems,
  MercadoLivreCatalogProduct,
  MercadoLivreCategory,
  MercadoLivreDescription,
  MercadoLivreItem,
  MercadoLivreReviews,
  MercadoLivreUserProduct,
  MercadoLivreUserProductItemSearch,
} from "./types";

export async function getItem(
  itemId: string
): Promise<MercadoLivreItem> {
  return mercadoLivreFetch(
    `/items/${itemId}`
  ) as Promise<MercadoLivreItem>;
}

export async function getCatalogProduct(
  productId: string
): Promise<MercadoLivreCatalogProduct> {
  return mercadoLivreFetch(
    `/products/${productId}`
  ) as Promise<MercadoLivreCatalogProduct>;
}

export async function getCatalogItems(
  productId: string
): Promise<MercadoLivreCatalogItems> {
  return mercadoLivreFetch(
    `/products/${productId}/items`
  ) as Promise<MercadoLivreCatalogItems>;
}

export async function getUserProduct(
  userProductId: string
): Promise<MercadoLivreUserProduct> {
  return mercadoLivreFetch(
    `/user-products/${userProductId}`
  ) as Promise<MercadoLivreUserProduct>;
}

export async function searchUserProductItems(
  userId: number,
  userProductId: string
): Promise<MercadoLivreUserProductItemSearch> {
  return mercadoLivreFetch(
    `/users/${userId}/items/search?user_product_id=${encodeURIComponent(
      userProductId
    )}`
  ) as Promise<MercadoLivreUserProductItemSearch>;
}

export async function getCategory(
  categoryId: string
): Promise<MercadoLivreCategory> {
  return mercadoLivreFetch(
    `/categories/${categoryId}`
  ) as Promise<MercadoLivreCategory>;
}

export async function getDescription(
  itemId: string
): Promise<MercadoLivreDescription> {
  return mercadoLivreFetch(
    `/items/${itemId}/description`
  ) as Promise<MercadoLivreDescription>;
}

export async function getReviews(
  itemId: string
): Promise<MercadoLivreReviews> {
  return mercadoLivreFetch(
    `/reviews/item/${itemId}`
  ) as Promise<MercadoLivreReviews>;
}