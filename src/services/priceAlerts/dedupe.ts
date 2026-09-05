/**
 * Dedupe e cooldown por canal de notificacao.
 *
 * Regra central: o mesmo alerta nao pode ser enviado varias vezes para o
 * mesmo preco. Um canal so reenvia quando o preco atual e um NOVO minimo
 * abaixo do ultimo preco notificado NAQUELE canal (independente de outros
 * canais). Opcionalmente aplica um cooldown minimo entre envios do mesmo
 * canal para nao martelar o usuario.
 */

import { TOLERANCIA_PRECO, precoValidoParaHistorico } from "@/services/priceHistory/priceHistoryService";

export type DedupeEstadoCanal = {
  lastNotifiedPrice: number | null;
  lastNotifiedAt: Date | null;
};

export type DedupeDecisao =
  | { allowed: true }
  | { allowed: false; motivo: "DUPLICATE" | "COOLDOWN" };

export const COOLDOWN_PADRAO_MS = 6 * 60 * 60 * 1000;

/**
 * Decide se o canal pode ser notificado para `currentPrice`.
 *
 * - DUPLICATE: ultimo preco notificado no canal ja e <= currentPrice
 *   (dentro da tolerancia), ou seja, este preco (ou um melhor) ja foi
 *   avisado naquele canal.
 * - COOLDOWN: ultima notificacao no canal foi ha menos que o cooldown e
 *   o preco nao caiu em relacao ao ultimo notificado.
 */
export function avaliarDedupeCanal({
  currentPrice,
  lastNotifiedPrice,
  lastNotifiedAt,
  now,
  cooldownMs = COOLDOWN_PADRAO_MS,
}: {
  currentPrice: number;
  lastNotifiedPrice: number | null;
  lastNotifiedAt: Date | null;
  now: Date;
  cooldownMs?: number;
}): DedupeDecisao {
  if (!precoValidoParaHistorico(currentPrice)) {
    return { allowed: false, motivo: "DUPLICATE" };
  }

  if (lastNotifiedPrice !== null) {
    if (currentPrice >= lastNotifiedPrice - TOLERANCIA_PRECO) {
      return { allowed: false, motivo: "DUPLICATE" };
    }
  }

  if (lastNotifiedAt !== null && cooldownMs > 0) {
    const desde = now.getTime() - lastNotifiedAt.getTime();

    if (desde >= 0 && desde < cooldownMs && lastNotifiedPrice !== null) {
      return { allowed: false, motivo: "COOLDOWN" };
    }
  }

  return { allowed: true };
}
