import prisma from "@/lib/prisma";

import type {
  MarketplaceName,
  ProductImport,
} from "@/services/importers/core/types";

type MarketplaceDatabase =
  | "MERCADO_LIVRE"
  | "AMAZON"
  | "SHOPEE"
  | "MAGAZINE_LUIZA"
  | "ALIEXPRESS";

function converterMarketplace(
  marketplace: MarketplaceName,
): MarketplaceDatabase {
  switch (marketplace) {
    case "Mercado Livre":
      return "MERCADO_LIVRE";

    case "Amazon":
      return "AMAZON";

    case "Shopee":
      return "SHOPEE";

    case "Magazine Luiza":
      return "MAGAZINE_LUIZA";

    case "AliExpress":
      return "ALIEXPRESS";
  }
}

/**
 * Reconstrói a referência do matcher a partir do Product canônico e da
 * MarketplaceOffer que acabaram de ser salvos. Assim todos os importadores
 * chegam ao Multi Loja com a mesma estrutura de marca, modelo, GTIN e
 * variantes, independentemente dos campos que cada marketplace retornou.
 */
export async function reconstruirReferenciaMultiloja(
  productId: string,
  marketplaceName: MarketplaceName,
): Promise<ProductImport> {
  const marketplace =
    converterMarketplace(
      marketplaceName,
    );

  const product =
    await prisma.product.findUnique({
      where: {
        id: productId,
      },

      select: {
        id: true,
        name: true,
        canonicalName: true,
        brand: true,
        description: true,
        category: true,
        image: true,
        images: true,
        price: true,
        oldPrice: true,
        discount: true,
        installments: true,
        rating: true,
        reviews: true,
        sales: true,
        stock: true,
        affiliateLink: true,
        specifications: true,
        modelNumber: true,
        ean: true,
        gtin: true,
        mpn: true,
        color: true,
        voltage: true,
        size: true,
      },
    });

  if (!product) {
    throw new Error(
      `Produto ${productId} não encontrado para o Multi Loja.`,
    );
  }

  const offer =
    await prisma.marketplaceOffer.findUnique({
      where: {
        productId_marketplace: {
          productId,
          marketplace,
        },
      },

      select: {
        externalId: true,
        sourceUrl: true,
        affiliateLink: true,
        seller: true,
        price: true,
        oldPrice: true,
        installments: true,
        stock: true,
      },
    });

  const externalId =
    offer?.externalId?.trim();

  const sourceUrl =
    offer?.sourceUrl?.trim();

  if (!offer || !externalId || !sourceUrl) {
    throw new Error(
      `Oferta ${marketplaceName} incompleta para o produto ${productId}.`,
    );
  }

  const attributes: Record<string, string> = {};

  if (
    product.specifications &&
    typeof product.specifications === "object" &&
    !Array.isArray(product.specifications)
  ) {
    for (
      const [key, value]
      of Object.entries(
        product.specifications,
      )
    ) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        attributes[key] = String(value);
      }
    }
  }

  if (product.modelNumber) {
    attributes.MODEL = product.modelNumber;
  }

  if (product.ean) {
    attributes.EAN = product.ean;
  }

  if (product.gtin) {
    attributes.GTIN = product.gtin;
  }

  if (product.mpn) {
    attributes.MPN = product.mpn;
  }

  if (product.color) {
    attributes.COLOR = product.color;
  }

  if (product.voltage) {
    attributes.VOLTAGE = product.voltage;
  }

  if (product.size) {
    attributes.SIZE = product.size;
  }

  return {
    marketplace:
      marketplaceName,

    externalId,
    url: sourceUrl,

    affiliateLink:
      offer.affiliateLink?.trim() ||
      product.affiliateLink?.trim() ||
      null,

    title:
      product.canonicalName?.trim() ||
      product.name,

    description:
      product.description,

    brand:
      product.brand,

    category:
      product.category,

    image:
      product.image,

    images:
      product.images,

    price:
      offer.price ?? product.price,

    oldPrice:
      offer.oldPrice ?? product.oldPrice,

    discount:
      product.discount,

    installments:
      offer.installments ??
      product.installments,

    rating:
      product.rating,

    reviews:
      product.reviews,

    sales:
      product.sales,

    stock:
      offer.stock ?? product.stock,

    seller:
      offer.seller,

    attributes,
  };
}
