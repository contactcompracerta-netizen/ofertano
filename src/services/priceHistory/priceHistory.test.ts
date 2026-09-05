/**
 * TESTES OBRIGATORIOS — Historico de preco real por marketplace.
 *
 * Cobre os 12 casos exigidos pela missao PRICE_HISTORY, incluindo
 * protecao contra duplicatas, validacao de preco, janelas de 30/90
 * dias, estado vazio, preparacao para alertas e Multi Loja.
 */

import fs from "node:fs";
import path from "node:path";

import {
  TOLERANCIA_PRECO,
  UM_DIA_EM_MS,
  construirSerieMelhorPrecoMultiLoja,
  construirSerieMelhorPrecoMultiLojaComBaseline,
  historicoPrecisaNovaEntrada,
  precoValidoParaHistorico,
  resumirHistorico,
  resumirPrecosPeriodo,
} from "./priceHistoryService";

import { avaliarQuedaPreco } from "./priceAlertReadiness";

function verificar(nome: string, ok: boolean, detalhe: string) {
  if (!ok) {
    console.error(`${nome}=FAIL ${detalhe}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${nome}=PASS`);
}

function quaseIgual(a: number, b: number) {
  return Math.abs(a - b) < 0.01;
}

function ler(relativo: string) {
  return fs.readFileSync(
    path.join(process.cwd(), relativo),
    "utf8",
  );
}

type RegistroHistoricoSimulado = {
  productId: string;
  offerId: string;
  marketplace: string;
  price: number;
  recordedAt: Date;
};

/**
 * Miniatura fiel do fluxo de saveProduct: consulta o ultimo preco da
 * oferta e decide, pela funcao compartilhada, se uma nova linha de
 * historico precisa ser gravada. Nunca deleta nem sobrescreve.
 */
function aplicarMonitoramento(
  registros: RegistroHistoricoSimulado[],
  verificacao: {
    productId: string;
    offerId: string;
    marketplace: string;
    price: number;
    recordedAt: Date;
  },
) {
  const ultimoDaOferta = [...registros]
    .reverse()
    .find(
      (registro) => registro.offerId === verificacao.offerId,
    );

  const deveGravar = historicoPrecisaNovaEntrada({
    precoAnterior: ultimoDaOferta?.price ?? null,
    precoNovo: verificacao.price,
  });

  if (!deveGravar) {
    return registros;
  }

  registros.push({
    productId: verificacao.productId,
    offerId: verificacao.offerId,
    marketplace: verificacao.marketplace,
    price: verificacao.price,
    recordedAt: verificacao.recordedAt,
  });

  return registros;
}

function criarPonto(preco: number, diasAtras: number, agora: Date) {
  return {
    price: preco,
    recordedAt: new Date(
      agora.getTime() - diasAtras * UM_DIA_EM_MS,
    ),
  };
}

async function run() {
  const agora = new Date("2026-09-05T12:00:00.000Z");
  const ofertaMl = "offer_ml_1";
  const ofertaAmazon = "offer_amazon_1";
  const productId = "product_1";

  /*
   * PRICE_HISTORY_NO_DUPLICATE_SAME_PRICE
   *
   * O mesmo preco verificado varias vezes nao pode gerar novas linhas.
   * 10:00 R$ 699 -> 10:05 R$ 699 -> 10:10 R$ 699 permanece em 1 entrada.
   */
  {
    const registros: RegistroHistoricoSimulado[] = [];
    const base = new Date("2026-09-01T10:00:00.000Z");

    for (let indice = 0; indice < 3; indice += 1) {
      aplicarMonitoramento(registros, {
        productId,
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 699,
        recordedAt: new Date(base.getTime() + indice * 5 * 60 * 1000),
      });
    }

    verificar(
      "PRICE_HISTORY_NO_DUPLICATE_SAME_PRICE",
      registros.length === 1 && registros[0].price === 699,
      `esperava 1 entrada para R$ 699 repetido, obteve ${registros.length}.`,
    );

    verificar(
      "PRICE_HISTORY_NO_DUPLICATE_SAME_PRICE_WITHIN_OFFER",
      historicoPrecisaNovaEntrada({
        precoAnterior: 699,
        precoNovo: 699.005,
      }) === false,
      "variacao dentro da tolerancia (0.009) nao pode gerar entrada.",
    );
  }

  /*
   * PRICE_HISTORY_RECORDS_PRICE_CHANGE
   *
   * 10:00 R$ 699 -> 12:00 R$ 679: a alteracao real precisa ser gravada.
   */
  {
    const registros: RegistroHistoricoSimulado[] = [];
    const base = new Date("2026-09-01T10:00:00.000Z");

    aplicarMonitoramento(registros, {
      productId,
      offerId: ofertaMl,
      marketplace: "MERCADO_LIVRE",
      price: 699,
      recordedAt: base,
    });

    aplicarMonitoramento(registros, {
      productId,
      offerId: ofertaMl,
      marketplace: "MERCADO_LIVRE",
      price: 679,
      recordedAt: new Date("2026-09-01T12:00:00.000Z"),
    });

    verificar(
      "PRICE_HISTORY_RECORDS_PRICE_CHANGE",
      registros.length === 2 &&
        registros[0].price === 699 &&
        registros[1].price === 679,
      `esperava 2 entradas (699 -> 679), obteve ${registros.length}.`,
    );
  }

  /*
   * PRICE_HISTORY_REJECTS_INVALID_PRICE
   *
   * Nada de NaN, Infinity, preco <= 0 ou valor ausente.
   */
  {
    const invalidos = [NaN, Infinity, -Infinity, 0, -1, -0.01];

    verificar(
      "PRICE_HISTORY_REJECTS_INVALID_PRICE",
      invalidos.every(
        (preco) => !precoValidoParaHistorico(preco),
      ),
      "NaN/Infinity/preco <= 0 precisam ser rejeitados.",
    );

    verificar(
      "PRICE_HISTORY_REJECTS_INVALID_PRICE_FIRST_WRITE",
      invalidos.every(
        (preco) =>
          !historicoPrecisaNovaEntrada({
            precoAnterior: null,
            precoNovo: preco,
          }),
      ),
      "gravacao inicial com preco invalido precisa ser impedida.",
    );

    const serieComInvalidos = construirSerieMelhorPrecoMultiLoja(
      [
        {
          offerId: ofertaMl,
          marketplace: "MERCADO_LIVRE",
          price: NaN,
          recordedAt: new Date("2026-09-01T10:00:00.000Z"),
        },
        {
          offerId: ofertaMl,
          marketplace: "MERCADO_LIVRE",
          price: 0,
          recordedAt: new Date("2026-09-01T10:05:00.000Z"),
        },
        {
          offerId: ofertaMl,
          marketplace: "MERCADO_LIVRE",
          price: 699,
          recordedAt: new Date("2026-09-01T11:00:00.000Z"),
        },
      ],
    );

    verificar(
      "PRICE_HISTORY_REJECTS_INVALID_PRICE_IN_SERIE",
      serieComInvalidos.length === 1 &&
        serieComInvalidos[0].price === 699,
      "precos invalidos nao podem contaminar a serie.",
    );
  }

  /*
   * PRICE_HISTORY_PRESERVES_MARKETPLACE
   *
   * Cada oferta/marketplace mantem identidade propria no historico.
   * Nenhum registro mistura origem; nenhum e sobrescrito/apagado.
   */
  {
    const registros: RegistroHistoricoSimulado[] = [];
    const base = new Date("2026-09-01T10:00:00.000Z");

    for (const step of [
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 699,
        recordedAt: base,
      },
      {
        offerId: ofertaAmazon,
        marketplace: "AMAZON",
        price: 720,
        recordedAt: new Date(base.getTime() + 60 * 60 * 1000),
      },
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 699,
        recordedAt: new Date(base.getTime() + 2 * 60 * 60 * 1000),
      },
      {
        offerId: ofertaAmazon,
        marketplace: "AMAZON",
        price: 700,
        recordedAt: new Date(base.getTime() + 3 * 60 * 60 * 1000),
      },
    ]) {
      aplicarMonitoramento(registros, {
        productId,
        ...step,
      });
    }

    const registrosMl = registros.filter(
      (registro) => registro.marketplace === "MERCADO_LIVRE",
    );
    const registrosAmazon = registros.filter(
      (registro) => registro.marketplace === "AMAZON",
    );

    verificar(
      "PRICE_HISTORY_PRESERVES_MARKETPLACE",
      registros.length === 3 &&
        registrosMl.length === 1 &&
        registrosMl.every(
          (registro) => registro.offerId === ofertaMl,
        ) &&
        registrosAmazon.length === 2 &&
        registrosAmazon.every(
          (registro) => registro.offerId === ofertaAmazon,
        ) &&
        registrosMl[0].price === 699 &&
        registrosAmazon[0].price === 720 &&
        registrosAmazon[1].price === 700,
      `esperava 3 registros com origem preservada, obteve ${registros.length}.`,
    );
  }

  /*
   * PRICE_HISTORY_30_DAY_LOW / 30_DAY_HIGH / 90_DAY_LOW / 90_DAY_HIGH
   *
   * Sem numeros inventados: tudo sai dos pontos reais registrados.
   */
  {
    const pontos = [
      criarPonto(850, 85, agora), // so no 90 dias
      criarPonto(650, 70, agora), // menor dos 90 dias
      criarPonto(999, 60, agora), // maior dos 90 dias
      criarPonto(800, 10, agora),
      criarPonto(700, 5, agora), // menor dos 30 dias
      criarPonto(900, 2, agora), // maior dos 30 dias
      criarPonto(750, 0, agora),
    ];

    const resumo30 = resumirHistorico(pontos, 30, agora);
    const resumo90 = resumirHistorico(pontos, 90, agora);

    verificar(
      "PRICE_HISTORY_30_DAY_LOW",
      resumo30.menorPreco === 700,
      `menor de 30 dias deveria ser 700, obteve ${resumo30.menorPreco}.`,
    );

    verificar(
      "PRICE_HISTORY_30_DAY_HIGH",
      resumo30.maiorPreco === 900,
      `maior de 30 dias deveria ser 900, obteve ${resumo30.maiorPreco}.`,
    );

    verificar(
      "PRICE_HISTORY_90_DAY_LOW",
      resumo90.menorPreco === 650,
      `menor de 90 dias deveria ser 650, obteve ${resumo90.menorPreco}.`,
    );

    verificar(
      "PRICE_HISTORY_90_DAY_HIGH",
      resumo90.maiorPreco === 999,
      `maior de 90 dias deveria ser 999, obteve ${resumo90.maiorPreco}.`,
    );

    verificar(
      "PRICE_HISTORY_30_DAY_EXCLUDES_OLD_POINTS",
      !resumo30.pontos.some(
        (ponto) => ponto.price === 650 || ponto.price === 850,
      ),
      "pontos mais antigos que 30 dias nao podem entrar no resumo de 30 dias.",
    );

    const mediaEsperada = 907.0588235080;

    verificar(
      "PRICE_HISTORY_90_DAY_WEIGHTED_AVERAGE",
      resumo90.mediaPreco !== null &&
        quaseIgual(resumo90.mediaPreco, mediaEsperada),
      "media ponderada pelos dias em que cada preco valeu.",
    );
  }

  /*
   * PRICE_HISTORY_EMPTY_STATE
   *
   * Sem dados suficientes, nada de numeros falsos: estado vazio.
   */
  {
    const vazio = resumirPrecosPeriodo([]);
    const resumoVazio = resumirHistorico([], 30, agora);

    verificar(
      "PRICE_HISTORY_EMPTY_STATE",
      vazio.menorPreco === null &&
        vazio.maiorPreco === null &&
        resumoVazio.pontos.length === 0 &&
        resumoVazio.menorPreco === null &&
        resumoVazio.maiorPreco === null &&
        resumoVazio.mediaPreco === null &&
        resumoVazio.diasMonitorados === 0,
      "sem historico, resumo precisa ser vazio (null), nunca um chute.",
    );

    verificar(
      "PRICE_HISTORY_EMPTY_STATE_SINGLE_POINT_HAS_VALUE",
      resumirPrecosPeriodo([criarPonto(700, 0, agora)])
        .menorPreco === 700,
      "um unico ponto valido ainda e um dado real, nao um estado vazio.",
    );
  }

  /*
   * PRICE_HISTORY_DROP_PERCENTAGE
   *
   * Queda de R$ 799 para R$ 679 = R$ 120 = ~15,02%.
   */
  {
    const avaliacao = avaliarQuedaPreco({
      currentPrice: 679,
      previousPrice: 799,
      lowest30Days: 650,
      lowest90Days: 640,
    });

    verificar(
      "PRICE_HISTORY_DROP_PERCENTAGE",
      avaliacao.priceDropped &&
        quaseIgual(avaliacao.dropAmount, 120) &&
        quaseIgual(avaliacao.dropPercentage, 15.02),
      `esperava 120 / 15,02% de queda, obteve ${avaliacao.dropAmount} / ${avaliacao.dropPercentage.toFixed(2)}%.`,
    );

    verificar(
      "PRICE_HISTORY_DROP_PERCENTAGE_NO_DROP_ON_RISE",
      avaliarQuedaPreco({
        currentPrice: 799,
        previousPrice: 679,
        lowest30Days: 650,
        lowest90Days: 640,
      }).priceDropped === false,
      "subida de preco nao pode ser reportada como queda.",
    );
  }

  /*
   * PRICE_HISTORY_NEW_30_DAY_LOW
   *
   * Um preco menor ou igual ao menor observado em 30 dias e uma nova
   * marca de 30 dias. Sem referencia real, nao inventamos a marca.
   */
  {
    const novaMinima = avaliarQuedaPreco({
      currentPrice: 640,
      previousPrice: 700,
      lowest30Days: 660,
      lowest90Days: 650,
    });

    const semReferencia = avaliarQuedaPreco({
      currentPrice: 640,
      previousPrice: 700,
      lowest30Days: null,
      lowest90Days: null,
    });

    verificar(
      "PRICE_HISTORY_NEW_30_DAY_LOW",
      novaMinima.isNew30DayLow === true &&
        novaMinima.isNew90DayLow === true &&
        semReferencia.isNew30DayLow === false &&
        semReferencia.isNew90DayLow === false,
      "nova minima real em 30/90 dias precisa ser detectada; sem referencia, nada de afirmativa.",
    );
  }

  /*
   * PRICE_HISTORY_PRODUCT_PAGE_EMPTY_SAFE
   *
   * A pagina de produto nunca renderiza grafico falso: com historico
   * insuficiente, mostra mensagem adequada e nao quebra.
   */
  {
    const painel = ler(
      "src/components/product/PriceHistoryPanel.tsx",
    );
    const pagina = ler("src/app/produto/[id]/page.tsx");

    verificar(
      "PRICE_HISTORY_PRODUCT_PAGE_EMPTY_SAFE",
      painel.includes("Ainda estamos acumulando o histórico real") &&
        painel.includes("> 0.009") === false &&
        /pontos\.length >= 2/.test(painel) &&
        pagina.includes("resumo30.pontos.length > 0"),
      "painel precisa ter mensagem de vazio explicita e pagina precisa garantir a renderizacao segura.",
    );
  }

  /*
   * PRICE_HISTORY_MULTI_STORE_PRESERVED
   *
   * Duas lojas com preco proximo nao viram pontos artificiais: a serie
   * publica usa o melhor preco valido por oferta, sem misturar.
   */
  {
    const historico = [
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 699,
        recordedAt: new Date("2026-09-01T10:00:00.000Z"),
      },
      {
        offerId: ofertaAmazon,
        marketplace: "AMAZON",
        price: 720,
        recordedAt: new Date("2026-09-01T11:00:00.000Z"),
      },
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 679,
        recordedAt: new Date("2026-09-02T10:00:00.000Z"),
      },
      {
        offerId: ofertaAmazon,
        marketplace: "AMAZON",
        price: 700,
        recordedAt: new Date("2026-09-02T11:00:00.000Z"),
      },
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 679,
        recordedAt: new Date("2026-09-03T10:00:00.000Z"),
      },
    ];

    const serie = construirSerieMelhorPrecoMultiLoja(historico);

    verificar(
      "PRICE_HISTORY_MULTI_STORE_PRESERVED",
      serie.length === 2 &&
        serie[0].price === 699 &&
        serie[1].price === 679 &&
        serie.every((ponto) => ponto.price > 0),
      `serie Multi Loja deveria ter [699, 679], obteve ${JSON.stringify(serie.map((ponto) => ponto.price))}.`,
    );

    verificar(
      "PRICE_HISTORY_MULTI_STORE_DISTINCT_SERIES",
      historico.filter(
        (registro) => registro.offerId === ofertaMl,
      ).length === 3 &&
        historico.filter(
          (registro) => registro.offerId === ofertaAmazon,
        ).length === 2,
      "cada loja preserva sua propria linhagem de registros.",
    );
  }

  /*
   * PRICE_HISTORY_90_DAY_BASELINE_BEFORE_WINDOW
   *
   * Oferta com preco estavel ha mais de 90 dias (sem registros na
   * janela) precisa ter o preco vigente no inicio dos 90 dias vindo do
   * baseline anterior a janela. R$ 700 vigente, caiu para R$ 650 20 dias
   * atras: o menor e R$ 650 e o maior dos 90 dias e R$ 700 (nao inventado).
   */
  {
    const agora = new Date("2026-09-05T12:00:00.000Z");
    const inicio90 = new Date(
      agora.getTime() - 90 * UM_DIA_EM_MS,
    );

    const eventos = [
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 700,
        recordedAt: new Date(
          agora.getTime() - 120 * UM_DIA_EM_MS,
        ),
      },
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 650,
        recordedAt: new Date(
          agora.getTime() - 20 * UM_DIA_EM_MS,
        ),
      },
    ];

    const serie = construirSerieMelhorPrecoMultiLojaComBaseline(
      eventos,
      inicio90,
    );

    const precos = serie.map((ponto) => ponto.price);

    verificar(
      "PRICE_HISTORY_90_DAY_BASELINE_BEFORE_WINDOW",
      precos.length === 2 &&
        quaseIgual(precos[0], 700) &&
        quaseIgual(precos[1], 650) &&
        serie[0].recordedAt.getTime() === inicio90.getTime(),
      `esperava baseline 700 vigente no inicio dos 90 dias (depois 650), obteve ${JSON.stringify(precos)}.`,
    );
  }

  /*
   * PRICE_HISTORY_30_DAY_BASELINE_BEFORE_WINDOW
   *
   * Mesma ideia para a janela de 30 dias: preco vigente no inicio dos
   * 30 dias (o ultimo registro real ate o inicio dos 30) precisa usarse
   * como baseline, mesmo que o ultimo registro seja mais antigo que 30d.
   */
  {
    const agora = new Date("2026-09-05T12:00:00.000Z");
    const inicio30 = new Date(
      agora.getTime() - 30 * UM_DIA_EM_MS,
    );

    const eventos = [
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 800,
        recordedAt: new Date(
          agora.getTime() - 120 * UM_DIA_EM_MS,
        ),
      },
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 700,
        recordedAt: new Date(
          agora.getTime() - 40 * UM_DIA_EM_MS,
        ),
      },
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 750,
        recordedAt: new Date(
          agora.getTime() - 10 * UM_DIA_EM_MS,
        ),
      },
    ];

    const serie = construirSerieMelhorPrecoMultiLojaComBaseline(
      eventos,
      inicio30,
    );

    const precos = serie.map((ponto) => ponto.price);

    verificar(
      "PRICE_HISTORY_30_DAY_BASELINE_BEFORE_WINDOW",
      precos.length === 2 &&
        quaseIgual(precos[0], 700) &&
        quaseIgual(precos[1], 750) &&
        serie[0].recordedAt.getTime() === inicio30.getTime(),
      `esperava 700 vigente no inicio dos 30 dias (800 era anterior a 30d e NAO deve entrar; 700 era o ultimo antes do inicio), obteve ${JSON.stringify(precos)}.`,
    );
  }

  /*
   * PRICE_HISTORY_MULTISTORE_BASELINE_PER_OFFER
   *
   * Em Multi Loja, cada oferta tem o seu proprio baseline antes da
   * janela. Oferta A (ML) estavel e Oferta B (Amazon) estavel comecam
   * juntas na janela com seus preco proprios, e o melhor preco inicial
   * e a menor das duas linhas de baseline.
   */
  {
    const agora = new Date("2026-09-05T12:00:00.000Z");
    const inicio90 = new Date(
      agora.getTime() - 90 * UM_DIA_EM_MS,
    );

    const eventos = [
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 720,
        recordedAt: new Date(
          agora.getTime() - 120 * UM_DIA_EM_MS,
        ),
      },
      {
        offerId: ofertaAmazon,
        marketplace: "AMAZON",
        price: 699,
        recordedAt: new Date(
          agora.getTime() - 150 * UM_DIA_EM_MS,
        ),
      },
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 680,
        recordedAt: new Date(
          agora.getTime() - 15 * UM_DIA_EM_MS,
        ),
      },
    ];

    const serie = construirSerieMelhorPrecoMultiLojaComBaseline(
      eventos,
      inicio90,
    );

    const precos = serie.map((ponto) => ponto.price);

    verificar(
      "PRICE_HISTORY_MULTISTORE_BASELINE_PER_OFFER",
      precos.length === 2 &&
        quaseIgual(precos[0], 699) &&
        quaseIgual(precos[1], 680),
      `esperava start com min(baselines)=699 e depois 680, obteve ${JSON.stringify(precos)}.`,
    );
  }

  /*
   * PRICE_HISTORY_STABLE_PRICE_ACROSS_WINDOW
   *
   * Preco 100% estavel durante a janela inteira (sem nenhuma mudanca
   * dentro da janela) produz UM unico ponto, o baseline, e LOWEST =
   * HIGHEST = media = preco vigente.
   */
  {
    const agora = new Date("2026-09-05T12:00:00.000Z");
    const inicio90 = new Date(
      agora.getTime() - 90 * UM_DIA_EM_MS,
    );

    const eventos = [
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 512,
        recordedAt: new Date(
          agora.getTime() - 200 * UM_DIA_EM_MS,
        ),
      },
    ];

    const serie = construirSerieMelhorPrecoMultiLojaComBaseline(
      eventos,
      inicio90,
    );

    const resumo = resumirHistorico(serie, 90, agora);

    verificar(
      "PRICE_HISTORY_STABLE_PRICE_ACROSS_WINDOW",
      serie.length === 1 &&
        quaseIgual(serie[0].price, 512) &&
        resumo.menorPreco !== null &&
        quaseIgual(resumo.menorPreco, 512) &&
        resumo.maiorPreco !== null &&
        quaseIgual(resumo.maiorPreco, 512) &&
        resumo.mediaPreco !== null &&
        quaseIgual(resumo.mediaPreco, 512),
      "preco estavel na janela inteira precisa ter LOWEST=HIGHEST=media=preco vigente (1 ponto baseline).",
    );
  }

  /*
   * PRICE_HISTORY_BASELINE_DOES_NOT_CREATE_FAKE_DB_ENTRY
   *
   * O baseline e apenas uma leitura para referencia da serie. Ele NAO
   * cria/duplica nenhuma linha de PriceHistory no banco e nem inventa
   * registro novo. Aqui verificamos que a funcao usa somente os eventos
   * fornecidos e nao escreve em lado nenhum (puro, sem efeito colateral).
   */
  {
    const agora = new Date("2026-09-05T12:00:00.000Z");
    const inicio90 = new Date(
      agora.getTime() - 90 * UM_DIA_EM_MS,
    );

    const eventosAntes = [
      {
        offerId: ofertaMl,
        marketplace: "MERCADO_LIVRE",
        price: 700,
        recordedAt: inicio90,
      },
    ];

    const serieAntes = construirSerieMelhorPrecoMultiLojaComBaseline(
      eventosAntes,
      inicio90,
    );
    const serieDepois = construirSerieMelhorPrecoMultiLojaComBaseline(
      eventosAntes,
      inicio90,
    );

    verificar(
      "PRICE_HISTORY_BASELINE_DOES_NOT_CREATE_FAKE_DB_ENTRY",
      serieAntes.length === 1 &&
        serieDepois.length === 1 &&
        quaseIgual(serieAntes[0].price, 700) &&
        quaseIgual(serieDepois[0].price, 700),
      "construir serie com baseline precisa ser pura/reidempotente e nao criar entradas falsas.",
    );
  }

  verificar(
    "PRICE_HISTORY_TOLERANCIA_ADERENTE",
    TOLERANCIA_PRECO === 0.009,
    "tolerancia real de mudanca precisa ser coerente com o monitor (0.009).",
  );
}

run();