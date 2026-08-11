import { NextResponse } from "next/server";

import { importarProduto } from "@/services/importers";
import { saveProduct } from "@/services/database/saveProduct";
import { buscarComparacaoManual } from "@/services/comparison/manualComparison";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function obterLinkAfiliadoAmazon(
  rawUrl: string,
  marketplace: string,
): string | null {
  if (marketplace !== "Amazon") {
    return null;
  }

  try {
    const url = new URL(rawUrl);

    const hostname = url.hostname
      .toLowerCase()
      .replace(/^www\./, "");

    const dominioAmazon =
      hostname === "amazon.com.br" ||
      hostname.endsWith(".amazon.com.br") ||
      hostname === "amazon.com" ||
      hostname.endsWith(".amazon.com");

    if (!dominioAmazon) {
      return null;
    }

    const tag =
      url.searchParams.get("tag")?.trim();

    if (tag !== "ofertano-20") {
      return null;
    }

    return rawUrl.trim();
  } catch {
    return null;
  }
}

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
     * Primeiro importamos o produto informado
     * pelo administrador.
     */
    const imported =
      await importarProduto(url);

    /*
     * Na importação manual da Amazon,
     * preservamos o URL original quando ele
     * contém o identificador oficial do
     * Ofertano no programa de afiliados.
     *
     * Isso evita perder os parâmetros
     * tag, linkCode e linkId durante a
     * normalização/canonicalização feita
     * pelo importador da Amazon.
     */
    const affiliateLinkAmazon =
      obterLinkAfiliadoAmazon(
        url,
        imported.marketplace,
      );

    const affiliateLink =
      affiliateLinkAmazon ??
      imported.affiliateLink?.trim() ??
      null;

    const saved =
      await saveProduct(
        imported,
        affiliateLink,
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