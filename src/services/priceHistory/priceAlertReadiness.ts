/**
 * Preparacao para a proxima fase de alertas automaticos.
 *
 * Expõe uma avaliacao reutilizavel de queda de preco baseada somente
 * em precos reais registrados pelo Ofertano. Nenhuma notificacao
 * (e-mail/WhatsApp) e enviada aqui: apenas o calculo pronto para um
 * motor de alertas usar.
 */

import {
  TOLERANCIA_PRECO,
  precoValidoParaHistorico,
} from "./priceHistoryService";

export type AvaliacaoQuedaPreco = {
  priceDropped: boolean;
  previousPrice: number | null;
  currentPrice: number;
  dropAmount: number;
  dropPercentage: number;
  isNew30DayLow: boolean;
  isNew90DayLow: boolean;
};

export function avaliarQuedaPreco({
  currentPrice,
  previousPrice,
  lowest30Days,
  lowest90Days,
}: {
  currentPrice: number;
  previousPrice: number | null;
  lowest30Days: number | null;
  lowest90Days: number | null;
}): AvaliacaoQuedaPreco {
  const precoAtualValido = precoValidoParaHistorico(currentPrice);
  const precoAnteriorValido =
    previousPrice === null ||
    (previousPrice !== null &&
      precoValidoParaHistorico(previousPrice));

  const priceDropped =
    precoAtualValido &&
    precoAnteriorValido &&
    previousPrice !== null &&
    previousPrice - currentPrice > TOLERANCIA_PRECO;

  const dropAmount =
    priceDropped && previousPrice !== null
      ? previousPrice - currentPrice
      : 0;

  const dropPercentage =
    priceDropped && previousPrice !== null && previousPrice > 0
      ? (dropAmount / previousPrice) * 100
      : 0;

  const isNew30DayLow =
    precoAtualValido &&
    lowest30Days !== null &&
    currentPrice <= lowest30Days + TOLERANCIA_PRECO;

  const isNew90DayLow =
    precoAtualValido &&
    lowest90Days !== null &&
    currentPrice <= lowest90Days + TOLERANCIA_PRECO;

  return {
    priceDropped,
    previousPrice,
    currentPrice,
    dropAmount,
    dropPercentage,
    isNew30DayLow,
    isNew90DayLow,
  };
}