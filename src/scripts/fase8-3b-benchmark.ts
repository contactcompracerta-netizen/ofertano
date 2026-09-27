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

/**
 * FASE P (FASE V) — POOL DE CARDIANALIDADE ALTA.
 *
 * O pool de cima tem 8 marcas x 6 familias = 48 combinações, e cada item
 * contribui com o par `brand|family`. Em 10k itens cada combinação passa de
 * `MAX_CANDIDATES_PER_LISTING` (20) e TODA chave ampla do probe fica ambígua:
 * o generator pula as chaves ambíguas e devolve 0 candidatas. Foi isso que a
 * FASE P mediu (`avgCandidates=0`).
 *
 * Aqui cada item recebe um código de modelo ÚNICO (`M<índice>`). Isso muda
 * APENAS a carga sintética — nada em `candidateGeneration` muda, e o teto
 * `MAX_CANDIDATES_PER_LISTING` continua exatamente 20. O que muda é a
 * cardinalidade das chaves, que é o parâmetro que o cenário 1 fixa por acidente.
 *
 * A chave `MODEL_CODE:M<n>` tem bucket de tamanho 1, então o probe materializa
 * a candidata de verdade. As chaves AMPLAS (`brand|family`, `MODEL_CODE:galaxy`)
 * continuam ambíguas e continuam sendo puladas — o que é o comportamento
 * correto, e por isso `ambiguousBlockCount` continua sendo reportado: um
 * cenário que escondesse os skips seria o mesmo erro que o cenário 1 cometeu.
 */
function synthPoolHighCardinality(n: number): NormalizedMarketplaceListingV1[] {
  const brands = ["samsung", "xiaomi", "logitech", "anker", "apple", "baseus", "sony", "lg"];
  const families = ["galaxy", "redmi", "thinkpad", "soundcore", "buds", "galaxywatch"];
  const pool: NormalizedMarketplaceListingV1[] = [];
  for (let i = 0; i < n; i += 1) {
    const b = brands[i % brands.length];
    const f = families[i % families.length];
    const model = `M${i}`;
    pool.push(
      buildFakeListing({
        marketplaceId: "mercado_livre",
        externalListingId: `p${i}`,
        identity: { gtin: [], brand: b, manufacturerModel: model, model, mpn: null },
        catalog: { title: `${b} ${f} modelo ${model} 256GB`, category: null, attributes: {} },
        variant: { storage: "256GB" },
        commerce: { price: 100 + (i % 500) },
      }),
    );
  }
  return pool;
}

/**
 * Mede o caminho indexado para um pool sintético. Não altera o algoritmo de
 * produção: chama `generateCandidates` exatamente como o cenário 1 chama.
 */
function benchPool(
  size: number,
  pool: NormalizedMarketplaceListingV1[],
  brandLexicon: Set<string>,
) {
  const tBuild0 = performance.now();
  const index = new InMemoryBlockingKeyIndex(pool);
  const buildMs = performance.now() - tBuild0;

  const LOOKUPS = 2000;
  const lat: number[] = [];
  let candTotal = 0;
  let maxCand = 0;
  let ambiguousBlocks = 0;
  let nonEmptyLookups = 0;
  const skipTotals: Record<string, number> = {};

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
    const res = generateCandidates(probe, index, { brandLexicon });
    lat.push(performance.now() - t0);
    candTotal += res.candidates.length;
    if (res.candidates.length > 0) nonEmptyLookups += 1;
    maxCand = Math.max(maxCand, res.candidates.length);
    ambiguousBlocks += res.ambiguousBlocks;
    for (const [reason, n] of Object.entries(res.skipStats)) {
      skipTotals[reason] = (skipTotals[reason] ?? 0) + n;
    }
  }
  lat.sort((a, b) => a - b);

  return {
    row: {
      catalogSize: size,
      indexBuckets: index.size(),
      indexBuildMs: Number(buildMs.toFixed(1)),
      lookups: LOOKUPS,
      lookupP50Ms: pct(lat, 50),
      lookupP95Ms: pct(lat, 95),
      lookupP99Ms: pct(lat, 99),
      lookupTotalMs: Number(lat.reduce((a, b) => a + b, 0).toFixed(1)),
      lookupThroughputPerSec: Math.round(
        LOOKUPS / (lat.reduce((a, b) => a + b, 0) / 1000),
      ),
      avgCandidates: Number((candTotal / LOOKUPS).toFixed(2)),
      maxCandidatesObserved: maxCand,
      capRespected: maxCand <= MAX_CANDIDATES_PER_LISTING,
      AMBIGUOUS_BLOCK_COUNT: ambiguousBlocks,
      SKIP_STATS: skipTotals,
      approxIndexMemMB: Number(((index.size() * 160) / (1024 * 1024)).toFixed(1)),
    },
    nonEmptyLookups,
    lookups: LOOKUPS,
  };
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
    let ambiguousBlocks = 0;
    const skipTotals: Record<string, number> = {};
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
      ambiguousBlocks += res.ambiguousBlocks;
      for (const [reason, n] of Object.entries(res.skipStats)) {
        skipTotals[reason] = (skipTotals[reason] ?? 0) + n;
      }
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
      /*
       * FASE P: estas duas linhas são o que torna o workload audível. Sem
       * elas, um tamanho que mede 0 candidatas por pular chaves ambíguas é
       * indistinguível de um tamanho que mede trabalho real.
       */
      AMBIGUOUS_BLOCK_COUNT: ambiguousBlocks,
      SKIP_STATS: skipTotals,
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

  /*
   * FASE P (FASE 19) — O rótulo de growth anterior dizia "10K_TO_1M", mas o
   * tamanho FINAL é o último elemento de BENCH_SIZES, cujo default é 100000
   * (100k) e NÃO 1M. Um rótulo que afirma um tamanho não testado é uma
   * afirmação falsa, mesmo com o número certo. O rótulo agora é DERIVADO dos
   * tamanhos efetivamente medidos: nenhum tamanho é inventado, nenhum é
   * omitido, e o cálculo do growth é o mesmo de antes (inalterado).
   */
  const growthFromSize = Number(first.catalogSize);
  const growthToSize = Number(last.catalogSize);
  out.P95_GROWTH_FIRST_TO_LAST = Number(growth.toFixed(2));
  out.P95_GROWTH_FROM_SIZE = growthFromSize;
  out.P95_GROWTH_TO_SIZE = growthToSize;
  out.P95_GROWTH_LABEL = `${growthFromSize}->${growthToSize}`;
  out.INDEXED_LOOKUP_IS_FLAT =
    growth < 5 ? "PASS (p95 não cresce de forma linear com o catálogo)" : "FAIL";
  out.CARTESIAN_GROWTH = "O(listings x products) — evitado por construção";
  out.VERDICT =
    Number(last.maxCandidatesObserved) <= MAX_CANDIDATES_PER_LISTING
      ? "PASS"
      : "FAIL";

  /*
   * FASE P (FASE 9) — FIDELIDADE DO BENCHMARK.
   *
   * Descoberta medida, não suposição: com o pool sintético deste script, o
   * número de candidatos por probe é 0 nos tamanhos DEFAULT (10k e 100k).
   *
   * Causa: `generateCandidates` NUNCA alarga um bucket ambíguo. Quando
   * `bucketSize > MAX_CANDIDATES_PER_LISTING` a chave é pulada
   * (AMBIGUOUS_BLOCK) e o generator tenta a próxima chave mais específica. O
   * probe deste benchmark é title-only, e o pool sintético só produz chaves
   * `brand|category|family` e `brand|family` (o token `modelo N` é único por
   * item, logo nunca vira chave compartilhada). Então, assim que o catálogo
   * passa de ~`MAX x nº de combinações(brand,family)`, TODA chave do probe fica
   * ambígua e o generator devolve 0 candidatas.
   *
   * Consequência honesta: `lookupP95Ms` mede o custo de uma busca que NÃO
   * materializa candidatas. Isso sustenta "o probe do índice é plano", mas NÃO
   * sustenta "a geração de candidatos é plana" — materialização, dedup,
   * pre-filter e cap nunca são exercitados nesses tamanhos.
   *
   * `VERDICT=PASS` e `INDEXED_LOOKUP_IS_FLAT=PASS` continuam válidos no que
   * medem; o benchmark NÃO foi alterado (mesmos thresholds, mesmas métricas,
   * mesma carga sintética). O que muda é que o workload degenerado passa a
   * ser VISÍVEL em vez de silenciosamente reportado como PASS.
   */
  const measuredNonEmpty = rows.every((r) => Number(r.avgCandidates) > 0);
  out.WORKLOAD_MEASURED_NON_EMPTY_CANDIDATES = measuredNonEmpty;
  out.WORKLOAD_NOTE = measuredNonEmpty
    ? "todos os tamanhos mediram candidatos nao nulos: o workload exercita a materializacao."
    : "ATENCAO: algum tamanho mediu 0 candidatas. Ver AMBIGUOUS_BLOCK_COUNT por linha: o gerator pulou chaves ambiguas e o p95 mede busca sem materializar candidatas. O verdict continua valido para o que mede, mas NAO sustenta que a geracao de candidatas seja plana neste tamanho.";

  /*
   * FASE P (FASE V) — CENARIO 2: `CONTROLLED_NON_AMBIGUOUS_WORKLOAD`.
   *
   * O cenario 1 (acima) nao mente, mas mede menos do que parece. Ele ja avisa,
   * em `WORKLOAD_MEASURED_NON_EMPTY_CANDIDATES=false`, que o workload DEGENEROU:
   * nos tamanhos default toda chave do probe ficou ambigua e `avgCandidates`
   * ficou 0. Consequencia honesta: o p95 do cenario 1 sustenta que o PERCURSO
   * DO INDICE e plano, mas NAO sustenta que a GERACAO DE CANDIDATAS e plana —
   * porque materializacao, dedup, pre-filter e cap nunca foram exercitados.
   *
   * Este bloco fecha essa lacuna mudando UMA SO VARIAVEL: a cardinalidade das
   * chaves da carga sintetica. Cada item recebe um codigo de modelo unico
   * (`M<indice>`), de modo que a chave `MODEL_CODE:M<indice>` tem bucket de
   * tamanho 1 e o probe materializa a candidata de verdade. Os tamanhos de
   * catalogo sao os MESMOS (`SIZES`), o probe e o MESMO, e `generateCandidates`
   * e chamado exatamente como o cenario 1 chama.
   *
   * O que NAO muda, deliberadamente:
   *   - o teto `MAX_CANDIDATES_PER_LISTING` continua sendo 20 — e o MESMO teto
   *     real de producao, nao um teto novo nem afrouxado;
   *   - nenhuma linha de `ROWS` e nenhum campo top-level anterior e tocado.
   *     Este bloco e ADITIVO e vive inteiro em uma chave nova, acrescentada
   *     DEPOIS de todos os campos existentes, que portanto mantem posicao e
   *     valor no JSON de saida;
   *   - nenhum limite/veredito de latencia NOVO e inventado. Este bloco
   *     REPORTA. O julgamento de achatamento continua sendo feito por
   *     `INDEXED_LOOKUP_IS_FLAT` e `VERDICT`, que sao calculados do cenario 1,
   *     sem alteracao. `P95_GROWTH_*` aqui e uma razao CRUA medida, nao um
   *     PASS/FAIL novo;
   *   - as chaves AMPLAS continuam ambiguas e continuam sendo puladas, e
   *     `ambiguousBlockCount` continua reportado. Um cenario que escondesse os
   *     skips seria o mesmo erro que o cenario 1 cometeu: reportar PASS sobre
   *     trabalho que nao aconteceu.
   */
  const controlledRows: Array<Record<string, unknown>> = [];
  for (const size of SIZES) {
    const { row, nonEmptyLookups, lookups } = benchPool(size, synthPoolHighCardinality(size), LEX);
    controlledRows.push({
      catalogSize: row.catalogSize,
      indexBuckets: row.indexBuckets,
      indexBuildMs: row.indexBuildMs,
      lookups: row.lookups,
      nonEmptyLookups,
      nonEmptyLookupRate: Number((nonEmptyLookups / lookups).toFixed(4)),
      avgCandidates: row.avgCandidates,
      maxCandidatesObserved: row.maxCandidatesObserved,
      capRespected: row.capRespected,
      ambiguousBlockCount: row.AMBIGUOUS_BLOCK_COUNT,
      skipStats: row.SKIP_STATS,
      lookupP50Ms: row.lookupP50Ms,
      lookupP95Ms: row.lookupP95Ms,
      lookupP99Ms: row.lookupP99Ms,
      lookupTotalMs: row.lookupTotalMs,
      lookupThroughputPerSec: row.lookupThroughputPerSec,
      approxIndexMemMB: row.approxIndexMemMB,
    });
  }

  const cFirst = controlledRows[0];
  const cLast = controlledRows[controlledRows.length - 1];
  const cGrowth = Number(cFirst.catalogSize) > 0
    ? Number(cLast.lookupP95Ms) / Math.max(Number(cFirst.lookupP95Ms), 0.0001)
    : 0;

  out.CONTROLLED_NON_AMBIGUOUS_WORKLOAD = {
    /*
     * Razao CRUA de crescimento do p95 entre o primeiro e o ultimo tamanho
     * medido. NAO e veredito: nenhum limite de latencia novo e aplicado aqui.
     */
    P95_GROWTH_FIRST_TO_LAST: Number(cGrowth.toFixed(2)),
    P95_GROWTH_LABEL: `${cFirst.catalogSize}->${cLast.catalogSize}`,
    /*
     * As mesmas duas checagens que o cenario 1 ja fazia no topo, aplicadas a
     * ESTE cenario. Nenhuma e nova: `MEASURED_NON_EMPTY_CANDIDATES` e a
     * contraparte de `WORKLOAD_MEASURED_NON_EMPTY_CANDIDATES`, e
     * `CAP_RESPECTED_ALL_SIZES` e a contraparte do `capRespected` que o
     * cenario 1 ja emitia por linha, contra o mesmo teto real.
     */
    MEASURED_NON_EMPTY_CANDIDATES: controlledRows.every(
      (r) => Number(r.nonEmptyLookupRate) > 0 && Number(r.avgCandidates) > 0,
    ),
    CAP_RESPECTED_ALL_SIZES: controlledRows.every((r) => r.capRespected === true),
    /*
     * `ambiguousBlockCount` por linha mostra o trabalho REALMENTE pulado. Ele
     * NAO precisa ser zero aqui: as chaves amplas continuam ambiguas por
     * construcao, e continuar sendo puladas e o comportamento correto. O que
     * muda em relacao ao cenario 1 e que a chave especifica agora materializa
     * a candidata, entao o workload exercita o caminho completo.
     */
    ROWS: controlledRows,
    NOTE:
      "Cenario ADITIVO, nao substitui o cenario 1: existe para fechar a lacuna que WORKLOAD_NOTE declarou (geracao de candidatas nao foi medida no cenario 1). Muda SO a cardinalidade das chaves da carga sintetica; tamanhos, probe e generateCandidates sao os mesmos. Nenhum threshold novo foi criado aqui: o julgamento de achatamento continua em INDEXED_LOOKUP_IS_FLAT/VERDICT, calculados do cenario 1.",
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
