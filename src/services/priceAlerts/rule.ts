/**
 * Regra de disparo de um alerta de preco individual.
 *
 * Usa os precos reais registrados (`avaliarQuedaPreco`) e a condicao
 * configurada pelo usuario (targetPrice / percentageDrop / ANY_DROP).
 * Preco invalido (<= 0, NaN, Infinity, ausente) nunca dispara.
 */

import { TOLERANCIA_PRECO, precoValidoParaHistorico } from "@/services/priceHistory/priceHistoryService";
import { avaliarQuedaPreco } from "@/services/priceHistory/priceAlertReadiness";

export type AlertRuleInput = {
  alertType: "ANY_DROP" | "TARGET";
  targetPrice: number | null;
  percentageDrop: number | null;
  previousPrice: number | null;
  currentPrice: number;
  lowest30Days: number | null;
  lowest90Days: number | null;
};

export type RegraAvaliacao =
  | {
      satisfied: true;
      motivo: "ANY_DROP" | "TARGET_PRICE" | "PERCENTAGE";
    }
  | {
      satisfied: false;
      motivo:
        | "NO_PRICE"
        | "INVALID_PRICE"
        | "NO_DROP"
        | "THRESHOLD_NOT_MET"
        | "RISE";
    };

export function avaliarRegraAlerta(
  input: AlertRuleInput,
): RegraAvaliacao {
  const currentPrice = input.currentPrice;

  if (!precoValidoParaHistorico(currentPrice)) {
    return { satisfied: false, motivo: "INVALID_PRICE" };
  }

  const avaliacao = avaliarQuedaPreco({
    currentPrice,
    previousPrice: input.previousPrice,
    lowest30Days: input.lowest30Days,
    lowest90Days: input.lowest90Days,
  });

  // Sem preco anterior real, nao existe queda a notificar.
  if (input.previousPrice === null) {
    return { satisfied: false, motivo: "NO_PRICE" };
  }

  if (input.alertType === "TARGET") {
    const alvo =
      input.targetPrice !== null &&
      input.targetPrice !== undefined &&
      precoValidoParaHistorico(input.targetPrice);

    const atingiuAlvo =
      alvo && currentPrice <= input.targetPrice! + TOLERANCIA_PRECO;

    // O alerta so dispara com queda real E condicao satisfeita. Uma
    // subida que continua abaixo do alvo nao e uma queda a notificar.
    const caiuDeVerdade =
      input.previousPrice - currentPrice > TOLERANCIA_PRECO;

    if (atingiuAlvo && caiuDeVerdade) {
      return { satisfied: true, motivo: "TARGET_PRICE" };
    }

    return {
      satisfied: false,
      motivo: atingiuAlvo ? "NO_DROP" : "THRESHOLD_NOT_MET",
    };
  }

  // ANY_DROP: precisa haver queda real.
  if (!avaliacao.priceDropped) {
    return {
      satisfied: false,
      motivo: avaliacao.previousPrice === null ? "NO_PRICE" : "NO_DROP",
    };
  }

  if (
    input.percentageDrop !== null &&
    input.percentageDrop !== undefined
  ) {
    const exigencia = input.percentageDrop;

    if (!Number.isFinite(exigencia) || exigencia <= 0) {
      return { satisfied: true, motivo: "ANY_DROP" };
    }

    if (avaliacao.dropPercentage < exigencia - 1e-9) {
      return { satisfied: false, motivo: "THRESHOLD_NOT_MET" };
    }
  }

  return { satisfied: true, motivo: "ANY_DROP" };
}
