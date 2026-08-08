import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    codigo: string;
  }>;
};

function converterCodigoEmPrefixo(
  codigoRaw: string,
): string | null {
  const codigo = codigoRaw
    .trim()
    .toLowerCase();

  if (!/^[0-9a-f]{12}$/.test(codigo)) {
    return null;
  }

  return `${codigo.slice(0, 8)}-${codigo.slice(8, 12)}`;
}

async function redirecionarProduto(
  request: Request,
  context: RouteContext,
) {
  const { codigo } =
    await context.params;

  const prefixo =
    converterCodigoEmPrefixo(
      codigo,
    );

  if (!prefixo) {
    return new NextResponse(
      "Link inválido.",
      {
        status: 404,
      },
    );
  }

  const produtos =
    await prisma.product.findMany({
      where: {
        id: {
          startsWith: prefixo,
        },
        active: true,
      },
      select: {
        id: true,
      },
      take: 2,
    });

  if (produtos.length !== 1) {
    return new NextResponse(
      "Produto não encontrado.",
      {
        status: 404,
      },
    );
  }

  const destino = new URL(
    `/produto/${produtos[0].id}`,
    request.url,
  );

  return NextResponse.redirect(
    destino,
    307,
  );
}

export async function GET(
  request: Request,
  context: RouteContext,
) {
  return redirecionarProduto(
    request,
    context,
  );
}

export async function HEAD(
  request: Request,
  context: RouteContext,
) {
  return redirecionarProduto(
    request,
    context,
  );
}