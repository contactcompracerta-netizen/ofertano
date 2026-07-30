import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.MERCADO_LIVRE_CLIENT_ID;
  const redirectUri = process.env.MERCADO_LIVRE_REDIRECT_URI;

  if (!clientId) {
    return NextResponse.json(
      {
        error: "MERCADO_LIVRE_CLIENT_ID não configurado.",
      },
      {
        status: 500,
      }
    );
  }

  if (!redirectUri) {
    return NextResponse.json(
      {
        error: "MERCADO_LIVRE_REDIRECT_URI não configurado.",
      },
      {
        status: 500,
      }
    );
  }

  const authUrl = new URL(
    "https://auth.mercadolivre.com.br/authorization"
  );

  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);

  return NextResponse.redirect(authUrl.toString());
}