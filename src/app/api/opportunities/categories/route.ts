import { NextResponse } from "next/server";

import { mercadoLivreFetch } from "@/lib/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MercadoLivreCategory = {
  id?: string;
  name?: string;
};

export async function GET() {
  try {
    const response = (await mercadoLivreFetch(
      "/sites/MLB/categories"
    )) as MercadoLivreCategory[];

    const categories = response
      .filter(
        (category) =>
          typeof category.id === "string" &&
          typeof category.name === "string"
      )
      .map((category) => ({
        id: category.id!,
        name: category.name!.trim(),
      }))
      .sort((first, second) =>
        first.name.localeCompare(
          second.name,
          "pt-BR"
        )
      );

    return NextResponse.json({
      success: true,
      categories,
    });
  } catch (error) {
    console.error(
      "Erro ao carregar categorias do Mercado Livre:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar as categorias.",
      },
      {
        status: 500,
      }
    );
  }
}
