import { NextRequest, NextResponse } from "next/server";

import { descobrirProdutos } from "@/services/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function obterLimite(
  valor: string | null,
): number | undefined {
  if (!valor) {
    return undefined;
  }

  const numero = Number(valor);

  if (
    !Number.isFinite(numero) ||
    numero <= 0
  ) {
    return undefined;
  }

  return Math.trunc(numero);
}

export async function GET(
  request: NextRequest,
) {
  try {
    const { searchParams } =
      request.nextUrl;

    const query =
      searchParams
        .get("q")
        ?.trim() ?? "";

    const limit =
      obterLimite(
        searchParams.get("limit"),
      );

    if (!query) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Informe a busca usando "?q=produto".',
        },
        {
          status: 400,
        },
      );
    }

    const resultado =
      await descobrirProdutos(
        query,
        limit,
      );

    return NextResponse.json({
      success: true,

      query:
        resultado.query,

      normalizedQuery:
        resultado.normalizedQuery,

      found:
        resultado.found,

      errors:
        resultado.errors,

      marketplaces:
        resultado.results.map(
          (item) => ({
            marketplace:
              item.marketplace,

            success:
              item.success,

            scanned:
              item.scanned,

            found:
              item.candidates.length,

            error:
              item.error ?? null,
          }),
        ),

      candidates:
        resultado.candidates.map(
          (candidate) => ({
            marketplace:
              candidate.marketplace,

            externalId:
              candidate.externalId,

            title:
              candidate.title,

            price:
              candidate.price,

            oldPrice:
              candidate.oldPrice,

            image:
              candidate.image,

            sourceUrl:
              candidate.sourceUrl,

            affiliateLink:
              candidate.affiliateLink ??
              null,

            status:
              candidate.status,
          }),
        ),

      startedAt:
        resultado.startedAt.toISOString(),

      completedAt:
        resultado.completedAt.toISOString(),
    });
  } catch (error) {
    console.error(
      "Erro no teste de descoberta automática:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno durante a descoberta.",
      },
      {
        status: 500,
      },
    );
  }
}