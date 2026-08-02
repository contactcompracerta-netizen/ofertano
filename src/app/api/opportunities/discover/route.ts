import { NextResponse } from "next/server";

import { discoverMercadoLivreOpportunities } from "@/services/opportunities/discoverMercadoLivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const categoryId =
      typeof body?.categoryId === "string"
        ? body.categoryId.trim().toUpperCase()
        : "";

    const quantity =
      typeof body?.quantity === "number"
        ? body.quantity
        : 5;

    if (!/^MLB\d+$/.test(categoryId)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Informe uma categoria válida no formato MLB seguido de números.",
        },
        {
          status: 400,
        }
      );
    }

    const result =
      await discoverMercadoLivreOpportunities(
        categoryId,
        quantity
      );

    return NextResponse.json({
      success: true,
      message:
        `${result.added} oportunidade(s) nova(s) encontrada(s).`,
      ...result,
    });
  } catch (error) {
    console.error(
      "Erro ao descobrir oportunidades:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao descobrir oportunidades.",
      },
      {
        status: 500,
      }
    );
  }
}