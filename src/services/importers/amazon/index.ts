import { carregarPaginaAmazon } from "./api";
import { parseAmazonProduct } from "./parser";

import type { ProductImport } from "../core/types";

export async function importarAmazon(
  url: string
): Promise<ProductImport> {
  const $ = await carregarPaginaAmazon(url);

  const product = parseAmazonProduct($, url);

  const discount =
    product.oldPrice &&
    product.oldPrice > product.price
      ? Math.round(
          ((product.oldPrice - product.price) /
            product.oldPrice) *
            100
        )
      : null;

  return {
    marketplace: "Amazon",

    externalId: product.asin,

    url: product.affiliateLink,

    title: product.title,

    description:
      product.description ?? null,

    brand: product.brand ?? null,

    category:
      product.category ?? null,

    image: product.image,

    images: product.images,

    price: product.price,

    oldPrice:
      product.oldPrice ?? null,

    discount,

    installments: null,

    rating:
      product.rating ?? null,

    reviews:
      product.reviews ?? null,

    sales: null,

    stock: null,

    seller: "Amazon",

    attributes: {},
  };
}