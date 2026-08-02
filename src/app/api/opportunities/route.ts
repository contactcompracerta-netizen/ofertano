import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

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
      "Erro ao consultar oportunidades:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao consultar oportunidades.",
      },
      {
        status: 500,
      }
    );
  }
}