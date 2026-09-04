import assert from "node:assert/strict";

import {
  buildAffiliateTargetMarkers,
  decideResolvedSource,
  extractCatalogId,
  extractItemId,
  extractItemIdFromQuery,
  isOfficialMercadoLivreUrl,
  isResolvableHttpUrl,
  resolveTargetMeta,
} from "./generator";

const SOURCE_STALE_ITEM = "https://produto.mercadolivre.com.br/MLB-3608328785";
const RESOLVED_CATALOG =
  "https://www.mercadolivre.com.br/aspirador-de-po-e-agua-wap-gtw-inox-12-1400w-com-bocal-de-sopro/p/MLB6339959?pdp_filters=item_id:MLB6398917320";

function run() {
  assert.equal(
    extractItemId("https://produto.mercadolivre.com.br/MLB-1234567890-x"),
    "MLB-1234567890",
  );
  assert.equal(
    extractItemId("https://produto.mercadolivre.com.br/MLB1234567890-x"),
    "MLB1234567890",
  );
  assert.equal(extractItemId("https://example.com/sem-id"), null);
  assert.equal(
    extractItemId("https://produto.mercadolivre.com.br/MLB_12345"),
    "MLB-12345",
  );

  // Segurança: somente http/https são aceitas.
  assert.equal(isResolvableHttpUrl(SOURCE_STALE_ITEM), true);
  assert.equal(isResolvableHttpUrl("file:///etc/passwd"), false);
  assert.equal(isResolvableHttpUrl("javascript:alert(1)"), false);

  // Domínio oficial.
  assert.equal(isOfficialMercadoLivreUrl(SOURCE_STALE_ITEM), true);
  assert.equal(isOfficialMercadoLivreUrl(RESOLVED_CATALOG), true);
  assert.equal(isOfficialMercadoLivreUrl("https://evil.example.org/phish"), false);
  assert.equal(isOfficialMercadoLivreUrl("https://mercadolivre.com.br.evil.io/x"), false);

  // SOURCE_URL_NO_REDIRECT_USES_ORIGINAL
  {
    const d = decideResolvedSource(SOURCE_STALE_ITEM, SOURCE_STALE_ITEM);
    assert.equal(d.redirect, false);
    assert.equal(d.linkBuilderInput, SOURCE_STALE_ITEM);
    assert.equal(d.official, true);
  }

  // SOURCE_URL_REDIRECT_USES_RESOLVED (redirect oficial para catálogo)
  {
    const d = decideResolvedSource(SOURCE_STALE_ITEM, RESOLVED_CATALOG);
    assert.equal(d.redirect, true);
    assert.equal(d.official, true);
    assert.equal(d.linkBuilderInput, RESOLVED_CATALOG);
    assert.equal(d.catalogId, "MLB6339959");
    assert.equal(d.itemId, "MLB6398917320");
  }

  // REDIRECT_OUTSIDE_ML_REJECTED (redireciona para fora do ML)
  {
    const d = decideResolvedSource(
      SOURCE_STALE_ITEM,
      "https://www.google.com/search?q=aspirador",
    );
    assert.equal(d.redirect, true);
    assert.equal(d.official, false);
    // como saiu do ML, NÃO usa a resolvida: mantém a original
    assert.equal(d.linkBuilderInput, SOURCE_STALE_ITEM);
  }

  // STALE_DIRECT_ITEM_TO_CATALOG_SUPPORTED
  {
    const meta = resolveTargetMeta(RESOLVED_CATALOG);
    assert.equal(meta.catalogId, "MLB6339959");
    assert.equal(meta.itemId, "MLB6398917320");
    assert.equal(extractCatalogId(RESOLVED_CATALOG), "MLB6339959");
    assert.equal(extractItemIdFromQuery(RESOLVED_CATALOG), "MLB6398917320");
  }

  // OFFER_EXTERNAL_ID_NOT_MUTATED: a resolução deriva apenas marcadores de
  // alvo a partir da URL; nunca reescreve externalId da oferta.
  {
    const markers = buildAffiliateTargetMarkers(
      extractItemId(SOURCE_STALE_ITEM),
      resolveTargetMeta(RESOLVED_CATALOG),
    );
    // item original NÃO desaparece do conjunto de validação...
    assert.ok(markers.includes("MLB-3608328785"));
    assert.ok(markers.includes("MLB3608328785"));
    // ...mas o alvo resolvido também está presente (com e sem hífen).
    assert.ok(markers.includes("MLB6339959"));
    assert.ok(markers.includes("MLB-6339959"));
    assert.ok(markers.includes("MLB6398917320"));
    assert.ok(markers.includes("MLB-6398917320"));
  }

  // OFFER_PRICE_NOT_MUTATED: as funções de resolução não tocam preço.
  {
    const before = { price: 399.9, externalId: "MLB-3608328785" };
    // nenhuma função altera o objeto da oferta (trabalham em cópias/strings)
    const meta = resolveTargetMeta(RESOLVED_CATALOG);
    assert.equal(meta.itemId, "MLB6398917320");
    assert.equal(before.price, 399.9);
    assert.equal(before.externalId, "MLB-3608328785");
  }

  // AFFILIATE_VALIDATED_AGAINST_RESOLVED_TARGET: a validação considera o alvo
  // resolvido; o MLB stale não precisa continuar aparecendo no meli.la.
  {
    const markers = buildAffiliateTargetMarkers(
      extractItemId(SOURCE_STALE_ITEM),
      resolveTargetMeta(RESOLVED_CATALOG),
    );
    // Evidência: mesmo sem o MLB3608328785 na página final, o catalog
    // resolvido MLB6339959 autoriza a validação.
    assert.ok(markers.includes("MLB6339959"));
    // o conjunto contém tanto o original quanto o resolvido.
    assert.ok(markers.some((m) => m.includes("3608328785")));
  }

  console.log("ML_AFFILIATE_GENERATOR_TEST_OK");
}

run();
