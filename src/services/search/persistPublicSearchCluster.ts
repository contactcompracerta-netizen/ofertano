import prisma from "@/lib/prisma";

import {
  saveProduct,
  sincronizarMelhorOfertaDoProduto,
} from "@/services/database/saveProduct";

import {
  agruparPorIdentidadeExata,
  avaliarCompatibilidadeComConsulta,
  avaliarCompatibilidadeExataEntreImports,
  pontuarEspecificidadeDaConsulta,
  pontuarEvidenciaIdentidade,
} from "@/services/identity";

import type { ProductImport } from "@/services/importers/core/types";

export type PublicSearchOffer = {
  product: ProductImport;
  affiliateLink?: string | null;
};

export type PersistPublicSearchClusterResult = {
  productId: string;
  storeCount: number;
};

function oneOfferPerMarketplace(
  offers: PublicSearchOffer[],
): PublicSearchOffer[] {
  const byMarketplace = new Map<string, PublicSearchOffer>();

  for (const offer of offers) {
    const current = byMarketplace.get(offer.product.marketplace);

    if (!current) {
      byMarketplace.set(offer.product.marketplace, offer);
      continue;
    }

    const currentHasLink = Boolean(current.affiliateLink?.trim());
    const nextHasLink = Boolean(offer.affiliateLink?.trim());

    if (nextHasLink !== currentHasLink) {
      byMarketplace.set(
        offer.product.marketplace,
        nextHasLink ? offer : current,
      );
      continue;
    }

    if (offer.product.price < current.product.price) {
      byMarketplace.set(offer.product.marketplace, offer);
    }
  }

  return Array.from(byMarketplace.values());
}

function sortOffersForPersistence(
  offers: PublicSearchOffer[],
): PublicSearchOffer[] {
  return [...offers].sort((first, second) => {
    const identityDifference =
      pontuarEvidenciaIdentidade({ product: second.product }) -
      pontuarEvidenciaIdentidade({ product: first.product });

    if (identityDifference !== 0) {
      return identityDifference;
    }

    const firstHasLink = Number(Boolean(first.affiliateLink?.trim()));
    const secondHasLink = Number(Boolean(second.affiliateLink?.trim()));

    if (firstHasLink !== secondHasLink) {
      return secondHasLink - firstHasLink;
    }

    return first.product.price - second.product.price;
  });
}

function pickBestExactCluster(
  query: string,
  offers: PublicSearchOffer[],
): PublicSearchOffer[] {
  const clusters = agruparPorIdentidadeExata(
    offers.map((offer) => ({
      item: offer,
      product: offer.product,
    })),
  );

  const ranked = clusters
    .map((cluster) => {
      const members = oneOfferPerMarketplace(
        cluster.members.map((member) => member.item),
      );
      const queryScore = Math.max(
        ...members.map(
          (member) =>
            avaliarCompatibilidadeComConsulta(query, {
              title: member.product.title,
              brand: member.product.brand,
              attributes: member.product.attributes,
            }).score,
        ),
      );
      const lowestPrice = Math.min(
        ...members.map((member) => member.product.price),
      );
      const specificity = Math.max(
        ...members.map((member) =>
          pontuarEspecificidadeDaConsulta(query, {
            title: member.product.title,
            brand: member.product.brand,
            attributes: member.product.attributes,
          }),
        ),
      );

      return {
        members,
        storeCount: members.length,
        queryScore,
        specificity,
        lowestPrice,
        identityScore: pontuarEvidenciaIdentidade(cluster.anchor),
      };
    })
    .sort((first, second) => {
      if (first.specificity !== second.specificity) {
        return second.specificity - first.specificity;
      }

      if (first.storeCount !== second.storeCount) {
        return second.storeCount - first.storeCount;
      }

      if (first.queryScore !== second.queryScore) {
        return second.queryScore - first.queryScore;
      }

      if (first.identityScore !== second.identityScore) {
        return second.identityScore - first.identityScore;
      }

      return first.lowestPrice - second.lowestPrice;
    });

  return ranked[0]?.members ?? [];
}

export function escolherClusterExatoDaPesquisaPublica(
  query: string,
  offers: PublicSearchOffer[],
): PublicSearchOffer[] {
  const compatibleOffers = offers.filter((offer) =>
    avaliarCompatibilidadeComConsulta(query, {
      title: offer.product.title,
      brand: offer.product.brand,
      attributes: offer.product.attributes,
    }).compatible,
  );

  if (compatibleOffers.length === 0) {
    return [];
  }

  return pickBestExactCluster(query, compatibleOffers);
}

export async function persistPublicSearchCluster(
  query: string,
  offers: PublicSearchOffer[],
  existingProductId?: string | null,
): Promise<PersistPublicSearchClusterResult | null> {
  const cluster = escolherClusterExatoDaPesquisaPublica(query, offers);

  if (cluster.length === 0) {
    return null;
  }

  if (existingProductId) {
    const existing = await prisma.product.findUnique({
      where: { id: existingProductId },
      select: {
        name: true,
        canonicalName: true,
        brand: true,
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

    if (existing) {
      const specifications =
        existing.specifications &&
        typeof existing.specifications === "object" &&
        !Array.isArray(existing.specifications)
          ? Object.fromEntries(
              Object.entries(
                existing.specifications as Record<string, unknown>,
              )
                .filter(([, value]) => value !== null && value !== undefined)
                .map(([key, value]) => [key, String(value)]),
            )
          : {};

      const catalogIdentity = {
        title: existing.canonicalName?.trim() || existing.name,
        brand: existing.brand,
        attributes: {
          ...specifications,
          ...(existing.modelNumber ? { MODEL: existing.modelNumber } : {}),
          ...(existing.ean ? { EAN: existing.ean } : {}),
          ...(existing.gtin ? { GTIN: existing.gtin } : {}),
          ...(existing.mpn ? { MPN: existing.mpn } : {}),
          ...(existing.color ? { COLOR: existing.color } : {}),
          ...(existing.voltage ? { VOLTAGE: existing.voltage } : {}),
          ...(existing.size ? { SIZE: existing.size } : {}),
        },
      };

      const exactWithCatalog = cluster.every((member) =>
        avaliarCompatibilidadeExataEntreImports(
          catalogIdentity,
          member.product,
        ).exact,
      );

      if (!exactWithCatalog) {
        existingProductId = null;
      }
    }
  }

  const ordered = sortOffersForPersistence(cluster);
  let productId = existingProductId?.trim() || null;

  for (const offer of ordered) {
    const saved = await saveProduct(
      offer.product,
      offer.affiliateLink?.trim() || offer.product.affiliateLink || null,
      productId
        ? {
            targetProductId: productId,
            verifiedExactMatch: true,
            discoverySource: "ON_DEMAND_SEARCH",
            autoCreated: true,
            sourceQuery: query,
            suppressPublicationSync: true,
          }
        : {
            discoverySource: "ON_DEMAND_SEARCH",
            autoCreated: true,
            sourceQuery: query,
            suppressPublicationSync: true,
          },
    );

    if (productId && saved.id !== productId) {
      throw new Error(
        `Persistencia Multi Loja desviou do Product canonico ${productId} para ${saved.id}.`,
      );
    }

    productId = saved.id;
  }

  if (!productId) {
    return null;
  }

  await prisma.$transaction(async (tx) => {
    await sincronizarMelhorOfertaDoProduto(tx, productId!);
  });

  return {
    productId,
    storeCount: ordered.length,
  };
}
