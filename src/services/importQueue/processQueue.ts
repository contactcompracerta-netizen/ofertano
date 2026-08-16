import prisma from "@/lib/prisma";
import { buscarComparacaoManual } from "@/services/comparison/manualComparison";
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

function limitarQuantidade(
  valor: unknown,
): number {
  if (
    typeof valor !== "number" ||
    !Number.isInteger(valor)
  ) {
    return 5;
  }

  return Math.min(
    Math.max(valor, 1),
    10,
  );
}

export async function processImportQueue(
  quantidade: unknown,
): Promise<QueueProcessResult> {
  const limit =
    limitarQuantidade(quantidade);

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

  if (
    pendentes.length === 0
  ) {
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

  const results:
    QueueProcessResult["results"] = [];

  for (
    const item of pendentes
  ) {
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

    if (
      reservado.count === 0
    ) {
      continue;
    }

    /*
     * MODO COMPARACAO DE PRODUTO JA PUBLICADO
     *
     * Uma linha PENDING com productId preenchido e sem opportunityId
     * representa um Product que já foi publicado pela busca do site
     * e agora precisa receber o Multi Loja fora da requisição pública.
     *
     * Nesse modo:
     * - o Product existente NÃO é recriado;
     * - usamos a URL da oferta de referência apenas para reconstruir
     *   o ProductImport necessário ao matcher;
     * - o comparador salva somente ofertas EXACT no mesmo productId;
     * - o trabalho pesado fica na fila e não segura a busca do cliente.
     */
    if (
      item.productId &&
      !item.opportunityId
    ) {
      try {
        const produtoExistente =
          await prisma.product.findUnique({
            where: {
              id: item.productId,
            },

            select: {
              id: true,
              name: true,
            },
          });

        if (!produtoExistente) {
          throw new Error(
            `Produto ${item.productId} não encontrado para comparação Multi Loja.`,
          );
        }

        const referencia =
          await importarProduto(
            item.url,
          );

        const comparison =
          await buscarComparacaoManual(
            referencia,
            item.productId,
          );

        const processedAt =
          new Date();

        await prisma.importQueue.update({
          where: {
            id: item.id,
          },

          data: {
            status: "SUCCESS",
            errorMessage: null,
            processedAt,
          },
        });

        console.log(
          `[ImportQueue] Multi Loja em fila concluído para ${item.productId}: ` +
            `${comparison.found} oferta(s) EXACT encontrada(s).`,
        );

        if (
          comparison.errors.length > 0
        ) {
          console.warn(
            `[ImportQueue] Multi Loja em fila de ${item.productId} terminou com avisos:`,
            comparison.errors,
          );
        }

        results.push({
          queueId:
            item.id,

          url:
            item.url,

          success:
            true,

          productId:
            item.productId,

          productName:
            produtoExistente.name,
        });
      } catch (error) {
        const mensagem =
          error instanceof Error
            ? error.message
            : "Erro desconhecido ao processar comparação Multi Loja.";

        const processedAt =
          new Date();

        const errorMessage =
          mensagem.slice(
            0,
            2000,
          );

        await prisma.importQueue.update({
          where: {
            id: item.id,
          },

          data: {
            status:
              "ERROR",

            errorMessage,

            processedAt,
          },
        });

        results.push({
          queueId:
            item.id,

          url:
            item.url,

          success:
            false,

          productId:
            item.productId,

          error:
            mensagem,
        });
      }

      continue;
    }

    try {
      const imported =
        await importarProduto(
          item.url,
        );

      /*
       * Prioridade do link:
       *
       * 1. Link individual já salvo na fila;
       * 2. Link individual retornado pelo importador;
       * 3. null -> oferta fica pendente de afiliado.
       */
      const affiliateLink =
        item.affiliateLink?.trim() ||
        imported.affiliateLink?.trim() ||
        null;

      /*
       * Se existe opportunityId, o item foi criado
       * pelo sistema automático de oportunidades.
       *
       * Nesse caso:
       * - Product.autoCreated = true
       * - discoverySource = OPPORTUNITY
       *
       * Itens adicionados manualmente à fila continuam
       * usando o comportamento padrão do saveProduct.
       */
      const saved =
        await saveProduct(
          imported,
          affiliateLink,
          item.opportunityId
            ? {
                autoCreated: true,
                discoverySource:
                  "OPPORTUNITY",
              }
            : undefined,
        );

      /*
       * A publicação da oferta de origem é concluída
       * antes da comparação Multi Loja.
       *
       * Assim, uma falha ou lentidão em outra marketplace
       * nunca desfaz o produto que o robô já importou.
       */
      const processedAt =
        new Date();

      await prisma.$transaction(
        async (tx) => {
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

          if (
            item.opportunityId
          ) {
            await tx.productOpportunity.updateMany({
              where: {
                id:
                  item.opportunityId,

                status: {
                  in: [
                    "QUEUED",
                    "READY_TO_QUEUE",
                    "ERROR",
                  ],
                },
              },

              data: {
                status:
                  "PUBLISHED",

                productId:
                  saved.id,

                errorMessage:
                  null,

                publishedAt:
                  processedAt,
              },
            });
          }
        },
      );

      /*
       * ETAPA MULTI LOJA
       *
       * Depois que a oferta de origem já está salva no
       * Product canônico, executamos o mesmo comparador
       * usado pela importação manual.
       *
       * O comparador:
       * - consulta as marketplaces integradas;
       * - ignora a marketplace de origem;
       * - valida identidade/variante com matcher estrito;
       * - aceita somente EXACT;
       * - salva a oferta no mesmo targetProductId;
       * - não força presença nas 5 lojas.
       *
       * Qualquer erro aqui é não fatal:
       * o produto de origem continua publicado e poderá
       * ser pesquisado novamente posteriormente.
       */
      try {
        const comparison =
          await buscarComparacaoManual(
            imported,
            saved.id,
          );

        console.log(
          `[ImportQueue] Multi Loja concluído para ${saved.id}: ` +
            `${comparison.found} oferta(s) EXACT encontrada(s).`,
        );

        if (
          comparison.errors.length > 0
        ) {
          console.warn(
            `[ImportQueue] Multi Loja de ${saved.id} terminou com avisos:`,
            comparison.errors,
          );
        }
      } catch (comparisonError) {
        console.error(
          `[ImportQueue] Falha não fatal no Multi Loja do produto ${saved.id}:`,
          comparisonError,
        );
      }

      results.push({
        queueId:
          item.id,

        url:
          item.url,

        success:
          true,

        productId:
          saved.id,

        productName:
          saved.name,
      });
    } catch (error) {
      const mensagem =
        error instanceof Error
          ? error.message
          : "Erro desconhecido ao importar.";

      const processedAt =
        new Date();

      const errorMessage =
        mensagem.slice(
          0,
          2000,
        );

      await prisma.$transaction(
        async (tx) => {
          await tx.importQueue.update({
            where: {
              id: item.id,
            },

            data: {
              status:
                "ERROR",

              errorMessage,

              processedAt,
            },
          });

          if (
            item.opportunityId
          ) {
            await tx.productOpportunity.updateMany({
              where: {
                id:
                  item.opportunityId,

                status: {
                  in: [
                    "QUEUED",
                    "READY_TO_QUEUE",
                    "ERROR",
                  ],
                },
              },

              data: {
                status:
                  "ERROR",

                attempts: {
                  increment: 1,
                },

                errorMessage,
              },
            });
          }
        },
      );

      results.push({
        queueId:
          item.id,

        url:
          item.url,

        success:
          false,

        error:
          mensagem,
      });
    }
  }

  const imported =
    results.filter(
      (resultado) =>
        resultado.success,
    ).length;

  const errors =
    results.length -
    imported;

  return {
    success: true,

    message:
      `${imported} produto(s) importado(s) e ${errors} erro(s).`,

    processed:
      results.length,

    imported,

    errors,

    results,
  };
}
