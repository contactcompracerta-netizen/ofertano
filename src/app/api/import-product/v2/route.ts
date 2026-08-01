import { NextResponse } from "next/server";

import { importarProduto } from "@/services/importers";
import { saveProduct } from "@/services/database/saveProduct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request
) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const url =
      typeof body?.url === "string"
        ? body.url.trim()
        : "";

    if (!url) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Cole o link do produto do Mercado Livre.",
        },
        {
          status: 400,
        }
      );
    }

    const imported = await importarProduto(url);
    const saved = await saveProduct(imported);

    return NextResponse.json({
      success: true,
      message:
        "Produto importado com sucesso!",
      product: {
        id: saved.id,
        mlId: saved.mlId,
        name: saved.name,
        image: saved.image,
        price: saved.price,
        oldPrice: saved.oldPrice,
        discount: saved.discount,
        category: saved.category,
      },
    });
  } catch (error) {
    console.error(
      "Erro na importação:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao importar produto.",
      },
      {
        status: 500,
      }
    );
  }
}
