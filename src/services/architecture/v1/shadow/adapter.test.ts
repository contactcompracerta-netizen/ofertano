/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW LEGACY ADAPTER TESTS.
 *
 * Converte observações do fluxo REAL legado no contrato V1 sem efeitos:
 *  - marketplace desconhecido => null (fail-closed, identidade via registry);
 *  - mapeamento de campos (título, preço, estoque, disponibilidade, GTIN);
 *  - determinismo independente de chamadas.
 */
import assert from "node:assert/strict";
import {
  buildShadowListingFromRawRow,
  buildShadowListingFromSaveContext,
} from "./adapter";
import { resolveMarketplaceIdFromLegacyEnum } from "../marketplaceRegistry";

// --- Marketplace desconhecido => null (fail-closed) ------------------------
{
  const listing = buildShadowListingFromSaveContext({
    marketplace: "MERCADO_DO_FUTURO",
    externalId: "x1",
    sourceUrl: "https://example.com/x1",
    price: 10,
  });
  assert.equal(listing, null, "marketplace sem registro canônico => null");
}

// --- Mapeamento correto de um contexto de save -----------------------------
{
  const listing = buildShadowListingFromSaveContext({
    marketplace: "MERCADO_LIVRE",
    externalId: "ML123",
    sourceUrl: "https://produto.mercadolivre.com.br/ML123",
    title: "iPhone 16 128GB Preto",
    price: 4999.9,
    oldPrice: 5499.9,
    stock: 7,
    available: true,
    brand: "Apple",
    category: "Celulares",
    image: "https://img.example.com/iphone.jpg",
  });
  assert.ok(listing, "listing deve ser construída");
  assert.equal(listing.marketplaceId, "mercado_livre");
  assert.equal(listing.externalListingId, "ML123");
  assert.equal(listing.source, "legacy-save-product");
  assert.equal(listing.identity.brand, "Apple");
  assert.equal(listing.catalog.title, "iPhone 16 128GB Preto");
  assert.equal(listing.catalog.images[0], "https://img.example.com/iphone.jpg");
  assert.equal(listing.commerce.price, 4999.9);
  assert.equal(listing.commerce.oldPrice, 5499.9);
  assert.equal(listing.commerce.stock, 7);
  assert.equal(listing.commerce.availability, "IN_STOCK");
  assert.equal(
    listing.metadata.payloadVersion,
    "raw/v1",
    "payloadVersion descreve o schema do payload BRUTO (reprocessamento) — convenção V1 (DEFAULT_PAYLOAD_VERSION)",
  );
}

// --- Availability derivada --------------------------------------------------
{
  const unavailable = buildShadowListingFromSaveContext({
    marketplace: "SHOPEE",
    externalId: "S1",
    sourceUrl: "https://shopee.com.br/S1",
    price: 50,
    available: false,
  });
  assert.equal(
    unavailable?.commerce.availability,
    "OUT_OF_STOCK",
    "available=false => OUT_OF_STOCK",
  );

  const semPreco = buildShadowListingFromSaveContext({
    marketplace: "SHOPEE",
    externalId: "S2",
    sourceUrl: "https://shopee.com.br/S2",
    price: null,
  });
  assert.equal(
    semPreco?.commerce.price,
    0,
    "preço ausente => 0 (o gate de validação V1 rejeita INVALID_PRICE)",
  );
  assert.equal(
    semPreco?.commerce.availability,
    "UNAVAILABLE",
    "sem preço e sem available => UNAVAILABLE",
  );
}

// --- GTIN/EAN da linha RAW --------------------------------------------------
{
  const row = buildShadowListingFromRawRow({
    marketplace: "MAGAZINE_LUIZA",
    externalId: "MLZ-1",
    ean: "7891234567890",
    gtin: "7891234567890",
    price: 199.9,
    available: true,
  });
  assert.ok(row);
  assert.deepEqual(
    row.identity.gtin,
    ["7891234567890"],
    "GTIN deduplicado do ean/gtin",
  );

  const semGtin = buildShadowListingFromRawRow({
    marketplace: "SHOPEE",
    externalId: "S-1",
    price: 10,
  });
  assert.deepEqual(semGtin?.identity.gtin, [], "sem GTIN => []");
}

// --- Registry: identidade nunca é nome/URL ----------------------------------
{
  assert.equal(resolveMarketplaceIdFromLegacyEnum("MERCADO_LIVRE"), "mercado_livre");
  assert.equal(resolveMarketplaceIdFromLegacyEnum("CARREFOUR"), "carrefour");
  assert.equal(resolveMarketplaceIdFromLegacyEnum("NAO_EXISTE"), null);
}

// --- Determinismo (mesmo input, mesmo contrato) ------------------------------
{
  const a = buildShadowListingFromSaveContext({
    marketplace: "AMAZON",
    externalId: "ASIN123",
    sourceUrl: "https://amazon.com.br/dp/ASIN123",
    title: "Livro X",
    price: 89.9,
    brand: "Editora Y",
  });
  const rawA = JSON.stringify(a);
  const b = buildShadowListingFromSaveContext({
    marketplace: "AMAZON",
    externalId: "ASIN123",
    sourceUrl: "https://amazon.com.br/dp/ASIN123",
    title: "Livro X",
    price: 89.9,
    brand: "Editora Y",
  });
  const rawB = JSON.stringify(b);
  assert.equal(
    rawA,
    rawB,
    "mesmo contexto => mesmo contrato normalizado (sem timestamps de observação)",
  );
}

console.log("shadow/adapter.test.ts PASS");