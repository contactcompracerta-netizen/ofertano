import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import {
  getAccessToken,
} from "@/lib/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MercadoLivreUser = {
  id?: number | string;
  nickname?: string;

  status?: {
    site_status?: string;
  };
};

export async function GET() {
  try {
    const connection =
      await prisma.marketplaceConnection.findUnique({
        where: {
          marketplace:
            "MERCADO_LIVRE",
        },
      });

    if (!connection) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Não existe conexão do Mercado Livre salva no banco.",
        },
        {
          status: 404,
        },
      );
    }

    const token =
      await getAccessToken();

    const response = await fetch(
      "https://api.mercadolibre.com/users/me",
      {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${token}`,

          Accept:
            "application/json",
        },

        cache: "no-store",
      },
    );

    const texto =
      await response.text();

    let data:
      | MercadoLivreUser
      | string = texto;

    try {
      data = JSON.parse(
        texto,
      ) as MercadoLivreUser;
    } catch {
      // Mantém o conteúdo como texto
      // quando a resposta não for JSON.
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          tokenValid: false,

          savedSellerId:
            connection.sellerId,

          mercadoLivreStatus:
            response.status,

          mercadoLivreResponse:
            data,
        },
        {
          status: response.status,
        },
      );
    }

    const authenticatedUserId =
      typeof data === "object" &&
      data.id !== undefined
        ? String(data.id)
        : null;

    return NextResponse.json({
      success: true,
      tokenValid: true,

      savedSellerId:
        connection.sellerId,

      authenticatedUserId,

      sellerIdMatches:
        authenticatedUserId ===
        connection.sellerId,

      nickname:
        typeof data === "object"
          ? data.nickname ?? null
          : null,

      accountStatus:
        typeof data === "object"
          ? data.status
              ?.site_status ?? null
          : null,

      tokenExpiresAt:
        connection.expiresAt.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro desconhecido.";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}