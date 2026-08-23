import assert from "node:assert/strict";

import { PRICE_ALERT_ERROR_CODES, PriceAlertError } from "./errors";
import { criarMemoryPriceAlertStore } from "./memoryStore";
import { selecionarMenorPrecoExact } from "./menorPrecoExact";
import { criarServicoPriceAlerts } from "./service";
import { PRICE_ALERT_TYPES } from "./types";
import type { ExactOfferSnapshot } from "./types";

const usuarioA = "user-a";
const usuarioB = "user-b";
const produto1 = "product-1";
const produto2 = "product-2";
const produtoInexistente = "product-missing";

function produto(id: string, preco = 500) {
  return {
    id,
    name: `Produto ${id}`,
    image: "https://cdn.example/produto.jpg",
    price: preco,
    slug: id,
  };
}

function oferta(
  parcial: Partial<ExactOfferSnapshot> & {
    productId?: string;
    price: number;
  }
): ExactOfferSnapshot {
  return {
    productId: produto1,
    marketplace: "AMAZON",
    matchStatus: "EXACT",
    active: true,
    available: true,
    status: "ACTIVE",
    ...parcial,
  };
}

function criarCenario(
  ofertas: ExactOfferSnapshot[] = [
    oferta({ marketplace: "AMAZON", price: 500 }),
  ]
) {
  const store = criarMemoryPriceAlertStore({
    products: [produto(produto1, 500), produto(produto2, 1800)],
    offers: ofertas,
  });

  return {
    store,
    servico: criarServicoPriceAlerts(store),
  };
}

function definirOfertas(
  store: ReturnType<typeof criarMemoryPriceAlertStore>,
  ofertas: ExactOfferSnapshot[]
) {
  store.state.offers = ofertas;
}

async function deveSelecionarSomenteMenorExact() {
  const menor = selecionarMenorPrecoExact([
    oferta({
      marketplace: "AMAZON",
      matchStatus: "EXACT",
      price: 1800,
    }),
    oferta({
      marketplace: "MERCADO_LIVRE",
      matchStatus: "EXACT",
      price: 1700,
    }),
    oferta({
      marketplace: "SHOPEE",
      matchStatus: "HIGH",
      price: 1200,
    }),
  ]);

  assert.equal(menor, 1700);
}

async function naoDeveUsarHighComoPrecoDoAlerta() {
  const { servico } = criarCenario([
    oferta({
      marketplace: "AMAZON",
      matchStatus: "EXACT",
      price: 1800,
    }),
    oferta({
      marketplace: "MERCADO_LIVRE",
      matchStatus: "EXACT",
      price: 1700,
    }),
    oferta({
      marketplace: "SHOPEE",
      matchStatus: "HIGH",
      price: 1200,
    }),
  ]);

  const criado = await servico.criarAlerta(usuarioA, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.ANY_DROP,
  });

  assert.equal(criado.created, true);
  assert.equal(criado.alert.referencePrice, 1700);
  assert.equal(
    await servico.obterMenorPrecoExactDoProduto(produto1),
    1700
  );
}

async function anyDropNaoDisparaEm500Nem510EDisparaEm499() {
  const { store, servico } = criarCenario([
    oferta({ price: 500 }),
  ]);

  const criado = await servico.criarAlerta(usuarioA, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.ANY_DROP,
  });

  assert.equal(criado.alert.referencePrice, 500);

  definirOfertas(store, [oferta({ price: 500 })]);
  const igual = await servico.avaliarAlertasAtivos();
  assert.equal(igual.triggered, 0);

  definirOfertas(store, [oferta({ price: 510 })]);
  const alta = await servico.avaliarAlertasAtivos();
  assert.equal(alta.triggered, 0);

  definirOfertas(store, [oferta({ price: 499 })]);
  const queda = await servico.avaliarAlertasAtivos();
  assert.equal(queda.triggered, 1);
  assert.equal(queda.results[0]?.triggered, true);

  const lista = await servico.listarAlertas(usuarioA);
  assert.equal(lista[0]?.referencePrice, 499);
  assert.equal(lista[0]?.lastTriggeredPrice, 499);
  assert.equal(lista[0]?.triggerCount, 1);
}

async function anyDropNaoDuplicaOMesmoPrecoEDisparaNovaQueda() {
  const { store, servico } = criarCenario([
    oferta({ price: 500 }),
  ]);

  await servico.criarAlerta(usuarioA, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.ANY_DROP,
  });

  definirOfertas(store, [oferta({ price: 499 })]);
  await servico.avaliarAlertasAtivos();

  definirOfertas(store, [oferta({ price: 499 })]);
  const repetido = await servico.avaliarAlertasAtivos();
  assert.equal(repetido.triggered, 0);

  definirOfertas(store, [oferta({ price: 470 })]);
  const novaQueda = await servico.avaliarAlertasAtivos();
  assert.equal(novaQueda.triggered, 1);

  const lista = await servico.listarAlertas(usuarioA);
  assert.equal(lista[0]?.referencePrice, 470);
  assert.equal(lista[0]?.triggerCount, 2);
  assert.equal(lista[0]?.lastTriggeredPrice, 470);
}

async function targetPriceDisparaEm1500ENaoDuplicaEm1490() {
  const { store, servico } = criarCenario([
    oferta({ price: 1600 }),
  ]);

  const criado = await servico.criarAlerta(usuarioA, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.TARGET_PRICE,
    targetPrice: 1500,
  });

  assert.equal(criado.alert.targetPrice, 1500);
  assert.equal(criado.alert.triggerCount, 0);
  assert.equal(criado.alert.armed, true);

  definirOfertas(store, [oferta({ price: 1600 })]);
  assert.equal((await servico.avaliarAlertasAtivos()).triggered, 0);

  definirOfertas(store, [oferta({ price: 1501 })]);
  assert.equal((await servico.avaliarAlertasAtivos()).triggered, 0);

  definirOfertas(store, [oferta({ price: 1500 })]);
  const atingiu = await servico.avaliarAlertasAtivos();
  assert.equal(atingiu.triggered, 1);

  definirOfertas(store, [oferta({ price: 1490 })]);
  const abaixoDeNovo = await servico.avaliarAlertasAtivos();
  assert.equal(abaixoDeNovo.triggered, 0);
  assert.equal(
    abaixoDeNovo.results[0]?.skippedReason,
    "ALREADY_TRIGGERED"
  );

  const lista = await servico.listarAlertas(usuarioA);
  assert.equal(lista[0]?.armed, false);
  assert.equal(lista[0]?.active, true);
  assert.equal(lista[0]?.triggerCount, 1);
  assert.equal(lista[0]?.lastTriggeredPrice, 1500);
}

async function semExactNaoDisparaNemInventaPreco() {
  const { store, servico } = criarCenario([]);

  const criado = await servico.criarAlerta(usuarioA, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.ANY_DROP,
  });

  assert.equal(criado.alert.referencePrice, null);
  assert.equal(criado.alert.lastEvaluatedHadExact, false);
  assert.equal(criado.alert.active, true);

  definirOfertas(store, [
    oferta({ matchStatus: "HIGH", price: 100 }),
    oferta({
      matchStatus: "EXACT",
      active: false,
      price: 90,
    }),
  ]);

  const avaliacao = await servico.avaliarAlertasAtivos();
  assert.equal(avaliacao.triggered, 0);
  assert.equal(avaliacao.withoutExact, 1);
  assert.equal(avaliacao.results[0]?.skippedReason, "NO_EXACT");
  assert.equal(avaliacao.results[0]?.currentPrice, null);

  const lista = await servico.listarAlertas(usuarioA);
  assert.equal(lista[0]?.active, true);
  assert.equal(lista[0]?.triggerCount, 0);
  assert.equal(lista[0]?.referencePrice, null);
}

async function primeiroExactDepoisDoVazioViraReferenciaSemDisparar() {
  const { store, servico } = criarCenario([]);

  await servico.criarAlerta(usuarioA, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.ANY_DROP,
  });

  definirOfertas(store, [oferta({ price: 500 })]);
  const primeiraLeitura = await servico.avaliarAlertasAtivos();
  assert.equal(primeiraLeitura.triggered, 0);

  const lista = await servico.listarAlertas(usuarioA);
  assert.equal(lista[0]?.referencePrice, 500);

  definirOfertas(store, [oferta({ price: 499 })]);
  const queda = await servico.avaliarAlertasAtivos();
  assert.equal(queda.triggered, 1);
}

async function usuariosFicamIsolados() {
  const { servico } = criarCenario([oferta({ price: 500 })]);

  const alertaA = await servico.criarAlerta(usuarioA, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.ANY_DROP,
  });
  const alertaB = await servico.criarAlerta(usuarioB, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.TARGET_PRICE,
    targetPrice: 400,
  });

  const listaA = await servico.listarAlertas(usuarioA);
  const listaB = await servico.listarAlertas(usuarioB);

  assert.equal(listaA.length, 1);
  assert.equal(listaB.length, 1);
  assert.equal(listaA[0]?.id, alertaA.alert.id);
  assert.equal(listaB[0]?.id, alertaB.alert.id);
  assert.equal(listaA[0]?.type, PRICE_ALERT_TYPES.ANY_DROP);
  assert.equal(listaB[0]?.type, PRICE_ALERT_TYPES.TARGET_PRICE);

  await assert.rejects(
    () =>
      servico.atualizarAlerta(usuarioB, alertaA.alert.id, {
        active: false,
      }),
    (error: unknown) => {
      assert.equal(error instanceof PriceAlertError, true);
      assert.equal(
        (error as PriceAlertError).code,
        PRICE_ALERT_ERROR_CODES.ALERT_NOT_FOUND
      );
      return true;
    }
  );

  const removidoB = await servico.removerAlerta(
    usuarioB,
    alertaA.alert.id
  );
  assert.equal(removidoB.removed, false);

  const listaADepois = await servico.listarAlertas(usuarioA);
  assert.equal(listaADepois.length, 1);
  assert.equal(listaADepois[0]?.active, true);
}

async function umProdutoMultiLojaTemUmUnicoAlertaPorConfiguracao() {
  const { store, servico } = criarCenario([
    oferta({ marketplace: "AMAZON", price: 1800 }),
    oferta({ marketplace: "MERCADO_LIVRE", price: 1700 }),
    oferta({
      marketplace: "SHOPEE",
      matchStatus: "HIGH",
      price: 1200,
    }),
  ]);

  const primeiro = await servico.criarAlerta(usuarioA, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.ANY_DROP,
  });
  const segundo = await servico.criarAlerta(usuarioA, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.ANY_DROP,
  });

  assert.equal(primeiro.created, true);
  assert.equal(segundo.created, false);
  assert.equal(primeiro.alert.id, segundo.alert.id);
  assert.equal(primeiro.alert.productId, produto1);
  assert.equal(primeiro.alert.referencePrice, 1700);

  const lista = await servico.listarAlertas(usuarioA);
  assert.equal(lista.length, 1);

  definirOfertas(store, [
    oferta({ marketplace: "AMAZON", price: 1800 }),
    oferta({ marketplace: "MERCADO_LIVRE", price: 1690 }),
    oferta({
      marketplace: "SHOPEE",
      matchStatus: "HIGH",
      price: 1000,
    }),
  ]);

  const avaliacao = await servico.avaliarAlertasAtivos();
  assert.equal(avaliacao.triggered, 1);
  assert.equal(avaliacao.results[0]?.currentPrice, 1690);
}

async function avaliacaoIdempotenteSemMudancaDePreco() {
  const { store, servico } = criarCenario([
    oferta({ price: 500 }),
  ]);

  await servico.criarAlerta(usuarioA, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.ANY_DROP,
  });

  definirOfertas(store, [oferta({ price: 480 })]);
  const primeira = await servico.avaliarAlertasAtivos();
  const segunda = await servico.avaliarAlertasAtivos();

  assert.equal(primeira.triggered, 1);
  assert.equal(segunda.triggered, 0);

  const lista = await servico.listarAlertas(usuarioA);
  assert.equal(lista[0]?.triggerCount, 1);
}

async function naoCriaAlertaDeProdutoInexistente() {
  const { servico } = criarCenario();

  await assert.rejects(
    () =>
      servico.criarAlerta(usuarioA, {
        productId: produtoInexistente,
        type: PRICE_ALERT_TYPES.ANY_DROP,
      }),
    (error: unknown) => {
      assert.equal(
        (error as PriceAlertError).code,
        PRICE_ALERT_ERROR_CODES.PRODUCT_NOT_FOUND
      );
      return true;
    }
  );
}

async function validaPayloadsDeCriacao() {
  const { servico } = criarCenario();

  await assert.rejects(
    () =>
      servico.criarAlerta(usuarioA, {
        productId: produto1,
        type: PRICE_ALERT_TYPES.TARGET_PRICE,
      }),
    (error: unknown) => {
      assert.equal(
        (error as PriceAlertError).code,
        PRICE_ALERT_ERROR_CODES.TARGET_PRICE_REQUIRED
      );
      return true;
    }
  );

  await assert.rejects(
    () =>
      servico.criarAlerta(usuarioA, {
        productId: produto1,
        type: PRICE_ALERT_TYPES.ANY_DROP,
        targetPrice: 1500,
      }),
    (error: unknown) => {
      assert.equal(
        (error as PriceAlertError).code,
        PRICE_ALERT_ERROR_CODES.TARGET_PRICE_NOT_ALLOWED
      );
      return true;
    }
  );

  await assert.rejects(
    () =>
      servico.criarAlerta(usuarioA, {
        productId: produto1,
        type: PRICE_ALERT_TYPES.TARGET_PRICE,
        targetPrice: 0,
      }),
    (error: unknown) => {
      assert.equal(
        (error as PriceAlertError).code,
        PRICE_ALERT_ERROR_CODES.INVALID_TARGET_PRICE
      );
      return true;
    }
  );
}

async function patchEDeleteFicamNoDono() {
  const { servico } = criarCenario([oferta({ price: 800 })]);

  const criado = await servico.criarAlerta(usuarioA, {
    productId: produto1,
    type: PRICE_ALERT_TYPES.TARGET_PRICE,
    targetPrice: 700,
  });

  const atualizado = await servico.atualizarAlerta(
    usuarioA,
    criado.alert.id,
    {
      targetPrice: 650,
      active: false,
    }
  );

  assert.equal(atualizado.targetPrice, 650);
  assert.equal(atualizado.active, false);

  const reativado = await servico.atualizarAlerta(
    usuarioA,
    criado.alert.id,
    { active: true, armed: true }
  );
  assert.equal(reativado.active, true);
  assert.equal(reativado.armed, true);

  const removido = await servico.removerAlerta(
    usuarioA,
    criado.alert.id
  );
  assert.equal(removido.removed, true);
  assert.equal((await servico.listarAlertas(usuarioA)).length, 0);
}

async function executar() {
  await deveSelecionarSomenteMenorExact();
  await naoDeveUsarHighComoPrecoDoAlerta();
  await anyDropNaoDisparaEm500Nem510EDisparaEm499();
  await anyDropNaoDuplicaOMesmoPrecoEDisparaNovaQueda();
  await targetPriceDisparaEm1500ENaoDuplicaEm1490();
  await semExactNaoDisparaNemInventaPreco();
  await primeiroExactDepoisDoVazioViraReferenciaSemDisparar();
  await usuariosFicamIsolados();
  await umProdutoMultiLojaTemUmUnicoAlertaPorConfiguracao();
  await avaliacaoIdempotenteSemMudancaDePreco();
  await naoCriaAlertaDeProdutoInexistente();
  await validaPayloadsDeCriacao();
  await patchEDeleteFicamNoDono();

  console.log("priceAlerts.test.ts: todos os testes passaram.");
}

void executar().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
