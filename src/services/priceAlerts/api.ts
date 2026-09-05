/**
 * Operacoes da API de alertas de preco do Ofertano.
 *
 * A seguranca central vive aqui: o userId sempre vem da autenticacao
 * do Supabase (nunca do corpo/referencia passado pelo cliente). Toda a
 * logica CRUD usa o repositorio canonico PriceAlert, entao o alerta
 * salvo/alterado/lido no frontend e o MESMO registro que o monitor
 * automático le via processProductAlerts.
 */

import type { PriceAlertApiStore } from "./apiStore";

export type PriceAlertApiOutcome =
  | { ok: true; status: 200; alert: unknown }
  | { ok: true; status: 200; alert: null }
  | { ok: false; status: number; error: string };

export function normalizeAlertResponse(alert: {
  id: string;
  alertType: string;
  targetPrice: number | null;
  percentageDrop: number | null;
  referencePrice: number;
  lowestSeenPrice: number | null;
  active: boolean;
}) {
  return {
    id: alert.id,
    alertType: alert.alertType === "TARGET" ? "TARGET" : "ANY_DROP",
    targetPrice: alert.targetPrice,
    percentageDrop: alert.percentageDrop,
    referencePrice: alert.referencePrice,
    lowestSeenPrice: alert.lowestSeenPrice,
    active: alert.active,
  };
}

export async function getAlertForUser(
  userId: string,
  productId: unknown,
  store: PriceAlertApiStore,
): Promise<PriceAlertApiOutcome> {
  if (typeof productId !== "string" || !productId) {
    return { ok: false, status: 400, error: "productId é obrigatório." };
  }

  try {
    const alert = await store.findAlert(userId, productId);
    if (!alert) {
      return { ok: true, status: 200, alert: null };
    }
    return { ok: true, status: 200, alert: normalizeAlertResponse(alert) };
  } catch (error) {
    console.error("Erro ao carregar alerta de preço:", error);
    return {
      ok: false,
      status: 500,
      error: "Não foi possível consultar seu alerta.",
    };
  }
}

export async function upsertAlertForUser(
  userId: string,
  input: Record<string, unknown>,
  store: PriceAlertApiStore,
): Promise<PriceAlertApiOutcome> {
  if (typeof input.productId !== "string" || !input.productId) {
    return { ok: false, status: 400, error: "productId é obrigatório." };
  }

  const alertType = input.alertType === "TARGET" ? "TARGET" : "ANY_DROP";

  let targetPrice: number | null = null;
  if (input.targetPrice !== undefined && input.targetPrice !== null) {
    if (!validPositiveNumber(input.targetPrice)) {
      return { ok: false, status: 400, error: "targetPrice inválido." };
    }
    targetPrice = input.targetPrice;
  }

  let percentageDrop: number | null = null;
  if (input.percentageDrop !== undefined && input.percentageDrop !== null) {
    if (
      typeof input.percentageDrop !== "number" ||
      !Number.isFinite(input.percentageDrop) ||
      input.percentageDrop < 0 ||
      input.percentageDrop > 100
    ) {
      return { ok: false, status: 400, error: "percentageDrop inválido." };
    }
    percentageDrop = input.percentageDrop;
  }

  let referencePrice: number | null = null;
  if (input.referencePrice !== undefined && input.referencePrice !== null) {
    if (!validPositiveNumber(input.referencePrice)) {
      return { ok: false, status: 400, error: "referencePrice inválido." };
    }
    referencePrice = input.referencePrice;
  }

  const active = input.active === undefined ? true : Boolean(input.active);

  try {
    const existing = await store.findAlert(userId, input.productId);
    const finalReferencePrice =
      referencePrice ?? existing?.referencePrice ?? 0;

    if (!validPositiveNumber(finalReferencePrice)) {
      return {
        ok: false,
        status: 400,
        error:
          "referencePrice é obrigatório quando não existe um alerta anterior.",
      };
    }

    const exists = await store.productExists(input.productId);
    if (!exists) {
      return { ok: false, status: 404, error: "Produto não encontrado." };
    }

    const alert = await store.upsertAlert(userId, {
      productId: input.productId,
      alertType,
      targetPrice,
      percentageDrop,
      referencePrice: finalReferencePrice,
      active,
    });

    return { ok: true, status: 200, alert: normalizeAlertResponse(alert) };
  } catch (error) {
    console.error("Erro ao salvar alerta de preço:", error);
    return {
      ok: false,
      status: 500,
      error: "Não foi possível salvar o alerta.",
    };
  }
}

export async function deactivateAlertForUser(
  userId: string,
  productId: unknown,
  store: PriceAlertApiStore,
): Promise<PriceAlertApiOutcome> {
  if (typeof productId !== "string" || !productId) {
    return { ok: false, status: 400, error: "productId é obrigatório." };
  }

  try {
    const alert = await store.deactivateAlert(userId, productId);
    if (!alert) {
      return { ok: true, status: 200, alert: null };
    }
    return { ok: true, status: 200, alert: normalizeAlertResponse(alert) };
  } catch (error) {
    console.error("Erro ao desativar alerta de preço:", error);
    return {
      ok: false,
      status: 500,
      error: "Não foi possível desativar o alerta.",
    };
  }
}

function validPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
