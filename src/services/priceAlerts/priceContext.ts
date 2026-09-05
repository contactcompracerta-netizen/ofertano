/**
 * Construcao do contexto de precos para o motor de alertas usando o
 * historico real registrado pelo Ofertano.
 *
 * O preco anterior vem do valor da oferta antes da atualizacao do
 * monitor (passado pelo chamador); as minimas de 30/90 dias vêm da serie
 * Multi Loja com baseline, preservando cada origem (nunca inventamos
 * preco).
 */

import prisma from "@/lib/prisma";
import {
  UM_DIA_EM_MS,
  construirSerieMelhorPrecoMultiLojaComBaseline,
  resumirHistorico,
} from "@/services/priceHistory/priceHistoryService";

import type { ContextoAlertas } from "./processProductAlerts";

export async function montarContextoAlertas({
  productId,
  currentPrice,
  previousPrice,
  productName,
  marketplace,
  store,
}: {
  productId: string;
  currentPrice: number;
  previousPrice: number;
  productName?: string | null;
  marketplace?: string | null;
  store?: string | null;
}): Promise<ContextoAlertas> {
  const agora = new Date();
  const inicio90 = new Date(agora.getTime() - 90 * UM_DIA_EM_MS);

  const eventos = await prisma.priceHistory.findMany({
    where: {
      productId,
    },
    orderBy: {
      recordedAt: "asc",
    },
    take: 400,
  });

  const serie = construirSerieMelhorPrecoMultiLojaComBaseline(
    eventos.map((registro) => ({
      offerId: registro.offerId,
      marketplace: registro.marketplace,
      price: registro.price,
      recordedAt: registro.recordedAt,
    })),
    inicio90,
  );

  const resumo30 = resumirHistorico(serie, 30, agora);
  const resumo90 = resumirHistorico(serie, 90, agora);

  return {
    productId,
    currentPrice,
    previousPrice,
    lowest30Days: resumo30.menorPreco,
    lowest90Days: resumo90.menorPreco,
    productName,
    marketplace,
    store,
  };
}