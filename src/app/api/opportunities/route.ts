import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import {
  limparOportunidadesDoPainel,
  montarMensagemLimpeza,
} from "@/services/opportunities/clearOpportunities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [
      total,
      waitingAffiliate,
      readyToQueue,
      queued,
      published,
      dismissed,
      error,
      items,
    ] = await Promise.all([
      prisma.productOpportunity.count(),

      prisma.productOpportunity.count({
        where: {
          status: "WAITING_AFFILIATE",
        },
      }),

      prisma.productOpportunity.count({
        where: {
          status: "READY_TO_QUEUE",
        },
      }),

      prisma.productOpportunity.count({
        where: {
          status: "QUEUED",
        },
      }),

      prisma.productOpportunity.count({
        where: {
          status: "PUBLISHED",
        },
      }),

      prisma.productOpportunity.count({
        where: {
          status: "DISMISSED",
        },
      }),

      prisma.productOpportunity.count({
        where: {
          status: "ERROR",
        },
      }),

      prisma.productOpportunity.findMany({
        orderBy: {
          discoveredAt: "desc",
        },
        take: 100,
        select: {
          id: true,
          marketplace: true,
          externalId: true,
          sourceType: true,
          sourceUrl: true,
          title: true,
          image: true,
          categoryId: true,
          categoryName: true,
          price: true,
          oldPrice: true,
          discount: true,
          affiliateLink: true,
          status: true,
          attempts: true,
          errorMessage: true,
          productId: true,
          discoveredAt: true,
          updatedAt: true,
          queuedAt: true,
          publishedAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      summary: {
        total,
        waitingAffiliate,
        readyToQueue,
        queued,
        published,
        dismissed,
        error,
      },
      items,
    });
  } catch (error) {
    console.error(
      "Erro ao carregar oportunidades:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar as oportunidades.",
      },
      {
        status: 500,
      }
    );
  }
}

export async function PATCH(
  request: Request
) {
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
            "Informe a oportunidade que será descartada.",
        },
        {
          status: 400,
        }
      );
    }

    const reason =
      typeof body?.reason === "string" &&
      body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : "Produto indisponível no marketplace.";

    const opportunity =
      await prisma.productOpportunity.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          status: true,
          title: true,
        },
      });

    if (!opportunity) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Oportunidade não encontrada.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      opportunity.status === "QUEUED" ||
      opportunity.status === "PUBLISHED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Esta oportunidade já foi enviada para publicação e não pode ser descartada por esta tela.",
        },
        {
          status: 409,
        }
      );
    }

    if (opportunity.status !== "DISMISSED") {
      await prisma.productOpportunity.update({
        where: {
          id: opportunity.id,
        },
        data: {
          status: "DISMISSED",
          affiliateLink: null,
          reviewReason: reason,
          errorMessage: null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message:
        "Produto indisponível descartado da lista de publicação.",
      id: opportunity.id,
    });
  } catch (error) {
    console.error(
      "Erro ao descartar oportunidade:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível descartar a oportunidade.",
      },
      {
        status: 500,
      }
    );
  }
}

export async function DELETE() {
  try {
    const resultado = await limparOportunidadesDoPainel();

    return NextResponse.json({
      success: true,
      deletedCount: resultado.deletedCount,
      preservedCount: resultado.preservedCount,
      removed: resultado.deletedCount,
      preserved: resultado.preservedCount,
      message: montarMensagemLimpeza(resultado),
    });
  } catch (error) {
    console.error(
      "Erro ao limpar oportunidades:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível limpar as oportunidades.",
      },
      {
        status: 500,
      },
    );
  }
}
