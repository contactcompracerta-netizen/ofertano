import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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

  // ====================================================
  // AQUI depois iremos salvar no banco (Supabase)
  // ====================================================

  console.log("Mercado Livre conectado!");
  console.log("Usuário:", data.user_id);

  const res = NextResponse.json({
    success: true,
    message: "Mercado Livre conectado com sucesso.",
  });

  res.cookies.delete("ml_code_verifier");
  res.cookies.delete("ml_oauth_state");

  return res;
}