import prisma from "@/lib/prisma";

import {
  getItem,
  getCategory,
  getDescription,
  getReviews,
} from "./api";

import { parseMercadoLivreProduct } from "./parser";

export async function importMercadoLivreProduct(itemId: string) {
  // Busca o produto
  const item = await getItem(itemId);

  // Busca informações complementares em paralelo
  const [category, reviews] = await Promise.all([
    getCategory(item.category_id),
    getReviews(itemId).catch(() => null),
  ]);

  // Apenas para validar que o anúncio possui descrição
  await getDescription(itemId).catch(() => null);

  const product = parseMercadoLivreProduct(
    item,
    category,
    reviews ?? undefined
  );

  return prisma.product.upsert({
    where: {
      mlId: product.mlId,
    },

    update: {
      ...product,
    },

    create: {
      ...product,
    },
  });
}