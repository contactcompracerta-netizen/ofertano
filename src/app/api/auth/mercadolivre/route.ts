import {
  createHash,
  randomBytes,
} from "node:crypto";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function base64Url(
  buffer: Buffer,
): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET() {
  const clientId =
    process.env.MERCADO_LIVRE_CLIENT_ID;

  const redirectUri =
    process.env.MERCADO_LIVRE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        success: false,
        error:
          "MERCADO_LIVRE_CLIENT_ID ou MERCADO_LIVRE_REDIRECT_URI não configurado.",
      },
      {
        status: 500,
      },
    );
  }

  const codeVerifier = base64Url(
    randomBytes(64),
  );

  const codeChallenge = base64Url(
    createHash("sha256")
      .update(codeVerifier)
      .digest(),
  );

  const state = base64Url(
    randomBytes(32),
  );

  const authorizationUrl = new URL(
    "https://auth.mercadolivre.com.br/authorization",
  );

  authorizationUrl.searchParams.set(
    "response_type",
    "code",
  );

  authorizationUrl.searchParams.set(
    "client_id",
    clientId,
  );

  authorizationUrl.searchParams.set(
    "redirect_uri",
    redirectUri,
  );

  authorizationUrl.searchParams.set(
    "state",
    state,
  );

  authorizationUrl.searchParams.set(
    "code_challenge",
    codeChallenge,
  );

  authorizationUrl.searchParams.set(
    "code_challenge_method",
    "S256",
  );

  const response =
    NextResponse.redirect(
      authorizationUrl,
    );

  const secure =
    process.env.NODE_ENV === "production";

  response.cookies.set(
    "ml_code_verifier",
    codeVerifier,
    {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    },
  );

  response.cookies.set(
    "ml_oauth_state",
    state,
    {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    },
  );

  return response;
}
