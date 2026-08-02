import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (authorization) {
    const [tipo, credenciais] = authorization.split(" ");

    if (tipo === "Basic" && credenciais) {
      const dados = atob(credenciais);
      const separador = dados.indexOf(":");

      const usuario = dados.slice(0, separador);
      const senha = dados.slice(separador + 1);

      const usuarioCorreto = process.env.ADMIN_USER;
      const senhaCorreta = process.env.ADMIN_PASSWORD;

      if (
        usuarioCorreto &&
        senhaCorreta &&
        usuario === usuarioCorreto &&
        senha === senhaCorreta
      ) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse(
    "Acesso restrito ao administrador.",
    {
      status: 401,
      headers: {
        "WWW-Authenticate":
          'Basic realm="Painel Ofertano"',
        "Cache-Control": "no-store",
      },
    }
  );
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/import-product/v2/:path*",
    "/api/import-queue/:path*",
    "/api/opportunities/:path*",
  ],
};