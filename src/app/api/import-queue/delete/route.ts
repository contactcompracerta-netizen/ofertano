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

    if (item.status === "PROCESSING") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Não é possível excluir um produto enquanto ele está sendo processado.",
        },
        {
          status: 409,
        }
      );
    }

    const resultado = await prisma.importQueue.deleteMany({
      where: {
        id,
        status: {
          not: "PROCESSING",
        },
      },
    });

    if (resultado.count === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "O item começou a ser processado. Atualize o painel.",
        },
        {
          status: 409,
        }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Item removido da fila com sucesso.",
    });
  } catch (error) {
    console.error(
      "Erro ao excluir item da fila:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao excluir o item.",
      },
      {
        status: 500,
      }
    );
  }
}