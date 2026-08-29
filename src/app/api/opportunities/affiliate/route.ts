import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { validateOfficialMercadoLivreAffiliateLink } from "@/lib/affiliates/validateAdminAffiliateLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const id =
      typeof body?.id === "string"
        ? body.id.trim()
        : "";

    const affiliateLink =
      typeof body?.affiliateLink === "string"
        ? validateOfficialMercadoLivreAffiliateLink(body.affiliateLink)
        : null;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: "Identificador da oportunidade não informado.",
        },
        {
          status: 400,
        }
      );
    }

    if (!affiliateLink) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Informe um link válido de afiliado do Mercado Livre.",
        },
        {
          status: 400,
        }
      );
    }

    const opportunity =
      await prisma.productOpportunity.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          status: true,
          productId: true,
          marketplace: true,
          externalId: true,
        },
      });

    if (!opportunity) {
      return NextResponse.json(
        {
          success: false,
          error: "Oportunidade não encontrada.",
        },
        {
          status: 404,
        }
      );
    }

    const editableStatuses = [
      "WAITING_AFFILIATE",
      "READY_TO_QUEUE",
      "ERROR",
    ] as const;

    if (!editableStatuses.includes(opportunity.status as typeof editableStatuses[number])) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Esta oportunidade não permite alterar o link de afiliado.",
        },
        {
          status: 409,
        }
      );
    }

    if (
      opportunity.marketplace === "MERCADO_LIVRE" &&
      opportunity.productId
    ) {
      const { applyConfirmedAffiliateLinkWithProductSync } = await import(
        "@/services/opportunities/applyAffiliateLink"
      );
      const applied = await applyConfirmedAffiliateLinkWithProductSync({
        opportunityId: opportunity.id,
        affiliateLink,
      });

      if (applied.ok) {
        return NextResponse.json({
          success: true,
          message:
            "Link de afiliado salvo. A oferta do Mercado Livre já está disponível.",
        });
      }

      if (
        applied.code === "PRODUCT_MISMATCH" ||
        applied.code === "EXTERNAL_ID_MISMATCH"
      ) {
        return NextResponse.json(
          {
            success: false,
            error: applied.error,
          },
          {
            status: 409,
          },
        );
      }
    }

    const result =
      await prisma.productOpportunity.updateMany({
        where: {
          id,
          status: {
            in: [
              "WAITING_AFFILIATE",
              "READY_TO_QUEUE",
              "ERROR",
            ],
          },
        },
        data: {
          affiliateLink,
          status: "READY_TO_QUEUE",
          errorMessage: null,
        },
      });

    if (result.count === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "A oportunidade foi alterada por outro processo. Atualize o painel.",
        },
        {
          status: 409,
        }
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "Link de afiliado salvo. Produto pronto para publicação.",
    });
  } catch (error) {
    console.error(
      "Erro ao salvar link de afiliado:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao salvar o link de afiliado.",
      },
      {
        status: 500,
      }
    );
  }
}