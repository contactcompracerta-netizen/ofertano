import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET() {
  const clientId = process.env.MERCADO_LIVRE_CLIENT_ID;
  const redirectUri = process.env.MERCADO_LIVRE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        error:
          "MERCADO_LIVRE_CLIENT_ID ou MERCADO_LIVRE_REDIRECT_URI não configurado.",
      },
      { status: 500 }
    );
  }

  const codeVerifier = base64UrlEncode(randomBytes(32));

  const codeChallenge = base64UrlEncode(
    createHash("sha256").update(codeVerifier).digest()
  );

  const authorizationUrl = new URL(
    "https://auth.mercadolivre.com.br/authorization"
  );

  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizationUrl);

  response.cookies.set("mercadolivre_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}