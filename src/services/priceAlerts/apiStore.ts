/**
 * Armazenamento de alertas para a API server-side do Ofertano.
 *
 * Segue o padrao de repositorio do projeto: a implementacao Prisma grava
 * no modelo canonico `PriceAlert` (mesmo usado pelo monitor), permitindo
 * que o alerta criado no frontend seja exatamente o registro lido pelo
 * motor de alertas. Testes usam repositorio em memoria.
 */

export type PriceAlertApiRecord = {
  id: string;
  userId: string;
  productId: string;
  alertType: "ANY_DROP" | "TARGET";
  targetPrice: number | null;
  percentageDrop: number | null;
  referencePrice: number;
  lowestSeenPrice: number | null;
  active: boolean;
};

export type PriceAlertApiStore = {
  findAlert(userId: string, productId: string): Promise<PriceAlertApiRecord | null>;
  upsertAlert(
    userId: string,
    input: {
      productId: string;
      alertType: "ANY_DROP" | "TARGET";
      targetPrice: number | null;
      percentageDrop: number | null;
      referencePrice: number;
      active: boolean;
    },
  ): Promise<PriceAlertApiRecord>;
  deactivateAlert(userId: string, productId: string): Promise<PriceAlertApiRecord | null>;
  productExists(productId: string): Promise<boolean>;
};

export type PrismaPriceAlertRow = {
  id: string;
  userId: string;
  productId: string;
  alertType: string;
  targetPrice: number | null;
  percentageDrop: number | null;
  referencePrice: number;
  lowestSeenPrice: number | null;
  active: boolean;
};

export function createPrismaPriceAlertApiStore(
  prisma: {
    priceAlert: {
      findUnique(args: unknown): Promise<PrismaPriceAlertRow | null>;
      upsert(args: unknown): Promise<PrismaPriceAlertRow>;
      update(args: unknown): Promise<PrismaPriceAlertRow>;
    };
    product: {
      findUnique(args: unknown): Promise<{ id: string } | null>;
    };
  },
): PriceAlertApiStore {
  return {
    async findAlert(userId, productId) {
      const row = await prisma.priceAlert.findUnique({
        where: {
          userId_productId: { userId, productId },
        },
      });
      return row ? normalizeRow(row) : null;
    },

    async upsertAlert(userId, input) {
      const row = await prisma.priceAlert.upsert({
        where: {
          userId_productId: { userId, productId: input.productId },
        },
        create: {
          userId,
          productId: input.productId,
          alertType: input.alertType,
          targetPrice: input.targetPrice,
          percentageDrop: input.percentageDrop,
          referencePrice: input.referencePrice,
          active: input.active,
        },
        update: {
          alertType: input.alertType,
          targetPrice: input.targetPrice,
          percentageDrop: input.percentageDrop,
          referencePrice: input.referencePrice,
          active: input.active,
        },
      });
      return normalizeRow(row);
    },

    async deactivateAlert(userId, productId) {
      const existing = await prisma.priceAlert.findUnique({
        where: {
          userId_productId: { userId, productId },
        },
      });

      if (!existing) {
        return null;
      }

      const row = await prisma.priceAlert.update({
        where: { id: existing.id },
        data: { active: false },
      });

      return normalizeRow(row);
    },

    async productExists(productId) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      return Boolean(product);
    },
  };
}

function normalizeRow(row: PrismaPriceAlertRow): PriceAlertApiRecord {
  return {
    id: row.id,
    userId: row.userId,
    productId: row.productId,
    alertType: row.alertType === "TARGET" ? "TARGET" : "ANY_DROP",
    targetPrice: row.targetPrice,
    percentageDrop: row.percentageDrop,
    referencePrice: row.referencePrice,
    lowestSeenPrice: row.lowestSeenPrice,
    active: row.active,
  };
}

/**
 * Repositorio em memoria para testes. Reproduz a semantica de upsert
 * (uma alerta por usuario+produto) e a desativacao por `active=false`.
 */
export function createMemoryPriceAlertApiStore(): PriceAlertApiStore & {
  dump(): PriceAlertApiRecord[];
} {
  const rows: PriceAlertApiRecord[] = [];
  let sequencer = 0;

  return {
    dump() {
      return rows.map((row) => ({ ...row }));
    },

    async productExists(productId) {
      return rows.some((row) => row.productId === productId) || true;
    },

    async findAlert(userId, productId) {
      const row = rows.find(
        (r) => r.userId === userId && r.productId === productId,
      );
      return row ? { ...row } : null;
    },

    async upsertAlert(userId, input) {
      const existingIndex = rows.findIndex(
        (r) => r.userId === userId && r.productId === input.productId,
      );

      if (existingIndex >= 0) {
        const updated: PriceAlertApiRecord = {
          ...rows[existingIndex],
          alertType: input.alertType,
          targetPrice: input.targetPrice,
          percentageDrop: input.percentageDrop,
          referencePrice: input.referencePrice,
          active: input.active,
        };
        rows[existingIndex] = updated;
        return { ...updated };
      }

      const created: PriceAlertApiRecord = {
        id: `alert_${++sequencer}`,
        userId,
        productId: input.productId,
        alertType: input.alertType,
        targetPrice: input.targetPrice,
        percentageDrop: input.percentageDrop,
        referencePrice: input.referencePrice,
        lowestSeenPrice: null,
        active: input.active,
      };
      rows.push(created);
      return { ...created };
    },

    async deactivateAlert(userId, productId) {
      const index = rows.findIndex(
        (r) => r.userId === userId && r.productId === productId,
      );

      if (index < 0) {
        return null;
      }

      const updated = { ...rows[index], active: false };
      rows[index] = updated;
      return { ...updated };
    },
  };
}
