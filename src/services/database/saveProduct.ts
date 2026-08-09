import prisma from "@/lib/prisma";

import type { ProductImport } from "@/services/importers/core/types";

type MarketplaceDatabase =
  | "MERCADO_LIVRE"
  | "AMAZON"
  | "SHOPEE"
  | "MAGAZINE_LUIZA"
  | "ALIEXPRESS";

type DiscoverySourceDatabase =
  | "MANUAL"
  | "OPPORTUNITY"
  | "ON_DEMAND_SEARCH"
  | "PRICE_MONITOR"
  | "API";

export type SaveProductOptions = {
  targetProductId?: string | null;
  discoverySource?: DiscoverySourceDatabase;
  autoCreated?: boolean;
  sourceQuery?: string | null;
};

function criarSlug(
  texto: string,
  marketplace: MarketplaceDatabase,
  externalId: string,
): string {
  const base = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

  const loja = marketplace
    .toLowerCase()
    .replaceAll("_", "-");

  const codigo = externalId
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  return `${base}-${loja}-${codigo}`;
}

function normalizarLinkAfiliado(
  valor: string,
): string {
  let link = valor.trim();

  while (true) {
    const linkDuplicado = link.match(
      /^https?:\/\/(?:www\.)?meli\.la\/(https?:\/\/.+)$/i,
    );

    if (!linkDuplicado?.[1]) {
      break;
    }

    link = linkDuplicado[1].trim();
  }

  return link;
}

function converterMarketplace(
  marketplace: ProductImport["marketplace"],
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

    default: {
      const marketplaceNunca: never = marketplace;

      throw new Error(
        `Marketplace nÃ£o suportado: ${String(
          marketplaceNunca,
        )}`,
      );
    }
  }
}

function nomeMarketplace(
  marketplace: MarketplaceDatabase,
): string {
  const nomes: Record<
    MarketplaceDatabase,
    string
  > = {
    MERCADO_LIVRE: "Mercado Livre",
    AMAZON: "Amazon",
    SHOPEE: "Shopee",
    MAGAZINE_LUIZA: "Magazine Luiza",
    ALIEXPRESS: "AliExpress",
  };

  return nomes[marketplace];
}

function normalizarTextoIdentificador(
  valor: string,
): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizarChaveAtributo(
  valor: string,
): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function encontrarAtributo(
  atributos: Record<string, string>,
  nomes: readonly string[],
): string | null {
  const nomesNormalizados = nomes.map(
    normalizarChaveAtributo,
  );

  for (const [chave, valor] of Object.entries(
    atributos,
  )) {
    const chaveNormalizada =
      normalizarChaveAtributo(chave);

    const encontrado = nomesNormalizados.some(
      (nome) =>
        chaveNormalizada === nome ||
        chaveNormalizada.includes(nome),
    );

    if (encontrado && valor.trim()) {
      return valor.trim();
    }
  }

  return null;
}

function normalizarCodigoNumerico(
  valor: string | null,
): string | null {
  if (!valor) {
    return null;
  }

  const numeros = valor.replace(/\D/g, "");

  if (
    numeros.length < 8 ||
    numeros.length > 14
  ) {
    return null;
  }

  return numeros;
}

function normalizarCodigoProduto(
  valor: string | null,
): string | null {
  if (!valor) {
    return null;
  }

  const codigo = normalizarTextoIdentificador(
    valor,
  )
    .replace(/[^A-Z0-9._/-]+/g, "")
    .slice(0, 100);

  return codigo || null;
}

function extrairIdentificadores(
  product: ProductImport,
) {
  const eanEncontrado = encontrarAtributo(
    product.attributes,
    [
      "EAN",
      "CODIGO_EAN",
      "CODIGO_DE_BARRAS",
      "BARCODE",
    ],
  );

  const gtinEncontrado = encontrarAtributo(
    product.attributes,
    [
      "GTIN",
      "GTIN_8",
      "GTIN_12",
      "GTIN_13",
      "GTIN_14",
      "UPC",
      "ISBN",
    ],
  );

  const mpnEncontrado = encontrarAtributo(
    product.attributes,
    [
      "MPN",
      "PART_NUMBER",
      "NUMERO_DA_PECA",
      "CODIGO_DO_FABRICANTE",
      "REFERENCIA_DO_FABRICANTE",
    ],
  );

  const modeloEncontrado = encontrarAtributo(
    product.attributes,
    [
      "MODELO",
      "MODEL",
      "MODEL_NUMBER",
      "NUMERO_DO_MODELO",
      "CODIGO_DO_MODELO",
    ],
  );

  const ean = normalizarCodigoNumerico(
    eanEncontrado,
  );

  const gtin = normalizarCodigoNumerico(
    gtinEncontrado,
  );

  const mpn = normalizarCodigoProduto(
    mpnEncontrado,
  );

  const modelNumber = normalizarCodigoProduto(
    modeloEncontrado,
  );

  return {
    ean,
    gtin,
    mpn,
    modelNumber,
  };
}

function criarCanonicalKey(
  product: ProductImport,
  identificadores: ReturnType<
    typeof extrairIdentificadores
  >,
): string | null {
  const codigoGlobal =
    identificadores.gtin ||
    identificadores.ean;

  if (codigoGlobal) {
    return `gtin:${codigoGlobal}`;
  }

  const codigoFabricante =
    identificadores.mpn ||
    identificadores.modelNumber;

  const marca = product.brand
    ? normalizarTextoIdentificador(
        product.brand,
      )
    : null;

  if (marca && codigoFabricante) {
    return [
      "brand-model",
      marca,
      codigoFabricante,
    ].join(":");
  }

  return null;
}

function calcularDesconto(
  oldPrice: number | null,
  price: number,
): number | null {
  if (
    oldPrice === null ||
    oldPrice <= price ||
    oldPrice <= 0
  ) {
    return null;
  }

  return Math.round(
    ((oldPrice - price) / oldPrice) * 100,
  );
}

function obterDescontoProduto(
  product: ProductImport,
): number | null {
  const calculado = calcularDesconto(
    product.oldPrice,
    product.price,
  );

  if (calculado !== null) {
    return calculado;
  }

  const informado = product.discount;

  if (
    informado === null ||
    !Number.isFinite(informado) ||
    informado <= 0 ||
    informado >= 100
  ) {
    return null;
  }

  return Math.round(informado);
}

function precoMudou(
  precoAnterior: number | null | undefined,
  precoAtual: number,
): boolean {
  if (
    precoAnterior === null ||
    precoAnterior === undefined
  ) {
    return true;
  }

  return (
    Math.abs(precoAnterior - precoAtual) >
    0.009
  );
}

function unirImagens(
  atuais: string[],
  novas: string[],
  imagemPrincipal: string,
): string[] {
  return Array.from(
    new Set(
      [
        ...atuais,
        imagemPrincipal,
        ...novas,
      ]
        .map((imagem) => imagem.trim())
        .filter(Boolean),
    ),
  );
}

export async function saveProduct(
  product: ProductImport,
  affiliateLinkOverride?: string | null,
  options: SaveProductOptions = {},
) {
  const externalId =
    product.externalId.trim();

  if (!externalId) {
    throw new Error(
      "O produto nÃ£o possui identificador externo.",
    );
  }

  if (
    !Number.isFinite(product.price) ||
    product.price <= 0
  ) {
    throw new Error(
      "O produto nÃ£o possui um preÃ§o vÃ¡lido.",
    );
  }

  const marketplace = converterMarketplace(
    product.marketplace,
  );

  const sourceUrl = product.url.trim();

  if (!sourceUrl) {
    throw new Error(
      "O produto nÃ£o possui uma URL de origem.",
    );
  }

  const linkInformado =
    affiliateLinkOverride?.trim()
      ? normalizarLinkAfiliado(
          affiliateLinkOverride,
        )
      : null;

  const identificadores =
    extrairIdentificadores(product);

  const canonicalKey = criarCanonicalKey(
    product,
    identificadores,
  );

  const slug = criarSlug(
    product.title,
    marketplace,
    externalId,
  );

  const discoverySource =
    options.discoverySource ?? "MANUAL";

  const agora = new Date();

  return prisma.$transaction(async (tx) => {
    const ofertaPeloCodigo =
      await tx.marketplaceOffer.findUnique({
        where: {
          marketplace_externalId: {
            marketplace,
            externalId,
          },
        },
        include: {
          product: true,
        },
      });

    const produtoPeloCanonicalKey =
      canonicalKey
        ? await tx.product.findUnique({
            where: {
              canonicalKey,
            },
          })
        : null;

    let saved =
      ofertaPeloCodigo?.product ?? null;

    if (
      !saved &&
      marketplace === "MERCADO_LIVRE"
    ) {
      saved = await tx.product.findUnique({
        where: {
          mlId: externalId,
        },
      });
    }

    if (
      !saved &&
      options.targetProductId
    ) {
      saved = await tx.product.findUnique({
        where: {
          id: options.targetProductId,
        },
      });
    }

    if (
      !saved &&
      produtoPeloCanonicalKey
    ) {
      saved = produtoPeloCanonicalKey;
    }

    if (!saved) {
      saved = await tx.product.create({
        data: {
          mlId:
            marketplace ===
            "MERCADO_LIVRE"
              ? externalId
              : null,

          name: product.title,
          slug,

          canonicalName: product.title,
          canonicalKey,

          modelNumber:
            identificadores.modelNumber,
          ean: identificadores.ean,
          gtin: identificadores.gtin,
          mpn: identificadores.mpn,

          image: product.image,
          images: unirImagens(
            [],
            product.images,
            product.image,
          ),

          video: null,
          brand: product.brand,
          description:
            product.description,

          specifications:
            product.attributes,

          category:
            product.category ?? "Ofertas",

          store: nomeMarketplace(
            marketplace,
          ),

          affiliateLink:
            linkInformado ?? "",

          price: product.price,
          oldPrice: product.oldPrice,
          installments:
            product.installments,
          discount:
            obterDescontoProduto(product),

          rating: product.rating,
          reviews: product.reviews,
          sales: product.sales,
          stock: product.stock,

          publicationStatus:
            linkInformado
              ? "LIVE_COMPLETE"
              : "LIVE_PARTIAL",

          autoCreated:
            options.autoCreated ?? false,

          sourceQuery:
            options.sourceQuery?.trim() ||
            null,

          lastSearchedAt:
            discoverySource ===
            "ON_DEMAND_SEARCH"
              ? agora
              : null,

          active: true,
          featured: false,
        },
      });
    } else {
      const mesmaOferta =
        ofertaPeloCodigo?.productId ===
          saved.id ||
        (marketplace ===
          "MERCADO_LIVRE" &&
          saved.mlId === externalId);

      const atualizarDadosPrincipais =
        mesmaOferta || saved.autoCreated;

      const canonicalKeyPermitida =
        !canonicalKey
          ? saved.canonicalKey
          : !produtoPeloCanonicalKey ||
              produtoPeloCanonicalKey.id ===
                saved.id
            ? canonicalKey
            : saved.canonicalKey;

      saved = await tx.product.update({
        where: {
          id: saved.id,
        },
        data: {
          mlId:
            marketplace ===
            "MERCADO_LIVRE"
              ? externalId
              : saved.mlId,

          name: atualizarDadosPrincipais
            ? product.title
            : saved.name,

          slug: saved.slug ?? slug,

          canonicalName:
            saved.canonicalName ??
            product.title,

          canonicalKey:
            canonicalKeyPermitida,

          modelNumber:
            saved.modelNumber ??
            identificadores.modelNumber,

          ean:
            saved.ean ??
            identificadores.ean,

          gtin:
            saved.gtin ??
            identificadores.gtin,

          mpn:
            saved.mpn ??
            identificadores.mpn,

          image: atualizarDadosPrincipais
            ? product.image
            : saved.image,

          images: unirImagens(
            saved.images,
            product.images,
            product.image,
          ),

          brand:
            saved.brand ?? product.brand,

          description:
            atualizarDadosPrincipais
              ? product.description
              : saved.description ??
                product.description,

          specifications:
            atualizarDadosPrincipais
              ? product.attributes
              : undefined,

          category:
            saved.category === "Ofertas"
              ? product.category ??
                saved.category
              : saved.category,

          rating:
            atualizarDadosPrincipais
              ? product.rating
              : saved.rating,

          reviews:
            atualizarDadosPrincipais
              ? product.reviews
              : saved.reviews,

          sales:
            atualizarDadosPrincipais
              ? product.sales
              : saved.sales,

          sourceQuery:
            options.sourceQuery?.trim() ||
            saved.sourceQuery,

          lastSearchedAt:
            discoverySource ===
            "ON_DEMAND_SEARCH"
              ? agora
              : saved.lastSearchedAt,

          autoCreated:
            saved.autoCreated ||
            Boolean(options.autoCreated),

          active: true,
        },
      });
    }

    const ofertaAtual =
      ofertaPeloCodigo?.productId ===
      saved.id
        ? ofertaPeloCodigo
        : await tx.marketplaceOffer.findUnique({
            where: {
              productId_marketplace: {
                productId: saved.id,
                marketplace,
              },
            },
          });

    const linkExistente =
      ofertaAtual?.affiliateLink?.trim() ||
      null;

    const affiliateLink =
      linkInformado ?? linkExistente;

    const disponivel =
      product.stock === null ||
      product.stock > 0;

    const status =
      !disponivel
        ? "UNAVAILABLE"
        : affiliateLink
          ? "ACTIVE"
          : ofertaAtual?.status ===
              "UNDER_REVIEW"
            ? "UNDER_REVIEW"
            : "PENDING_AFFILIATE";

    const mudouPreco = precoMudou(
      ofertaAtual?.price,
      product.price,
    );

    const oferta =
      await tx.marketplaceOffer.upsert({
        where: {
          productId_marketplace: {
            productId: saved.id,
            marketplace,
          },
        },

        update: {
          externalId,
          sourceUrl,

          affiliateLink,

          title: product.title,
          image: product.image,
          seller: product.seller,

          price: product.price,
          oldPrice: product.oldPrice,
          installments:
            product.installments,
          stock: product.stock,

          status,

          matchStatus:
            ofertaPeloCodigo ||
            produtoPeloCanonicalKey?.id ===
              saved.id
              ? "EXACT"
              : "HIGH",

          discoverySource,

          active: true,
          available: disponivel,

          reviewReason: affiliateLink
            ? null
            : ofertaAtual?.reviewReason ??
              "Aguardando link individual de afiliado.",

          errorMessage: null,

          affiliateValidatedAt:
            linkInformado
              ? agora
              : ofertaAtual
                  ?.affiliateValidatedAt ??
                null,

          reviewedAt:
            linkInformado
              ? agora
              : ofertaAtual?.reviewedAt ??
                null,

          lastCheckedAt: agora,

          lastPriceChangeAt:
            mudouPreco
              ? agora
              : ofertaAtual
                  ?.lastPriceChangeAt ??
                null,

          consecutiveErrors: 0,
        },

        create: {
          productId: saved.id,
          marketplace,

          externalId,
          sourceUrl,

          affiliateLink,

          title: product.title,
          image: product.image,
          seller: product.seller,

          price: product.price,
          oldPrice: product.oldPrice,
          installments:
            product.installments,
          stock: product.stock,

          status,

          matchStatus:
            produtoPeloCanonicalKey?.id ===
            saved.id
              ? "EXACT"
              : "HIGH",

          discoverySource,

          active: true,
          available: disponivel,
          isBest: false,

          reviewReason: affiliateLink
            ? null
            : "Aguardando link individual de afiliado.",

          errorMessage: null,

          affiliateValidatedAt:
            linkInformado ? agora : null,

          reviewedAt:
            linkInformado ? agora : null,

          lastCheckedAt: agora,

          lastPriceChangeAt: agora,

          consecutiveErrors: 0,
        },
      });

    const ultimoHistorico =
      await tx.priceHistory.findFirst({
        where: {
          offerId: oferta.id,
        },
        orderBy: {
          recordedAt: "desc",
        },
      });

    if (
      !ultimoHistorico ||
      precoMudou(
        ultimoHistorico.price,
        product.price,
      )
    ) {
      await tx.priceHistory.create({
        data: {
          productId: saved.id,
          offerId: oferta.id,
          marketplace,

          price: product.price,
          oldPrice: product.oldPrice,

          source: discoverySource,
        },
      });
    }

    const ofertasDoProduto =
      await tx.marketplaceOffer.findMany({
        where: {
          productId: saved.id,
          active: true,
        },
        orderBy: {
          price: "asc",
        },
      });

    const melhorOferta =
      ofertasDoProduto.find(
        (item) =>
          item.available &&
          item.status !== "UNAVAILABLE" &&
          item.status !== "ERROR",
      ) ?? ofertasDoProduto[0];

    await tx.marketplaceOffer.updateMany({
      where: {
        productId: saved.id,
        isBest: true,
      },
      data: {
        isBest: false,
      },
    });

    if (melhorOferta) {
      await tx.marketplaceOffer.update({
        where: {
          id: melhorOferta.id,
        },
        data: {
          isBest: true,
        },
      });
    }

    const possuiOfertaAtiva =
      ofertasDoProduto.some(
        (item) =>
          item.status === "ACTIVE" &&
          Boolean(
            item.affiliateLink?.trim(),
          ),
      );

    const possuiOfertaPendente =
      ofertasDoProduto.some((item) =>
        [
          "DISCOVERED",
          "PENDING_AFFILIATE",
          "UNDER_REVIEW",
        ].includes(item.status),
      );

    const publicationStatus =
      possuiOfertaPendente ||
      !possuiOfertaAtiva
        ? "LIVE_PARTIAL"
        : "LIVE_COMPLETE";

    if (!melhorOferta) {
      return tx.product.update({
        where: {
          id: saved.id,
        },
        data: {
          publicationStatus,
          active: true,
        },
      });
    }

    return tx.product.update({
      where: {
        id: saved.id,
      },
      data: {
        store: nomeMarketplace(
          melhorOferta.marketplace as MarketplaceDatabase,
        ),

        affiliateLink:
          melhorOferta.affiliateLink?.trim() ||
          "",

        price: melhorOferta.price,
        oldPrice: melhorOferta.oldPrice,

        installments:
          melhorOferta.installments,

        stock: melhorOferta.stock,

        discount:
          melhorOferta.id === oferta.id
            ? obterDescontoProduto(product)
            : calcularDesconto(
                melhorOferta.oldPrice,
                melhorOferta.price,
              ),

        publicationStatus,
        active: true,
      },
    });
  });
}