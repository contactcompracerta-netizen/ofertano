import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.json(
      {
        error: "Código de autorização não recebido.",
      },
      {
        status: 400,
      }
    );
  }

  try {
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
          code,
          redirect_uri: process.env.MERCADO_LIVRE_REDIRECT_URI!,
        }),
      }
    );

    const data = await response.json();

    return NextResponse.json(data, {
      status: response.status,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Erro ao gerar o Access Token.",
      },
      {
        status: 500,
      }
    );
  }
}