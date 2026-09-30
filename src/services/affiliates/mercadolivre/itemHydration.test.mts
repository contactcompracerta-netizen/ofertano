/**
 * HIDRATAÇÃO DO ANÚNCIO — testes com `getItem` injetado.
 *
 * Nenhum teste toca a rede. O `getItem` é substituído por um duplo, porque o
 * que se está verificando aqui é a decisão: quando aceitar a permalink da API,
 * quando recusar, e quando marcar como retentável. A forma do payload real do
 * ML é um detalhe de integração; a regra de recusa é o que protege o backfill.
 *
 * Sem injeção, este teste exigiria rede e login no momento de rodar a suíte —
 * que é o que fez a validação de alvo ficar sem cobertura até agora.
 */
import assert from "node:assert/strict";

import {
  AFFILIATE_INPUT_MODE_EXACT_ITEM,
  canonicalizarMlb,
  hydrateExactItemPermalink,
  mlbParaApi,
  permalinkProvaAnuncio,
  type HydrateItemFn,
} from "./itemHydration";

const MLB = "MLB-7681144154";
const CATALOGO = "MLB-25263382";

function getItemReturning(payload: unknown): HydrateItemFn {
  return async () => payload as never;
}

console.log("--- 1. caminho feliz: permalink do anúncio ---");
{
  const r = await hydrateExactItemPermalink(MLB, {
    getItem: getItemReturning({
      id: "MLB7681144154",
      permalink:
        "https://www.mercadolivre.com.br/Notebook-X/MLB-7681144154-apple" +
        "-p/MLB25263382",
      catalog_product_id: "MLB25263382",
    }),
  });
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  assert.equal(r.ok && r.inputMode, AFFILIATE_INPUT_MODE_EXACT_ITEM);
  assert.equal(r.ok && r.itemId, MLB);
  assert.equal(r.ok && r.catalogId, CATALOGO);
  assert.equal(r.ok && r.provaDoAnuncio, true);
  console.log(`  inputMode=${AFFILIATE_INPUT_MODE_EXACT_ITEM} item=${r.ok && r.itemId}`);
}

console.log("--- 2. permalink só de catálogo => recusado, SEM retry ---");
{
  // É o caso medido em produção: o ML devolve /p/MLB<catalogId> para anúncio
  // que já migrou para produto. Aceitar aqui reinicia o bug do link errado.
  const r = await hydrateExactItemPermalink(MLB, {
    getItem: getItemReturning({
      id: "MLB7681144154",
      permalink: "https://www.mercadolivre.com.br/p/MLB25263382",
      catalog_product_id: "MLB25263382",
    }),
  });
  assert.equal(r.ok, false, "permalink de catálogo não pode passar");
  assert.equal(r.ok === false && r.status, "ITEM_HYDRATION_FAILED");
  assert.equal(r.ok === false && r.disposition, "NO_RETRY",
    "não é transitório: repetir não muda a resposta da API");
  console.log(`  recusado (NO_RETRY): ${!r.ok ? r.reason : ""}`);
}

console.log("--- 3. mesmo MLB em /p/ ainda é catálogo => recusado ---");
{
  const r = await hydrateExactItemPermalink(MLB, {
    getItem: getItemReturning({
      id: "MLB7681144154",
      permalink: "https://www.mercadolivre.com.br/p/MLB7681144154",
    }),
  });
  assert.equal(r.ok, false, "/p/ com o MLB esperado ainda é catálogo");
  assert.equal(r.ok === false && r.disposition, "NO_RETRY");
}

console.log("--- 4. sem permalink => RETRY ---");
{
  const r = await hydrateExactItemPermalink(MLB, {
    getItem: getItemReturning({ id: "MLB7681144154" }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.disposition, "RETRY");
  console.log(`  RETRY: ${!r.ok ? r.reason : ""}`);
}

console.log("--- 5. erro de rede => RETRY ---");
{
  const r = await hydrateExactItemPermalink(MLB, {
    getItem: async () => {
      throw new Error("ECONNRESET");
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.disposition, "RETRY");
  assert.match(r.ok === false ? r.reason : "", /ECONNRESET/);
}

console.log("--- 6. resposta nula => RETRY ---");
{
  const r = await hydrateExactItemPermalink(MLB, { getItem: async () => null });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.disposition, "RETRY");
}

console.log("--- 7. id divergente na resposta => descartada ---");
{
  // O multiget pode devolver o primeiro item quando o id pedido não casa.
  // Gravar o permalink de OUTRO anúncio aqui é o pior erro possível.
  const r = await hydrateExactItemPermalink(MLB, {
    getItem: getItemReturning({
      id: "MLB9999999999",
      permalink:
        "https://www.mercadolivre.com.br/Outro/MLB-9999999999-outro-p/MLB1",
    }),
  });
  assert.equal(r.ok, false, "resposta de outro anúncio não pode passar");
  assert.equal(r.ok === false && r.disposition, "RETRY");
  assert.match(r.ok === false ? r.reason : "", /9999999999/);
  console.log(`  descartada: ${!r.ok ? r.reason : ""}`);
}

console.log("--- 8. permalink fora do domínio oficial => recusado ---");
{
  for (const host of [
    "https://meli.la.evil.test/MLB-7681144154-x",
    "https://mercadolivre.com.br.evil.test/MLB-7681144154-x",
  ]) {
    const r = await hydrateExactItemPermalink(MLB, {
      getItem: getItemReturning({ id: "MLB7681144154", permalink: host }),
    });
    assert.equal(r.ok, false, `deveria recusar ${host}`);
    assert.equal(r.ok === false && r.disposition, "NO_RETRY");
  }
  console.log("  2 hosts externos recusados");
}

console.log("--- 9. externalId inválido => NO_RETRY, sem chamar a API ---");
{
  let chamado = false;
  const spy: HydrateItemFn = async () => {
    chamado = true;
    return null;
  };
  for (const ruim of ["", "  ", "nao-mlb", "12345", "MLB-abc"]) {
    const r = await hydrateExactItemPermalink(ruim, { getItem: spy });
    assert.equal(r.ok, false, `deveria recusar externalId: ${JSON.stringify(ruim)}`);
    assert.equal(r.ok === false && r.disposition, "NO_RETRY");
  }
  assert.equal(chamado, false, "a API não deve ser chamada com MLB inválido");
  console.log("  5 IDs inválidos recusados antes da chamada");
}

console.log("--- 10. canonicalização de MLB ---");
{
  assert.equal(canonicalizarMlb("MLB7681144154"), MLB);
  assert.equal(canonicalizarMlb("mlb-7681144154"), MLB);
  assert.equal(canonicalizarMlb("MLB_7681144154"), MLB);
  assert.equal(canonicalizarMlb("  MLB-7681144154  "), MLB);
}

console.log("--- 10b. forma enviada à API é SEM hífen (medido) ---");
{
  // Regressão medida: `GET /items/MLB-7681144154` devolve 404 sem `id` no
  // corpo; `GET /items/MLB7681144154` devolve 403 COM `id`. A API não
  // reconhece a forma com hífen. Enviar a forma do permalink ao endpoint de
  // recurso produz 404 garantido e mascara negação de permissão.
  for (const entrada of [
    "MLB7681144154",
    "MLB-7681144154",
    "mlb-7681144154",
    "  MLB_7681144154 ",
  ]) {
    assert.equal(mlbParaApi(entrada), "MLB7681144154", `entrada: ${entrada}`);
  }
  // E o que a API devolve (o multiget responde SEM hífen) ainda casa.
  assert.equal(canonicalizarMlb(mlbParaApi(MLB)), MLB, "ida e volta preserva o MLB");
  console.log(`  mlbParaApi -> ${mlbParaApi(MLB)} (canônico: ${canonicalizarMlb(MLB)})`);
}

console.log("--- 10c. a API é chamada com a forma sem hífen ---");
{
  let recebido: string | null = null;
  const spy: HydrateItemFn = async (id) => {
    recebido = id;
    return {
      id: "MLB7681144154",
      permalink:
        "https://www.mercadolivre.com.br/Notebook-X/MLB-7681144154-apple" +
        "-p/MLB25263382",
    };
  };
  const r = await hydrateExactItemPermalink(MLB, { getItem: spy });
  assert.equal(recebido, "MLB7681144154", "a API não pode receber MLB-...");
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  console.log(`  getItem recebeu: ${recebido}`);
}

console.log("--- 10d. access_denied é NO_RETRY, não RETRY ---");
{
  // Medido: o ML responde 403 access_denied para GET /items/{id} desta
  // credencial. Não é transitório — repetir devolve 403 para sempre. Marcar
  // RETRY faria o backfill re-enfileirar a oferta indefinidamente.
  const negado = async () => {
    throw new Error(
      'Mercado Livre Multiget para MLB7681144154 retornou 403: ' +
        '{"id":"MLB7681144154","error":"access_denied","status":403}',
    );
  };
  const r = await hydrateExactItemPermalink(MLB, { getItem: negado });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.disposition, "NO_RETRY",
    "negação de permissão não pode ser retentável");
  assert.match(r.ok === false ? r.reason : "", /recusou ler/i);
  console.log(`  NO_RETRY: ${!r.ok ? r.reason.slice(0, 90) : ""}`);
}

console.log("--- 10e. 5xx/timeout continua RETRY ---");
{
  for (const msg of ["ETIMEDOUT", "HTTP 502", "rate limit 429", "fetch failed"]) {
    const r = await hydrateExactItemPermalink(MLB, {
      getItem: async () => {
        throw new Error(msg);
      },
    });
    assert.equal(r.ok === false && r.disposition, "RETRY", `msg: ${msg}`);
  }
  console.log("  4 falhas transitórias mantidas em RETRY");
}

console.log("--- 11. permalinkProvaAnuncio isolado ---");
{
  assert.equal(permalinkProvaAnuncio(
    "https://www.mercadolivre.com.br/X/MLB-7681144154-x-p/MLB25263382", MLB), true);
  assert.equal(permalinkProvaAnuncio(
    "https://www.mercadolivre.com.br/p/MLB25263382?pdp_filters=item_id:7681144154", MLB), true);
  assert.equal(permalinkProvaAnuncio(
    "https://www.mercadolivre.com.br/produto?item_id=MLB-7681144154", MLB), true);
  assert.equal(permalinkProvaAnuncio(
    "https://www.mercadolivre.com.br/p/MLB25263382", MLB), false);
  assert.equal(permalinkProvaAnuncio(
    "https://www.mercadolivre.com.br/X/MLB-1234567890-x-p/MLB25263382", MLB), false);
  console.log("  prova/recusa conferidas");
}

console.log("itemHydration.test.ts PASS");
