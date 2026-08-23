import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const resultado =
      await prisma.importQueue.deleteMany({
        where: {
          status: {
            not: "PROCESSING",
          },
        },
      });

    return NextResponse.json({
      success: true,
      message:
        `${resultado.count} registro(s) removido(s) da fila. ` +
        "Itens que estavam em processamento foram preservados.",
      removed: resultado.count,
    });
  } catch (error) {
    console.error(
      "Erro ao limpar fila:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível limpar a fila.",
      },
      {
        status: 500,
      },
    );
  }
}
