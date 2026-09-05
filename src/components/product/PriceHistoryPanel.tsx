"use client";

import { useState } from "react";

export type PontoPrecoSerializado = {
  price: number;
  recordedAt: number;
};

export type AnalisePrecoSerializada = {
  titulo: string;
  descricao: string;
  badgeClassName: string;
  cardClassName: string;
};

export type PeriodoPrecoSerializado = {
  dias: 30 | 90;
  pontos: PontoPrecoSerializado[];
  menorPreco: number | null;
  maiorPreco: number | null;
  mediaPreco: number | null;
  diasMonitorados: number;
  analise: AnalisePrecoSerializada;
};

type PriceHistoryPanelProps = {
  precoAtualMercado: number;
  periodo30: PeriodoPrecoSerializado;
  periodo90: PeriodoPrecoSerializado;
};

function formatarPreco(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarDataHistorico(data: Date) {
  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function GraficoHistorico({
  pontos,
}: {
  pontos: PontoPrecoSerializado[];
}) {
  if (pontos.length === 0) {
    return null;
  }

  const largura = 720;
  const altura = 110;
  const margemX = 20;
  const margemSuperior = 9;
  const margemInferior = 13;
  const larguraGrafico = largura - margemX * 2;
  const alturaGrafico = altura - margemSuperior - margemInferior;

  const valores = pontos.map((ponto) => ponto.price);
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  const amplitudeOriginal = maximo - minimo;
  const amplitude = Math.max(
    amplitudeOriginal,
    Math.max(maximo * 0.08, 1),
  );

  const piso = Math.max(0, minimo - amplitude * 0.18);
  const teto = maximo + amplitude * 0.18;
  const faixa = Math.max(teto - piso, 1);

  const primeiroTempo = pontos[0].recordedAt;
  const ultimoTempo =
    pontos.at(-1)?.recordedAt ?? primeiroTempo;
  const faixaTempo = Math.max(ultimoTempo - primeiroTempo, 1);

  const coordenadas = pontos.map((ponto, indice) => {
    const x =
      pontos.length === 1
        ? largura / 2
        : margemX +
          ((ponto.recordedAt - primeiroTempo) / faixaTempo) *
            larguraGrafico;

    const y =
      margemSuperior +
      ((teto - ponto.price) / faixa) * alturaGrafico;

    return {
      ...ponto,
      x,
      y,
      indice,
    };
  });

  const linha = coordenadas
    .map((ponto) => `${ponto.x.toFixed(2)},${ponto.y.toFixed(2)}`)
    .join(" ");

  const linhasGrade = [0, 0.5, 1].map((proporcao) => ({
    y: margemSuperior + alturaGrafico * proporcao,
  }));

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div>
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          role="img"
          aria-label="Gráfico do histórico do melhor preço do produto"
          className="h-auto w-full"
        >
          {linhasGrade.map((linhaGrade, indice) => (
            <line
              key={indice}
              x1={margemX}
              x2={largura - margemX}
              y1={linhaGrade.y}
              y2={linhaGrade.y}
              stroke="currentColor"
              strokeWidth="1"
              className="text-slate-200"
            />
          ))}

          {coordenadas.length > 1 && (
            <polyline
              points={linha}
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-600"
            />
          )}

          {coordenadas.map((ponto) => (
            <circle
              key={`${ponto.recordedAt}-${ponto.indice}`}
              cx={ponto.x}
              cy={ponto.y}
              r={coordenadas.length <= 20 ? 4.2 : 3.2}
              fill="currentColor"
              className="text-emerald-600"
            />
          ))}
        </svg>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-2.5 py-1.5 text-[9px] font-bold text-slate-500 sm:text-[10px]">
        <span>{formatarDataHistorico(new Date(pontos[0].recordedAt))}</span>
        <span>
          {formatarDataHistorico(
            new Date(
              pontos.at(-1)?.recordedAt ?? pontos[0].recordedAt,
            ),
          )}
        </span>
      </div>
    </div>
  );
}

export default function PriceHistoryPanel({
  precoAtualMercado,
  periodo30,
  periodo90,
}: PriceHistoryPanelProps) {
  const [diasSelecionados, setDiasSelecionados] = useState<30 | 90>(30);

  const periodoAtual =
    diasSelecionados === 30 ? periodo30 : periodo90;

  const temPontos = periodoAtual.pontos.length > 0;
  const podeDesenharGrafico = periodoAtual.pontos.length >= 2;

  const menorPrecoExibido =
    periodoAtual.menorPreco ?? precoAtualMercado;
  const maiorPrecoExibido =
    periodoAtual.maiorPreco ?? precoAtualMercado;
  const mediaExibida = periodoAtual.mediaPreco ?? precoAtualMercado;

  return (
    <section className="mt-2.5 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:mt-3 sm:p-3">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700 sm:text-[11px]">
            Inteligência de preço
          </p>
          <h2 className="mt-0.5 text-lg font-black tracking-tight text-slate-950 sm:text-xl">
            Histórico de preços
          </h2>
        </div>

        <p className="max-w-xl text-[11px] leading-4 text-slate-600 sm:text-xs">
          Acompanhamos o melhor preço registrado no Ofertano sem inventar valores anteriores.
        </p>
      </div>

      <div className="mt-2 flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
        {([30, 90] as const).map((dias) => (
          <button
            key={dias}
            type="button"
            onClick={() => setDiasSelecionados(dias)}
            aria-pressed={diasSelecionados === dias}
            className={`flex-1 rounded-md px-3 py-1.5 text-[11px] font-black tracking-wide transition sm:text-xs ${
              diasSelecionados === dias
                ? "bg-white text-emerald-700 shadow-sm ring-1 ring-inset ring-slate-200"
                : "text-slate-500 hover:bg-white/60 hover:text-slate-700"
            }`}
          >
            {dias} dias
          </button>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
          <p className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
            Preço atual
          </p>
          <p className="mt-0.5 text-base font-black text-emerald-700 sm:text-lg">
            {formatarPreco(precoAtualMercado)}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
          <p className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
            Menor em {periodoAtual.dias} dias
          </p>
          <p className="mt-0.5 text-base font-black text-slate-950 sm:text-lg">
            {formatarPreco(menorPrecoExibido)}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
          <p className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
            Maior em {periodoAtual.dias} dias
          </p>
          <p className="mt-0.5 text-base font-black text-slate-950 sm:text-lg">
            {formatarPreco(maiorPrecoExibido)}
          </p>
        </div>
      </div>

      <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {podeDesenharGrafico ? (
            <GraficoHistorico pontos={periodoAtual.pontos} />
          ) : temPontos ? (
            <div className="flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center">
              <p className="text-[10px] leading-4 text-slate-500 sm:text-[11px]">
                O gráfico fica disponível assim que houver pelo menos dois registros reais de preço nesse período.
              </p>
            </div>
          ) : (
            <div className="flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center">
              <p className="text-[10px] leading-4 text-slate-500 sm:text-[11px]">
                Ainda estamos acumulando o histórico real deste produto. Quando houver variações registradas, a evolução aparece aqui.
              </p>
            </div>
          )}
        </div>

        <div
          className={`rounded-lg border p-2.5 ${periodoAtual.analise.cardClassName}`}
        >
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Comprar agora ou esperar?
          </p>

          <span
            className={`mt-1.5 block rounded-lg px-3 py-2 text-[12px] font-black leading-5 sm:text-sm ${periodoAtual.analise.badgeClassName}`}
          >
            {periodoAtual.analise.titulo}
          </span>

          <p className="mt-1.5 text-[10px] leading-4 text-slate-700 sm:text-[11px]">
            {periodoAtual.analise.descricao}
          </p>

          <div className="mt-2 border-t border-slate-200/80 pt-2">
            <p className="text-[11px] font-bold text-slate-600">
              {periodoAtual.diasMonitorados > 0
                ? `${periodoAtual.diasMonitorados} ${periodoAtual.diasMonitorados === 1 ? "dia" : "dias"} de acompanhamento`
                : "Acompanhamento iniciado recentemente"}
            </p>
            <p className="mt-0.5 text-[9px] leading-[14px] text-slate-500 sm:text-[10px] sm:leading-4">
              Média do período: {formatarPreco(mediaExibida)}. A análise usa somente preços realmente registrados pelo Ofertano e pode mudar conforme novas verificações são realizadas.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}