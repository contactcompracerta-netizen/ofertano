import assert from "node:assert/strict";

import {
  limparOportunidadesDoPainel,
  montarFiltroExclusao,
  montarMensagemLimpeza,
} from "./clearOpportunities";

function deveExcluirTudoQuandoNaoHaProcessamento() {
  assert.equal(
    montarFiltroExclusao([]),
    undefined,
  );
}

function devePreservarSomenteIdsEmProcessamento() {
  const filtro = montarFiltroExclusao(["opp-1", "opp-2"]);

  assert.deepEqual(filtro, {
    id: {
      notIn: ["opp-1", "opp-2"],
    },
  });
}

function deveMontarMensagensDoPainel() {
  assert.equal(
    montarMensagemLimpeza({
      deletedCount: 0,
      preservedCount: 0,
    }),
    "Nenhuma oportunidade para limpar.",
  );

  assert.equal(
    montarMensagemLimpeza({
      deletedCount: 35,
      preservedCount: 0,
    }),
    "35 oportunidade(s) removida(s). Produtos publicados, ofertas e a fila não foram apagados.",
  );

  assert.equal(
    montarMensagemLimpeza({
      deletedCount: 35,
      preservedCount: 2,
    }),
    "35 oportunidade(s) removida(s). 2 em processamento foram preservadas. Produtos publicados, ofertas e a fila não foram apagados.",
  );
}

async function deveSerIdempotenteComPainelVazio() {
  const resultado = await limparOportunidadesDoPainel({
    importQueue: {
      findMany: async () => [],
    },
    productOpportunity: {
      deleteMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    $transaction: async (fn) =>
      fn({
        importQueue: {
          findMany: async () => [],
        },
        productOpportunity: {
          deleteMany: async () => ({ count: 0 }),
          count: async () => 0,
        },
        $transaction: async (inner) => inner({} as never),
      }),
  });

  assert.equal(resultado.deletedCount, 0);
  assert.equal(resultado.preservedCount, 0);
}

async function deveRemoverSomenteOportunidadesForaDeProcessamento() {
  let filtroUsado:
    | { id?: { notIn: string[] } }
    | undefined;

  const resultado = await limparOportunidadesDoPainel({
    importQueue: {
      findMany: async () => [],
    },
    productOpportunity: {
      deleteMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    $transaction: async (fn) =>
      fn({
        importQueue: {
          findMany: async () => [
            { opportunityId: "opp-proc" },
            { opportunityId: "opp-proc" },
            { opportunityId: null },
          ],
        },
        productOpportunity: {
          deleteMany: async (args) => {
            filtroUsado = args?.where;
            return { count: 35 };
          },
          count: async () => 2,
        },
        $transaction: async (inner) => inner({} as never),
      }),
  });

  assert.deepEqual(filtroUsado, {
    id: {
      notIn: ["opp-proc"],
    },
  });
  assert.equal(resultado.deletedCount, 35);
  assert.equal(resultado.preservedCount, 2);
}

async function executar() {
  deveExcluirTudoQuandoNaoHaProcessamento();
  devePreservarSomenteIdsEmProcessamento();
  deveMontarMensagensDoPainel();
  await deveSerIdempotenteComPainelVazio();
  await deveRemoverSomenteOportunidadesForaDeProcessamento();
  console.log("clearOpportunities.test.ts: ok");
}

void executar();
