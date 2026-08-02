import prisma from "@/lib/prisma";
import { saveProduct } from "@/services/database/saveProduct";
import { importarProduto } from "@/services/importers";

export type QueueProcessResult = {
  success: boolean;
  message: string;
  processed: number;
  imported: number;
  errors: number;
  results: Array<{
    queueId: string;
    url: string;
    success: boolean;
    productId?: string;
    productName?: string;
    error?: string;
  }>;
};

function limitarQuantidade(valor: unknown): number {
  if (
    typeof valor !== "number" ||
    !Number.isInteger(valor)
  ) {
    return 5;
  }

  return Math.min(Math.max(valor, 1), 10);
}

export async function processImportQueue(
  quantidade: unknown
): Promise<QueueProcessResult> {
  const limit = limitarQuantidade(quantidade);

  const pendentes =
    await prisma.importQueue.findMany({
      where: {
        status: "PENDING",
      },
      orderBy: {
        createdAt: "asc",
      },
      take: limit,
    });

  if (pendentes.length === 0) {
    return {
      success: true,
      message:
        "Não há produtos pendentes na fila.",
      processed: 0,
      imported: 0,
      errors: 0,
      results: [],
    };
  }

  const results: QueueProcessResult["results"] = [];

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

      const saved = await saveProduct(
        imported,
        item.affiliateLink
      );

      const processedAt = new Date();

      await prisma.$transaction(async (tx) => {
        await tx.importQueue.update({
          where: {
            id: item.id,
          },
          data: {
            status: "SUCCESS",
            productId: saved.id,
            errorMessage: null,
            processedAt,
          },
        });

        if (item.opportunityId) {
          await tx.productOpportunity.updateMany({
            where: {
              id: item.opportunityId,
              status: {
                in: [
                  "QUEUED",
                  "READY_TO_QUEUE",
                  "ERROR",
                ],
              },
            },
            data: {
              status: "PUBLISHED",
              productId: saved.id,
              errorMessage: null,
              publishedAt: processedAt,
            },
          });
        }
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

      const processedAt = new Date();
      const errorMessage = mensagem.slice(0, 2000);

      await prisma.$transaction(async (tx) => {
        await tx.importQueue.update({
          where: {
            id: item.id,
          },
          data: {
            status: "ERROR",
            errorMessage,
            processedAt,
          },
        });

        if (item.opportunityId) {
          await tx.productOpportunity.updateMany({
            where: {
              id: item.opportunityId,
              status: {
                in: [
                  "QUEUED",
                  "READY_TO_QUEUE",
                  "ERROR",
                ],
              },
            },
            data: {
              status: "ERROR",
              attempts: {
                increment: 1,
              },
              errorMessage,
            },
          });
        }
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

  return {
    success: true,
    message:
      `${imported} produto(s) importado(s) e ${errors} erro(s).`,
    processed: results.length,
    imported,
    errors,
    results,
  };
}