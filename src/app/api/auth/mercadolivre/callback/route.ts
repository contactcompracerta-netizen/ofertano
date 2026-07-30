import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.json(
      {
        error: oauthError,
        description:
          request.nextUrl.searchParams.get("error_description") ??
          "Autorização cancelada ou recusada.",
      },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json(
      {
        error: "Código de autorização não recebido.",
      },
      { status: 400 }
    );
  }

  const clientId = process.env.MERCADO_LIVRE_CLIENT_ID;
  const clientSecret = process.env.MERCADO_LIVRE_CLIENT_SECRET;
  const redirectUri = process.env.MERCADO_LIVRE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      {
        error: "Variáveis do Mercado Livre não configuradas.",
      },
      { status: 500 }
    );
  }

  const codeVerifier = request.cookies.get(
    "mercadolivre_code_verifier"
  )?.value;

  if (!codeVerifier) {
    return NextResponse.json(
      {
        error:
          "code_verifier não encontrado. Inicie novamente a autorização.",
      },
      { status: 400 }
    );
  }

  try {
    const tokenResponse = await fetch(
      "https://api.mercadolibre.com/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
        cache: "no-store",
      }
    );

    const data = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return NextResponse.json(data, {
        status: tokenResponse.status,
      });
    }

    const response = NextResponse.json({
      message: "Mercado Livre conectado com sucesso.",
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      user_id: data.user_id,
      token_type: data.token_type,
    });

    response.cookies.delete("mercadolivre_code_verifier");

    return response;
  } catch (error) {
    console.error("Erro no OAuth do Mercado Livre:", error);

    return NextResponse.json(
      {
        error: "Erro interno ao gerar o Access Token.",
      },
      { status: 500 }
    );
  }
}