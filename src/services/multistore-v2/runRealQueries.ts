import "dotenv/config";
import { searchMultistoreV2 } from "./search";

const queries = [
  "JBL Tune 520BT",
  "panela de pressão 4,5L",
  "lapis",
  "Samsung Galaxy A55 256GB",
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
        marketplacesAttempted: result.marketplacesAttempted,
        marketplacesSucceeded: result.marketplacesSucceeded,
        rawCandidates: result.rawCandidates,
        relevantCandidates: result.relevantCandidates.length,
        clusters: result.products.length,
        multiStoreClusters: result.multiStoreClusters,
        singleStoreClusters: result.singleStoreClusters,
        discarded: result.acquisitions.flatMap((item) =>
          item.status === "SUCCESS"
            ? []
            : [
                `${item.marketplace}:${item.status}:${item.error ?? ""}`.slice(
                  0,
                  180,
                ),
              ],
        ),
        titles: result.products.slice(0, 8).map((product) => ({
          title: product.title,
          offers: product.offers.length,
          marketplaces: product.marketplaces,
          price: product.price,
        })),
        relevantTitles: result.relevantCandidates.slice(0, 12).map((item) => ({
          marketplace: item.normalized.raw.marketplace,
          title: item.normalized.raw.title,
          price: item.normalized.raw.price,
          reason: item.reason,
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
