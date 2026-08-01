import prisma from "@/lib/prisma";
import type { ProductImport } from "@/services/importers/core/types";

function criarSlug(
  texto: string,
  externalId: string
): string {
  const base = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  return `${base}-${externalId.toLowerCase()}`;
}

export async function saveProduct(
  product: ProductImport
) {
  const slug = criarSlug(
    product.title,
    product.externalId
  );

  return prisma.$transaction(async (tx) => {
    const saved = await tx.product.upsert({
      where: {
        mlId: product.externalId,
      },

      update: {
        name: product.title,
        slug,
        image: product.image,
        images: product.images,
        brand: product.brand,
        description: product.description,
        category:
          product.category ?? "Ofertas",
        store: product.marketplace,
        affiliateLink: product.url,
        price: product.price,
        oldPrice: product.oldPrice,
        discount: product.discount,
        installments: product.installments,
        rating: product.rating,
        reviews: product.reviews,
        sales: product.sales,
        stock: product.stock,
        specifications: product.attributes,
        active: true,
      },

      create: {
        mlId: product.externalId,
        name: product.title,
        slug,
        image: product.image,
        images: product.images,
        video: null,
        brand: product.brand,
        description: product.description,
        category:
          product.category ?? "Ofertas",
        store: product.marketplace,
        affiliateLink: product.url,
        price: product.price,
        oldPrice: product.oldPrice,
        discount: product.discount,
        installments: product.installments,
        rating: product.rating,
        reviews: product.reviews,
        sales: product.sales,
        stock: product.stock,
        specifications: product.attributes,
        active: true,
        featured: false,
      },
    });

    const ultimoRegistro =
      await tx.priceHistory.findFirst({
        where: {
          productId: saved.id,
        },
        orderBy: {
          recordedAt: "desc",
        },
      });

    if (
      !ultimoRegistro ||
      ultimoRegistro.price !== product.price
    ) {
      await tx.priceHistory.create({
        data: {
          productId: saved.id,
          price: product.price,
        },
      });
    }

    return saved;
  });
}
