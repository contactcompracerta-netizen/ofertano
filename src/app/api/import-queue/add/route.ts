import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizarUrl(valor: string): string | null {
  const texto = valor.trim();

  if (!texto) {
    return null;
  }

  try {
    const url = new URL(texto);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    const host = url.hostname.toLowerCase();

    const mercadoLivre =
      host === "mercadolivre.com.br" ||
      host.endsWith(".mercadolivre.com.br") ||
      host === "mercadolibre.com" ||
      host.endsWith(".mercadolibre.com") ||
      host === "meli.la" ||
      host.endsWith(".meli.la");

    if (!mercadoLivre) {
      return null;
    }

    url.hash = "";

    return url.toString();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const texto =
      typeof body?.urls === "string"
        ? body.urls
        : "";

    if (!texto.trim()) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Cole pelo menos um link do Mercado Livre.",
        },
        {
          status: 400,
        }
      );
    }

    const urls: string[] = [];

    for (const linha of texto.split(/\r?\n/)) {
      const url = normalizarUrl(linha);

      if (url && !urls.includes(url)) {
        urls.push(url);
      }
    }

    if (urls.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Nenhum link válido do Mercado Livre foi encontrado.",
        },
        {
          status: 400,
        }
      );
    }

    const resultado =
      await prisma.importQueue.createMany({
        data: urls.map((url: string) => ({
          url,
          marketplace: "MERCADO_LIVRE",
          status: "PENDING",
        })),
        skipDuplicates: true,
      });

    return NextResponse.json({
      success: true,
      message:
        `${resultado.count} link(s) adicionado(s) à fila.`,
      received: urls.length,
      added: resultado.count,
      ignored:
        urls.length - resultado.count,
    });
  } catch (error) {
    console.error(
      "Erro ao adicionar links à fila:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao adicionar links.",
      },
      {
        status: 500,
      }
    );
  }
}