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

type MercadoLivreApplicationGrant = {
  user_id?: number | string;
  app_id?: number | string;
  date_created?: string;
  scopes?: string[];
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

    /*
     * 1. Valida o token e identifica
     *    o usuário autenticado.
     */
    const userResponse = await fetch(
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

    const userText =
      await userResponse.text();

    let userData:
      | MercadoLivreUser
      | string = userText;

    try {
      userData = JSON.parse(
        userText,
      ) as MercadoLivreUser;
    } catch {
      // Mantém como texto.
    }

    if (!userResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          tokenValid: false,

          savedSellerId:
            connection.sellerId,

          mercadoLivreStatus:
            userResponse.status,

          mercadoLivreResponse:
            userData,
        },
        {
          status: userResponse.status,
        },
      );
    }

    const authenticatedUserId =
      typeof userData === "object" &&
      userData.id !== undefined
        ? String(userData.id)
        : null;

    /*
     * 2. Consulta os Grants existentes
     *    para este usuário.
     *
     * A resposta informa os scopes
     * efetivamente concedidos.
     */
    let grants:
      MercadoLivreApplicationGrant[] = [];

    let grantsStatus:
      number | null = null;

    let grantsError:
      string | null = null;

    if (authenticatedUserId) {
      try {
        const grantsResponse =
          await fetch(
            `https://api.mercadolibre.com/users/${encodeURIComponent(
              authenticatedUserId,
            )}/applications`,
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

        grantsStatus =
          grantsResponse.status;

        const grantsText =
          await grantsResponse.text();

        if (grantsResponse.ok) {
          const parsed =
            JSON.parse(grantsText);

          if (Array.isArray(parsed)) {
            grants =
              parsed as MercadoLivreApplicationGrant[];
          }
        } else {
          grantsError =
            grantsText;
        }
      } catch (error) {
        grantsError =
          error instanceof Error
            ? error.message
            : "Erro ao consultar Grants.";
      }
    }

    /*
     * 3. Localiza especificamente
     *    o Grant da aplicação Ofertano.
     */
    const clientId =
      process.env.MERCADO_LIVRE_CLIENT_ID ??
      null;

    const grantOfertano =
      clientId
        ? grants.find(
            (grant) =>
              String(
                grant.app_id ?? "",
              ) === String(clientId),
          ) ?? null
        : null;

    const scopes =
      Array.isArray(
        grantOfertano?.scopes,
      )
        ? grantOfertano.scopes
        : [];

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
        typeof userData === "object"
          ? userData.nickname ?? null
          : null,

      accountStatus:
        typeof userData === "object"
          ? userData.status
              ?.site_status ?? null
          : null,

      tokenExpiresAt:
        connection.expiresAt.toISOString(),

      grantDiagnostic: {
        grantsStatus,

        grantFound:
          Boolean(grantOfertano),

        scopes,

        hasRead:
          scopes.includes("read"),

        hasWrite:
          scopes.includes("write"),

        hasOfflineAccess:
          scopes.includes(
            "offline_access",
          ),

        grantsError,
      },
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