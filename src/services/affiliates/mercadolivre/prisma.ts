import type { MercadoLivreApplyStore, MercadoLivrePendingStore } from "./pending";
import { createPrismaMercadoLivrePendingStore } from "./pending";

/**
 * Adaptador Prisma para gravar o link de afiliado validado, reutilizando o
 * caminho de produção já comprovado (applyConfirmedAffiliateLinkWithProductSync):
 *   - ativa a MarketplaceOffer (status ACTIVE)
 *   - resolve a ProductOpportunity para PUBLISHED
 *   - sincroniza Product.affiliateLink
 */
export function createPrismaMercadoLivreApplyStore(): MercadoLivreApplyStore {
  return {
    async applyValidatedAffiliateLink(input) {
      const {
        applyConfirmedAffiliateLinkWithProductSync,
      } = await import("@/services/opportunities/applyAffiliateLink");

      const result = await applyConfirmedAffiliateLinkWithProductSync({
        affiliateLink: input.affiliateUrl,
        opportunityId: input.opportunityId ?? undefined,
        offerId: input.offerId,
      });

      if (!result.ok) {
        throw new Error(
          `Falha ao aplicar link de afiliado validado: ${result.code} ${result.error}`,
        );
      }
    },
  };
}

export function createPrismaMercadoLivreWorkerStores(client: unknown): {
  pendingStore: MercadoLivrePendingStore;
  applyStore: MercadoLivreApplyStore;
} {
  const prisma = client as Parameters<typeof createPrismaMercadoLivrePendingStore>[0];
  return {
    pendingStore: createPrismaMercadoLivrePendingStore(prisma),
    applyStore: createPrismaMercadoLivreApplyStore(),
  };
}
