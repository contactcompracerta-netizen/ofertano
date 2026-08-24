import type { PrismaClient } from "@prisma/client";

import { MAX_FAVORITE_IDS } from "@/lib/favorites/constants";
import { normalizeFavoriteIds } from "@/lib/favorites/ids";

export const FAVORITE_PRODUCT_SELECT = {
  id: true,
  name: true,
  image: true,
  price: true,
  oldPrice: true,
  discount: true,
  store: true,
  brand: true,
  installments: true,
  rating: true,
  reviews: true,
  stock: true,
} as const;

export type FavoriteProductRecord = {
  id: string;
  name: string;
  image: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  store: string;
  brand: string | null;
  installments: string | null;
  rating: number | null;
  reviews: number | null;
  stock: number | null;
};

export function parseFavoriteProductIds(input: unknown) {
  return normalizeFavoriteIds(input, MAX_FAVORITE_IDS);
}

export async function loadFavoriteProducts(
  prisma: Pick<PrismaClient, "product">,
  ids: string[],
): Promise<FavoriteProductRecord[]> {
  const unique = parseFavoriteProductIds(ids);

  if (unique.length === 0) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      id: {
        in: unique,
      },
      active: true,
    },
    select: FAVORITE_PRODUCT_SELECT,
  });

  const order = new Map(unique.map((id, index) => [id, index]));

  products.sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );

  return products;
}
