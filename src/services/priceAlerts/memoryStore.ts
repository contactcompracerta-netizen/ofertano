import { randomUUID } from "node:crypto";

import { criarErroDuplicado } from "./errors";
import type {
  ExactOfferSnapshot,
  PriceAlertEvaluationCommit,
  PriceAlertEventInput,
  PriceAlertProductSummary,
  PriceAlertRecord,
  PriceAlertStore,
  PriceAlertType,
} from "./types";

type MemoryState = {
  products: Map<string, PriceAlertProductSummary>;
  alerts: PriceAlertRecord[];
  events: Array<{
    id: string;
    alertId: string;
    type: PriceAlertType;
    price: number;
    previousReferencePrice: number | null;
    targetPrice: number | null;
    createdAt: Date;
  }>;
  offers: ExactOfferSnapshot[];
};

function copiarAlerta(alerta: PriceAlertRecord): PriceAlertRecord {
  return { ...alerta };
}

export function criarMemoryPriceAlertStore(options: {
  products?: PriceAlertProductSummary[];
  offers?: ExactOfferSnapshot[];
} = {}): PriceAlertStore & { state: MemoryState } {
  const state: MemoryState = {
    products: new Map(
      (options.products ?? []).map((product) => [product.id, product])
    ),
    alerts: [],
    events: [],
    offers: [...(options.offers ?? [])],
  };

  const store: PriceAlertStore & { state: MemoryState } = {
    state,

    async productExists(productId) {
      return state.products.has(productId);
    },

    async findProduct(productId) {
      return state.products.get(productId) ?? null;
    },

    async findAlertById(id) {
      const alerta = state.alerts.find((item) => item.id === id);
      return alerta ? copiarAlerta(alerta) : null;
    },

    async findAlertByUserProductType(userId, productId, type) {
      const alerta = state.alerts.find(
        (item) =>
          item.userId === userId &&
          item.productId === productId &&
          item.type === type
      );
      return alerta ? copiarAlerta(alerta) : null;
    },

    async listAlertsByUser(userId) {
      return state.alerts
        .filter((item) => item.userId === userId)
        .slice()
        .sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        )
        .map(copiarAlerta);
    },

    async listActiveAlerts() {
      return state.alerts
        .filter((item) => item.active)
        .map(copiarAlerta);
    },

    async countEventsByAlert(alertId) {
      return state.events.filter((item) => item.alertId === alertId)
        .length;
    },

    async createAlert(input) {
      const existente = await store.findAlertByUserProductType(
        input.userId,
        input.productId,
        input.type
      );

      if (existente) {
        throw criarErroDuplicado();
      }

      const agora = new Date();
      const record: PriceAlertRecord = {
        id: randomUUID(),
        userId: input.userId,
        productId: input.productId,
        type: input.type,
        targetPrice: input.targetPrice,
        referencePrice: input.referencePrice,
        active: true,
        armed: true,
        lastEvaluatedAt: null,
        lastEvaluatedPrice: null,
        lastEvaluatedHadExact: null,
        lastTriggeredAt: null,
        lastTriggeredPrice: null,
        createdAt: agora,
        updatedAt: agora,
      };

      state.alerts.push(record);
      return copiarAlerta(record);
    },

    async updateAlert(id, data) {
      const alerta = state.alerts.find((item) => item.id === id);

      if (!alerta) {
        throw new Error("ALERT_NOT_FOUND");
      }

      Object.assign(alerta, data, { updatedAt: new Date() });
      return copiarAlerta(alerta);
    },

    async deleteAlertByUserAndId(userId, id) {
      const index = state.alerts.findIndex(
        (item) => item.id === id && item.userId === userId
      );

      if (index < 0) {
        return false;
      }

      const [removido] = state.alerts.splice(index, 1);

      if (removido) {
        state.events = state.events.filter(
          (item) => item.alertId !== removido.id
        );
      }

      return true;
    },

    async listOffersByProductIds(productIds) {
      const ids = new Set(productIds);
      return state.offers.filter((item) => ids.has(item.productId));
    },

    async commitEvaluation(
      alertId,
      data: PriceAlertEvaluationCommit,
      event?: PriceAlertEventInput
    ) {
      const alerta = state.alerts.find((item) => item.id === alertId);

      if (!alerta) {
        throw new Error("ALERT_NOT_FOUND");
      }

      Object.assign(alerta, data, { updatedAt: new Date() });

      if (event) {
        state.events.push({
          id: randomUUID(),
          alertId,
          ...event,
          createdAt: data.lastTriggeredAt ?? new Date(),
        });
      }

      return copiarAlerta(alerta);
    },
  };

  return store;
}
