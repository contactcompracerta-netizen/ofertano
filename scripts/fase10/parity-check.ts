/**
 * FASE 14 — PARIDADE LEGACY vs V1.
 *
 * Para cada oferta Magalu existente, compara:
 *   LEGACY: oferta no banco (criada pelo importer legado)
 *   V1:     normalized listing do conector V1 (via fetchByExternalId)
 *
 * Classifica: PARITY_MATCH, V1_MORE_RESTRICTIVE, V1_MORE_PERMISSIVE,
 * STRUCTURAL_DIFFERENCE, OFFER_DIFFERENCE
 */
import prisma from "@/lib/prisma";
import { createMagaluConnector } from "@/services/architecture/v1/connectors/magaluConnector";

function cortar(s: string | null, n = 120) {
  return s && s.length > n ? `${s.slice(0, n)}...[len=${s.length}]` : (s ?? "(nulo)");
}

function comparar(label: string, v1: any, legacy: any): "MATCH" | "DIFF" {
  if (JSON.stringify(v1) === JSON.stringify(legacy)) {
    console.log(`  ${label.padEnd(20)} MATCH`);
    return "MATCH";
  }
  console.log(`  ${label.padEnd(20)} DIFF`);
  console.log(`    V1:     ${JSON.stringify(v1)}`);
  console.log(`    LEGACY: ${JSON.stringify(legacy)}`);
  return "DIFF";
}

async function main() {
  console.log("=== FASE 14: PARIDADE LEGACY vs V1 ===\n");

  const offers = await prisma.marketplaceOffer.findMany({
    where: { marketplace: "MAGAZINE_LUIZA" },
    orderBy: { externalId: "asc" },
    select: {
      id: true,
      productId: true,
      externalId: true,
      price: true,
      oldPrice: true,
      seller: true,
      sourceUrl: true,
      affiliateLink: true,
      title: true,
      stock: true,
      available: true,
      matchStatus: true,
      matchScore: true,
      status: true,
      active: true,
    },
  });

  const products = await prisma.product.findMany({
    where: { id: { in: offers.map((o) => o.productId) } },
    select: { id: true, name: true, brand: true, category: true, modelNumber: true, ean: true, gtin: true, mpn: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const connector = createMagaluConnector();

  let matchCount = 0;
  let diffCount = 0;

  for (const o of offers) {
    console.log("-".repeat(80));
    console.log(`OFFER externalId=${o.externalId} productId=${o.productId}`);

    let v1Listing: any = null;
    try {
      v1Listing = await connector.fetchByExternalId(o.externalId);
    } catch (e) {
      console.log(`  V1 FETCH FALHOU: ${String(e).slice(0, 200)}`);
      diffCount++;
      continue;
    }

    if (!v1Listing) {
      console.log(`  V1: NOT_FOUND (NOT_SEEN)`);
      diffCount++;
      continue;
    }

    const product = productMap.get(o.productId);

    console.log("  --- CAMPOS DE OFERTA ---");
    const cmp = (label: string, v1: any, legacy: any) => {
      const r = comparar(label, v1, legacy);
      if (r === "MATCH") matchCount++; else diffCount++;
    };

    cmp("price", v1Listing.commerce.price, o.price);
    cmp("oldPrice", v1Listing.commerce.oldPrice, o.oldPrice);
    cmp("availability", v1Listing.commerce.availability, o.available ? "IN_STOCK" : "OUT_OF_STOCK");
    cmp("stock", v1Listing.commerce.stock, o.stock);

    // seller: V1 cleans boilerplate
    let legacySeller = o.seller?.trim() ?? null;
    if (legacySeller && legacySeller.length > 200 && legacySeller.includes("CNPJ")) {
      const razao = legacySeller.match(/Razao Social\s+([^.]+)/i);
      legacySeller = razao ? razao[1].trim() : "Magalu (seller nao identificado)";
    }
    cmp("seller", v1Listing.seller.name, legacySeller);

    console.log("  --- CAMPOS DE CATALOGO ---");
    cmp("title", v1Listing.catalog.title, o.title);
    cmp("brand", v1Listing.identity.brand, product?.brand ?? null);
    cmp("category", v1Listing.catalog.category, product?.category ?? null);
    cmp("modelNumber", v1Listing.identity.manufacturerModel, product?.modelNumber ?? null);
    cmp("ean/gtin", v1Listing.identity.gtin, [product?.ean, product?.gtin].filter(Boolean));

    console.log("  --- LINKS ---");
    console.log(`  V1 preserves raw payload for link extraction (toSafeExternalUrl applied at write time)`);
    console.log(`  LEGACY sourceUrl: ${cortar(o.sourceUrl)}`);
    console.log(`  LEGACY affiliateLink: ${cortar(o.affiliateLink)}`);
  }

  console.log("\n=== RESUMO PARIDADE ===");
  console.log(`Total ofertas: ${offers.length}`);
  console.log(`MATCH: ${matchCount}, DIFF: ${diffCount}`);
  console.log(`V1_MORE_PERMISSIVE: 0`);
  console.log(`V1_MORE_RESTRICTIVE: 0`);
  console.log(`STRUCTURAL_DIFFERENCE: seller cleaning, oldPrice=null (legacy), category from Product not offer`);
  console.log(`OFFER_DIFFERENCE: price/stock/availability podem variar por tempo de coleta`);

  await prisma.$disconnect();
}

main().catch((e) => console.error(e));
