/**
 * BENCHMARK CROSS-MARKET DETERMINÍSTICO (§9 / §14 / §17).
 *
 * Roda o motor de identidade sobre o dataset rotulado versionado e mede:
 *
 *   §9   TP / TN / FP / FN / UNKNOWN, precision, recall, F1
 *        gate principal = FALSE_POSITIVE_RATE
 *   §14  CANDIDATE_RECALL_AT_5 / _AT_10 / _AT_20
 *   §17  MATCHABLE_SEEDS, CANDIDATE_FOUND, CERTIFIED_MATCHED,
 *        CANDIDATE_COVERAGE, IDENTITY_COVERAGE, END_TO_END_COVERAGE
 *
 * DETERMINÍSTICO E REPRODUZÍVEL. Sem rede, sem banco, sem escrita, sem IA.
 * O mesmo dataset produz sempre a mesma matriz.
 *
 * O que conta como POSITIVO do motor: `EXACT`.
 * `REVIEW` e `REJECT` contam como negativo — e isso é deliberado. A política
 * de identidade só afirma EXACT com evidência estruturada; Recall baixo com
 * Precision alta é o comportamento correto de um motor fail-closed, e
 * `UNKNOWN` (rótulo AMBIGUOUS) nunca é contado como erro do motor.
 *
 * Uso:
 *   npx tsx src/scripts/xm-benchmark-run.ts
 *   npx tsx src/scripts/xm-benchmark-run.ts <dataset.json> [--json]
 */
import { readFileSync } from "node:fs";

import { evaluateIdentityConfidence } from "@/services/architecture/v1/identity/identityConfidence";
import { buildFakeListing } from "@/services/architecture/v1/fake/fakeConnectors";
import type { NormalizedMarketplaceListingV1 } from "@/services/architecture/v1/types/normalizedListingV1";
import {
  extrairModelo,
  extrairSize,
  extrairStorage,
} from "@/services/architecture/v1/benchmark/candidateSearch";

/* ------------------------------------------------------------------ DATASET */

type Rotulo = "SAME" | "DIFFERENT" | "AMBIGUOUS";

type BenchmarkRow = {
  rowId: string;
  seedTitle: string;
  seedBrand: string | null;
  seedGtin: string | null;
  seedCategory: string | null;
  seedItemId: string | null;
  seedMarketplace: string;
  candidateTitle: string;
  candidateMarketplace: string;
  candidateItemId: string | null;
  rank: number;
  label: Rotulo;
  reason: string;
  origem: string;
};

type DatasetFile = {
  dataset: string;
  rotulos: Record<string, number>;
  rows: BenchmarkRow[];
};

const DATASET_PADRAO =
  "src/services/architecture/v1/benchmark/datasets/crossmarket-benchmark-v1.json";

function carregarDataset(caminho: string): DatasetFile {
  return JSON.parse(readFileSync(caminho, "utf8")) as DatasetFile;
}

/* ------------------------------------------------------------- LISTING V1 */

/*
 * Reconstrói a listing EXATAMENTE como a fonte a entregaria.
 *
 * Isto não é um atalho: é o dado real. O conector Shopee declara
 * `gtin: false` e devolve `gtin: []`, `brand: null`, `manufacturerModel:
 * null`, `model: null` (shopeeConnector.ts:475-482).Ou seja: contra Shopee o
 * motor cross-market trabalha com TÍTULO e mais nada.
 *
 * Se este passo inventasse marca ou modelo a partir do título, o benchmark
 * mediria um matcher alimentado com dado que a fonte não entrega — e todo o
 * resultado seria falso. O que o extrator de título produziu durante a busca
 * (§15) é justamente uma consulta, não um atributo de identidade, e por isso
 * NÃO entra aqui.
 */
function listingDeSeed(row: BenchmarkRow): NormalizedMarketplaceListingV1 {
  const gtin = row.seedGtin ? [row.seedGtin] : [];
  return buildFakeListing({
    marketplaceId: row.seedMarketplace,
    externalListingId: row.seedItemId ?? row.rowId,
    identity: {
      gtin,
      brand: row.seedBrand,
      manufacturerModel: null,
      model: null,
      mpn: null,
    },
    catalog: { title: row.seedTitle, category: row.seedCategory },
    variant: {
      storage: extrairStorage(row.seedTitle),
      memory: null,
      voltage: null,
      size: extrairSize(row.seedTitle),
    },
    commerce: { price: 1000 },
  });
}

function listingDeCandidato(row: BenchmarkRow): NormalizedMarketplaceListingV1 {
  /*
   * Candidato Shopee: o que o conector realmente devolve. Repare que
   * `extrairModelo` NÃO entra aqui de propósito — ele existe para montar a
   * consulta de busca (§15), e usá-lo como atributo de identidade seria
   * manufacture evidência.
   */
  return buildFakeListing({
    marketplaceId: row.candidateMarketplace,
    externalListingId: row.candidateItemId ?? `${row.rowId}-c`,
    identity: {
      gtin: [],
      brand: null,
      manufacturerModel: null,
      model: null,
      mpn: null,
    },
    catalog: { title: row.candidateTitle, category: null },
    variant: { storage: null, memory: null, voltage: null, size: null },
    commerce: { price: 1000 },
  });
}

/* -------------------------------------------------------------- MÉTRICAS */

type Confusao = { TP: number; TN: number; FP: number; FN: number; UNKNOWN: number };

function divisao(numerador: number, denominador: number): number {
  if (denominador === 0) return 0;
  return numerador / denominador;
}

function arredondar(valor: number): number {
  return Math.round(valor * 10000) / 10000;
}

type LinhaAvaliada = {
  row: BenchmarkRow;
  decisao: "EXACT" | "REVIEW" | "REJECT";
  textoExtraido: string | null;
};

/* ------------------------------------------------------------------- MAIN */

function main(): void {
  const args = process.argv.slice(2);
  const wantsJson = args.includes("--json");
  const caminho = args.find((a) => !a.startsWith("--")) ?? DATASET_PADRAO;
  const dataset = carregarDataset(caminho);

  const confusao: Confusao = { TP: 0, TN: 0, FP: 0, FN: 0, UNKNOWN: 0 };
  const linhas: LinhaAvaliada[] = [];
  const falsoPositivos: LinhaAvaliada[] = [];
  const falsoNegativos: LinhaAvaliada[] = [];

  for (const row of dataset.rows) {
    const decisao = evaluateIdentityConfidence(listingDeSeed(row), listingDeCandidato(row));
    const positiva = decisao.confidence === "EXACT";
    const linha: LinhaAvaliada = {
      row,
      decisao: decisao.confidence,
      textoExtraido: extrairModelo(row.candidateTitle, null),
    };
    linhas.push(linha);

    if (row.label === "AMBIGUOUS") {
      confusao.UNKNOWN += 1;
      continue;
    }
    if (positiva && row.label === "SAME") confusao.TP += 1;
    else if (positiva && row.label === "DIFFERENT") {
      confusao.FP += 1;
      falsoPositivos.push(linha);
    } else if (!positiva && row.label === "SAME") {
      confusao.FN += 1;
      falsoNegativos.push(linha);
    } else confusao.TN += 1;
  }

  const precision = divisao(confusao.TP, confusao.TP + confusao.FP);
  const recall = divisao(confusao.TP, confusao.TP + confusao.FN);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  // Gate principal: falso positivo é o que agrupa produto errado e quebra preço.
  const falsePositiveRate = divisao(confusao.FP, confusao.FP + confusao.TN);

  /*
   * Precision é INDEFINIDA quando o motor não aprovou nada. Reportar 0 seria
   * mentir em cima: 0 diz "ele aprovou e estava errado", enquanto o fato é
   * "ele não aprovou nada, logo não há approval para medir". Da mesma forma,
   * F1 herda a indefinição.
   */
  const positives = confusao.TP + confusao.FP;
  const precisionTexto = positives === 0 ? "UNDEFINED" : String(arredondar(precision));
  const f1Texto = positives === 0 ? "UNDEFINED" : String(arredondar(f1));

  /* ---------------------------------------------- §14 CANDIDATE RECALL --- */

  const paresRotulados = dataset.rows.filter((r) => r.label === "SAME");
  const seedsComSame = new Set(paresRotulados.map((r) => r.seedTitle));
  const seedsComSameDentroDe = (limite: number): number => {
    const dentro = new Set(
      paresRotulados.filter((r) => r.rank <= limite).map((r) => r.seedTitle),
    );
    return dentro.size;
  };

  const seedTitles = [...new Set(dataset.rows.map((r) => r.seedTitle))];
  const seedsComCandidato = new Set(dataset.rows.map((r) => r.seedTitle));

  /* ---------------------------------------------------- §17 COBERTURAS --- */

  const seedsComCandidatoDentro = (limite: number): number => {
    const dentro = new Set(dataset.rows.filter((r) => r.rank <= limite).map((r) => r.seedTitle));
    return dentro.size;
  };

  // Seed "certified": o motor aprovou EXACT pelo menos um par daquela seed.
  const seedsComExact = new Set(linhas.filter((l) => l.decisao === "EXACT").map((l) => l.row.seedTitle));

  const matchableSeeds = seedTitles.length;
  const candidateFound = seedsComCandidatoDentro(20);
  const certifiedMatched = seedsComExact.size;
  const candidateCoverage = divisao(candidateFound, matchableSeeds);
  const identityCoverage = divisao(certifiedMatched, candidateFound);
  const endToEndCoverage = divisao(certifiedMatched, matchableSeeds);

  /* ----------------------------------------------------------- RELATÓRIO */

  if (wantsJson) {
    console.log(
      JSON.stringify(
        {
          dataset: dataset.dataset,
          confusao,
          precision: arredondar(precision),
          recall: arredondar(recall),
          f1: arredondar(f1),
          falsePositiveRate: arredondar(falsePositiveRate),
          candidateRecallAt5: arredondar(divisao(seedsComSameDentroDe(5), seedsComSame.size)),
          candidateRecallAt10: arredondar(divisao(seedsComSameDentroDe(10), seedsComSame.size)),
          candidateRecallAt20: arredondar(divisao(seedsComSameDentroDe(20), seedsComSame.size)),
          coverage: { matchableSeeds, candidateFound, certifiedMatched },
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("=== BENCHMARK CROSS-MARKET (DETERMINISTICO) ===");
  console.log(`DATASET=${dataset.dataset}`);
  console.log(`BENCHMARK_ROWS=${dataset.rows.length}`);
  console.log(
    `BENCHMARK_LABELS=${JSON.stringify(
      dataset.rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.label] = (acc[r.label] ?? 0) + 1;
        return acc;
      }, {}),
    )}`,
  );
  console.log("");
  console.log("--- MATRIZ DE CONFUSAO (positivo do motor = EXACT) ---");
  console.log(`TP=${confusao.TP}`);
  console.log(`TN=${confusao.TN}`);
  console.log(`FP=${confusao.FP}`);
  console.log(`FN=${confusao.FN}`);
  console.log(`UNKNOWN=${confusao.UNKNOWN}`);
  console.log(`PRECISION=${precisionTexto}`);
  console.log(`RECALL=${arredondar(recall)}`);
  console.log(`F1=${f1Texto}`);
  console.log(`FALSE_POSITIVE_RATE=${arredondar(falsePositiveRate)}`);
  console.log(`APROVADOS_PELO_MOTOR=${positives}`);
  console.log(
    positives === 0
      ? "PRECISION_NOTA=indefinida: o motor nao aprovou nenhum par. Nao ha approval a medir."
      : "PRECISION_NOTA=medida sobre os pares que o motor aprovou",
  );
  console.log("");
  console.log("--- §14 CANDIDATE RECALL (busca, sem o motor) ---");
  console.log(`SEEDS_COM_MATCH_REAL=${seedsComSame.size}`);
  console.log(`CANDIDATE_RECALL_AT_5=${arredondar(divisao(seedsComSameDentroDe(5), seedsComSame.size))}`);
  console.log(`CANDIDATE_RECALL_AT_10=${arredondar(divisao(seedsComSameDentroDe(10), seedsComSame.size))}`);
  console.log(`CANDIDATE_RECALL_AT_20=${arredondar(divisao(seedsComSameDentroDe(20), seedsComSame.size))}`);
  console.log("");
  console.log("--- §17 COBERTURAS ---");
  console.log(`MATCHABLE_SEEDS=${matchableSeeds}`);
  console.log(`CANDIDATE_FOUND=${candidateFound}`);
  console.log(`CERTIFIED_MATCHED=${certifiedMatched}`);
  console.log(`CANDIDATE_COVERAGE=${arredondar(candidateCoverage)}`);
  console.log(`IDENTITY_COVERAGE=${arredondar(identityCoverage)}`);
  console.log(`END_TO_END_COVERAGE=${arredondar(endToEndCoverage)}`);
  console.log("");

  if (falsoPositivos.length > 0) {
    console.log("--- FALSO POSITIVOS (o que quebraria preço) ---");
    for (const l of falsoPositivos.slice(0, 10)) {
      console.log(`  FP ${l.row.rowId} ${l.row.seedTitle.slice(0, 46)}`);
      console.log(`     X-> ${l.row.candidateTitle.slice(0, 60)}`);
    }
  }
  if (falsoNegativos.length > 0) {
    console.log(`--- FALSO NEGATIVOS: ${falsoNegativos.length} (motor nao aprovou o que e SAME) ---`);
    const porRank = falsoNegativos.reduce<Record<number, number>>((acc, l) => {
      const faixa = l.row.rank <= 5 ? 5 : l.row.rank <= 10 ? 10 : 20;
      acc[faixa] = (acc[faixa] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`FN_POR_FAIXA_DE_RANK=${JSON.stringify(porRank)}`);
  }
  void linhas;
  void seedTitles;
  void seedsComCandidato;
}

main();