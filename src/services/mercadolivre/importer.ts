import prisma from "@/lib/prisma";

import {
  getItem,
  getCategory,
  getDescription,
  getReviews,
} from "./api";

import { parseMercadoLivreProduct } from "./parser";

export async function importMercadoLivreProduct(itemId: string) {
  console.log("1 - Buscando produto...");
  const item = await getItem(itemId);

  console.log("2 - Produto OK");

  console.log("3 - Buscando categoria...");
  const category = await getCategory(item.category_id);

  console.log("4 - Categoria OK");

  console.log("5 - Buscando descrição...");
  await getDescription(itemId).catch((e) => {
    console.error("Descrição:", e.message);
  });

  console.log("6 - Buscando reviews...");
  const reviews = await getReviews(itemId).catch((e) => {
    console.error("Reviews:", e.message);
    return null;
  });

  console.log("7 - Salvando produto...");

  const product = parseMercadoLivreProduct(
    item,
    category,
    reviews ?? undefined
  );

  return prisma.product.upsert({
    where: {
      mlId: product.mlId,
    },
    update: product,
    create: product,
  });
}