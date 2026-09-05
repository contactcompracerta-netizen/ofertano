/**
 * Repositorio de alertas de preco.
 *
 * Interface injetavel para o motor de alertas, seguindo o padrao de
 * repositorio do projeto (favorites). A implementacao Prisma le e grava
 * a tabela `PriceAlert`; testes usam repositorio em memoria.
 */

export type PriceAlertRecord = {
  id: string;
  userId: string;
  productId: string;
  alertType: "ANY_DROP" | "TARGET";
  targetPrice: number | null;
  referencePrice: number;
  lowestSeenPrice: number | null;
  percentageDrop: number | null;
  active: boolean;
  notifyEmail: boolean;
  notifyWhatsApp: boolean;
  lastEmailNotifiedPrice: number | null;
  lastEmailNotifiedAt: Date | null;
  lastWhatsAppNotifiedPrice: number | null;
  lastWhatsAppNotifiedAt: Date | null;
};

export type PriceAlertRepository = {
  listByProductId(productId: string): Promise<PriceAlertRecord[]>;
  updateNotified(
    alertId: string,
    canal: "EMAIL" | "WHATSAPP",
    price: number,
    notifiedAt: Date,
  ): Promise<void>;
};

/**
 * Guarda otimista (compare-and-set) usada ao gravar o estado de dedupe.
 *
 * Um alerta so pode reivindicar "notificado em X" se o estado atual do
 * canal ainda nao tiver um preco igual ou melhor que X. Dois workers que
 * leem o mesmo estado "nunca notificado" ao mesmo tempo: apenas o
 * primeiro update com o preco mais baixo prevalece; o segundo nao casa
 * com a guarda e nao sobrescreve o estado.
 */
export function podeReivindicarNotificacao({
  estadoAtual,
  novoPreco,
}: {
  estadoAtual: number | null;
  novoPreco: number;
}): boolean {
  if (!Number.isFinite(novoPreco) || novoPreco <= 0) {
    return false;
  }

  if (estadoAtual === null) {
    return true;
  }

  return novoPreco < estadoAtual;
}

/**
 * Repositorio Prisma: le alertas de um produto e atualiza o estado de
 * dedupe por canal com guarda otimista atomica por alerta.
 */
export function createPrismaPriceAlertRepository(
  prisma: {
    priceAlert: {
      findMany(args: unknown): Promise<PriceAlertRecord[]>;
      updateMany(args: unknown): Promise<unknown>;
    };
  },
): PriceAlertRepository {
  return {
    async listByProductId(productId) {
      const rows = await prisma.priceAlert.findMany({
        where: {
          productId,
          active: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      return (rows as PriceAlertRecord[]) ?? [];
    },

    async updateNotified(alertId, canal, price, notifiedAt) {
      const campoPreco =
        canal === "EMAIL"
          ? "lastEmailNotifiedPrice"
          : "lastWhatsAppNotifiedPrice";
      const campoTempo =
        canal === "EMAIL"
          ? "lastEmailNotifiedAt"
          : "lastWhatsAppNotifiedAt";

      // Guarda: so atualiza se o estado ainda nao tem preco igual/melhor.
      await prisma.priceAlert.updateMany({
        where: {
          id: alertId,
          OR: [
            { [campoPreco]: null },
            { [campoPreco]: { gt: price } },
          ],
        },
        data: {
          [campoPreco]: price,
          [campoTempo]: notifiedAt,
        },
      });
    },
  };
}

/**
 * Repositorio em memoria para testes e ferramentas locais. Reproduz a
 * mesma guarda otimista da implementacao Prisma.
 */
export function createMemoryPriceAlertRepository(
  alertasIniciais: PriceAlertRecord[] = [],
): PriceAlertRepository & {
  dump(): PriceAlertRecord[];
} {
  let linhas: PriceAlertRecord[] = alertasIniciais.map((alerta) => ({
    ...alerta,
  }));

  return {
    async listByProductId(productId) {
      return linhas
        .filter((alerta) => alerta.productId === productId)
        .map((alerta) => ({ ...alerta }));
    },

    async updateNotified(alertId, canal, price, notifiedAt) {
      linhas = linhas.map((alerta) => {
        if (alerta.id !== alertId) {
          return alerta;
        }

        const campoPreco =
          canal === "EMAIL"
            ? "lastEmailNotifiedPrice"
            : "lastWhatsAppNotifiedPrice";
        const campoTempo =
          canal === "EMAIL"
            ? "lastEmailNotifiedAt"
            : "lastWhatsAppNotifiedAt";

        const estadoAtual = alerta[campoPreco];

        if (
          !podeReivindicarNotificacao({
            estadoAtual,
            novoPreco: price,
          })
        ) {
          return alerta;
        }

        return {
          ...alerta,
          [campoPreco]: price,
          [campoTempo]: notifiedAt,
        };
      });
    },

    dump() {
      return linhas.map((alerta) => ({ ...alerta }));
    },
  };
}