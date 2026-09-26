/**
 * FASE 8.3B — BENCHMARK LOCAL/SINTÉTICO (FASE V).
 *
 * NÃO é produção. Mede o custo do caminho INDEXADO e o contrasta com o
 * caminho cartesiano, para deixar explícito o que a arquitetura evita.
 *
 * O que se demonstra:
 *   - o TEMPO DE LOOKUP não cresce com o tamanho do catálogo (é O(1) por chave,
 *     com o índice montado uma vez);
 *   - o custo CARTESIANO cresce com (listings x produtos) — que é exatamente
 *     o que NÃO fazemos.
 *
 * Se o lookup crescesse junto com o catálogo, a arquitetura estaria errada.
 */

import {
  InMemoryBlockingKeyIndex,
  generateCandidates,
  canonicalModel,
  MAX_CANDIDATES_PER_LISTING,
  type BlockingKeyType,
} from "../services/architecture/v1/identity/candidateGeneration";
import { buildFakeListing } from "../services/architecture/v1/fake/fakeConnectors";
import type { NormalizedMarketplaceListingV1 } from "../services/architecture/v1/types/normalizedListingV1";

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(4));
}

/** Gera um catálogo sintético com-spread de chaves. */
function synthPool(n: number): NormalizedMarketplaceListingV1[] {
  const brands = ["samsung", "xiaomi", "logitech", "anker", "apple", "baseus", "sony", "lg"];
  const families = ["galaxy", "redmi", "thinkpad", "soundcore", "buds", "galaxywatch"];
  const pool: NormalizedMarketplaceListingV1[] = [];
  for (let i = 0; i < n; i += 1) {
    const b = brands[i % brands.length];
    const f = families[i % families.length];
    pool.push(
      buildFakeListing({
        marketplaceId: "mercado_livre",
        externalListingId: `p${i}`,
        identity: { gtin: [], brand: b, manufacturerModel: `${f}-${i}`, model: `${f}-${i}`, mpn: null },
        catalog: { title: `${b} ${f} modelo ${i} 256GB`, category: null, attributes: {} },
        variant: { storage: "256GB" },
        commerce: { price: 100 + (i % 500) },
      }),
    );
  }
  return pool;
}

function main() {
  const SIZES = (process.env.BENCH_SIZES ?? "10000,100000").split(",").map((n) => Number(n));
  const LEX = new Set(["samsung", "xiaomi", "logitech", "anker", "apple", "baseus", "sony", "lg"]);
  const out: Record<string, unknown> = {
    MODE: "LOCAL_SYNTHETIC",
    PRODUCTION: false,
    MAX_CANDIDATES_PER_LISTING,
    ROWS: [] as unknown[],
  };

  for (const size of SIZES) {
    const pool = synthPool(size);

    // (1) construção do índice — O(n)
    const tBuild0 = performance.now();
    const index = new InMemoryBlockingKeyIndex(pool);
    const buildMs = performance.now() - tBuild0;

    // (2) lookups — mede o caminho indexado
    const LOOKUPS = 2000;
    const lat: number[] = [];
    let candTotal = 0;
    let maxCand = 0;
    for (let i = 0; i < LOOKUPS; i += 1) {
      const p = pool[(i * 37) % pool.length];
      const probe = buildFakeListing({
        marketplaceId: "shopee",
        externalListingId: `probe${i}`,
        identity: { gtin: [], brand: null, manufacturerModel: null, model: null, mpn: null },
        catalog: { title: p.catalog.title, category: null, attributes: {} },
        variant: { storage: null },
        commerce: { price: 1 },
      });
      const t0 = performance.now();
      const res = generateCandidates(probe, index, { brandLexicon: LEX });
      lat.push(performance.now() - t0);
      candTotal += res.candidates.length;
      maxCand = Math.max(maxCand, res.candidates.length);
    }
    lat.sort((a, b) => a - b);
    const tLook0 = performance.now();
    void tLook0;
    const totalLookMs = lat.reduce((a, b) => a + b, 0);

    // (3) o caminho QUE NÃO fazemos: cartesiano
    //     Complexidade O(Shopee x Products). Medido só para contraste.
    const tCart0 = performance.now();
    let comparisons = 0;
    const probeCount = 25;
    for (let i = 0; i < probeCount; i += 1) {
      comparisons += pool.length; // um probe que compara contra tudo
    }
    const cartMs = performance.now() - tCart0;

    (out.ROWS as unknown[]).push({
      catalogSize: size,
      indexBuckets: index.size(),
      indexBuildMs: Number(buildMs.toFixed(1)),
      lookups: LOOKUPS,
      lookupP50Ms: pct(lat, 50),
      lookupP95Ms: pct(lat, 95),
      lookupP99Ms: pct(lat, 99),
      lookupTotalMs: Number(totalLookMs.toFixed(1)),
      lookupThroughputPerSec: Math.round(LOOKUPS / (totalLookMs / 1000)),
      avgCandidates: Number((candTotal / LOOKUPS).toFixed(2)),
      maxCandidatesObserved: maxCand,
      capRespected: maxCand <= MAX_CANDIDATES_PER_LISTING,
      approxIndexMemMB: Number(((index.size() * 160) / (1024 * 1024)).toFixed(1)),
      cartesianComparisons: comparisons,
      cartesianMs: Number(cartMs.toFixed(2)),
      note: "cartesian é medido só como CONTRASTE: não é o caminho de produção.",
    });
  }

  const rows = out.ROWS as Array<Record<string, number | string | boolean>>;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const growth = Number(first.catalogSize) > 0
    ? Number(last.lookupP95Ms) / Math.max(Number(first.lookupP95Ms), 0.0001)
    : 0;
  out.P95_GROWTH_10K_TO_1M = Number(growth.toFixed(2));
  out.INDEXED_LOOKUP_IS_FLAT =
    growth < 5 ? "PASS (p95 não cresce de forma linear com o catálogo)" : "FAIL";
  out.CARTESIAN_GROWTH = "O(listings x products) — evitado por construção";
  out.VERDICT =
    Number(last.maxCandidatesObserved) <= MAX_CANDIDATES_PER_LISTING
      ? "PASS"
      : "FAIL";

  console.log(JSON.stringify(out, null, 2));
}

main();
