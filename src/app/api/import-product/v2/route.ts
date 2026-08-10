import { NextResponse } from "next/server";

import { importarProduto } from "@/services/importers";
import { saveProduct } from "@/services/database/saveProduct";
import { buscarComparacaoManual } from "@/services/comparison/manualComparison";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  request: Request,
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
            "Cole o link do produto.",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * Primeiro importamos e salvamos
     * o produto informado pelo administrador.
     */
    const imported =
      await importarProduto(url);

    const saved =
      await saveProduct(
        imported,
        imported.affiliateLink,
        {
          discoverySource:
            "MANUAL",
          autoCreated: false,
        },
      );

    /*
     * Depois procuramos automaticamente
     * ofertas equivalentes.
     *
     * Falha na busca secundária nunca deve
     * desfazer a importação principal.
     */
    let comparison:
      Awaited<
        ReturnType<
          typeof buscarComparacaoManual
        >
      > | null = null;

    let comparisonError:
      string | null = null;

    try {
      comparison =
        await buscarComparacaoManual(
          imported,
          saved.id,
        );
    } catch (error) {
      console.error(
        "Erro na comparação multiloja:",
        error,
      );

      comparisonError =
        error instanceof Error
          ? error.message
          : "Erro durante a busca de outras lojas.";
    }

    return NextResponse.json({
      success: true,

      message:
        comparison?.found
          ? `Produto importado e ${comparison.found} oferta(s) equivalente(s) encontrada(s).`
          : "Produto importado com sucesso. Nenhuma nova oferta exata foi encontrada automaticamente.",

      product: {
        id: saved.id,
        mlId: saved.mlId,
        name: saved.name,
        image: saved.image,
        price: saved.price,
        oldPrice:
          saved.oldPrice,
        discount:
          saved.discount,
        category:
          saved.category,

        sourceMarketplace:
          imported.marketplace,
      },

      comparison,

      comparisonError,
    });
  } catch (error) {
    console.error(
      "Erro na importação:",
      error,
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
      },
    );
  }
}
