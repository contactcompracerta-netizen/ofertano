import { NextResponse } from "next/server";

import { discoverAmazonOpportunities } from "@/services/opportunities/discoverAmazon";
import { discoverMercadoLivreOpportunities } from "@/services/opportunities/discoverMercadoLivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SupportedMarketplace =
  | "MERCADO_LIVRE"
  | "AMAZON";

function obterMarketplace(
  value: unknown,
): SupportedMarketplace | null {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "MERCADO_LIVRE";
  }

  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const normalized =
    value
      .trim()
      .toUpperCase();

  if (
    normalized ===
      "MERCADO_LIVRE" ||
    normalized ===
      "AMAZON"
  ) {
    return normalized;
  }

  return null;
}

function obterQuantidade(
  value: unknown,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return 5;
  }

  return Math.min(
    10,
    Math.max(
      1,
      Math.trunc(value),
    ),
  );
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request
        .json()
        .catch(() => null);

    const marketplace =
      obterMarketplace(
        body?.marketplace,
      );

    const quantity =
      obterQuantidade(
        body?.quantity,
      );

    if (!marketplace) {
      return NextResponse.json(
        {
          success:
            false,

          error:
            "Marketplace inválido. Use MERCADO_LIVRE ou AMAZON.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      marketplace ===
      "AMAZON"
    ) {
      const query =
        typeof body?.query ===
        "string"
          ? body.query.trim()
          : "";

      if (
        query.length < 3
      ) {
        return NextResponse.json(
          {
            success:
              false,

            error:
              "Informe um produto Amazon com pelo menos 3 caracteres.",
          },
          {
            status:
              400,
          },
        );
      }

      const result =
        await discoverAmazonOpportunities(
          query,
          quantity,
        );

      return NextResponse.json({
        success:
          true,

        message:
          result.added > 0
            ? `${result.added} oportunidade(s) Amazon adicionada(s) para revisão.`
            : result.found > 0
              ? "Os produtos Amazon encontrados já estavam cadastrados."
              : "Nenhum produto Amazon compatível foi encontrado.",

        ...result,
      });
    }

    const categoryId =
      typeof body?.categoryId ===
      "string"
        ? body.categoryId
            .trim()
            .toUpperCase()
        : "";

    if (
      !/^MLB\d+$/.test(
        categoryId,
      )
    ) {
      return NextResponse.json(
        {
          success:
            false,

          error:
            "Informe uma categoria válida no formato MLB seguido de números.",
        },
        {
          status:
            400,
        },
      );
    }

    const result =
      await discoverMercadoLivreOpportunities(
        categoryId,
        quantity,
      );

    return NextResponse.json({
      success:
        true,

      marketplace:
        "MERCADO_LIVRE",

      message:
        `${result.added} oportunidade(s) nova(s) encontrada(s).`,

      ...result,
    });
  } catch (error) {
    console.error(
      "Erro ao descobrir oportunidades:",
      error,
    );

    return NextResponse.json(
      {
        success:
          false,

        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao descobrir oportunidades.",
      },
      {
        status:
          500,
      },
    );
  }
}