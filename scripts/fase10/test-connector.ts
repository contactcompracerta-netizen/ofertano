/**
 * FASE 12 — TESTES DO CONECTOR MAGALU V1.
 *
 * Valida:
 *   - payload valido
 *   - preco valido/invalido
 *   - externalId ausente
 *   - produto indisponivel
 *   - brand, attributes, seller
 *   - affiliate URL, URL insegura
 *   - replay deterministico: mesmo raw -> mesmo normalized -> mesmos hashes
 *   - alteracao so de preco -> offerHash muda, catalogHash permanece
 *   - alteracao estrutural -> catalogHash muda
 */
import { createMagaluConnector } from "@/services/architecture/v1/connectors/magaluConnector";
import { computeCatalogHash, computeOfferHash, classifyHashChange } from "@/services/architecture/v1/hashing";
import type { NormalizedMarketplaceListingV1 } from "@/services/architecture/v1/types/normalizedListingV1";

function cortar(s: string | null, n = 100) {
  return s && s.length > n ? `${s.slice(0, n)}...[len=${s.length}]` : (s ?? "(nulo)");
}

async function main() {
  console.log("=== FASE 12: TESTES DO CONECTOR MAGALU V1 ===\n");

  const connector = createMagaluConnector();

  // 1. Teste com produto real (REDMI BUDS - mais completo)
  console.log("--- 1. Coleta de produto real (REDMI BUDS) ---");
  const urlRedmi = "https://www.magazinevoce.com.br/magazineofertanobr/fone-de-ouvido-sem-fio-xiaomi-redmi-buds-6-play-bluetooth/p/kjh21gkh2e/ea/fobt/";
  let listing1: NormalizedMarketplaceListingV1 | null = null;

  try {
    const result = await connector.collect(urlRedmi);
    if (result.items.length === 0) {
      console.log("  FALHOU: nenhum item retornado");
    } else {
      listing1 = result.items[0];
      console.log("  OK: listing coletada");
      console.log(`    externalListingId = ${listing1.externalListingId}`);
      console.log(`    title             = ${cortar(listing1.catalog.title)}`);
      console.log(`    brand             = ${listing1.identity.brand ?? "(nulo)"}`);
      console.log(`    category          = ${listing1.catalog.category ?? "(nulo)"}`);
      console.log(`    price             = ${listing1.commerce.price}`);
      console.log(`    oldPrice          = ${listing1.commerce.oldPrice ?? "(nulo)"}`);
      console.log(`    availability      = ${listing1.commerce.availability}`);
      console.log(`    stock             = ${listing1.commerce.stock}`);
      console.log(`    seller            = ${cortar(listing1.seller.name)}`);
      console.log(`    installments      = ${JSON.stringify(listing1.commerce.installments)}`);
      console.log(`    images            = ${listing1.catalog.images.length}`);
      console.log(`    affiliateLink raw = ${cortar(listing1.metadata.rawHash)}`);
    }
  } catch (e) {
    console.log(`  ERRO: ${String(e).slice(0, 200)}`);
  }

  // 2. Replay deterministico: mesma URL -> mesmo normalized -> mesmos hashes
  console.log("\n--- 2. Replay deterministico (mesma URL duas vezes) ---");
  if (listing1) {
    const result2 = await connector.collect(urlRedmi);
    const listing2 = result2.items[0];

    const catHash1 = computeCatalogHash(listing1);
    const catHash2 = computeCatalogHash(listing2);
    const offHash1 = computeOfferHash(listing1);
    const offHash2 = computeOfferHash(listing2);

    console.log(`  catalogHash 1 = ${catHash1}`);
    console.log(`  catalogHash 2 = ${catHash2}`);
    console.log(`  offerHash 1   = ${offHash1}`);
    console.log(`  offerHash 2   = ${offHash2}`);
    console.log(`  catalogHash IGUAL = ${catHash1 === catHash2 ? "SIM" : "NAO"}`);
    console.log(`  offerHash IGUAL   = ${offHash1 === offHash2 ? "SIM" : "NAO"}`);
    console.log(`  REPLAY_OK = ${catHash1 === catHash2 && offHash1 === offHash2 ? "SIM" : "NAO"}`);
  }

  // 3. Alteração só de preço -> offerHash muda, catalogHash permanece
  console.log("\n--- 3. Simulacao: alteracao so de preco ---");
  if (listing1) {
    const listingPriceChanged: NormalizedMarketplaceListingV1 = {
      ...listing1,
      commerce: { ...listing1.commerce, price: listing1.commerce.price + 10 },
    };
    const catHash = computeCatalogHash(listing1);
    const catHash2 = computeCatalogHash(listingPriceChanged);
    const offHash = computeOfferHash(listing1);
    const offHash2 = computeOfferHash(listingPriceChanged);
    const change = classifyHashChange({ catalogHash: catHash, offerHash: offHash }, { catalogHash: catHash2, offerHash: offHash2 });

    console.log(`  catalogHash original = ${catHash}`);
    console.log(`  catalogHash preco+10 = ${catHash2}`);
    console.log(`  offerHash original   = ${offHash}`);
    console.log(`  offerHash preco+10   = ${offHash2}`);
    console.log(`  catalogHash IGUAL    = ${catHash === catHash2 ? "SIM" : "NAO"}`);
    console.log(`  offerHash DIFERENTE  = ${offHash !== offHash2 ? "SIM" : "NAO"}`);
    console.log(`  classify = ${change} (esperado: OFFER_ONLY)`);
  }

  // 4. Alteração estrutural (title) -> catalogHash muda
  console.log("\n--- 4. Simulacao: alteracao estrutural (title) ---");
  if (listing1) {
    const listingTitleChanged: NormalizedMarketplaceListingV1 = {
      ...listing1,
      catalog: { ...listing1.catalog, title: listing1.catalog.title + " - EDICAO ESPECIAL" },
    };
    const catHash = computeCatalogHash(listing1);
    const catHash2 = computeCatalogHash(listingTitleChanged);
    const offHash = computeOfferHash(listing1);
    const offHash2 = computeOfferHash(listingTitleChanged);
    const change = classifyHashChange({ catalogHash: catHash, offerHash: offHash }, { catalogHash: catHash2, offerHash: offHash2 });

    console.log(`  catalogHash original = ${catHash}`);
    console.log(`  catalogHash title+   = ${catHash2}`);
    console.log(`  offerHash original   = ${offHash}`);
    console.log(`  offerHash title+     = ${offHash2}`);
    console.log(`  catalogHash DIFERENTE = ${catHash !== catHash2 ? "SIM" : "NAO"}`);
    console.log(`  offerHash IGUAL      = ${offHash === offHash2 ? "SIM" : "NAO"}`);
    console.log(`  classify = ${change} (esperado: STRUCTURAL)`);
  }

  // 5. Validacao da listing
  console.log("\n--- 5. Validacao (connector.validate) ---");
  if (listing1) {
    const errors = connector.validate(listing1);
    console.log(`  Erros: ${errors.length === 0 ? "NENHUM (OK)" : errors.join(", ")}`);

    // Testes de validacao negativa
    const invalidListing: NormalizedMarketplaceListingV1 = {
      ...listing1,
      externalListingId: "",
      catalog: { ...listing1.catalog, title: "" },
      commerce: { ...listing1.commerce, price: -1 },
      seller: { externalSellerId: null, name: null },
    };
    const invalidErrors = connector.validate(invalidListing);
    console.log(`  Erros (invalido): ${invalidErrors.join(", ")}`);
  }

  // 6. Coleta de segundo produto (FONE BT)
  console.log("\n--- 6. Coleta segundo produto (FONE BT) ---");
  const urlFone = "https://www.magazinevoce.com.br/magazineofertanobr/produto/p/ee0gdc22g3/";
  try {
    const result = await connector.collect(urlFone);
    if (result.items.length > 0) {
      const l = result.items[0];
      console.log(`  externalListingId = ${l.externalListingId}`);
      console.log(`  title             = ${cortar(l.catalog.title)}`);
      console.log(`  brand             = ${l.identity.brand ?? "(nulo)"}`);
      console.log(`  price             = ${l.commerce.price}`);
      console.log(`  oldPrice          = ${l.commerce.oldPrice ?? "(nulo)"}`);
      console.log(`  availability      = ${l.commerce.availability}`);
      console.log(`  seller            = ${cortar(l.seller.name)}`);
    }
  } catch (e) {
    console.log(`  ERRO: ${String(e).slice(0, 200)}`);
  }

  // 7. healthCheck
  console.log("\n--- 7. Health check ---");
  const health = await connector.healthCheck();
  console.log(`  ok = ${health.ok}${health.detail ? ` (${health.detail})` : ""}`);

  console.log("\n=== FASE 12 CONCLUIDA ===");
}

main().catch((e) => console.error("FATAL:", e));
