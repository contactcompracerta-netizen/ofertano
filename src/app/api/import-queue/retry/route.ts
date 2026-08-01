import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const id =
      typeof body?.id === "string"
        ? body.id.trim()
        : "";

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: "Identificador da fila não informado.",
        },
        {
          status: 400,
        }
      );
    }

    const item = await prisma.importQueue.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!item) {
      return NextResponse.json(
        {
          success: false,
          error: "Item da fila não encontrado.",
        },
        {
          status: 404,
        }
      );
    }

    if (item.status !== "ERROR") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Somente itens com erro podem ser enviados novamente.",
        },
        {
          status: 409,
        }
      );
    }

    const resultado =
      await prisma.importQueue.updateMany({
        where: {
          id,
          status: "ERROR",
        },
        data: {
          status: "PENDING",
          errorMessage: null,
          productId: null,
          processedAt: null,
        },
      });

    if (resultado.count === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "O item foi alterado por outro processo. Atualize o painel.",
        },
        {
          status: 409,
        }
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "Produto devolvido para a fila de importação.",
    });
  } catch (error) {
    console.error(
      "Erro ao reenviar item da fila:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao reenviar o produto.",
      },
      {
        status: 500,
      }
    );
  }
}