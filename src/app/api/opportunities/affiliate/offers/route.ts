import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { validateOfficialMercadoLivreAffiliateLink } from "@/lib/affiliates/validateAdminAffiliateLink";
import {
  applyConfirmedAffiliateLinkToOwnedOffer,
  createPrismaApplyAffiliateLinkStore,
} from "@/services/opportunities/applyAffiliateLink";
import { sincronizarMelhorOfertaDoProduto } from "@/services/database/saveProduct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TRANSACTION_MAX_WAIT_MS = 10_000;
const TRANSACTION_TIMEOUT_MS = 45_000;

export async function GET() {
  try {
    const offers =
      await prisma.marketplaceOffer.findMany({    
        where: {
          marketplace:
            "MERCADO_LIVRE",

          status:
            "PENDING_AFFILIATE",

          matchStatus:
            "EXACT",

          OR: [
            {
              affiliateLink: null,
            },
            {
              affiliateLink: "",
            },
          ],
        },

        orderBy: {
          createdAt: "asc",
        },

        select: {
          id: true,
          productId: true,
          externalId: true,
          sourceUrl: true,
          price: true,
          createdAt: true,

          product: {
            select: {
              id: true,
              name: true,
              image: true,
              price: true,
              publicationStatus: true,
            },
          },
        },
      });

    const productIds =
      Array.from(
        new Set(
          offers.map(
            (offer) =>
              offer.productId,
          ),
        ),
      );

    /*
     * Compatibilidade com produtos antigos:      
     * antes de MarketplaceOffer.sourceUrl ser usado
     * como fonte principal, algumas URLs estavam 
     * disponíveis apenas em ProductOpportunity.  
     */
    const opportunities =
      productIds.length > 0
        ? await prisma.productOpportunity.findMany(
            {
              where: {
                productId: {
                  in: productIds,
                },

                marketplace:
                  "MERCADO_LIVRE",

                status:
                  "PUBLISHED",
              },

              orderBy: {
                publishedAt: "desc",
              },

              select: {
                id: true,
                productId: true,
                sourceUrl: true,
                title: true,
              },
            },
          )
        : [];

    const opportunityByProduct =
      new Map<
        string,
        {
          id: string;
          sourceUrl: string;
        }
      >();

    for (
      const opportunity of opportunities
    ) {
      if (
        opportunity.productId &&
        !opportunityByProduct.has(
          opportunity.productId,
        )
      ) {
        opportunityByProduct.set(
          opportunity.productId,
          {
            id: opportunity.id,
            sourceUrl:
              opportunity.sourceUrl,
          },
        );
      }
    }

    const items =
      offers
        .map((offer) => {
          const opportunity =
            opportunityByProduct.get(
              offer.productId,
            );

          /*
           * A URL da própria MarketplaceOffer é a
           * fonte principal. Isso cobre MANUAL,  
           * ON_DEMAND_SEARCH, PRICE_MONITOR e API.
           *
           * ProductOpportunity fica somente como 
           * fallback para registros antigos.     
           */
          const sourceUrl =
            offer.sourceUrl?.trim() ||
            opportunity?.sourceUrl?.trim() ||     
            "";

          if (!sourceUrl) {
            return null;
          }

          return {
            offerId:
              offer.id,

            productId:
              offer.productId,

            opportunityId:
              opportunity?.id ?? "",

            externalId:
              offer.externalId,

            sourceUrl,

            name:
              offer.product.name,

            image:
              offer.product.image,

            price:
              Number(offer.price),

            createdAt:
              offer.createdAt,
          };
        })
        .filter(
          (
            item,
          ): item is NonNullable<
            typeof item
          > => item !== null,
        );

    return NextResponse.json({
      success: true,
      total: items.length,
      items,
    });
  } catch (error) {
    console.error(
      "Erro ao carregar links pendentes:",        
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao carregar links pendentes.",
      },
      {
        status: 500,
      },
    );
  }
}

type AffiliateItem = {
  offerId: string;
  affiliateLink: string;
};

export async function POST(
  request: Request,
) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const rawItems =
      Array.isArray(body?.items)
        ? body.items
        : [];

    if (rawItems.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Nenhum link foi enviado.",
        },
        {
          status: 400,
        },
      );
    }

    const items: AffiliateItem[] =
      [];

    for (const rawItem of rawItems) {
      const offerId =
        typeof rawItem?.offerId ===
        "string"
          ? rawItem.offerId.trim()
          : "";

      const affiliateLink =
        typeof rawItem
          ?.affiliateLink ===
        "string"
          ? validateOfficialMercadoLivreAffiliateLink(
              rawItem.affiliateLink,
            )
          : null;

      if (!offerId) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Existe um produto sem identificador de oferta.",
          },
          {
            status: 400,
          },
        );
      }

      if (!affiliateLink) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Todos os links devem ser links completos oficiais do Mercado Livre, gerados com a etiqueta ofertano.",
          },
          {
            status: 400,
          },
        );
      }

      items.push({
        offerId,
        affiliateLink,
      });
    }

    const offerIds =
      items.map(
        (item) => item.offerId,
      );

    if (
      new Set(offerIds).size !==
      offerIds.length
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Existem ofertas repetidas na solicitação.",
        },
        {
          status: 400,
        },
      );
    }

    const normalizedLinks =
      items.map((item) =>
        item.affiliateLink.toLowerCase(),
      );

    if (
      new Set(normalizedLinks).size !==
      normalizedLinks.length
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Existem links de afiliado repetidos.",
        },
        {
          status: 400,
        },
      );
    }

    const offers =
      await prisma.marketplaceOffer.findMany(     
        {
          where: {
            id: {
              in: offerIds,
            },
          },

          select: {
            id: true,
            productId: true,
            marketplace: true,
            externalId: true,
            status: true,
            matchStatus: true,
            affiliateLink: true,
          },
        },
      );

    if (
      offers.length !==
      items.length
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Uma ou mais ofertas não foram encontradas. Atualize a página e tente novamente.",
        },
        {
          status: 409,
        },
      );
    }

    for (const offer of offers) {
      if (
        offer.marketplace !==
        "MERCADO_LIVRE"
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Esta operação aceita somente ofertas do Mercado Livre.",
          },
          {
            status: 400,
          },
        );
      }

      if (
        offer.status !==
          "PENDING_AFFILIATE" ||
        offer.matchStatus !== "EXACT" ||
        offer.affiliateLink
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Uma das ofertas não está mais aguardando link de afiliado. Atualize a página.",
          },
          {
            status: 409,
          },
        );
      }
    }

    const itemByOfferId =
      new Map(
        items.map((item) => [
          item.offerId,
          item,
        ]),
      );

    await prisma.$transaction(
      async (tx) => {
        const store = createPrismaApplyAffiliateLinkStore(tx);

        for (const offer of offers) {
          const item =
            itemByOfferId.get(
              offer.id,
            );

          if (!item) {
            throw new Error(
              "Não foi possível associar um dos links.",
            );
          }

          const applied =
            await applyConfirmedAffiliateLinkToOwnedOffer(
              {
                offerId: offer.id,
                affiliateLink: item.affiliateLink,
              },
              store,
            );

          if (!applied.ok) {
            throw new Error(applied.error);
          }

          await sincronizarMelhorOfertaDoProduto(
            tx,
            applied.productId,
          );
        }
      },
      {
        maxWait:
          TRANSACTION_MAX_WAIT_MS,

        timeout:
          TRANSACTION_TIMEOUT_MS,
      },
    );

    return NextResponse.json({
      success: true,
      updated: items.length,
      message:
        `${items.length} link(s) de afiliado ativado(s) com sucesso.`,
    });
  } catch (error) {
    console.error(
      "Erro ao ativar links de afiliado:",        
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao ativar os links.", 
      },
      {
        status: 500,
      },
    );
  }
}
