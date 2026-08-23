import prisma from "@/lib/prisma";

import type {
  Marketplace,
} from "@prisma/client";

import type {
  MarketplaceName,
} from "@/services/importers/core/types";

export type MarketplaceMultiloja =
  | Marketplace
  | MarketplaceName;

export type ReferenciaMultiloja = {
  marketplace: MarketplaceMultiloja;
  sourceUrl: string;
  affiliateLink: string | null;
};

function normalizarMarketplaceMultiloja(
  marketplace: MarketplaceMultiloja,
): Marketplace {
  switch (marketplace) {
    case "MERCADO_LIVRE":
    case "Mercado Livre":
      return "MERCADO_LIVRE";

    case "AMAZON":
    case "Amazon":
      return "AMAZON";

    case "SHOPEE":
    case "Shopee":
      return "SHOPEE";

    case "MAGAZINE_LUIZA":
    case "Magazine Luiza":
      return "MAGAZINE_LUIZA";

    case "ALIEXPRESS":
    case "AliExpress":
      return "ALIEXPRESS";

    default:
      throw new Error(
        `Marketplace nao suportado pelo Multi Loja: ${marketplace}`,
      );
  }
}

function criarUrlFilaMultiloja(
  sourceUrl: string,
  productId: string,
): string {
  const original =
    sourceUrl.trim();

  if (!original) {
    throw new Error(
      "Multi Loja sem URL de referencia.",
    );
  }

  const marcador =
    `ofertano-multiloja=${encodeURIComponent(
      productId,
    )}`;

  try {
    const url =
      new URL(original);

    const hashAtual =
      url.hash
        .replace(/^#/, "")
        .trim();

    url.hash =
      hashAtual
        ? `${hashAtual}&${marcador}`
        : marcador;

    return url.toString();
  } catch {
    return (
      original +
      (
        original.includes("#")
          ? "&"
          : "#"
      ) +
      marcador
    );
  }
}

export async function agendarComparacaoMultiloja(
  productId: string,
  referencia: ReferenciaMultiloja,
): Promise<boolean> {
  const id =
    productId.trim();

  const sourceUrl =
    referencia.sourceUrl.trim();

  if (!id || !sourceUrl) {
    return false;
  }

  const marketplace =
    normalizarMarketplaceMultiloja(
      referencia.marketplace,
    );

  const url =
    criarUrlFilaMultiloja(
      sourceUrl,
      id,
    );

  const existente =
    await prisma.importQueue.findUnique({
      where: {
        url,
      },

      select: {
        id: true,
        status: true,
      },
    });

  if (!existente) {
    await prisma.importQueue.create({
      data: {
        url,
        marketplace,
        status: "PENDING",
        productId: id,

        affiliateLink:
          referencia.affiliateLink,
      },
    });

    return true;
  }

  if (
    existente.status ===
    "PROCESSING"
  ) {
    return true;
  }

  await prisma.importQueue.update({
    where: {
      id:
        existente.id,
    },

    data: {
      marketplace,

      status:
        "PENDING",

      productId:
        id,

      affiliateLink:
        referencia.affiliateLink,

      errorMessage:
        null,

      processedAt:
        null,
    },
  });

  return true;
}

export async function agendarComparacaoMultilojaDoProduto(
  productId: string,
  marketplaceName: MarketplaceMultiloja,
): Promise<boolean> {
  const marketplace =
    normalizarMarketplaceMultiloja(
      marketplaceName,
    );

  const oferta =
    await prisma.marketplaceOffer.findUnique({
      where: {
        productId_marketplace: {
          productId,
          marketplace,
        },
      },

      select: {
        sourceUrl: true,
        affiliateLink: true,
      },
    });

  const sourceUrl =
    oferta?.sourceUrl?.trim();

  if (!sourceUrl) {
    return false;
  }

  return agendarComparacaoMultiloja(
    productId,
    {
      marketplace,
      sourceUrl,

      affiliateLink:
        oferta?.affiliateLink ??
        null,
    },
  );
}
