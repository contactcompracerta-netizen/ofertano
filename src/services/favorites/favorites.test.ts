import assert from "node:assert/strict";

import { FavoriteError, FAVORITE_ERROR_CODES } from "./errors";
import { unirIdsFavoritos } from "./ids";
import { criarMemoryFavoriteStore } from "./memoryStore";
import { criarServicoFavoritos } from "./service";
import { GUEST_OWNER, idsLocaisParaSincronizar } from "./sessionPolicy";

const usuarioA = "user-a";
const usuarioB = "user-b";
const produto1 = "product-1";
const produto2 = "product-2";
const produto3 = "product-3";
const produtoInexistente = "product-missing";

function criarServico(produtos = [produto1, produto2, produto3]) {
  return criarServicoFavoritos(criarMemoryFavoriteStore(produtos));
}

async function deveAdicionarFavorito() {
  const servico = criarServico();
  const resultado = await servico.adicionarFavorito(
    usuarioA,
    produto1
  );

  assert.equal(resultado.created, true);
  assert.equal(resultado.favorite.productId, produto1);
  assert.equal(resultado.favorite.userId, usuarioA);
  assert.equal(
    await servico.produtoEstaFavoritado(usuarioA, produto1),
    true
  );
}

async function deveSerIdempotenteAoFavoritarDeNovo() {
  const servico = criarServico();

  await servico.adicionarFavorito(usuarioA, produto1);
  const segunda = await servico.adicionarFavorito(
    usuarioA,
    produto1
  );
  const lista = await servico.listarFavoritos(usuarioA);

  assert.equal(segunda.created, false);
  assert.equal(lista.length, 1);
  assert.equal(lista[0]?.productId, produto1);
}

async function deveRemoverFavorito() {
  const servico = criarServico();

  await servico.adicionarFavorito(usuarioA, produto1);
  const removido = await servico.removerFavorito(
    usuarioA,
    produto1
  );
  const novamente = await servico.removerFavorito(
    usuarioA,
    produto1
  );

  assert.equal(removido.removed, true);
  assert.equal(novamente.removed, false);
  assert.equal(
    await servico.produtoEstaFavoritado(usuarioA, produto1),
    false
  );
  assert.equal((await servico.listarFavoritos(usuarioA)).length, 0);
}

async function deveListarSomenteDoUsuario() {
  const servico = criarServico();

  await servico.adicionarFavorito(usuarioA, produto1);
  await servico.adicionarFavorito(usuarioA, produto2);
  await servico.adicionarFavorito(usuarioB, produto3);

  const listaA = await servico.listarFavoritos(usuarioA);
  const listaB = await servico.listarFavoritos(usuarioB);

  assert.deepEqual(
    listaA.map((item) => item.productId).sort(),
    [produto1, produto2]
  );
  assert.deepEqual(
    listaB.map((item) => item.productId),
    [produto3]
  );
  assert.equal(
    await servico.produtoEstaFavoritado(usuarioB, produto1),
    false
  );
}

async function naoDeveFavoritarProdutoInexistente() {
  const servico = criarServico();

  await assert.rejects(
    () => servico.adicionarFavorito(usuarioA, produtoInexistente),
    (error: unknown) => {
      assert.equal(error instanceof FavoriteError, true);
      assert.equal(
        (error as FavoriteError).code,
        FAVORITE_ERROR_CODES.PRODUCT_NOT_FOUND
      );
      return true;
    }
  );

  assert.equal((await servico.listarFavoritos(usuarioA)).length, 0);
}

async function deveAdicionarUmUnicoFavoritoPorProduto() {
  const servico = criarServico();

  await servico.adicionarFavorito(usuarioA, produto1);
  await servico.adicionarFavorito(usuarioA, produto1);
  await servico.adicionarFavorito(usuarioA, produto1);

  const lista = await servico.listarFavoritos(usuarioA);

  assert.equal(lista.length, 1);
  assert.equal(lista[0]?.productId, produto1);
}

async function deveUnirLocaisERemotosSemDuplicar() {
  const servico = criarServico();

  await servico.adicionarFavorito(usuarioA, produto1);
  await servico.adicionarFavorito(usuarioA, produto3);

  const merge = await servico.unirFavoritosLocais(usuarioA, [
    produto1,
    produto2,
    produto1,
    produtoInexistente,
    "  ",
    produto2,
  ]);

  assert.deepEqual(merge.added.sort(), [produto2]);
  assert.deepEqual(merge.alreadyPresent, [produto1]);
  assert.deepEqual(merge.skippedInvalid, [produtoInexistente]);
  assert.equal(merge.productIds.includes(produto1), true);
  assert.equal(merge.productIds.includes(produto2), true);
  assert.equal(merge.productIds.includes(produto3), true);
  assert.equal(merge.productIds.includes(produtoInexistente), false);
  assert.equal(merge.productIds.length, 3);

  const uniao = unirIdsFavoritos(
    [produto2, produto3, produto1],
    [produto1]
  );

  assert.deepEqual(uniao.sort(), [produto1, produto2, produto3]);
}

async function deveMesclarSomenteFavoritosDeVisitante() {
  assert.deepEqual(
    idsLocaisParaSincronizar({
      ownerId: GUEST_OWNER,
      userId: usuarioA,
      idsLocais: [produto1, produto2],
    }),
    [produto1, produto2]
  );

  assert.deepEqual(
    idsLocaisParaSincronizar({
      ownerId: null,
      userId: usuarioA,
      idsLocais: [produto1],
    }),
    [produto1]
  );

  assert.deepEqual(
    idsLocaisParaSincronizar({
      ownerId: usuarioA,
      userId: usuarioA,
      idsLocais: [produto1, produto2],
    }),
    []
  );

  assert.deepEqual(
    idsLocaisParaSincronizar({
      ownerId: usuarioA,
      userId: usuarioB,
      idsLocais: [produto1, produto2],
    }),
    []
  );
}

async function executar() {
  await deveAdicionarFavorito();
  await deveSerIdempotenteAoFavoritarDeNovo();
  await deveRemoverFavorito();
  await deveListarSomenteDoUsuario();
  await naoDeveFavoritarProdutoInexistente();
  await deveAdicionarUmUnicoFavoritoPorProduto();
  await deveUnirLocaisERemotosSemDuplicar();
  await deveMesclarSomenteFavoritosDeVisitante();

  console.log("favorites.test.ts: todos os testes passaram.");
}

void executar().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
