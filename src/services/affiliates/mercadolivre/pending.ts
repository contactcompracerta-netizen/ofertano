import type { MarketplaceOfferStatus, PrismaClient } from "@prisma/client";
import { confirmarAffiliateLinkMercadoLivre } from "@/lib/affiliates/publicPurchase";

export type MercadoLivrePending = {
  offerId: string;
  productId: string;
  externalId: string | null;
  sourceUrl: string | null;
  opportunityId: string | null;
};

export type MercadoLivrePendingStore = {
  listPendingMercadoLivreOffers(limit: number): Promise<MercadoLivrePending[]>;
  /** Conta pendências candidatas (mesmo filtro de listagem, sem limite). */
  countPending(): Promise<number>;
  findOfferById(offerId: string): Promise<{
    id: string;
    productId: string;
    marketplace: string;
    externalId: string | null;
    sourceUrl: string | null;
    affiliateLink: string | null;
  } | null>;
};

export type MercadoLivreApplyStore = {
  applyValidatedAffiliateLink(input: {
    offerId: string;
    opportunityId: string | null;
    affiliateUrl: string;
  }): Promise<void>;
};

type PrismaLike = Pick<PrismaClient, "productOpportunity" | "marketplaceOffer">;

/** Oferta que pode receber link: visível ao público e não descartada. */
const OFERTA_ELEGIVEL = {
  active: true,
  available: true,
  status: { notIn: ["UNAVAILABLE", "ERROR"] as MarketplaceOfferStatus[] },
};

/**
 * "Sem link de afiliado" NÃO é `affiliateLink IS NULL`.
 *
 * A definição de link válido é a de produção (`confirmarAffiliateLinkMercadoLivre`)
 * e ela rejeita formatos que a coluna não consegue rejeitar: o fallback genérico
 * `meli.la/1i7Te2C`, a `sourceUrl` comum repetida na coluna de afiliado, e links
 * de fora da forma oficial. Filtrar por `IS NULL` deixaria essas ofertas fora
 * da fila para sempre — que é a forma mais silenciosa de "automatismo que não
 * automatiza".
 *
 * Ordem: mais antiga primeiro. É o que faz o sweep de ofertas históricas
 * escapar antes das novas, sem precisar de um job separado.
 */
function semLinkValido(oferta: {
  affiliateLink: string | null;
  sourceUrl: string | null;
}) {
  return (
    confirmarAffiliateLinkMercadoLivre({
      affiliateLink: oferta.affiliateLink,
      sourceUrl: oferta.sourceUrl,
    }) === null
  );
}

export async function listPendingMercadoLivreOffers(
  store: MercadoLivrePendingStore,
  limit: number,
): Promise<MercadoLivrePending[]> {
  return store.listPendingMercadoLivreOffers(limit);
}

export function createPrismaMercadoLivrePendingStore(
  client: PrismaLike,
): MercadoLivrePendingStore {
  return {
    async listPendingMercadoLivreOffers(limit) {
      if (limit <= 0) return [];

      /* Janela de varredura. A validação final é em JS (o SQL não consegue
         enumerar "forma inválida"), então busca-se um lote maior que o
         pedido e filtra-se. O excedente não some: countPending() conta
         tudo, e o relatório expõe a fila real. */
      const scan = Math.max(limit * 4, 200);

      const offers = await client.marketplaceOffer.findMany({
        where: { marketplace: "MERCADO_LIVRE", ...OFERTA_ELEGIVEL },
        orderBy: { createdAt: "asc" },
        take: scan,
        select: {
          id: true,
          productId: true,
          externalId: true,
          sourceUrl: true,
          affiliateLink: true,
        },
      });

      const semLink = offers.filter(semLinkValido).slice(0, limit);

      /* Sem link não há o que gerar: o Link Builder parte da URL do anúncio.
         Registrar como pendência futile só faria a fila nunca zerar. */
      const comUrl = semLink.filter((o) => o.sourceUrl?.trim());

      /* A oportunidade é OPCIONAL. A fila é dirigida pela oferta; se existir
         uma ProductOpportunity em WAITING_AFFILIATE do mesmo produto, ela é
         anexada para que o apply mantenha a sincronia de Product/Oportunidade.
         * Não criamos oportunidade nova — a coluna `productId` da oferta é
         a âncora, e criar linhas só duplicaria estado. */
      const productIds = [...new Set(comUrl.map((o) => o.productId))];
      const opportunities = productIds.length
        ? await client.productOpportunity.findMany({
            where: {
              marketplace: "MERCADO_LIVRE",
              status: "WAITING_AFFILIATE",
              affiliateLink: null,
              productId: { in: productIds },
            },
            select: { id: true, productId: true },
          })
        : [];

      const oppByProduct = new Map<string, string>();
      for (const o of opportunities) {
        if (o.productId && !oppByProduct.has(o.productId)) {
          oppByProduct.set(o.productId, o.id);
        }
      }

      return comUrl.map((o): MercadoLivrePending => ({
        offerId: o.id,
        productId: o.productId,
        externalId: o.externalId,
        sourceUrl: o.sourceUrl,
        opportunityId: oppByProduct.get(o.productId) ?? null,
      }));
    },

    async countPending() {
      /* Contagem honesta: varre as ofertas elegíveis e conta as que não têm
         link válido. Sem `take` — o número reported é o universe real. */
      const offers = await client.marketplaceOffer.findMany({
        where: { marketplace: "MERCADO_LIVRE", ...OFERTA_ELEGIVEL },
        select: { affiliateLink: true, sourceUrl: true },
      });
      return offers.filter(semLinkValido).length;
    },

    async findOfferById(offerId) {
      const row = await client.marketplaceOffer.findUnique({
        where: { id: offerId },
        select: {
          id: true,
          productId: true,
          marketplace: true,
          externalId: true,
          sourceUrl: true,
          affiliateLink: true,
        },
      });
      return row
        ? {
            id: row.id,
            productId: row.productId,
            marketplace: String(row.marketplace),
            externalId: row.externalId,
            sourceUrl: row.sourceUrl,
            affiliateLink: row.affiliateLink,
          }
        : null;
    },
  };
}
