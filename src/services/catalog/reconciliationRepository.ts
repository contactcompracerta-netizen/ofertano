/*
 * Repositório real (Prisma) do reconciliador de apresentação.
 *
 * - Somente leitura na listagem.
 * - A correção é DRAFT + active=false via update; nunca DELETE.
 */

import prisma from "@/lib/prisma";

import type {
  CatalogReconciliationRepository,
  AutoCreatedActiveProductRow,
} from "./reconciliation";

import { PUBLIC_OFFER_SELECT } from "@/services/publicVisibility/multiStoreVisibility";

const OFFER_SELECT = {
  ...(PUBLIC_OFFER_SELECT as {
    select: object;
  }).select,
  active: true,
  matchStatus: true,
} as const;

export function createPrismaCatalogReconciliationRepository(): CatalogReconciliationRepository {
  return {
    async listAutoCreatedActiveProducts() {
      const products = await prisma.product.findMany({
        where: {
          autoCreated: true,
          active: true,
        },
        select: {
          id: true,
          name: true,
          autoCreated: true,
          active: true,
          publicationStatus: true,
          offers: {
            where: {
              active: true,
              matchStatus: "EXACT",
            },
            select: { ...OFFER_SELECT },
          },
        },
      });

      return products as unknown as AutoCreatedActiveProductRow[];
    },

    async deactivateProductToDraft(
      productId: string,
    ) {
      const atual =
        await prisma.product.findUnique({
          where: {
            id: productId,
          },
          select: {
            active: true,
            publicationStatus: true,
          },
        });

      if (!atual) {
        return false;
      }

      if (
        atual.active === false &&
        atual.publicationStatus === "DRAFT"
      ) {
        return false;
      }

      await prisma.product.update({
        where: {
          id: productId,
        },
        data: {
          publicationStatus: "DRAFT",
          active: false,
        },
      });

      return true;
    },
  };
}