/**
 * CATALOG_ARCHITECTURE_V1 — SYNTHETIC BENCHMARK (FASE V).
 *
 * Mede o pipeline V1 em memória (NUNCA toca produção/banco):
 *   - primeira ingestão (STRUCTURAL): items/sec;
 *   - re-entrega idêntica (NOOP idempotente): NOOP rate + duplicate_prevented;
 *   - atualização só de preço (OFFER_ONLY / FAST OFFER PATH): offer-only rate,
 *     com catalogHash COMPUTADO mas trabalho estrutural (hook) SKIPPED.
 *
 * Uso:
 *   npx tsx scripts/benchmark/architecture-v1-benchmark.ts            # 1k/10k/100k
 *   npx tsx scripts/benchmark/architecture-v1-benchmark.ts --sizes 1000,10000,100000
 *   npx tsx scripts/benchmark/architecture-v1-benchmark.ts --sizes 100000
 */
import { processNormalizedListing } from "../../src/services/architecture/v1/ingestion/pipeline";
import { InMemoryRawListingRepository } from "../../src/services/architecture/v1/fake/inMemoryRepositories";
import { CatalogMetrics } from "../../src/services/architecture/v1/observability/metrics";
import { computeCatalogHash, computeOfferHash } from "../../src/services/architecture/v1/hashing";
import { buildFakeListing } from "../../src/services/architecture/v1/fake/fakeConnectors";

type Timing = { n: number; ms: number; itemsPerSec: number };

function fmtBody(label: string, t: Timing): string {
  return `${label.padEnd(34)} n=${String(t.n).padStart(6)}  ${t.ms.toFixed(0).padStart(6)} ms  ${t.itemsPerSec.toFixed(0).padStart(9)} items/s`;
}

function now(): [number, number] {
  return process.hrtime();
}

function elapsed(start: [number, number], n: number): Timing {
  const [s, ns] = process.hrtime(start);
  const ms = s * 1000 + ns / 1e6;
  return { n, ms, itemsPerSec: n / (ms / 1000) };
}

function parseSizes(): number[] {
  const arg = process.argv.find((a) => a.startsWith("--sizes="))?.split("=")[1];
  if (arg) {
    return arg.split(",").map((v) => Number.parseInt(v, 10)).filter(Number.isFinite);
  }
  return [1000, 10_000, 100_000];
}

function makeListing(index: number, price: number, marketplaceId: string) {
  const model = `N${index % 7}`;
  return buildFakeListing({
    marketplaceId,
    externalListingId: `bench-${index}`,
    identity: { gtin: [`789000000${String(index % 9000 + 1000).padStart(4, "0")}`], brand: "BenchBrand", model },
    catalog: { title: `Produto de benchmark ${model} ${index}`, category: "Eletrônicos" },
    variant: { color: index % 2 === 0 ? "Preto" : "Branco", storage: "256GB" },
    commerce: { price, stock: 42 },
  });
}

async function run(): Promise<void> {
  const sizes = parseSizes();
  console.log(`CATALOG_ARCHITECTURE_V1_BENCHMARK sizes=${sizes.join(",")} start at ${new Date().toISOString()}`);

  for (const n of sizes) {
    const marketplaces = ["MARKET_A", "MARKET_B", "MARKET_C"];
    const repository = new InMemoryRawListingRepository();
    const metrics = new CatalogMetrics();

    let structuralHookCalls = 0;
    let offerHookCalls = 0;

    // FASE 1 — primeira ingestão (STRUCTURAL).
    const ctx = {
      repository,
      metrics,
      onStructural: async () => { structuralHookCalls += 1; },
      onOfferOnly: async () => { offerHookCalls += 1; },
    };
    const t1 = now();
    for (let i = 0; i < n; i += 1) {
      await processNormalizedListing(
        ctx,
        { listing: makeListing(i, 1999.9, marketplaces[i % marketplaces.length]), rawPayload: { i } },
      );
    }
    const structural = elapsed(t1, n);

    // FASE 2 — re-entrega idêntica (NOOP idempotente).
    const t2 = now();
    for (let i = 0; i < n; i += 1) {
      await processNormalizedListing(
        ctx,
        { listing: makeListing(i, 1999.9, marketplaces[i % marketplaces.length]), rawPayload: { i } },
      );
    }
    const noop = elapsed(t2, n);

    // FASE 3 — só preço muda (FAST OFFER PATH), structural hook deve ficar 0.
    const t3 = now();
    for (let i = 0; i < n; i += 1) {
      await processNormalizedListing(
        ctx,
        { listing: makeListing(i, 1899.9, marketplaces[i % marketplaces.length]), rawPayload: { i } },
      );
    }
    const offerOnly = elapsed(t3, n);

    const records = repository.allRecords().length;
    const noopRate = metrics.total("ingestion_noop_total") / (n * 3);
    const duplicatesPrevented = metrics.total("duplicate_prevented_total");
    const catalogHashChanges = metrics.total("catalog_hash_changed_total");

    console.log(`\n--- size ${n} ---`);
    console.log(fmtBody("structural (first ingest)", structural));
    console.log(fmtBody("noop (identical re-delivery)", noop));
    console.log(fmtBody("offer-only (price change)", offerOnly));
    console.log(`records=${records} (esperado ${n})  structuralHookCalls=${structuralHookCalls} (esperado ${n})  offerHookCalls=${offerHookCalls} (esperado ${n})`);
    console.log(`NOOP-rate=${(noopRate * 100).toFixed(1)}%  duplicate_prevented=${duplicatesPrevented}  catalog_hash_changed=${catalogHashChanges} (esperado ${n})`);
    console.log(`catalogHash skips no FAST OFFER PATH: ${offerHookCalls === n ? "OK" : `FALHA (${offerHookCalls}/${n})`}`);

    if (records !== n || structuralHookCalls !== n || offerHookCalls !== n || catalogHashChanges !== n) {
      throw new Error(`benchmark size ${n}: invariantes de contagem quebradas`);
    }

    // Confirma determinismo de hash na amostra (evidência G sem tocar produção).
    const sample = makeListing(3, 1999.9, "MARKET_A");
    const h1 = computeCatalogHash(sample);
    const changed = { ...sample, commerce: { ...sample.commerce, price: 1.0 } };
    if (computeCatalogHash(changed) !== h1) {
      throw new Error("catalogHash deveria IGNORAR preço nesta amostra (invariante G)");
    }
    if (computeOfferHash(sample) === computeOfferHash(changed)) {
      throw new Error("offerHash deveria mudar com o preço (invariante G)");
    }
  }

  console.log(`\nCATALOG_ARCHITECTURE_V1_BENCHMARK done at ${new Date().toISOString()}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});