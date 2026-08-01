import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [
      total,
      pending,
      processing,
      success,
      error,
      queueItems,
    ] = await Promise.all([
      prisma.importQueue.count(),

      prisma.importQueue.count({
        where: {
          status: "PENDING",
        },
      }),

      prisma.importQueue.count({
        where: {
          status: "PROCESSING",
        },
      }),

      prisma.importQueue.count({
        where: {
          status: "SUCCESS",
        },
      }),

      prisma.importQueue.count({
        where: {
          status: "ERROR",
        },
      }),

      prisma.importQueue.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: 100,
        select: {
          id: true,
          url: true,
          marketplace: true,
          status: true,
          attempts: true,
          errorMessage: true,
          productId: true,
          createdAt: true,
          updatedAt: true,
          processedAt: true,
        },
      }),
    ]);

    const productIds = queueItems
      .map((item) => item.productId)
      .filter(
        (productId): productId is string =>
          typeof productId === "string"
      );

    const products =
      productIds.length > 0
        ? await prisma.product.findMany({
            where: {
              id: {
                in: productIds,
              },
            },
            select: {
              id: true,
              name: true,
            },
          })
        : [];

    const productNames = new Map(
      products.map((product) => [
        product.id,
        product.name,
      ])
    );

    const items = queueItems.map((item) => ({
      ...item,
      productName: item.productId
        ? productNames.get(item.productId) ?? null
        : null,
    }));

    return NextResponse.json({
      success: true,
      summary: {
        total,
        pending,
        processing,
        success,
        error,
      },
      items,
    });
  } catch (error) {
    console.error(
      "Erro ao consultar fila de importação:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao consultar a fila.",
      },
      {
        status: 500,
      }
    );
  }
}