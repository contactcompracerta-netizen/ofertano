import { searchMultistoreV2 } from "./search";

const queries = [
  "JBL Tune 520BT",
  "Kemei KM-1995",
  "Panela de pressao 4,5L",
  "Mesa de cabeceira 2 gavetas retro",
  "Estojo JBL Tune 520BT",
  "lapis",
  "iphone 18 pro max",
];

async function main() {
  for (const query of queries) {
    console.log("\n========== REAL QUERY:", query, "==========");
    const started = Date.now();

    try {
      const result = await searchMultistoreV2(query, {
        persist: false,
        limit: 8,
      });

      console.log("[MULTISTORE-V2] real-summary", {
        query,
        elapsedMs: Date.now() - started,
        marketplaces: result.acquisitions.map((item) => ({
          marketplace: item.marketplace,
          status: item.status,
          raw: item.raw,
          usable: item.usable,
          error: item.error,
        })),
        rawCandidates: result.rawCandidates,
        relevantCandidates: result.relevantCandidates.length,
        clusters: result.products.length,
        multiStoreClusters: result.multiStoreClusters,
        singleStoreClusters: result.singleStoreClusters,
        titles: result.products.slice(0, 8).map((product) => ({
          title: product.title,
          offers: product.offers.length,
          marketplaces: product.marketplaces,
          price: product.price,
        })),
      });
    } catch (error) {
      console.error("[MULTISTORE-V2] real-error", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

void main();
