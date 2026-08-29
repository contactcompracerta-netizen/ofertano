import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { sanitizarOfertaCompraPublica } from "@/lib/affiliates/liveOffers";
import { resolverLinkLegadoPrincipal } from "@/lib/affiliates/publicPurchase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const productId = id.trim();

    if (!productId) {
      return NextResponse.json(
        { success: false, error: "Produto não informado." },
        { status: 400 },
      );
    }

    const product = await prisma.product.findFirst({
      where: { id: productId },
      select: {
        id: true,
        store: true,
        affiliateLink: true,
        offers: {
          where: {
            active: true,
            matchStatus: "EXACT",
          },
          select: {
            id: true,
            productId: true,
            marketplace: true,
            affiliateLink: true,
            sourceUrl: true,
            matchStatus: true,
            status: true,
            available: true,
            price: true,
            oldPrice: true,
            installments: true,
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { success: false, error: "Produto não encontrado." },
        { status: 404 },
      );
    }

    const offers = product.offers.map((offer) =>
      sanitizarOfertaCompraPublica({
        id: offer.id,
        productId: offer.productId,
        marketplace: offer.marketplace,
        affiliateLink: offer.affiliateLink,
        sourceUrl: offer.sourceUrl,
        matchStatus: offer.matchStatus,
        status: offer.status,
        available: offer.available,
        price: offer.price,
        oldPrice: offer.oldPrice,
        installments: offer.installments,
      }),
    );

    return NextResponse.json({
      success: true,
      productId: product.id,
      store: product.store,
      affiliateLink: resolverLinkLegadoPrincipal(
        product.store,
        product.affiliateLink,
      ) || null,
      offers,
    });
  } catch (error) {
    console.error("Erro ao carregar ofertas ao vivo:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar as ofertas.",
      },
      { status: 500 },
    );
  }
}
