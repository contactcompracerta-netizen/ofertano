import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { MAX_FAVORITE_PAYLOAD_ITEMS } from "@/lib/favorites/constants";
import { loadFavoriteProducts } from "@/services/favorites/products";

export const dynamic = "force-dynamic";

type RequestBody = {
  ids?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    if (!Array.isArray(body.ids)) {
      return NextResponse.json(
        {
          success: false,
          error: "Lista de favoritos inválida.",
          products: [],
        },
        { status: 400 },
      );
    }

    if (body.ids.length > MAX_FAVORITE_PAYLOAD_ITEMS) {
      return NextResponse.json(
        {
          success: false,
          error: "Lista de favoritos inválida.",
          products: [],
        },
        { status: 400 },
      );
    }

    const products = await loadFavoriteProducts(prisma, body.ids);

    return NextResponse.json({
      success: true,
      products,
    });
  } catch (error) {
    console.error("Erro ao carregar favoritos:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Não foi possível carregar seus favoritos.",
        products: [],
      },
      { status: 500 },
    );
  }
}
