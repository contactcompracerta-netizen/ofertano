import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { mercadoLivreFetch } from "@/lib/mercadolivre";

import { carregarPaginaAmazon } from "@/services/importers/amazon/api";
import { buscarOfertaShopeePorIds } from "@/services/importers/shopee/api";
import { carregarPaginaMagazineLuiza } from "@/services/importers/magazineluiza/api";
import { carregarPaginaAliExpress } from "@/services/importers/aliexpress/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKETPLACES = [
  "MERCADO_LIVRE",
  "AMAZON",
  "SHOPEE",
  "MAGAZINE_LUIZA",
  "ALIEXPRESS",
] as const;

type MarketplaceAtivo =
  (typeof MARKETPLACES)[number];

function marketplaceValido(
  valor: string,
): valor is MarketplaceAtivo {
  return (
    MARKETPLACES as readonly string[]
  ).includes(valor);
}

function comoRegistro(
  valor: unknown,
): Record<string, unknown> | null {
  if (
    typeof valor !== "object" ||
    valor === null ||
    Array.isArray(valor)
  ) {
    return null;
  }

  return valor as Record<
    string,
    unknown
  >;
}

async function ultimaOferta(
  marketplace: MarketplaceAtivo,
) {
  return prisma.marketplaceOffer.findFirst({
    where: {
      marketplace,
    },

    orderBy: {
      updatedAt: "desc",
    },

    select: {
      externalId: true,
      sourceUrl: true,
      affiliateLink: true,
    },
  });
}

function obterUrl(
  oferta:
    | {
        sourceUrl:
          | string
          | null;
        affiliateLink:
          | string
          | null;
      }
    | null,
  nome: string,
): string {
  const url =
    oferta?.sourceUrl?.trim() ||
    oferta?.affiliateLink?.trim() ||
    "";

  if (!url) {
    throw new Error(
      `Não existe uma oferta de ${nome} com URL disponível para teste.`,
    );
  }

  return url;
}

function extrairIdsShopee(
  externalId:
    | string
    | null,
  sourceUrl:
    | string
    | null,
): {
  shopId: string;
  itemId: string;
} {
  const codigo =
    externalId?.trim() || "";

  const porExternalId =
    codigo.match(
      /^(\d+)\.(\d+)$/,
    );

  if (
    porExternalId?.[1] &&
    porExternalId?.[2]
  ) {
    return {
      shopId:
        porExternalId[1],
      itemId:
        porExternalId[2],
    };
  }

  const endereco =
    sourceUrl?.trim() || "";

  if (endereco) {
    try {
      const url =
        new URL(endereco);

      const pathname =
        decodeURIComponent(
          url.pathname,
        );

      const slug =
        pathname.match(
          /-i\.(\d+)\.(\d+)(?:\/|$)/i,
        );

      if (
        slug?.[1] &&
        slug?.[2]
      ) {
        return {
          shopId: slug[1],
          itemId: slug[2],
        };
      }

      const produto =
        pathname.match(
          /\/product\/(\d+)\/(\d+)(?:\/|$)/i,
        );

      if (
        produto?.[1] &&
        produto?.[2]
      ) {
        return {
          shopId:
            produto[1],
          itemId:
            produto[2],
        };
      }
    } catch {
      // Continua para o erro
      // abaixo.
    }
  }

  throw new Error(
    "Não foi possível identificar shopId e itemId da oferta da Shopee.",
  );
}

async function testarMercadoLivre() {
  const resposta =
    await mercadoLivreFetch(
      "/users/me",
    );

  const usuario =
    comoRegistro(resposta);

  if (!usuario?.id) {
    throw new Error(
      "O Mercado Livre respondeu, mas não retornou o usuário autenticado.",
    );
  }

  return {
    detail:
      `OAuth validado. Usuário ${String(
        usuario.id,
      )}.`,
  };
}

async function testarAmazon() {
  const oferta =
    await ultimaOferta(
      "AMAZON",
    );

  const url =
    obterUrl(
      oferta,
      "Amazon",
    );

  await carregarPaginaAmazon(
    url,
  );

  return {
    detail:
      "Página de produto da Amazon carregada com sucesso.",
  };
}

async function testarShopee() {
  const oferta =
    await ultimaOferta(
      "SHOPEE",
    );

  if (!oferta) {
    throw new Error(
      "Nenhuma oferta da Shopee disponível para teste.",
    );
  }

  const {
    shopId,
    itemId,
  } = extrairIdsShopee(
    oferta.externalId,
    oferta.sourceUrl,
  );

  const resposta =
    await buscarOfertaShopeePorIds(
      shopId,
      itemId,
    );

  if (
    !resposta.offerLink?.trim()
  ) {
    throw new Error(
      "A Shopee respondeu, mas não retornou link de afiliado.",
    );
  }

  return {
    detail:
      `Affiliate API validada para ${shopId}.${itemId}.`,
  };
}

async function testarMagazineLuiza() {
  const oferta =
    await ultimaOferta(
      "MAGAZINE_LUIZA",
    );

  const url =
    obterUrl(
      oferta,
      "Magazine Luiza",
    );

  await carregarPaginaMagazineLuiza(
    url,
  );

  return {
    detail:
      "Vitrine Magazine Você respondeu com sucesso.",
  };
}

async function testarAliExpress() {
  const oferta =
    await ultimaOferta(
      "ALIEXPRESS",
    );

  const url =
    obterUrl(
      oferta,
      "AliExpress",
    );

  const resposta =
    await carregarPaginaAliExpress(
      url,
    );

  if (
    !resposta.affiliateLink?.trim()
  ) {
    throw new Error(
      "O AliExpress respondeu, mas não retornou link de afiliado.",
    );
  }

  return {
    detail:
      "Affiliate API do AliExpress respondeu com link de afiliado válido.",
  };
}

export async function POST(
  request: Request,
) {
  const inicio =
    Date.now();

  try {
    const body =
      await request
        .json()
        .catch(() => null);

    const marketplace =
      typeof body?.marketplace ===
      "string"
        ? body.marketplace
            .trim()
            .toUpperCase()
        : "";

    if (
      !marketplaceValido(
        marketplace,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Marketplace inválido.",
        },
        {
          status: 400,
        },
      );
    }

    let resultado: {
      detail: string;
    };

    switch (marketplace) {
      case "MERCADO_LIVRE":
        resultado =
          await testarMercadoLivre();
        break;

      case "AMAZON":
        resultado =
          await testarAmazon();
        break;

      case "SHOPEE":
        resultado =
          await testarShopee();
        break;

      case "MAGAZINE_LUIZA":
        resultado =
          await testarMagazineLuiza();
        break;

      case "ALIEXPRESS":
        resultado =
          await testarAliExpress();
        break;
    }

    return NextResponse.json({
      success: true,

      marketplace,

      detail:
        resultado.detail,

      durationMs:
        Date.now() - inicio,

      testedAt:
        new Date()
          .toISOString(),
    });
  } catch (error) {
    console.error(
      "Erro no teste de integração:",
      error,
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Erro ao testar integração.",

        durationMs:
          Date.now() -
          inicio,

        testedAt:
          new Date()
            .toISOString(),
      },
      {
        status: 502,
      },
    );
  }
}