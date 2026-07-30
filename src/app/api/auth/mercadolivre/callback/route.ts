import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const oauthErrorDescription =
    request.nextUrl.searchParams.get("error_description");

  if (oauthError) {
    return NextResponse.json(
      {
        error: oauthError,
        description:
          oauthErrorDescription ?? "Autorização cancelada ou recusada.",
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
        error: "Variáveis de ambiente do Mercado Livre não configuradas.",
      },
      { status: 500 }
    );
  }

  const codeVerifier = request.cookies.get("ml_code_verifier")?.value;
  const savedState = request.cookies.get("ml_oauth_state")?.value;

  if (!codeVerifier) {
    return NextResponse.json(
      {
        error:
          "O cookie ml_code_verifier não foi encontrado. Inicie novamente pela rota /api/auth/mercadolivre.",
      },
      { status: 400 }
    );
  }

  if (!savedState || !returnedState || savedState !== returnedState) {
    return NextResponse.json(
      {
        error: "O parâmetro state da autenticação é inválido ou expirou.",
      },
      { status: 400 }
    );
  }

  const body = new URLSearchParams();

  body.set("grant_type", "authorization_code");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("code_verifier", codeVerifier);

  try {
    const tokenResponse = await fetch(
      "https://api.mercadolibre.com/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        cache: "no-store",
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return NextResponse.json(
        {
          error: "Erro retornado pelo Mercado Livre.",
          mercadoLivreResponse: tokenData,
          verifierSent: true,
          verifierLength: codeVerifier.length,
        },
        {
          status: tokenResponse.status,
        }
      );
    }

    const response = NextResponse.json({
      message: "Mercado Livre conectado com sucesso.",
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      user_id: tokenData.user_id,
      token_type: tokenData.token_type,
    });

    response.cookies.set("ml_code_verifier", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      expires: new Date(0),
      path: "/",
    });

    response.cookies.set("ml_oauth_state", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      expires: new Date(0),
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Erro no OAuth Mercado Livre:", error);

    return NextResponse.json(
      {
        error: "Erro interno ao solicitar o token do Mercado Livre.",
      },
      { status: 500 }
    );
  }
}