import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { importarProduto } from "@/services/importers";
import { saveProduct } from "@/services/database/saveProduct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function limitarQuantidade(valor: unknown): number {
  if (
    typeof valor !== "number" ||
    !Number.isInteger(valor)
  ) {
    return 5;
  }

  return Math.min(Math.max(valor, 1), 10);
}

export async function POST(request: Request) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const limit = limitarQuantidade(body?.limit);

    const pendentes = await prisma.importQueue.findMany({
      where: {
        status: "PENDING",
      },
      orderBy: {
        createdAt: "asc",
      },
      take: limit,
    });

    if (pendentes.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Não há produtos pendentes na fila.",
        processed: 0,
        imported: 0,
        errors: 0,
        results: [],
      });
    }

    const results: Array<{
      queueId: string;
      url: string;
      success: boolean;
      productId?: string;
      productName?: string;
      error?: string;
    }> = [];

    for (const item of pendentes) {
      const reservado =
        await prisma.importQueue.updateMany({
          where: {
            id: item.id,
            status: "PENDING",
          },
          data: {
            status: "PROCESSING",
            attempts: {
              increment: 1,
            },
            errorMessage: null,
          },
        });

      if (reservado.count === 0) {
        continue;
      }

      try {
        const imported =
          await importarProduto(item.url);

        const saved =
          await saveProduct(imported);

        await prisma.importQueue.update({
          where: {
            id: item.id,
          },
          data: {
            status: "SUCCESS",
            productId: saved.id,
            errorMessage: null,
            processedAt: new Date(),
          },
        });

        results.push({
          queueId: item.id,
          url: item.url,
          success: true,
          productId: saved.id,
          productName: saved.name,
        });
      } catch (error) {
        const mensagem =
          error instanceof Error
            ? error.message
            : "Erro desconhecido ao importar.";

        await prisma.importQueue.update({
          where: {
            id: item.id,
          },
          data: {
            status: "ERROR",
            errorMessage: mensagem.slice(0, 2000),
            processedAt: new Date(),
          },
        });

        results.push({
          queueId: item.id,
          url: item.url,
          success: false,
          error: mensagem,
        });
      }
    }

    const imported = results.filter(
      (resultado) => resultado.success
    ).length;

    const errors = results.length - imported;

    return NextResponse.json({
      success: true,
      message:
        `${imported} produto(s) importado(s) e ${errors} erro(s).`,
      processed: results.length,
      imported,
      errors,
      results,
    });
  } catch (error) {
    console.error(
      "Erro ao processar fila de importação:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao processar a fila.",
      },
      {
        status: 500,
      }
    );
  }
}