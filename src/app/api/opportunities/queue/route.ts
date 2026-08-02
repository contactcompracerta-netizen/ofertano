import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class OpportunityQueueError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OpportunityQueueError";
    this.status = status;
  }
}

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
          error:
            "Identificador da oportunidade não informado.",
        },
        {
          status: 400,
        }
      );
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const opportunity =
          await tx.productOpportunity.findUnique({
            where: {
              id,
            },
          });

        if (!opportunity) {
          throw new OpportunityQueueError(
            "Oportunidade não encontrada.",
            404
          );
        }

        if (
          opportunity.status === "QUEUED" ||
          opportunity.status === "PUBLISHED"
        ) {
          const existingQueue =
            await tx.importQueue.findUnique({
              where: {
                opportunityId: opportunity.id,
              },
            });

          return {
            queue: existingQueue,
            opportunity,
            alreadyProcessed: true,
          };
        }

        if (
          opportunity.status !== "READY_TO_QUEUE"
        ) {
          throw new OpportunityQueueError(
            "A oportunidade ainda não está pronta para a fila.",
            409
          );
        }

        const affiliateLink =
          opportunity.affiliateLink?.trim();

        if (!affiliateLink) {
          throw new OpportunityQueueError(
            "A oportunidade não possui link oficial de afiliado.",
            409
          );
        }

        const existingByOpportunity =
          await tx.importQueue.findUnique({
            where: {
              opportunityId: opportunity.id,
            },
          });

        if (existingByOpportunity) {
          const updatedOpportunity =
            await tx.productOpportunity.update({
              where: {
                id: opportunity.id,
              },
              data: {
                status:
                  existingByOpportunity.status ===
                    "SUCCESS" &&
                  existingByOpportunity.productId
                    ? "PUBLISHED"
                    : "QUEUED",
                productId:
                  existingByOpportunity.productId,
                queuedAt:
                  opportunity.queuedAt ??
                  new Date(),
                publishedAt:
                  existingByOpportunity.status ===
                    "SUCCESS" &&
                  existingByOpportunity.productId
                    ? opportunity.publishedAt ??
                      new Date()
                    : opportunity.publishedAt,
                errorMessage: null,
              },
            });

          return {
            queue: existingByOpportunity,
            opportunity: updatedOpportunity,
            alreadyProcessed: true,
          };
        }

        const existingByUrl =
          await tx.importQueue.findUnique({
            where: {
              url: opportunity.sourceUrl,
            },
          });

        if (
          existingByUrl?.opportunityId &&
          existingByUrl.opportunityId !==
            opportunity.id
        ) {
          throw new OpportunityQueueError(
            "Este produto já pertence a outra oportunidade.",
            409
          );
        }

        let queue;

        if (existingByUrl) {
          queue = await tx.importQueue.update({
            where: {
              id: existingByUrl.id,
            },
            data: {
              affiliateLink,
              opportunityId: opportunity.id,
              status:
                existingByUrl.status === "ERROR"
                  ? "PENDING"
                  : existingByUrl.status,
              errorMessage:
                existingByUrl.status === "ERROR"
                  ? null
                  : existingByUrl.errorMessage,
              processedAt:
                existingByUrl.status === "ERROR"
                  ? null
                  : existingByUrl.processedAt,
            },
          });
        } else {
          queue = await tx.importQueue.create({
            data: {
              url: opportunity.sourceUrl,
              marketplace: "MERCADO_LIVRE",
              affiliateLink,
              opportunityId: opportunity.id,
              status: "PENDING",
            },
          });
        }

        const wasAlreadyImported =
          queue.status === "SUCCESS" &&
          Boolean(queue.productId);

        if (
          wasAlreadyImported &&
          queue.productId
        ) {
          await tx.product.update({
            where: {
              id: queue.productId,
            },
            data: {
              affiliateLink,
            },
          });
        }

        const updatedOpportunity =
          await tx.productOpportunity.update({
            where: {
              id: opportunity.id,
            },
            data: {
              status: wasAlreadyImported
                ? "PUBLISHED"
                : "QUEUED",
              productId: queue.productId,
              queuedAt:
                opportunity.queuedAt ??
                new Date(),
              publishedAt: wasAlreadyImported
                ? opportunity.publishedAt ??
                  new Date()
                : null,
              errorMessage: null,
            },
          });

        return {
          queue,
          opportunity: updatedOpportunity,
          alreadyProcessed: false,
        };
      }
    );

    return NextResponse.json({
      success: true,
      message:
        result.opportunity.status === "PUBLISHED"
          ? "Produto já importado e link de afiliado atualizado."
          : result.alreadyProcessed
            ? "A oportunidade já estava vinculada à fila."
            : "Oportunidade enviada para a fila com sucesso.",
      queue: result.queue
        ? {
            id: result.queue.id,
            status: result.queue.status,
            opportunityId:
              result.queue.opportunityId,
          }
        : null,
      opportunity: {
        id: result.opportunity.id,
        status: result.opportunity.status,
        productId: result.opportunity.productId,
      },
    });
  } catch (error) {
    console.error(
      "Erro ao enviar oportunidade para a fila:",
      error
    );

    if (error instanceof OpportunityQueueError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        {
          status: error.status,
        }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao enviar oportunidade para a fila.",
      },
      {
        status: 500,
      }
    );
  }
}