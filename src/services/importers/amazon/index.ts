import type { ProductImport } from "../core/types";

import { carregarPaginaAmazon } from "./api";
import { parseAmazonProduct } from "./parser";

export async function importarAmazon(
  rawUrl: string,
): Promise<ProductImport> {
  const url = rawUrl.trim();

  if (!url) {
    throw new Error(
      "Cole o link do produto da Amazon.",
    );
  }

  const pagina =
    await carregarPaginaAmazon(url);

  const product = parseAmazonProduct(
    pagina.$,
    pagina.originalUrl,
    pagina.finalUrl,
  );

  const discount =
    product.oldPrice !== undefined &&
    product.oldPrice > product.price
      ? Math.round(
          ((product.oldPrice -
            product.price) /
            product.oldPrice) *
            100,
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

    stock: product.stock,

    seller:
      product.seller ?? "Amazon",

    attributes: product.attributes,
  };
}