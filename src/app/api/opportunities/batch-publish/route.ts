import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { processImportQueue } from "@/services/importQueue/processQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BatchItem = {
  id: string;
  affiliateLink: string;
};

class BatchPublishError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BatchPublishError";
    this.status = status;
  }
}

function validarLinkAfiliado(
  valor: unknown
): string | null {
  if (typeof valor !== "string") {
    return null;
  }

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

    const hostname = url.hostname.toLowerCase();

    const pertenceAoMercadoLivre =
      hostname === "mercadolivre.com.br" ||
      hostname.endsWith(".mercadolivre.com.br") ||
      hostname === "mercadolibre.com" ||
      hostname.endsWith(".mercadolibre.com") ||
      hostname === "meli.la" ||
      hostname.endsWith(".meli.la");

    if (!pertenceAoMercadoLivre) {
      return null;
    }

    url.hash = "";

    return url.toString();
  } catch {
    return null;
  }
}

function normalizarItens(
  valor: unknown
): BatchItem[] {
  if (!Array.isArray(valor)) {
    return [];
  }

  const itens: BatchItem[] = [];
  const idsUtilizados = new Set<string>();

  for (const item of valor) {
    const id =
      typeof item?.id === "string"
        ? item.id.trim()
        : "";

    const affiliateLink = validarLinkAfiliado(
      item?.affiliateLink
    );

    if (
      !id ||
      !affiliateLink ||
      idsUtilizados.has(id)
    ) {
      continue;
    }

    idsUtilizados.add(id);

    itens.push({
      id,
      affiliateLink,
    });
  }

  return itens.slice(0, 10);
}

export async function POST(request: Request) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const items = normalizarItens(body?.items);

    if (items.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Nenhuma oportunidade com link de afiliado válido foi informada.",
        },
        {
          status: 400,
        }
      );
    }

    const resultados: Array<{
      id: string;
      success: boolean;
      queueId?: string;
      status?: string;
      error?: string;
    }> = [];

    for (const item of items) {
      try {
        const resultado =
          await prisma.$transaction(
            async (tx) => {
              const oportunidade =
                await tx.productOpportunity.findUnique({
                  where: {
                    id: item.id,
                  },
                });

              if (!oportunidade) {
                throw new BatchPublishError(
                  "Oportunidade não encontrada.",
                  404
                );
              }

              if (
                oportunidade.status === "DISMISSED"
              ) {
                throw new BatchPublishError(
                  "A oportunidade está descartada.",
                  409
                );
              }

              if (
                oportunidade.status === "PUBLISHED"
              ) {
                if (oportunidade.productId) {
                  await tx.product.update({
                    where: {
                      id: oportunidade.productId,
                    },
                    data: {
                      affiliateLink:
                        item.affiliateLink,
                    },
                  });
                }

                await tx.productOpportunity.update({
                  where: {
                    id: oportunidade.id,
                  },
                  data: {
                    affiliateLink:
                      item.affiliateLink,
                    errorMessage: null,
                  },
                });

                return {
                  queueId: null,
                  status: "PUBLISHED",
                };
              }

              const oportunidadeAtualizada =
                await tx.productOpportunity.update({
                  where: {
                    id: oportunidade.id,
                  },
                  data: {
                    affiliateLink:
                      item.affiliateLink,
                    status: "READY_TO_QUEUE",
                    errorMessage: null,
                  },
                });

              const filaPorOportunidade =
                await tx.importQueue.findUnique({
                  where: {
                    opportunityId:
                      oportunidadeAtualizada.id,
                  },
                });

              if (filaPorOportunidade) {
                const filaAtualizada =
                  await tx.importQueue.update({
                    where: {
                      id: filaPorOportunidade.id,
                    },
                    data: {
                      affiliateLink:
                        item.affiliateLink,
                      status:
                        filaPorOportunidade.status ===
                          "ERROR"
                          ? "PENDING"
                          : filaPorOportunidade.status,
                      errorMessage:
                        filaPorOportunidade.status ===
                          "ERROR"
                          ? null
                          : filaPorOportunidade.errorMessage,
                      processedAt:
                        filaPorOportunidade.status ===
                          "ERROR"
                          ? null
                          : filaPorOportunidade.processedAt,
                    },
                  });

                const jaPublicado =
                  filaAtualizada.status ===
                    "SUCCESS" &&
                  Boolean(filaAtualizada.productId);

                await tx.productOpportunity.update({
                  where: {
                    id: oportunidadeAtualizada.id,
                  },
                  data: {
                    status: jaPublicado
                      ? "PUBLISHED"
                      : "QUEUED",
                    productId:
                      filaAtualizada.productId,
                    queuedAt:
                      oportunidadeAtualizada.queuedAt ??
                      new Date(),
                    publishedAt: jaPublicado
                      ? oportunidadeAtualizada.publishedAt ??
                        new Date()
                      : null,
                    errorMessage: null,
                  },
                });

                if (
                  jaPublicado &&
                  filaAtualizada.productId
                ) {
                  await tx.product.update({
                    where: {
                      id: filaAtualizada.productId,
                    },
                    data: {
                      affiliateLink:
                        item.affiliateLink,
                      active: true,
                    },
                  });
                }

                return {
                  queueId: filaAtualizada.id,
                  status: jaPublicado
                    ? "PUBLISHED"
                    : filaAtualizada.status,
                };
              }

              const filaPorUrl =
                await tx.importQueue.findUnique({
                  where: {
                    url: oportunidadeAtualizada.sourceUrl,
                  },
                });

              if (
                filaPorUrl?.opportunityId &&
                filaPorUrl.opportunityId !==
                  oportunidadeAtualizada.id
              ) {
                throw new BatchPublishError(
                  "Este produto já está vinculado a outra oportunidade.",
                  409
                );
              }

              let fila;

              if (filaPorUrl) {
                fila =
                  await tx.importQueue.update({
                    where: {
                      id: filaPorUrl.id,
                    },
                    data: {
                      affiliateLink:
                        item.affiliateLink,
                      opportunityId:
                        oportunidadeAtualizada.id,
                      status:
                        filaPorUrl.status ===
                          "ERROR"
                          ? "PENDING"
                          : filaPorUrl.status,
                      errorMessage:
                        filaPorUrl.status ===
                          "ERROR"
                          ? null
                          : filaPorUrl.errorMessage,
                      processedAt:
                        filaPorUrl.status ===
                          "ERROR"
                          ? null
                          : filaPorUrl.processedAt,
                    },
                  });
              } else {
                fila =
                  await tx.importQueue.create({
                    data: {
                      url: oportunidadeAtualizada.sourceUrl,
                      marketplace:
                        "MERCADO_LIVRE",
                      affiliateLink:
                        item.affiliateLink,
                      opportunityId:
                        oportunidadeAtualizada.id,
                      status: "PENDING",
                    },
                  });
              }

              const jaImportado =
                fila.status === "SUCCESS" &&
                Boolean(fila.productId);

              if (
                jaImportado &&
                fila.productId
              ) {
                await tx.product.update({
                  where: {
                    id: fila.productId,
                  },
                  data: {
                    affiliateLink:
                      item.affiliateLink,
                    active: true,
                  },
                });
              }

              await tx.productOpportunity.update({
                where: {
                  id: oportunidadeAtualizada.id,
                },
                data: {
                  status: jaImportado
                    ? "PUBLISHED"
                    : "QUEUED",
                  productId: fila.productId,
                  queuedAt:
                    oportunidadeAtualizada.queuedAt ??
                    new Date(),
                  publishedAt: jaImportado
                    ? oportunidadeAtualizada.publishedAt ??
                      new Date()
                    : null,
                  errorMessage: null,
                },
              });

              return {
                queueId: fila.id,
                status: jaImportado
                  ? "PUBLISHED"
                  : fila.status,
              };
            }
          );

        resultados.push({
          id: item.id,
          success: true,
          queueId:
            resultado.queueId ?? undefined,
          status: resultado.status,
        });
      } catch (error) {
        resultados.push({
          id: item.id,
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Erro desconhecido.",
        });
      }
    }

    const enviadosParaFila = resultados.filter(
      (resultado) =>
        resultado.success &&
        resultado.status !== "PUBLISHED"
    ).length;

    const processamento =
      enviadosParaFila > 0
        ? await processImportQueue(
            Math.min(enviadosParaFila, 10)
          )
        : {
            success: true,
            message:
              "Nenhum produto novo precisava ser processado.",
            processed: 0,
            imported: 0,
            errors: 0,
            results: [],
          };

    const sucessos = resultados.filter(
      (resultado) => resultado.success
    ).length;

    const erros =
      resultados.length - sucessos;

    return NextResponse.json({
      success: erros === 0,
      message:
        `${sucessos} oportunidade(s) preparada(s), ` +
        `${processamento.imported} produto(s) publicado(s) e ` +
        `${erros + processamento.errors} erro(s).`,
      prepared: sucessos,
      failed: erros,
      processing: processamento,
      results: resultados,
    });
  } catch (error) {
    console.error(
      "Erro na publicação em lote:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno na publicação em lote.",
      },
      {
        status:
          error instanceof BatchPublishError
            ? error.status
            : 500,
      }
    );
  }
}