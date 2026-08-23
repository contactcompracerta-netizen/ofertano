import { NextResponse } from "next/server";

import { obterUserIdAutenticado } from "@/lib/supabaseServerAuth";
import {
  FavoriteError,
  FAVORITE_ERROR_CODES,
} from "@/services/favorites/errors";
import { favoritos } from "@/services/favorites/server";

export const dynamic = "force-dynamic";

function responderErro(error: unknown) {
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

  console.error("Erro na API de favoritos:", error);

  return NextResponse.json(
    {
      success: false,
      error: "Não foi possível processar seus favoritos.",
    },
    { status: 500 }
  );
}

async function exigirUsuario(request: Request): Promise<
  | { userId: string; response?: undefined }
  | { userId: null; response: NextResponse }
> {
  const userId = await obterUserIdAutenticado(request);

  if (!userId) {
    return {
      userId: null,
      response: NextResponse.json(
        {
          success: false,
          error: "Entre na sua conta para gerenciar favoritos.",
        },
        { status: 401 }
      ),
    };
  }

  return { userId };
}

export async function GET(request: Request) {
  try {
    const autenticacao = await exigirUsuario(request);

    if (!autenticacao.userId) {
      return autenticacao.response;
    }

    const productId = new URL(request.url).searchParams.get(
      "productId"
    );

    if (productId) {
      const favorited = await favoritos.produtoEstaFavoritado(
        autenticacao.userId,
        productId
      );

      return NextResponse.json({
        success: true,
        productId,
        favorited,
      });
    }

    const lista = await favoritos.listarFavoritos(autenticacao.userId);

    return NextResponse.json({
      success: true,
      productIds: lista.map((item) => item.productId),
    });
  } catch (error) {
    return responderErro(error);
  }
}

export async function POST(request: Request) {
  try {
    const autenticacao = await exigirUsuario(request);

    if (!autenticacao.userId) {
      return autenticacao.response;
    }

    const body = (await request.json()) as {
      productId?: unknown;
    };

    const resultado = await favoritos.adicionarFavorito(
      autenticacao.userId,
      body.productId
    );

    return NextResponse.json({
      success: true,
      created: resultado.created,
      productId: resultado.favorite.productId,
    });
  } catch (error) {
    return responderErro(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const autenticacao = await exigirUsuario(request);

    if (!autenticacao.userId) {
      return autenticacao.response;
    }

    const productId =
      new URL(request.url).searchParams.get("productId") ??
      undefined;

    const resultado = await favoritos.removerFavorito(
      autenticacao.userId,
      productId
    );

    return NextResponse.json({
      success: true,
      removed: resultado.removed,
      productId: resultado.productId,
    });
  } catch (error) {
    return responderErro(error);
  }
}
