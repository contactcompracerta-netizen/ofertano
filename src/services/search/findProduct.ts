import type { Marketplace } from "@prisma/client";

import prisma from "@/lib/prisma";
import type { MarketplaceKey } from "@/services/importers/core/detector";

const marketplaceDatabase: Record<
  MarketplaceKey,
  Marketplace
> = {
  mercadolivre: "MERCADO_LIVRE",
  amazon: "AMAZON",
  shopee: "SHOPEE",
  magazineluiza: "MAGAZINE_LUIZA",
  casasbahia: "CASAS_BAHIA",
  kabum: "KABUM",
  terabyte: "TERABYTE",
  aliexpress: "ALIEXPRESS",
  carrefour: "CARREFOUR",
};

export async function findProduct(
  marketplace: MarketplaceKey,
  externalId: string,
) {
  const codigo = externalId.trim();

  if (!codigo) {
    return null;
  }

  const oferta =
    await prisma.marketplaceOffer.findUnique({
      where: {
        marketplace_externalId: {
          marketplace:
            marketplaceDatabase[marketplace],
          externalId: codigo,
        },
      },
      select: {
        product: true,
      },
    });

  if (oferta?.product) {
    return oferta.product;
  }

  /*
   * Compatibilidade temporária com produtos antigos
   * do Mercado Livre que ainda utilizam mlId.
   */
  if (marketplace === "mercadolivre") {
    return prisma.product.findUnique({
      where: {
        mlId: codigo,
      },
    });
  }

  return null;
}