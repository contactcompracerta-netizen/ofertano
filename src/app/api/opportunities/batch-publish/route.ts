import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { processImportQueue } from "@/services/importQueue/processQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH_SIZE = 10;
const LINK_CHECK_TIMEOUT_MS = 10_000;

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

function isMercadoLivreHostname(
  hostname: string
): boolean {
  const normalized = hostname.toLowerCase();

  return (
    normalized === "mercadolivre.com.br" ||
    normalized.endsWith(".mercadolivre.com.br") ||
    normalized === "mercadolibre.com" ||
    normalized.endsWith(".mercadolibre.com") ||
    normalized === "meli.la" ||
    normalized.endsWith(".meli.la")
  );
}

function normalizeAffiliateLink(
  value: unknown,
  position: number
): string {
  if (typeof value !== "string") {
    throw new BatchPublishError(
      `O produto ${position} não possui link de afiliado.`,
      400
    );
  }

  const text = value.trim();

  if (!text) {
    throw new BatchPublishError(
      `O produto ${position} está sem link de afiliado.`,
      400
    );
  }

  let url: URL;

  try {
    url = new URL(text);
  } catch {
    throw new BatchPublishError(
      `O link do produto ${position} não é válido.`,
      400
    );
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw new BatchPublishError(
      `O link do produto ${position} deve começar com http:// ou https://.`,
      400
    );
  }

  if (url.username || url.password) {
    throw new BatchPublishError(
      `O link do produto ${position} contém dados inválidos.`,
      400
    );
  }

  if (!isMercadoLivreHostname(url.hostname)) {
    throw new BatchPublishError(
      `O link do produto ${position} não pertence ao Mercado Livre.`,
      400
    );
  }

  /*
   * Bloqueia links quebrados como:
   *
   * https://meli.la/https://meli.la/22dhEQL
   */
  if (
    url.hostname.toLowerCase() === "meli.la" ||
    url.hostname
      .toLowerCase()
      .endsWith(".meli.la")
  ) {
    let decodedPath = url.pathname;

    try {
      decodedPath = decodeURIComponent(
        url.pathname
      );
    } catch {
      decodedPath = url.pathname;
    }

    if (/https?:\/\//i.test(decodedPath)) {
      throw new BatchPublishError(
        `O link do produto ${position} está duplicado ou malformado.`,
        400
      );
    }
  }

  url.hash = "";

  return url.toString();
}

function normalizeItems(
  value: unknown
): BatchItem[] {
  if (!Array.isArray(value)) {
    throw new BatchPublishError(
      "A lista de produtos não foi informada.",
      400
    );
  }

  if (value.length === 0) {
    throw new BatchPublishError(
      "Nenhum produto foi informado.",
      400
    );
  }

  if (value.length > MAX_BATCH_SIZE) {
    throw new BatchPublishError(
      `É permitido publicar no máximo ${MAX_BATCH_SIZE} produtos por vez.`,
      400
    );
  }

  const usedIds = new Set<string>();
  const usedLinks = new Set<string>();

  return value.map((item, index) => {
    const position = index + 1;

    const id =
      typeof item?.id === "string"
        ? item.id.trim()
        : "";

    if (!id) {
      throw new BatchPublishError(
        `O produto ${position} não possui identificador.`,
        400
      );
    }

    if (usedIds.has(id)) {
      throw new BatchPublishError(
        `O produto ${position} está repetido no lote.`,
        400
      );
    }

    const affiliateLink =
      normalizeAffiliateLink(
        item?.affiliateLink,
        position
      );

    const normalizedLink =
      affiliateLink.toLowerCase();

    if (usedLinks.has(normalizedLink)) {
      throw new BatchPublishError(
        `O mesmo link de afiliado foi usado em mais de um produto. Verifique o produto ${position}.`,
        400
      );
    }

    usedIds.add(id);
    usedLinks.add(normalizedLink);

    return {
      id,
      affiliateLink,
    };
  });
}

/*
 * Verificação de redirecionamento em modo tolerante.
 *
 * Alguns links meli.la não revelam o código MLB
 * diretamente na URL final ou podem bloquear
 * requisições automáticas.
 *
 * Por isso:
 * - domínio externo é bloqueado;
 * - link malformado é bloqueado;
 * - falha de rede não impede um link sintaticamente válido.
 */
async function checkAffiliateDestination(
  affiliateLink: string,
  position: number
): Promise<void> {
  try {
    const response = await fetch(
      affiliateLink,
      {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(
          LINK_CHECK_TIMEOUT_MS
        ),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; OfertanoLinkValidator/1.0)",
          Accept:
            "text/html,application/xhtml+xml",
        },
      }
    );

    const finalUrl = new URL(
      response.url || affiliateLink
    );

    if (
      !isMercadoLivreHostname(
        finalUrl.hostname
      )
    ) {
      throw new BatchPublishError(
        `O link do produto ${position} direciona para fora do Mercado Livre.`,
        400
      );
    }

    try {
      await response.body?.cancel();
    } catch {
      // O cancelamento do corpo não interfere
      // na validação.
    }
  } catch (error) {
    if (error instanceof BatchPublishError) {
      throw error;
    }

    /*
     * O Mercado Livre pode rejeitar a consulta
     * automática mesmo quando o link funciona
     * normalmente no navegador.
     */
    console.warn(
      `Não foi possível confirmar automaticamente o redirecionamento do link ${position}. O link passou na validação de domínio.`,
      error
    );
  }
}

async function synchronizePublishedProduct(
  tx: Prisma.TransactionClient,
  productId: string,
  affiliateLink: string
) {
  const product = await tx.product.update({
    where: {
      id: productId,
    },
    data: {
      affiliateLink,
      active: true,
    },
  });

  await tx.marketplaceOffer.upsert({
    where: {
      productId_marketplace: {
        productId,
        marketplace:
          "MERCADO_LIVRE",
      },
    },
    update: {
      affiliateLink,
      price: product.price,
      oldPrice: product.oldPrice,
      installments:
        product.installments,
      stock: product.stock,
      active: true,
    },
    create: {
      productId,
      marketplace:
        "MERCADO_LIVRE",
      affiliateLink,
      price: product.price,
      oldPrice: product.oldPrice,
      installments:
        product.installments,
      stock: product.stock,
      active: true,
    },
  });
}

async function prepareItems(
  items: BatchItem[]
): Promise<BatchItem[]> {
  const opportunityIds =
    items.map((item) => item.id);

  const opportunities =
    await prisma.productOpportunity.findMany({
      where: {
        id: {
          in: opportunityIds,
        },
      },
    });

  if (
    opportunities.length !==
    items.length
  ) {
    throw new BatchPublishError(
      "Uma ou mais oportunidades não foram encontradas.",
      404
    );
  }

  const opportunitiesById =
    new Map(
      opportunities.map(
        (opportunity) => [
          opportunity.id,
          opportunity,
        ]
      )
    );

  for (
    let index = 0;
    index < items.length;
    index += 1
  ) {
    const item = items[index];
    const position = index + 1;

    const opportunity =
      opportunitiesById.get(item.id);

    if (!opportunity) {
      throw new BatchPublishError(
        `A oportunidade do produto ${position} não foi encontrada.`,
        404
      );
    }

    if (
      opportunity.status ===
      "DISMISSED"
    ) {
      throw new BatchPublishError(
        `O produto ${position} está descartado.`,
        409
      );
    }

    await checkAffiliateDestination(
      item.affiliateLink,
      position
    );
  }

  const affiliateLinks =
    items.map(
      (item) => item.affiliateLink
    );

  const existingOpportunity =
    await prisma.productOpportunity.findFirst({
      where: {
        affiliateLink: {
          in: affiliateLinks,
        },
        id: {
          notIn: opportunityIds,
        },
      },
      select: {
        id: true,
      },
    });

  if (existingOpportunity) {
    throw new BatchPublishError(
      "Um dos links já está vinculado a outra oportunidade.",
      409
    );
  }

  const existingQueue =
    await prisma.importQueue.findFirst({
      where: {
        affiliateLink: {
          in: affiliateLinks,
        },
        OR: [
          {
            opportunityId: null,
          },
          {
            opportunityId: {
              notIn: opportunityIds,
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });

  if (existingQueue) {
    throw new BatchPublishError(
      "Um dos links já está sendo usado em outra importação.",
      409
    );
  }

  const existingProduct =
    await prisma.product.findFirst({
      where: {
        affiliateLink: {
          in: affiliateLinks,
        },
      },
      select: {
        id: true,
      },
    });

  if (existingProduct) {
    const belongsToCurrentBatch =
      opportunities.some(
        (opportunity) =>
          opportunity.productId ===
          existingProduct.id
      );

    if (!belongsToCurrentBatch) {
      throw new BatchPublishError(
        "Um dos links já pertence a outro produto publicado.",
        409
      );
    }
  }

  return items;
}

export async function POST(
  request: Request
) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const normalizedItems =
      normalizeItems(body?.items);

    /*
     * Todo o lote é validado antes de
     * qualquer alteração no banco.
     */
    const items = await prepareItems(
      normalizedItems
    );

    const results: Array<{
      id: string;
      success: boolean;
      queueId?: string;
      status?: string;
      error?: string;
    }> = [];

    for (const item of items) {
      try {
        const result =
          await prisma.$transaction(
            async (tx) => {
              const opportunity =
                await tx.productOpportunity.findUnique({
                  where: {
                    id: item.id,
                  },
                });

              if (!opportunity) {
                throw new BatchPublishError(
                  "Oportunidade não encontrada.",
                  404
                );
              }

              if (
                opportunity.status ===
                "DISMISSED"
              ) {
                throw new BatchPublishError(
                  "A oportunidade está descartada.",
                  409
                );
              }

              /*
               * Produto já publicado:
               * apenas atualiza o link em Product,
               * MarketplaceOffer e oportunidade.
               */
              if (
                opportunity.status ===
                "PUBLISHED"
              ) {
                if (!opportunity.productId) {
                  throw new BatchPublishError(
                    "A oportunidade está publicada, mas não possui produto vinculado.",
                    409
                  );
                }

                await synchronizePublishedProduct(
                  tx,
                  opportunity.productId,
                  item.affiliateLink
                );

                await tx.productOpportunity.update({
                  where: {
                    id: opportunity.id,
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

              const updatedOpportunity =
                await tx.productOpportunity.update({
                  where: {
                    id: opportunity.id,
                  },
                  data: {
                    affiliateLink:
                      item.affiliateLink,
                    status:
                      "READY_TO_QUEUE",
                    errorMessage: null,
                  },
                });

              /*
               * Primeiro procura uma fila já ligada
               * à oportunidade.
               */
              const queueByOpportunity =
                await tx.importQueue.findUnique({
                  where: {
                    opportunityId:
                      updatedOpportunity.id,
                  },
                });

              if (queueByOpportunity) {
                const mustReset =
                  queueByOpportunity.status ===
                    "ERROR" ||
                  (queueByOpportunity.status ===
                    "SUCCESS" &&
                    !queueByOpportunity.productId);

                const updatedQueue =
                  await tx.importQueue.update({
                    where: {
                      id:
                        queueByOpportunity.id,
                    },
                    data: {
                      affiliateLink:
                        item.affiliateLink,
                      status: mustReset
                        ? "PENDING"
                        : queueByOpportunity.status,
                      errorMessage: mustReset
                        ? null
                        : queueByOpportunity.errorMessage,
                      processedAt: mustReset
                        ? null
                        : queueByOpportunity.processedAt,
                    },
                  });

                const alreadyPublished =
                  updatedQueue.status ===
                    "SUCCESS" &&
                  Boolean(
                    updatedQueue.productId
                  );

                if (
                  alreadyPublished &&
                  updatedQueue.productId
                ) {
                  await synchronizePublishedProduct(
                    tx,
                    updatedQueue.productId,
                    item.affiliateLink
                  );
                }

                await tx.productOpportunity.update({
                  where: {
                    id:
                      updatedOpportunity.id,
                  },
                  data: {
                    status:
                      alreadyPublished
                        ? "PUBLISHED"
                        : "QUEUED",
                    productId:
                      updatedQueue.productId,
                    queuedAt:
                      updatedOpportunity.queuedAt ??
                      new Date(),
                    publishedAt:
                      alreadyPublished
                        ? updatedOpportunity.publishedAt ??
                          new Date()
                        : null,
                    errorMessage: null,
                  },
                });

                return {
                  queueId:
                    updatedQueue.id,
                  status:
                    alreadyPublished
                      ? "PUBLISHED"
                      : updatedQueue.status,
                };
              }

              /*
               * Depois procura uma fila criada
               * anteriormente para a mesma URL.
               */
              const queueByUrl =
                await tx.importQueue.findUnique({
                  where: {
                    url:
                      updatedOpportunity.sourceUrl,
                  },
                });

              if (
                queueByUrl?.opportunityId &&
                queueByUrl.opportunityId !==
                  updatedOpportunity.id
              ) {
                throw new BatchPublishError(
                  "Este produto já está vinculado a outra oportunidade.",
                  409
                );
              }

              let queue;

              if (queueByUrl) {
                const mustReset =
                  queueByUrl.status ===
                    "ERROR" ||
                  (queueByUrl.status ===
                    "SUCCESS" &&
                    !queueByUrl.productId);

                queue =
                  await tx.importQueue.update({
                    where: {
                      id: queueByUrl.id,
                    },
                    data: {
                      affiliateLink:
                        item.affiliateLink,
                      opportunityId:
                        updatedOpportunity.id,
                      status: mustReset
                        ? "PENDING"
                        : queueByUrl.status,
                      errorMessage: mustReset
                        ? null
                        : queueByUrl.errorMessage,
                      processedAt: mustReset
                        ? null
                        : queueByUrl.processedAt,
                    },
                  });
              } else {
                queue =
                  await tx.importQueue.create({
                    data: {
                      url:
                        updatedOpportunity.sourceUrl,
                      marketplace:
                        "MERCADO_LIVRE",
                      affiliateLink:
                        item.affiliateLink,
                      opportunityId:
                        updatedOpportunity.id,
                      status: "PENDING",
                    },
                  });
              }

              const alreadyImported =
                queue.status ===
                  "SUCCESS" &&
                Boolean(queue.productId);

              if (
                alreadyImported &&
                queue.productId
              ) {
                await synchronizePublishedProduct(
                  tx,
                  queue.productId,
                  item.affiliateLink
                );
              }

              await tx.productOpportunity.update({
                where: {
                  id:
                    updatedOpportunity.id,
                },
                data: {
                  status:
                    alreadyImported
                      ? "PUBLISHED"
                      : "QUEUED",
                  productId:
                    queue.productId,
                  queuedAt:
                    updatedOpportunity.queuedAt ??
                    new Date(),
                  publishedAt:
                    alreadyImported
                      ? updatedOpportunity.publishedAt ??
                        new Date()
                      : null,
                  errorMessage: null,
                },
              });

              return {
                queueId: queue.id,
                status:
                  alreadyImported
                    ? "PUBLISHED"
                    : queue.status,
              };
            }
          );

        results.push({
          id: item.id,
          success: true,
          queueId:
            result.queueId ??
            undefined,
          status: result.status,
        });
      } catch (error) {
        results.push({
          id: item.id,
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Erro desconhecido.",
        });
      }
    }

    const sentToQueue =
      results.filter(
        (result) =>
          result.success &&
          result.status !==
            "PUBLISHED"
      ).length;

    /*
     * Processa imediatamente os produtos
     * adicionados à fila.
     */
    const processing =
      sentToQueue > 0
        ? await processImportQueue(
            Math.min(
              sentToQueue,
              MAX_BATCH_SIZE
            )
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

    const prepared =
      results.filter(
        (result) => result.success
      ).length;

    const transactionErrors =
      results.length - prepared;

    const totalErrors =
      transactionErrors +
      processing.errors;

    const responseBody = {
      success: totalErrors === 0,
      message:
        `${prepared} oportunidade(s) preparada(s), ` +
        `${processing.imported} produto(s) publicado(s) e ` +
        `${totalErrors} erro(s).`,
      prepared,
      failed: totalErrors,
      processing,
      results,
    };

    return NextResponse.json(
      responseBody,
      {
        status:
          totalErrors === 0
            ? 200
            : 409,
      }
    );
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
          error instanceof
          BatchPublishError
            ? error.status
            : 500,
      }
    );
  }
}