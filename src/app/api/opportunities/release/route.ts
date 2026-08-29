import { NextResponse } from "next/server";

import { applyConfirmedAffiliateLinkWithProductSync } from "@/services/opportunities/applyAffiliateLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function statusForApplyCode(
  code:
    | "INVALID_AFFILIATE_LINK"
    | "OPPORTUNITY_NOT_FOUND"
    | "OFFER_NOT_FOUND"
    | "PRODUCT_MISMATCH"
    | "EXTERNAL_ID_MISMATCH"
    | "NOT_MERCADO_LIVRE",
) {
  if (code === "INVALID_AFFILIATE_LINK" || code === "NOT_MERCADO_LIVRE") {
    return 400;
  }

  if (code === "OPPORTUNITY_NOT_FOUND" || code === "OFFER_NOT_FOUND") {
    return 404;
  }

  return 409;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    const opportunityId =
      typeof body?.opportunityId === "string"
        ? body.opportunityId.trim()
        : "";

    const offerId =
      typeof body?.offerId === "string" ? body.offerId.trim() : "";

    const affiliateLink =
      typeof body?.affiliateLink === "string" ? body.affiliateLink : "";

    if (!opportunityId && !offerId) {
      return NextResponse.json(
        {
          success: false,
          error: "Informe a oportunidade ou a oferta que será liberada.",
        },
        {
          status: 400,
        },
      );
    }

    const applied = await applyConfirmedAffiliateLinkWithProductSync({
      opportunityId: opportunityId || undefined,
      offerId: offerId || undefined,
      affiliateLink,
    });

    if (!applied.ok) {
      return NextResponse.json(
        {
          success: false,
          error: applied.error,
        },
        {
          status: statusForApplyCode(applied.code),
        },
      );
    }

    return NextResponse.json({
      success: true,
      source: opportunityId ? "opportunity" : "offer",
      id: applied.opportunityId ?? applied.offerId,
      opportunityId: applied.opportunityId,
      offerId: applied.offerId,
      message: "Link salvo. Oferta do Mercado Livre liberada.",
    });
  } catch (error) {
    console.error("Erro ao salvar e liberar oferta:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar o link de afiliado.",
      },
      {
        status: 500,
      },
    );
  }
}
