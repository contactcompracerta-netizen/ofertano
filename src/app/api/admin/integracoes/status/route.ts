import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarketplaceAtivo =
  | "MERCADO_LIVRE"
  | "AMAZON"
  | "SHOPEE"
  | "MAGAZINE_LUIZA"
  | "ALIEXPRESS";

function envConfigurada(nome: string) {
  return Boolean(process.env[nome]?.trim());
}

async function obterResumo(
  marketplace: MarketplaceAtivo,
) {
  const [
    totalOfertas,
    ofertasAtivas,
    ultimaOferta,
  ] = await Promise.all([
    prisma.marketplaceOffer.count({
      where: {
        marketplace,
      },
    }),

    prisma.marketplaceOffer.count({
      where: {
        marketplace,
        active: true,
      },
    }),

    prisma.marketplaceOffer.findFirst({
      where: {
        marketplace,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        updatedAt: true,
        status: true,
      },
    }),
  ]);

  return {
    totalOffers: totalOfertas,
    activeOffers: ofertasAtivas,
    lastActivity:
      ultimaOferta?.updatedAt.toISOString() ??
      null,
    lastOfferStatus:
      ultimaOferta?.status ?? null,
  };
}

export async function GET() {
  try {
    const [
      mercadoLivre,
      amazon,
      shopee,
      magazineLuiza,
      aliexpress,
      conexaoMercadoLivre,
    ] = await Promise.all([
      obterResumo("MERCADO_LIVRE"),
      obterResumo("AMAZON"),
      obterResumo("SHOPEE"),
      obterResumo("MAGAZINE_LUIZA"),
      obterResumo("ALIEXPRESS"),

      prisma.marketplaceConnection.findUnique({
        where: {
          marketplace: "MERCADO_LIVRE",
        },
        select: {
          sellerId: true,
          expiresAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const mercadoLivreConfigurado =
      envConfigurada(
        "MERCADO_LIVRE_CLIENT_ID",
      ) &&
      envConfigurada(
        "MERCADO_LIVRE_CLIENT_SECRET",
      ) &&
      envConfigurada(
        "MERCADO_LIVRE_REDIRECT_URI",
      );

    const mercadoLivreConectado =
      mercadoLivreConfigurado &&
      Boolean(conexaoMercadoLivre);

    const shopeeConfigurada =
      envConfigurada(
        "SHOPEE_AFFILIATE_APP_ID",
      ) &&
      envConfigurada(
        "SHOPEE_AFFILIATE_SECRET",
      );

    const aliexpressConfigurado =
      envConfigurada(
        "ALIEXPRESS_APP_KEY",
      ) &&
      envConfigurada(
        "ALIEXPRESS_APP_SECRET",
      );

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),

      integrations: [
        {
          marketplace: "MERCADO_LIVRE",
          name: "Mercado Livre",
          authMode: "OAuth",

          configured:
            mercadoLivreConfigurado,

          connected:
            mercadoLivreConectado,

          status:
            mercadoLivreConectado
              ? "READY"
              : mercadoLivreConfigurado
                ? "DISCONNECTED"
                : "CONFIG_REQUIRED",

          message:
            mercadoLivreConectado
              ? "Conta conectada por OAuth."
              : mercadoLivreConfigurado
                ? "Credenciais configuradas, mas a conta precisa ser conectada."
                : "Credenciais OAuth incompletas.",

          sellerId:
            conexaoMercadoLivre?.sellerId ??
            null,

          tokenExpiresAt:
            conexaoMercadoLivre?.expiresAt.toISOString() ??
            null,

          connectionUpdatedAt:
            conexaoMercadoLivre?.updatedAt.toISOString() ??
            null,

          ...mercadoLivre,
        },

        {
          marketplace: "AMAZON",
          name: "Amazon",
          authMode: "Programa de Afiliados",

          configured: true,
          connected: true,
          status: "READY",

          message:
            "Importação e geração de links afiliados configuradas.",

          affiliateTag: "ofertano-20",

          ...amazon,
        },

        {
          marketplace: "SHOPEE",
          name: "Shopee",
          authMode: "Affiliate API",

          configured:
            shopeeConfigurada,

          connected:
            shopeeConfigurada,

          status:
            shopeeConfigurada
              ? "READY"
              : "CONFIG_REQUIRED",

          message:
            shopeeConfigurada
              ? "Credenciais da Shopee Affiliate API configuradas."
              : "Credenciais da Shopee Affiliate API incompletas.",

          ...shopee,
        },

        {
          marketplace: "MAGAZINE_LUIZA",
          name: "Magazine Luiza",
          authMode: "Magazine Você",

          configured: true,
          connected: true,
          status: "READY",

          message:
            "Vitrine afiliada configurada.",

          affiliateStore:
            "magazineofertanobr",

          ...magazineLuiza,
        },

        {
          marketplace: "ALIEXPRESS",
          name: "AliExpress",
          authMode: "Affiliate API",

          configured:
            aliexpressConfigurado,

          connected:
            aliexpressConfigurado,

          status:
            aliexpressConfigurado
              ? "READY"
              : "CONFIG_REQUIRED",

          message:
            aliexpressConfigurado
              ? "Credenciais da AliExpress Affiliate API configuradas."
              : "Credenciais da AliExpress Affiliate API incompletas.",

          ...aliexpress,
        },
      ],
    });
  } catch (error) {
    console.error(
      "Erro ao carregar status das integrações:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar status das integrações.",
      },
      {
        status: 500,
      },
    );
  }
}