import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { processImportQueue } from "@/services/importQueue/processQueue";
import {
  applyConfirmedAffiliateLinkToOwnedOffer,
  createPrismaApplyAffiliateLinkStore,
} from "@/services/opportunities/applyAffiliateLink";
import { sincronizarMelhorOfertaDoProduto } from "@/services/database/saveProduct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH_SIZE = 10;
const LINK_CHECK_TIMEOUT_MS = 10_000;

const AMAZON_ASSOCIATE_TAG =
  process.env.AMAZON_ASSOCIATE_TAG?.trim() ||
  "ofertano-20";

type SupportedMarketplace =
  | "MERCADO_LIVRE"
  | "AMAZON";

type BatchItem = {
  id: string;
  affiliateLink: string;
};

type PreparedBatchItem = BatchItem & {
  marketplace: SupportedMarketplace;
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
  hostname: string,
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

function isAmazonHostname(
  hostname: string,
): boolean {
  const normalized = hostname.toLowerCase();

  return (
    normalized === "amazon.com.br" ||
    normalized.endsWith(".amazon.com.br")
  );
}

function isAmazonShortHostname(
  hostname: string,
): boolean {
  const normalized = hostname.toLowerCase();

  return (
    normalized === "amzn.to" ||
    normalized.endsWith(".amzn.to")
  );
}

function requireSupportedMarketplace(
  value: string,
  position: number,
): SupportedMarketplace {
  if (
    value === "MERCADO_LIVRE" ||
    value === "AMAZON"
  ) {
    return value;
  }

  throw new BatchPublishError(
    `O marketplace do produto ${position} ainda não é aceito nesta publicação em lote.`,
    400,
  );
}

function normalizeAffiliateLink(
  value: unknown,
  position: number,
): string {
  if (typeof value !== "string") {
    throw new BatchPublishError(
      `O produto ${position} não possui link de afiliado.`,
      400,
    );
  }

  const text = value.trim();

  if (!text) {
    throw new BatchPublishError(
      `O produto ${position} está sem link de afiliado.`,
      400,
    );
  }

  let url: URL;

  try {
    url = new URL(text);
  } catch {
    throw new BatchPublishError(
      `O link do produto ${position} não é válido.`,
      400,
    );
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw new BatchPublishError(
      `O link do produto ${position} deve começar com http:// ou https://.`,
      400,
    );
  }

  if (url.username || url.password) {
    throw new BatchPublishError(
      `O link do produto ${position} contém dados inválidos.`,
      400,
    );
  }

  url.hash = "";

  return url.toString();
}

function normalizeItems(
  value: unknown,
): BatchItem[] {
  if (!Array.isArray(value)) {
    throw new BatchPublishError(
      "A lista de produtos não foi informada.",
      400,
    );
  }

  if (value.length === 0) {
    throw new BatchPublishError(
      "Nenhum produto foi informado.",
      400,
    );
  }

  if (value.length > MAX_BATCH_SIZE) {
    throw new BatchPublishError(
      `É permitido publicar no máximo ${MAX_BATCH_SIZE} produtos por vez.`,
      400,
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
        400,
      );
    }

    if (usedIds.has(id)) {
      throw new BatchPublishError(
        `O produto ${position} está repetido no lote.`,
        400,
      );
    }

    const affiliateLink =
      normalizeAffiliateLink(
        item?.affiliateLink,
        position,
      );

    const normalizedLink =
      affiliateLink.toLowerCase();

    if (usedLinks.has(normalizedLink)) {
      throw new BatchPublishError(
        `O mesmo link de afiliado foi usado em mais de um produto. Verifique o produto ${position}.`,
        400,
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

function validateMercadoLivreLink(
  affiliateLink: string,
  position: number,
): void {
  const url = new URL(affiliateLink);

  if (!isMercadoLivreHostname(url.hostname)) {
    throw new BatchPublishError(
      `O link do produto ${position} não pertence ao Mercado Livre.`,
      400,
    );
  }

  if (
    url.hostname.toLowerCase() === "meli.la" ||
    url.hostname
      .toLowerCase()
      .endsWith(".meli.la")
  ) {
    let decodedPath = url.pathname;

    try {
      decodedPath = decodeURIComponent(
        url.pathname,
      );
    } catch {
      decodedPath = url.pathname;
    }

    if (/https?:\/\//i.test(decodedPath)) {
      throw new BatchPublishError(
        `O link do produto ${position} está duplicado ou malformado.`,
        400,
      );
    }
  }
}

function extractAmazonAsin(
  url: URL,
): string | null {
  let pathname = url.pathname;

  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    pathname = url.pathname;
  }

  const patterns = [
    /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/exec\/obidos\/asin\/([A-Z0-9]{10})(?:[/?]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = pathname.match(pattern);

    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

function getAmazonAssociateTag(
  url: URL,
): string | null {
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === "tag") {
      return value.trim();
    }
  }

  return null;
}

function validateAmazonDestination(
  url: URL,
  externalId: string,
  position: number,
): void {
  if (url.protocol !== "https:") {
    throw new BatchPublishError(
      `O link Amazon do produto ${position} deve começar com https://.`,
      400,
    );
  }

  if (!isAmazonHostname(url.hostname)) {
    throw new BatchPublishError(
      `O link do produto ${position} não direciona para a Amazon Brasil.`,
      400,
    );
  }

  const asin = extractAmazonAsin(url);
  const expectedAsin =
    externalId.trim().toUpperCase();

  if (!asin) {
    throw new BatchPublishError(
      `Não foi possível identificar o ASIN no link Amazon do produto ${position}. Use o link individual completo do produto.`,
      400,
    );
  }

  if (asin !== expectedAsin) {
    throw new BatchPublishError(
      `O link Amazon do produto ${position} pertence a outro produto. Esperado: ${expectedAsin}; recebido: ${asin}.`,
      400,
    );
  }

  const associateTag =
    getAmazonAssociateTag(url);

  if (associateTag !== AMAZON_ASSOCIATE_TAG) {
    throw new BatchPublishError(
      `O link Amazon do produto ${position} não contém a tag de afiliado ${AMAZON_ASSOCIATE_TAG}.`,
      400,
    );
  }
}

/*
 * O Mercado Livre pode bloquear a consulta automática.
 * Por isso, falha de rede não invalida um link cujo domínio
 * já passou na validação local.
 */
async function checkMercadoLivreDestination(
  affiliateLink: string,
  position: number,
): Promise<void> {
  try {
    const response = await fetch(
      affiliateLink,
      {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(
          LINK_CHECK_TIMEOUT_MS,
        ),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; OfertanoLinkValidator/1.0)",
          Accept:
            "text/html,application/xhtml+xml",
        },
      },
    );

    const finalUrl = new URL(
      response.url || affiliateLink,
    );

    if (
      !isMercadoLivreHostname(
        finalUrl.hostname,
      )
    ) {
      throw new BatchPublishError(
        `O link do produto ${position} direciona para fora do Mercado Livre.`,
        400,
      );
    }

    try {
      await response.body?.cancel();
    } catch {
      // O cancelamento do corpo não interfere na validação.
    }
  } catch (error) {
    if (error instanceof BatchPublishError) {
      throw error;
    }

    console.warn(
      `Não foi possível confirmar automaticamente o redirecionamento do link ${position}. O link passou na validação de domínio.`,
      error,
    );
  }
}

async function checkAmazonLink(
  affiliateLink: string,
  externalId: string,
  position: number,
): Promise<void> {
  const originalUrl = new URL(affiliateLink);

  if (isAmazonHostname(originalUrl.hostname)) {
    validateAmazonDestination(
      originalUrl,
      externalId,
      position,
    );
    return;
  }

  if (!isAmazonShortHostname(originalUrl.hostname)) {
    throw new BatchPublishError(
      `O link do produto ${position} não pertence à Amazon.`,
      400,
    );
  }

  if (originalUrl.protocol !== "https:") {
    throw new BatchPublishError(
      `O link Amazon do produto ${position} deve começar com https://.`,
      400,
    );
  }

  try {
    const response = await fetch(
      affiliateLink,
      {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(
          LINK_CHECK_TIMEOUT_MS,
        ),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; OfertanoLinkValidator/1.0)",
          Accept:
            "text/html,application/xhtml+xml",
        },
      },
    );

    const finalUrl = new URL(response.url);

    validateAmazonDestination(
      finalUrl,
      externalId,
      position,
    );

    try {
      await response.body?.cancel();
    } catch {
      // O cancelamento do corpo não interfere na validação.
    }
  } catch (error) {
    if (error instanceof BatchPublishError) {
      throw error;
    }

    throw new BatchPublishError(
      `Não foi possível validar o link curto Amazon do produto ${position}. Use o link individual completo com a tag ${AMAZON_ASSOCIATE_TAG}.`,
      400,
    );
  }
}

async function validateAffiliateLink(
  marketplace: SupportedMarketplace,
  affiliateLink: string,
  externalId: string,
  position: number,
): Promise<void> {
  if (marketplace === "MERCADO_LIVRE") {
    validateMercadoLivreLink(
      affiliateLink,
      position,
    );

    await checkMercadoLivreDestination(
      affiliateLink,
      position,
    );
    return;
  }

  await checkAmazonLink(
    affiliateLink,
    externalId,
    position,
  );
}

async function synchronizePublishedProduct(
  tx: Prisma.TransactionClient,
  productId: string,
  marketplace: SupportedMarketplace,
  affiliateLink: string,
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

  const validatedAt = new Date();

  await tx.marketplaceOffer.upsert({
    where: {
      productId_marketplace: {
        productId,
        marketplace,
      },
    },
    update: {
      affiliateLink,
      price: product.price,
      oldPrice: product.oldPrice,
      installments:
        product.installments,
      stock: product.stock,
      status: "ACTIVE",
      active: true,
      available: true,
      errorMessage: null,
      affiliateValidatedAt:
        validatedAt,
    },
    create: {
      productId,
      marketplace,
      affiliateLink,
      price: product.price,
      oldPrice: product.oldPrice,
      installments:
        product.installments,
      stock: product.stock,
      status: "ACTIVE",
      discoverySource:
        "OPPORTUNITY",
      active: true,
      available: true,
      affiliateValidatedAt:
        validatedAt,
    },
  });
}

async function prepareItems(
  items: BatchItem[],
): Promise<PreparedBatchItem[]> {
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
      404,
    );
  }

  const opportunitiesById = new Map(
    opportunities.map((opportunity) => [
      opportunity.id,
      opportunity,
    ]),
  );

  const preparedItems: PreparedBatchItem[] = [];

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
        404,
      );
    }

    if (opportunity.status === "DISMISSED") {
      throw new BatchPublishError(
        `O produto ${position} está descartado.`,
        409,
      );
    }

    const marketplace =
      requireSupportedMarketplace(
        opportunity.marketplace,
        position,
      );

    await validateAffiliateLink(
      marketplace,
      item.affiliateLink,
      opportunity.externalId,
      position,
    );

    preparedItems.push({
      ...item,
      marketplace,
    });
  }

  const affiliateLinks = items.map(
    (item) => item.affiliateLink,
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
      409,
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
      409,
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
          existingProduct.id,
      );

    if (!belongsToCurrentBatch) {
      throw new BatchPublishError(
        "Um dos links já pertence a outro produto publicado.",
        409,
      );
    }
  }

  return preparedItems;
}

export async function POST(
  request: Request,
) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const normalizedItems =
      normalizeItems(body?.items);

    /*
     * Todo o lote é validado antes de qualquer
     * alteração no banco.
     */
    const items = await prepareItems(
      normalizedItems,
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
                  404,
                );
              }

              if (
                opportunity.marketplace !==
                item.marketplace
              ) {
                throw new BatchPublishError(
                  "O marketplace da oportunidade foi alterado. Atualize a página e tente novamente.",
                  409,
                );
              }

              if (
                opportunity.status ===
                "DISMISSED"
              ) {
                throw new BatchPublishError(
                  "A oportunidade está descartada.",
                  409,
                );
              }

              if (
                opportunity.status ===
                "PUBLISHED"
              ) {
                if (!opportunity.productId) {
                  throw new BatchPublishError(
                    "A oportunidade está publicada, mas não possui produto vinculado.",
                    409,
                  );
                }

                await synchronizePublishedProduct(
                  tx,
                  opportunity.productId,
                  item.marketplace,
                  item.affiliateLink,
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

              if (
                item.marketplace === "MERCADO_LIVRE" &&
                opportunity.productId &&
                opportunity.sourceType === "SEARCH_RESULT"
              ) {
                const applied =
                  await applyConfirmedAffiliateLinkToOwnedOffer(
                    {
                      opportunityId: opportunity.id,
                      affiliateLink: item.affiliateLink,
                    },
                    createPrismaApplyAffiliateLinkStore(tx),
                  );

                if (applied.ok) {
                  await sincronizarMelhorOfertaDoProduto(
                    tx,
                    applied.productId,
                  );

                  return {
                    queueId: null,
                    status: "PUBLISHED",
                  };
                }

                if (
                  applied.code === "PRODUCT_MISMATCH" ||
                  applied.code === "EXTERNAL_ID_MISMATCH"
                ) {
                  throw new BatchPublishError(
                    applied.error,
                    409,
                  );
                }
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
                      marketplace:
                        item.marketplace,
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
                    updatedQueue.productId,
                  );

                if (
                  alreadyPublished &&
                  updatedQueue.productId
                ) {
                  await synchronizePublishedProduct(
                    tx,
                    updatedQueue.productId,
                    item.marketplace,
                    item.affiliateLink,
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
                  409,
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
                      marketplace:
                        item.marketplace,
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
                        item.marketplace,
                      affiliateLink:
                        item.affiliateLink,
                      opportunityId:
                        updatedOpportunity.id,
                      status: "PENDING",
                    },
                  });
              }

              const alreadyImported =
                queue.status === "SUCCESS" &&
                Boolean(queue.productId);

              if (
                alreadyImported &&
                queue.productId
              ) {
                await synchronizePublishedProduct(
                  tx,
                  queue.productId,
                  item.marketplace,
                  item.affiliateLink,
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
            },
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

    const sentToQueue = results.filter(
      (result) =>
        result.success &&
        result.status !== "PUBLISHED",
    ).length;

    const processing =
      sentToQueue > 0
        ? await processImportQueue(
            Math.min(
              sentToQueue,
              MAX_BATCH_SIZE,
            ),
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

    const prepared = results.filter(
      (result) => result.success,
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
      },
    );
  } catch (error) {
    console.error(
      "Erro na publicação em lote:",
      error,
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
      },
    );
  }
}