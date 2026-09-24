/**
 * CATALOG_ARCHITECTURE_V1 — CATALOG PROJECTION TESTS (puro-lógica).
 *
 * NORMALIZED_LISTING_V1: projeção determinística do COLLECTION PATH:
 *  - catalogKey/variantKey determinísticos a partir da IDENTIDADE (nunca listing);
 *  - agrupamento multiloja: ofertas de marketplaces DISTINTOS no mesmo grupo;
 *  - ofertas do MESMO marketplace contam 1 (invariante multiloja).
 */
import assert from "node:assert/strict";
import {
  projectCatalogEntry,
  groupProjectedEntries,
  catalogKeyFromListing,
  variantKeyFromListing,
} from "./catalogProjection";
import { computeCatalogHash, computeOfferHash } from "./hashing";
import { buildFakeListing } from "./fake/fakeConnectors";

// Dois marketplaces com o MESMO produto (identidade igual) => mesmo catalogKey.
{
  const a1 = buildFakeListing({
    marketplaceId: "MARKET_A",
    externalListingId: "a1",
    identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
    catalog: { title: "Smartphone Nova X 256GB Preto", category: "Celulares" },
    variant: { color: "Preto", storage: "256GB" },
    commerce: { price: 1999.9 },
  });
  const b1 = buildFakeListing({
    marketplaceId: "MARKET_B",
    externalListingId: "b1",
    identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
    catalog: { title: "Smartphone Nova X 256GB - Oferta B", category: "Celulares" },
    variant: { color: "Preto", storage: "256GB" },
    commerce: { price: 2049.9 },
  });
  assert.equal(
    catalogKeyFromListing(a1),
    catalogKeyFromListing(b1),
    "identidade estruturais iguais => mesmo catalogKey (diferente marketplace)",
  );
  assert.equal(
    variantKeyFromListing(a1),
    variantKeyFromListing(b1),
    "variantes iguais => mesmo variantKey",
  );
}

// Variante diferente => variantKey diferente.
{
  const preto = buildFakeListing({
    marketplaceId: "MARKET_A",
    externalListingId: "a1",
    identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
    catalog: { title: "Smartphone Nova X", category: "Celulares" },
    variant: { color: "Preto", storage: "256GB" },
    commerce: { price: 1999.9 },
  });
  const branco = buildFakeListing({
    marketplaceId: "MARKET_A",
    externalListingId: "a2",
    identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
    catalog: { title: "Smartphone Nova X", category: "Celulares" },
    variant: { color: "Branco", storage: "256GB" },
    commerce: { price: 2019.9 },
  });
  assert.notEqual(variantKeyFromListing(preto), variantKeyFromListing(branco));
}

// Projeção de entry.
{
  const listing = buildFakeListing({
    marketplaceId: "MARKET_A",
    externalListingId: "a1",
    seller: { externalSellerId: "s-a-1" },
    identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
    catalog: { title: "Smartphone Nova X 256GB Preto", category: "Celulares" },
    variant: { color: "Preto", storage: "256GB" },
    commerce: { price: 1999.9, stock: 42 },
  });
  const catalogHash = computeCatalogHash(listing);
  const offerHash = computeOfferHash(listing);
  const entry = projectCatalogEntry(listing, catalogHash, offerHash);
  assert.equal(entry.catalogKey, catalogKeyFromListing(listing));
  assert.equal(entry.offer.marketplaceId, "MARKET_A");
  assert.equal(entry.offer.externalListingId, "a1");
  assert.equal(entry.offer.sellerExternalId, "s-a-1");
  assert.equal(entry.offer.price, 1999.9);
  assert.equal(entry.offer.offerHash, offerHash);
  assert.equal(entry.catalogHash, catalogHash);
}

// Agrupamento multiloja: MARKET_A + MARKET_B no mesmo grupo => publicMarketplaceCount >= 2.
{
  const make = (marketplaceId: string, externalListingId: string, price: number) => {
    const listing = buildFakeListing({
      marketplaceId,
      externalListingId,
      identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
      catalog: { title: "Smartphone Nova X 256GB", category: "Celulares" },
      variant: { color: "Preto", storage: "256GB" },
      commerce: { price },
    });
    return listing;
  };
  const entries = [
    make("MARKET_A", "a1", 1999.9),
    make("MARKET_A", "a2", 2019.9),
    make("MARKET_B", "b1", 2049.9),
  ].map((listing) => projectCatalogEntry(listing, computeCatalogHash(listing), computeOfferHash(listing)));

  const groups = groupProjectedEntries(entries);
  assert.equal(groups.length, 1, "mesmo produto+variante agrupa numa única entrada de catálogo");
  const group = groups[0];
  assert.equal(group.offers.length, 3);
  const distinctMarketplaces = new Set(group.offers.map((o) => o.marketplaceId)).size;
  assert.equal(distinctMarketplaces, 2, "2 marketplaces distintos => multiloja real");
}

console.log("catalogProjection.test.ts PASS");