import assert from "node:assert/strict";

import {
  extractMercadoLivreIdentities,
  extractMercadoLivreIdentitiesFromUrl,
  isListingId,
  isUserProductId,
  normalizeListingId,
  normalizeUserProductId,
} from "./mercadolivreIds";

const encoded = extractMercadoLivreIdentitiesFromUrl(
  "https://www.mercadolivre.com.br/produto/up/MLBU123456789?pdp_filters=item_id%3AMLB1967745737",
);
assert.equal(encoded.catalogIds.includes("MLBU123456789"), true);
assert.equal(encoded.userProductIds.includes("MLBU123456789"), true);
assert.equal(encoded.listingIds.includes("MLB1967745737"), true);
assert.equal(encoded.listingIds.includes("MLBU123456789"), false);
assert.equal(isUserProductId("MLBU123456789"), true);
assert.equal(isListingId("MLBU123456789"), false);
assert.equal(normalizeListingId("MLBU123456789"), null);
assert.equal(normalizeUserProductId("MLBU123456789"), "MLBU123456789");

const colonFilters = extractMercadoLivreIdentitiesFromUrl(
  "https://www.mercadolivre.com.br/produto/up/MLBU123456789?pdp_filters=item_id:MLB123456789",
);
assert.equal(colonFilters.listingIds.includes("MLB123456789"), true);

const itemIdQuery = extractMercadoLivreIdentitiesFromUrl(
  "https://www.mercadolivre.com.br/anuncio?item_id=MLB123456789",
);
assert.equal(itemIdQuery.listingIds.includes("MLB123456789"), true);

const widQuery = extractMercadoLivreIdentitiesFromUrl(
  "https://www.mercadolivre.com.br/anuncio?wid=MLB123456789",
);
assert.equal(widQuery.listingIds.includes("MLB123456789"), true);

const listingUrl = extractMercadoLivreIdentitiesFromUrl(
  "https://produto.mercadolivre.com.br/MLB-123456789-polia",
);
assert.equal(listingUrl.listingIds.includes("MLB123456789"), true);

const catalogPath = extractMercadoLivreIdentities(
  "https://www.mercadolivre.com.br/fones/p/MLB2102485316?wid=MLB4995511477",
);
assert.equal(catalogPath.listingIds.includes("MLB4995511477"), true);

const html = `
  <a href="https://www.mercadolivre.com.br/polia/up/MLBU123456789?pdp_filters=item_id%3AMLB1967745737">card</a>
`;
const fromHtml = extractMercadoLivreIdentities(html);
assert.equal(fromHtml.userProductIds.includes("MLBU123456789"), true);
assert.equal(fromHtml.listingIds.includes("MLB1967745737"), true);
assert.ok(
  !fromHtml.listingIds.includes("MLB123456789") || fromHtml.listingIds.includes("MLB1967745737"),
);

console.log("mercadolivre ids: extração de catalogo e listing passou");
