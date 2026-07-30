import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    const returnedState = request.nextUrl.searchParams.get("state");

    const codeVerifier = request.cookies.get("ml_code_verifier")?.value;
    const savedState = request.cookies.get("ml_oauth_state")?.value;

    if (!code) {
      return NextResponse.json(
        { error: "Código de autorização não encontrado." },
        { status: 400 }
      );
    }

    if (!codeVerifier) {
      return NextResponse.json(
        { error: "code_verifier não encontrado." },
        { status: 400 }
      );
    }

    if (savedState !== returnedState) {
      return NextResponse.json(
        { error: "State inválido." },
        { status: 400 }
      );
    }

    const response = await fetch(
      "https://api.mercadolibre.com/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: process.env.MERCADO_LIVRE_CLIENT_ID!,
          client_secret: process.env.MERCADO_LIVRE_CLIENT_SECRET!,
          redirect_uri: process.env.MERCADO_LIVRE_REDIRECT_URI!,
          code,
          code_verifier: codeVerifier,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, {
        status: response.status,
      });
    }

    const expiresAt = new Date(
      Date.now() + Number(data.expires_in) * 1000
    );

    await prisma.marketplaceConnection.upsert({
      where: {
        marketplace: "MERCADO_LIVRE",
      },
      update: {
        sellerId: String(data.user_id),
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
      },
      create: {
        marketplace: "MERCADO_LIVRE",
        sellerId: String(data.user_id),
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
      },
    });

    console.log("Mercado Livre conectado!");
    console.log("Usuário:", data.user_id);

    const res = NextResponse.json({
      success: true,
      message: "Mercado Livre conectado e salvo no banco com sucesso.",
    });

    res.cookies.delete("ml_code_verifier");
    res.cookies.delete("ml_oauth_state");

    return res;
  } catch (error) {
    console.error("Erro no callback Mercado Livre:", error);

    return NextResponse.json(
      {
        error: "Erro interno ao conectar com o Mercado Livre.",
      },
      {
        status: 500,
      }
    );
  }
}