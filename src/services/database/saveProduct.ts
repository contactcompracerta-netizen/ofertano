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

function normalizarLinkAfiliado(
  valor: string
): string {
  let link = valor.trim();

  /*
   * Corrige links duplicados como:
   *
   * https://meli.la/https://meli.la/22dhEQL
   *
   * Resultado:
   *
   * https://meli.la/22dhEQL
   */
  while (true) {
    const linkDuplicado = link.match(
      /^https?:\/\/(?:www\.)?meli\.la\/(https?:\/\/.+)$/i
    );

    if (!linkDuplicado?.[1]) {
      break;
    }

    link = linkDuplicado[1].trim();
  }

  return link;
}

export async function saveProduct(
  product: ProductImport,
  affiliateLinkOverride?: string | null
) {
  const slug = criarSlug(
    product.title,
    product.externalId
  );

  const linkRecebido =
    affiliateLinkOverride?.trim() ||
    product.url;

  const affiliateLink =
    normalizarLinkAfiliado(linkRecebido);

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
        affiliateLink,
        price: product.price,
        oldPrice: product.oldPrice,
        discount: product.discount,
        installments: product.installments,
        rating: product.rating,
        reviews: product.reviews,
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
        affiliateLink,
        price: product.price,
        oldPrice: product.oldPrice,
        discount: product.discount,
        installments: product.installments,
        rating: product.rating,
        reviews: product.reviews,
        stock: product.stock,
        specifications: product.attributes,
        active: true,
        featured: false,
      },
    });

    if (
      product.marketplace ===
      "Mercado Livre"
    ) {
      await tx.marketplaceOffer.upsert({
        where: {
          productId_marketplace: {
            productId: saved.id,
            marketplace:
              "MERCADO_LIVRE",
          },
        },

        update: {
          affiliateLink,
          price: product.price,
          oldPrice: product.oldPrice,
          installments:
            product.installments,
          stock: product.stock,
          active: true,
        },

        create: {
          productId: saved.id,
          marketplace:
            "MERCADO_LIVRE",
          affiliateLink,
          price: product.price,
          oldPrice: product.oldPrice,
          installments:
            product.installments,
          stock: product.stock,
          active: true,
        },
      });
    }

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
      ultimoRegistro.price !==
        product.price
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