import { NextResponse } from "next/server";

import { obterUserIdAutenticado } from "@/lib/supabaseServerAuth";
import {
  FavoriteError,
  FAVORITE_ERROR_CODES,
} from "@/services/favorites/errors";
import { favoritos } from "@/services/favorites/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await obterUserIdAutenticado(request);

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: "Entre na sua conta para sincronizar os favoritos.",
        },
        { status: 401 }
      );
    }

    const body = (await request.json()) as {
      productIds?: unknown;
    };

    const resultado = await favoritos.unirFavoritosLocais(
      userId,
      body.productIds
    );

    return NextResponse.json({
      success: true,
      ...resultado,
    });
  } catch (error) {
    if (error instanceof FavoriteError) {
      const status =
        error.code === FAVORITE_ERROR_CODES.PRODUCT_NOT_FOUND
          ? 404
          : 400;

      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
        },
        { status }
      );
    }

    console.error("Erro ao sincronizar favoritos:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Não foi possível sincronizar seus favoritos.",
      },
      { status: 500 }
    );
  }
}
