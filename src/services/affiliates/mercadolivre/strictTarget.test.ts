/**
 * CONTRATO DE ALVO EXATO — testes puros, sem rede, sem Chrome, sem login.
 *
 * A validação estrita precisa ser testável ANTES da autenticação, porque é
 * justamente o que impede que o backfill grave link de anúncio errado. Se essa
 * regra só pudesse ser exercitada depois de autenticar, o primeiro uso real
 * dela seria em produção, com 22 linhas para desfazer.
 *
 * Os casos derivam da medição de produção: 12 das 22 ofertas ML têm
 * `externalId != catalogId`, e as 22 têm `sourceUrl` de catálogo
 * (`/p/MLB...`). Se `/p/` sozinho validasse, o sistema publicaria preço de
 * uma oferta sobre o link de outra.
 */
import assert from "node:assert/strict";

import {
  collectTargetEvidence,
  extrairItemIdsDosFiltros,
  extractCatalogMlId,
  extractExactItemMlId,
  validateExactOfferTarget,
} from "./strictTarget";

const ESPERADO = "MLB-7681144154";
const CATALOGO = "MLB-25263382";
const OUTRO = "MLB-1234567890";

const CATALOGO_URL = "https://www.mercadolivre.com.br/p/MLB25263382";
// Permalink real do ML: slug do anúncio com hífen + sufixo de catálogo.
const PERMALINK_ITEM =
  "https://www.mercadolivre.com.br/Notebook-X/MLB-7681144154-apple-15" +
  "-p/MLB25263382?wid=MLB-7681144154&item_id=MLB-7681144154";

console.log("--- 1. externalId == destino exato => PASS ---");
{
  const v = validateExactOfferTarget(PERMALINK_ITEM, ESPERADO);
  assert.equal(v.ok, true, `deveria passar: ${!v.ok ? v.reason : ""}`);
  assert.ok(v.ok && v.evidence.length > 0);
  console.log(`  ok via ${v.ok ? v.evidence.map((e) => e.via).join(",") : "?"}`);

  // Sem o sufixo de catálogo também é anúncio.
  const semCatalogo =
    "https://www.mercadolivre.com.br/Notebook-X/MLB-7681144154-apple-15";
  assert.equal(validateExactOfferTarget(semCatalogo, ESPERADO).ok, true);
}

console.log("--- 2. externalId != catalogId, destino só catálogo => FAIL ---");
{
  const v = validateExactOfferTarget(CATALOGO_URL, ESPERADO);
  assert.equal(v.ok, false, "catálogo não é anúncio");
  assert.equal(v.catalogOnly, true, "classificado como catalogOnly");
  assert.match(v.reason, /catálogo/i);
  assert.match(v.reason, new RegExp(ESPERADO), "motivo nomeia o anúncio esperado");
  console.log(`  rejeitado: ${v.reason}`);

  // Mesmo MLB nos dois, ainda é catálogo: este é o caso que a validação
  // anterior aceitava e que não pode passar.
  const mesmo = "https://www.mercadolivre.com.br/p/MLB7681144154";
  const v2 = validateExactOfferTarget(mesmo, ESPERADO);
  assert.equal(v2.ok, false, "/p/ com o MLB esperado ainda é catálogo");
  assert.equal(v2.catalogOnly, true);
  console.log(`  rejeitado mesmo com MLB igual: ${v2.reason}`);

  // Diferença de formato de MLB: com e sem hífen normalizam igual.
  const semHifen = "https://www.mercadolivre.com.br/p/MLB7681144154";
  const v3 = validateExactOfferTarget(semHifen, "MLB7681144154");
  assert.equal(v3.ok, false);
  assert.equal(v3.catalogOnly, true);
}

console.log("--- 3. catálogo + pdp_filters com item_id esperado => PASS ---");
{
  const destino =
    `${CATALOGO_URL}?pdp_filters=item_id%3A7681144154`;
  const v = validateExactOfferTarget(destino, ESPERADO);
  assert.equal(v.ok, true, `pdp_filters deveria provar: ${!v.ok ? v.reason : ""}`);
  console.log(`  ok via ${v.ok ? v.evidence[0].via : "?"}`);

  // Forma com prefixo MLB no filtro.
  const comPrefixo =
    `${CATALOGO_URL}?pdp_filters=item_id%3AMLB-7681144154`;
  assert.equal(validateExactOfferTarget(comPrefixo, ESPERADO).ok, true);

  // pdp_filters com prefixo de tipo (que é o formato real do ML).
  const realista =
    `${CATALOGO_URL}?pdp_filters=item_id:7681144154,sale_select:selecao`;
  assert.equal(validateExactOfferTarget(realista, ESPERADO).ok, true);

  // item_id de OUTRO anúncio no filtro não vale como prova.
  const outroAnuncio =
    `${CATALOGO_URL}?pdp_filters=item_id%3A1234567890`;
  const v3 = validateExactOfferTarget(outroAnuncio, ESPERADO);
  assert.equal(v3.ok, false, "filtro de outro anúncio não prova o esperado");
  console.log(`  rejeitado filtro alheio: ${v3.reason}`);
}

console.log("--- 4. destino para OUTRO MLB da mesma página de catálogo => FAIL ---");
{
  // Permalink de anúncio, mas o anúncio é outro.
  const outro =
    "https://www.mercadolivre.com.br/Notebook-Y/MLB-1234567890-outro" +
    "-p/MLB25263382";
  const v = validateExactOfferTarget(outro, ESPERADO);
  assert.equal(v.ok, false, "anúncio errado é falha mesmo sendo o mesmo produto");
  assert.match(v.reason, /outro anúncio/);
  console.log(`  rejeitado: ${v.reason}`);

  // Mesmo com pdp_filters do anúncio errado.
  const comFiltro =
    `${CATALOGO_URL}?pdp_filters=item_id%3A1234567890`;
  assert.equal(validateExactOfferTarget(comFiltro, ESPERADO).ok, false);
}

console.log("--- 5. fallback genérico => FAIL ---");
{
  const v = validateExactOfferTarget("https://meli.la/1i7Te2C", ESPERADO);
  assert.equal(v.ok, false);
  assert.match(v.reason, /genérico/i);
  console.log(`  rejeitado: ${v.reason}`);
}

console.log("--- 6. sourceUrl comum (catálogo) como afiliado => FAIL ---");
{
  const v = validateExactOfferTarget(CATALOGO_URL, ESPERADO);
  assert.equal(v.ok, false);
  // Confirma também a forma "produto" (não só /p/).
  const produto =
    "https://www.mercadolivre.com.br/Notebook-X/MLB-7681144154";
  assert.equal(validateExactOfferTarget(produto, ESPERADO).ok, true,
    "permalink de anúncio SEM meli.la é item válido (evidência) mas não é link de afiliado");
}

console.log("--- 7. redirect externo => FAIL ---");
{
  for (const host of [
    "https://meli.la.evil.example/p/MLB25263382",
    "https://bit.ly/abc",
    "https://mercadolivre.com.br.evil.test/MLB-7681144154",
    "https://a.mercadolivre.com.br.evil.test/MLB-7681144154",
  ]) {
    const v = validateExactOfferTarget(host, ESPERADO);
    assert.equal(v.ok, false, `deveria rejeitar host: ${host}`);
  }
  console.log("  rejeitados 4 hosts");

  // Host oficial com MLB correto passa (a forma canônica do link de afiliado).
  const oficial = "https://www.mercadolivre.com.br/MLB-7681144154-notebook";
  assert.equal(validateExactOfferTarget(oficial, ESPERADO).ok, true);
}

console.log("--- 8. oferta sem externalId não é aprovável ---");
{
  const v = validateExactOfferTarget(PERMALINK_ITEM, null);
  assert.equal(v.ok, false, "sem MLB esperado não há o que provar");
  assert.match(v.reason, /sem externalId/);
  const v2 = validateExactOfferTarget(PERMALINK_ITEM, "");
  assert.equal(v2.ok, false);
  const v3 = validateExactOfferTarget(PERMALINK_ITEM, "nao-e-mlb");
  assert.equal(v3.ok, false);
}

console.log("--- 9. destination vazio / não parseável ---");
{
  assert.equal(validateExactOfferTarget("", ESPERADO).ok, false);
  assert.equal(validateExactOfferTarget("   ", ESPERADO).ok, false);
  assert.equal(validateExactOfferTarget("javascript:alert(1)", ESPERADO).ok, false);
  assert.equal(validateExactOfferTarget("meli.la/1i7Te2C", ESPERADO).ok, false);
}

console.log("--- 10. extração: catálogo NÃO é extraído como anúncio ---");
{
  // A regressão central. `/p/` com o MESMO número não pode virar itemId.
  assert.equal(extractExactItemMlId(CATALOGO_URL), null);
  assert.equal(extractExactItemMlId("https://www.mercadolivre.com.br/p/MLB7681144154"), null);
  // Permalink com slug de anúncio: extrai o anúncio, não o catálogo.
  assert.equal(extractExactItemMlId(PERMALINK_ITEM), ESPERADO);
  assert.equal(extractCatalogMlId(PERMALINK_ITEM), CATALOGO);
  // Só parâmetros.
  assert.equal(
    extractExactItemMlId("https://www.mercadolivre.com.br/produto?item_id=MLB7681144154"),
    ESPERADO,
  );
  assert.equal(extractExactItemMlId("https://exemplo.test/nada"), null);
  console.log("  catálogo e anúncio separados");
}

console.log("--- 11. normalização de formato de MLB ---");
{
  for (const forma of ["MLB-7681144154", "MLB7681144154", "mlb-7681144154", "MLB_7681144154"]) {
    const v = validateExactOfferTarget(PERMALINK_ITEM, forma);
    assert.equal(v.ok, true, `forma ${forma} deveria normalizar`);
  }
  console.log("  4 formas normalizadas");
}

console.log("--- 12. helper de filtros ---");
{
  const ids = extrairItemIdsDosFiltros(
    "item_id:7681144154,sale_select:selecao,item_id:1234567890",
  );
  assert.deepEqual(ids, [ESPERADO, "MLB-1234567890"]);
  assert.deepEqual(extrairItemIdsDosFiltros("nada aqui"), []);
  console.log(`  extraídos: ${ids.join(", ")}`);
}

console.log("--- 13. evidência só quando o MLB bate ---");
{
  assert.equal(collectTargetEvidence(PERMALINK_ITEM, ESPERADO).length > 0, true);
  assert.equal(collectTargetEvidence(PERMALINK_ITEM, OUTRO).length, 0);
  assert.equal(collectTargetEvidence(CATALOGO_URL, ESPERADO).length, 0);
  console.log("  nenhuma evidência para MLB divergente");
}

console.log("strictTarget.test.ts PASS");
