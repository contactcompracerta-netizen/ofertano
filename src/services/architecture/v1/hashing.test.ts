/**
 * CATALOG_ARCHITECTURE_V1 — HASHING TESTS (puro-lógica, fora de npm test).
 *
 * CATALOG_HASH / OFFER_HASH / FAST_OFFER_PATH / SOURCE_LISTING_IDEMPOTENCY:
 *  - determinismo (mesmo conteúdo => mesmo hash, independente da ordem das chaves);
 *  - catalogHash muda somente com mudança ESTRUTURAL;
 *  - offerHash muda somente com mudança COMERCIAL;
 *  - classifyHashChange => STRUCTURAL | OFFER_ONLY | NOOP.
 */
import assert from "node:assert/strict";
import {
  canonicalJson,
  computeCatalogHash,
  computeOfferHash,
  computeRawHash,
  computeHashPair,
  classifyHashChange,
} from "./hashing";
import { buildFakeListing } from "./fake/fakeConnectors";

const base = buildFakeListing({
  marketplaceId: "MARKET_A",
  externalListingId: "a1",
  identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
  catalog: { title: "Smartphone Nova X 256GB Preto", category: "Celulares" },
  variant: { color: "Preto", storage: "256GB" },
  commerce: { price: 1999.9, stock: 42 },
});

// --- Determinismo -----------------------------------------------------------
{
  const listingA = buildFakeListing({
    marketplaceId: "MARKET_A",
    externalListingId: "a1",
    identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
    catalog: {
      title: "Smartphone Nova X 256GB Preto",
      category: "Celulares",
      attributes: { screen: "6.7\"", battery: "5000mAh" },
    },
    commerce: { price: 1999.9 },
  });
  const listingB = buildFakeListing({
    marketplaceId: "MARKET_A",
    externalListingId: "a1",
    identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
    catalog: {
      title: "Smartphone Nova X 256GB Preto",
      category: "Celulares",
      attributes: { battery: "5000mAh", screen: "6.7\"" },
    },
    commerce: { price: 1999.9 },
  });
  assert.equal(
    computeCatalogHash(listingA),
    computeCatalogHash(listingB),
    "catalogHash deve ser determinístico mesmo com ordem de chaves diferente",
  );
  assert.equal(
    computeOfferHash(listingA),
    computeOfferHash(listingB),
    "offerHash deve ser determinístico mesmo com ordem de chaves diferente",
  );
}

// --- canonicalJson estável ---------------------------------------------------
{
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson([3, 1, 2]), canonicalJson([3, 1, 2]));
  assert.notEqual(
    canonicalJson({ a: [1, 2] }),
    canonicalJson({ a: [2, 1] }),
    "array com ordem diferente NÃO é equal (ordem de array é semântica)",
  );
  assert.equal(canonicalJson(null), "null");
  assert.equal(canonicalJson(undefined), "__undefined__");
}

// --- STRUCTURAL vs OFFER_ONLY ------------------------------------------------
{
  const priceChange = buildFakeListing({
    marketplaceId: "MARKET_A",
    externalListingId: "a1",
    identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
    catalog: { title: "Smartphone Nova X 256GB Preto", category: "Celulares" },
    variant: { color: "Preto", storage: "256GB" },
    commerce: { price: 1899.9, stock: 42 },
  });

  assert.equal(
    computeCatalogHash(base),
    computeCatalogHash(priceChange),
    "mudança de preço NÃO altera catalogHash",
  );
  assert.notEqual(
    computeOfferHash(base),
    computeOfferHash(priceChange),
    "mudança de preço altera offerHash",
  );
}

{
  const titleChange = buildFakeListing({
    marketplaceId: "MARKET_A",
    externalListingId: "a1",
    identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
    catalog: { title: "Smartphone Nova X 512GB Preto", category: "Celulares" },
    variant: { color: "Preto", storage: "256GB" },
    commerce: { price: 1999.9, stock: 42 },
  });

  assert.notEqual(
    computeCatalogHash(base),
    computeCatalogHash(titleChange),
    "mudança estrutural (título) altera catalogHash",
  );
}

{
  const gtinChange = buildFakeListing({
    marketplaceId: "MARKET_A",
    externalListingId: "a1",
    identity: { gtin: ["7899999999999"], brand: "Nova", model: "Nova X" },
    catalog: { title: "Smartphone Nova X 256GB Preto", category: "Celulares" },
    variant: { color: "Preto", storage: "256GB" },
    commerce: { price: 1999.9, stock: 42 },
  });
  assert.notEqual(
    computeCatalogHash(base),
    computeCatalogHash(gtinChange),
    "mudança de GTIN (evidência de identidade) altera catalogHash",
  );
  assert.equal(
    computeOfferHash(base),
    computeOfferHash(gtinChange),
    "mudança de GTIN NÃO altera offerHash",
  );
}

// --- UNKNOWN != null != vazio ------------------------------------------------
{
  const listingA = buildFakeListing({
    marketplaceId: "MARKET_A",
    externalListingId: "a1",
    identity: { brand: "Nova", model: "Nova X" },
    catalog: { title: "X", category: "C" },
    commerce: { price: 10 },
  });
  const listingB = buildFakeListing({
    marketplaceId: "MARKET_A",
    externalListingId: "a1",
    identity: { brand: "Nova", model: "Nova X" },
    catalog: { title: "X", category: "C" },
    commerce: { price: 10 },
  });
  // UNKNOWN (não coletado) é igual a UNKNOWN, mas diferente de null (reportado vazio).
  assert.equal(
    computeCatalogHash(listingA),
    computeCatalogHash(listingB),
    "mesmo conteúdo => mesmo hash",
  );
}

// --- classifyHashChange ------------------------------------------------------
{
  const pair = computeHashPair(base, { id: "a1" });
  const same = { ...pair };
  assert.equal(
    classifyHashChange({ catalogHash: pair.catalogHash, offerHash: pair.offerHash }, same),
    "NOOP",
  );
  assert.equal(
    classifyHashChange(null, pair),
    "STRUCTURAL",
    "listing recém-chegada (sem hash anterior) => STRUCTURAL",
  );
  assert.equal(
    classifyHashChange(
      { catalogHash: pair.catalogHash, offerHash: "old-offer-hash" },
      pair,
    ),
    "OFFER_ONLY",
  );
  assert.equal(
    classifyHashChange(
      { catalogHash: "old-catalog-hash", offerHash: pair.offerHash },
      pair,
    ),
    "STRUCTURAL",
  );
}

// --- rawHash determinístico --------------------------------------------------
{
  assert.equal(
    computeRawHash({ a: 1, b: [2, 3] }),
    computeRawHash({ b: [2, 3], a: 1 }),
    "rawHash determinístico para payloads equivalentes",
  );
  assert.notEqual(
    computeRawHash({ a: 1 }),
    computeRawHash({ a: 2 }),
    "rawHash sensível ao conteúdo do payload",
  );
}

console.log("hashing.test.ts PASS");