/**
 * Servico centralizado de historico de precos do Ofertano.
 *
 * Responsabilidades:
 * - validar precos antes de qualquer uso/gravacao;
 * - decidir quando uma nova entrada de historico precisa ser gravada
 *   (nunca uma linha por verificacao quando o preco nao mudou);
 * - construir a serie do melhor preco valido preservando a origem
 *   (Multi Loja nao e misturada: cada oferta mantem sua propria serie);
 * - resumir o historico para janelas de 30/90 dias com menor/maior preco
 *   e media ponderada pelo tempo, sem numeros inventados.
 */

export const UM_DIA_EM_MS = 24 * 60 * 60 * 1000;

export const TOLERANCIA_PRECO = 0.009;

export type DiasPeriodo = 30 | 90;

export type HistoricoPrecoEntrada = {
  offerId: string | null;
  marketplace: string | null;
  price: number;
  recordedAt: Date;
};

export type PontoPreco = {
  price: number;
  recordedAt: Date;
};

export type ResumoPrecoPeriodo = {
  dias: DiasPeriodo;
  pontos: PontoPreco[];
  menorPreco: number | null;
  maiorPreco: number | null;
  mediaPreco: number | null;
  diasMonitorados: number;
  inicio: Date | null;
  fim: Date | null;
};

export function precoValidoParaHistorico(preco: number): boolean {
  return Number.isFinite(preco) && preco > 0;
}

export function historicoPrecisaNovaEntrada({
  precoAnterior,
  precoNovo,
}: {
  precoAnterior: number | null | undefined;
  precoNovo: number;
}): boolean {
  if (!precoValidoParaHistorico(precoNovo)) {
    return false;
  }

  if (precoAnterior === null || precoAnterior === undefined) {
    return true;
  }

  return Math.abs(precoAnterior - precoNovo) > TOLERANCIA_PRECO;
}

/**
 * Multi Loja: cada oferta/marketplace mantem sua propria serie de preco.
 * A serie publica representa o menor preco valido observado entre todas
 * as ofertas ao longo do tempo, sem jamais apagar nenhuma origem no
 * banco (PriceHistory.offerId + PriceHistory.marketplace preservam a
 * identidade de cada loja).
 */
export function construirSerieMelhorPrecoMultiLoja(
  historico: HistoricoPrecoEntrada[],
): PontoPreco[] {
  const precosPorOferta = new Map<string, number>();
  const pontos: PontoPreco[] = [];

  for (const registro of historico) {
    if (!precoValidoParaHistorico(registro.price)) {
      continue;
    }

    const chaveOferta =
      registro.offerId ??
      `marketplace:${registro.marketplace ?? "DESCONHECIDO"}`;

    precosPorOferta.set(chaveOferta, registro.price);

    const precosConhecidos = Array.from(precosPorOferta.values());

    if (precosConhecidos.length === 0) {
      continue;
    }

    const melhorPreco = Math.min(...precosConhecidos);
    const ultimoPonto = pontos.at(-1);

    if (
      !ultimoPonto ||
      Math.abs(ultimoPonto.price - melhorPreco) > TOLERANCIA_PRECO
    ) {
      pontos.push({
        price: melhorPreco,
        recordedAt: registro.recordedAt,
      });
    }
  }

  return pontos;
}

/**
 * Serie do melhor preco Multi Loja COM baseline vigente no inicio da
 * janela.
 *
 * PrecoHistory so grava quando o preco muda, entao uma oferta que ficou
 * R$ 699 estavel por 90 dias sem alteracao NAO possui nenhum registro
 * dentro da janela — apenas o registro anterior ao inicio da janela.
 * Sem esse baseline, o preco vigente no comeco do periodo seria perdido
 * e LOWEST/HIGHEST 30/90 e a media ponderada ficariam errados.
 *
 * O dataset de entrada deve conter, em ordem cronologica crescente:
 * - o ultimo registro conhecido ANTES do inicio da janela mais ampla
 *   (baseline), ancorado no proprio recordedAt;
 * - todos os registros dentro da janela (30 ou 90 dias).
 *
 * Para uma janela de inicio `inicioJanela`, cada oferta e semeada com o
 * preco que estava vigente exatamente nesse momento (baseline dos que
 * nao mudaram + ultimo evento ate o inicio), e o primeiro ponto e
 * ancorado em `inicioJanela`. Nenhum preco e inventado: tudo vem de
 * registros reais.
 */
export function construirSerieMelhorPrecoMultiLojaComBaseline(
  eventos: HistoricoPrecoEntrada[],
  inicioJanela: Date,
): PontoPreco[] {
  const precosPorOferta = new Map<string, number>();
  const inicioMs = inicioJanela.getTime();

  for (const evento of eventos) {
    if (
      !precoValidoParaHistorico(evento.price) ||
      evento.recordedAt.getTime() > inicioMs
    ) {
      continue;
    }

    const chaveOferta =
      evento.offerId ??
      `marketplace:${evento.marketplace ?? "DESCONHECIDO"}`;

    precosPorOferta.set(chaveOferta, evento.price);
  }

  const pontos: PontoPreco[] = [];
  const precosIniciais = Array.from(precosPorOferta.values());

  if (precosIniciais.length > 0) {
    pontos.push({
      price: Math.min(...precosIniciais),
      recordedAt: inicioJanela,
    });
  }

  for (const evento of eventos) {
    if (
      !precoValidoParaHistorico(evento.price) ||
      evento.recordedAt.getTime() <= inicioMs
    ) {
      continue;
    }

    const chaveOferta =
      evento.offerId ??
      `marketplace:${evento.marketplace ?? "DESCONHECIDO"}`;

    precosPorOferta.set(chaveOferta, evento.price);

    const melhorPreco = Math.min(...precosPorOferta.values());
    const ultimoPonto = pontos.at(-1);

    if (
      !ultimoPonto ||
      Math.abs(ultimoPonto.price - melhorPreco) > TOLERANCIA_PRECO
    ) {
      pontos.push({
        price: melhorPreco,
        recordedAt: evento.recordedAt,
      });
    }
  }

  return pontos;
}

export function filtrarPontosPorPeriodo(
  pontos: PontoPreco[],
  dias: DiasPeriodo,
  agora = new Date(),
): PontoPreco[] {
  const limite = agora.getTime() - dias * UM_DIA_EM_MS;

  return pontos.filter(
    (ponto) => ponto.recordedAt.getTime() >= limite,
  );
}

export function resumirPrecosPeriodo(pontos: PontoPreco[]): {
  menorPreco: number | null;
  maiorPreco: number | null;
} {
  if (pontos.length === 0) {
    return { menorPreco: null, maiorPreco: null };
  }

  let menorPreco: number | null = null;
  let maiorPreco: number | null = null;

  for (const ponto of pontos) {
    if (!precoValidoParaHistorico(ponto.price)) {
      continue;
    }

    if (menorPreco === null || ponto.price < menorPreco) {
      menorPreco = ponto.price;
    }

    if (maiorPreco === null || ponto.price > maiorPreco) {
      maiorPreco = ponto.price;
    }
  }

  return { menorPreco, maiorPreco };
}

/**
 * Media ponderada pelo tempo em que cada preco permaneceu valendo.
 * A entrada precisa estar em ordem cronologica crescente.
 */
export function calcularMediaPonderada(
  pontos: PontoPreco[],
  fimPeriodo: Date,
): number | null {
  if (pontos.length === 0) {
    return null;
  }

  if (pontos.length === 1) {
    return pontos[0].price;
  }

  let totalPonderado = 0;
  let duracaoTotal = 0;

  for (let indice = 0; indice < pontos.length; indice += 1) {
    const pontoAtual = pontos[indice];
    const proximoPonto = pontos[indice + 1];

    const inicio = pontoAtual.recordedAt.getTime();
    const fim = proximoPonto
      ? proximoPonto.recordedAt.getTime()
      : fimPeriodo.getTime();

    const duracao = Math.max(fim - inicio, 1);

    totalPonderado += pontoAtual.price * duracao;
    duracaoTotal += duracao;
  }

  return duracaoTotal > 0
    ? totalPonderado / duracaoTotal
    : (pontos.at(-1)?.price ?? null);
}

/**
 * Resumo de um periodo (30 ou 90 dias): menor/maior preco, media do
 * periodo e dias efetivamente monitorados. Sem dados suficientes,
 * retorna estado vazio (null) em vez de inventar numeros.
 */
export function resumirHistorico(
  pontos: PontoPreco[],
  dias: DiasPeriodo,
  agora = new Date(),
): ResumoPrecoPeriodo {
  const pontosPeriodo = filtrarPontosPorPeriodo(pontos, dias, agora);

  const primeiroPonto = pontosPeriodo[0] ?? null;
  const ultimoPonto =
    pontosPeriodo.length > 0
      ? pontosPeriodo[pontosPeriodo.length - 1]
      : null;

  const fim = ultimoPonto?.recordedAt ?? agora;

  const { menorPreco, maiorPreco } = resumirPrecosPeriodo(pontosPeriodo);
  const mediaPreco = calcularMediaPonderada(pontosPeriodo, fim);

  const diasMonitorados =
    primeiroPonto && ultimoPonto
      ? Math.max(
          0,
          Math.floor(
            (ultimoPonto.recordedAt.getTime() -
              primeiroPonto.recordedAt.getTime()) /
              UM_DIA_EM_MS,
          ),
        )
      : 0;

  return {
    dias,
    pontos: pontosPeriodo,
    menorPreco,
    maiorPreco,
    mediaPreco,
    diasMonitorados,
    inicio: primeiroPonto?.recordedAt ?? null,
    fim: ultimoPonto?.recordedAt ?? null,
  };
}