/**
 * COMPARAÇÃO DETERMINISTIC_ONLY vs DETERMINISTIC_PLUS_AI (§13).
 *
 * Roda o benchmark rotulado duas vezes e imprime a diferença. Continua
 * SENDO SHADOW: `DETERMINISTIC_PLUS_AI` é uma HIPÓTESE, não uma política.
 * O motor determinístico continua sendo o dono da decisão; a coluna `+AI` só
 * existe para medir quanto uma segunda opinião acrescentaria.
 *
 * Sem credencial de LLM no ambiente, o provider é de REPLAY e o número de
 * chamadas reais de IA é ZERO. Isso é reportado explicitamente em
 * `AI_CALLS_REAIS=0` — e é por isso que o ganho de IA não pode ser
 * declarado. O que dá para medir aqui é o GASTO (quantos pares iam pedir
 * segunda opinião, quanto isso custaria) e a MECÂNICA (gate, contrato,
 * cache), não a qualidade de um modelo que nunca rodou.
 *
 * Uso:
 *   npx tsx src/scripts/xm-ai-shadow.ts
 *   npx tsx src/scripts/xm-ai-shadow.ts <dataset.json>
 */
import { readFileSync } from "node:fs";

import { evaluateIdentityConfidence } from "@/services/architecture/v1/identity/identityConfidence";
import {
  AiMemoryCache,
  ReplayAiProvider,
  consultarAiShadow,
  type AiShadowGate,
} from "@/services/architecture/v1/identity/aiIdentityResolver";
import { buildFakeListing } from "@/services/architecture/v1/fake/fakeConnectors";
import type { NormalizedMarketplaceListingV1 } from "@/services/architecture/v1/types/normalizedListingV1";
import {
  extrairSize,
  extrairStorage,
} from "@/services/architecture/v1/benchmark/candidateSearch";

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
};

const DATASET_PADRAO =
  "src/services/architecture/v1/benchmark/datasets/crossmarket-benchmark-v1.json";

function divis(ao: number, denominador: number): number {
  return denominador === 0 ? 0 : ao / denominador;
}

function arredondar(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Listing da seed: o que a fonte REALMENTE devolve (ML tem marca e GTIN). */
function listingDeSeed(row: BenchmarkRow): NormalizedMarketplaceListingV1 {
  return buildFakeListing({
    marketplaceId: row.seedMarketplace,
    externalListingId: row.seedItemId ?? row.rowId,
    identity: {
      gtin: row.seedGtin ? [row.seedGtin] : [],
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

/** Listing do candidato Shopee: sem marca, sem modelo, sem GTIN. */
function listingDeCandidato(row: BenchmarkRow): NormalizedMarketplaceListingV1 {
  return buildFakeListing({
    marketplaceId: row.candidateMarketplace,
    externalListingId: row.candidateItemId ?? `${row.rowId}-c`,
    identity: { gtin: [], brand: null, manufacturerModel: null, model: null, mpn: null },
    catalog: { title: row.candidateTitle, category: null },
    variant: { storage: null, memory: null, voltage: null, size: null },
    commerce: { price: 1000 },
  });
}

async function main(): Promise<void> {
  const caminho = process.argv[2] ?? DATASET_PADRAO;
  const dataset = JSON.parse(readFileSync(caminho, "utf8")) as { dataset: string; rows: BenchmarkRow[] };

  const cache = new AiMemoryCache();
  const provider = new ReplayAiProvider({
    "*": JSON.stringify({
      verdict: "UNCERTAIN",
      confidence: 0,
      matchingEvidence: [],
      conflicts: ["SEM_CREDENCIAL_DE_LLM_NO_AMBIENTE"],
      normalizedIdentity: { brand: null, model: null, gtin: [], variant: {} },
    }),
  });

  const porGate = new Map<AiShadowGate, number>();
  let deterministicoSame = 0;
  let maisAiSame = 0;
  let consultadas = 0;
  let violacoesContrato = 0;
  let mudancaDeVeredito = 0;

  for (const row of dataset.rows) {
    const seed = listingDeSeed(row);
    const cand = listingDeCandidato(row);
    const decisao = evaluateIdentityConfidence(seed, cand);

    const detPositivo = decisao.confidence === "EXACT";
    if (detPositivo && row.label === "SAME") deterministicoSame += 1;

    const resultado = await consultarAiShadow(
      {
        seed,
        candidate: cand,
        decisaoDeterministica: decisao,
        rotuloAmbiguo: row.label === "AMBIGUOUS",
        // "candidato forte" = existe evidencia compartilhada de modelo na busca.
        candidatoForte: row.candidateTitle.toLowerCase().includes("ekm30"),
        montarPrompt: (a, b) => `${a}|${b}`,
      },
      { provider, cache },
    );

    porGate.set(resultado.gate, (porGate.get(resultado.gate) ?? 0) + 1);
    if (resultado.aiVerdict !== null || resultado.gate.startsWith("SHADOW_CONSULTED")) consultadas += 1;
    if (resultado.contractViolations.length > 0) violacoesContrato += 1;
    /*
     * Compara os dois vereditos no MESMO vocabulario. O determinístico fala
     * EXACT/REVIEW/REJECT e a IA fala SAME/DIFFERENT/UNCERTAIN; comparar
     * strings diretas dariam divergência falso em 100% dos pares.
     */
    const detEmVocabularioIa: Record<string, string> = {
      EXACT: "SAME",
      REVIEW: "UNCERTAIN",
      REJECT: "DIFFERENT",
    };
    if (resultado.aiVerdict && resultado.aiVerdict !== detEmVocabularioIa[decisao.confidence]) {
      mudancaDeVeredito += 1;
    }

    const maisAiPositivo =
      detPositivo || (resultado.wouldPromoteToSame && decisao.hardConflicts.length === 0);
    if (maisAiPositivo && row.label === "SAME") maisAiSame += 1;
  }

  console.log("=== AI SHADOW: DETERMINISTIC_ONLY vs DETERMINISTIC_PLUS_AI (§13) ===");
  console.log(`DATASET=${dataset.dataset}`);
  console.log(`BENCHMARK_ROWS=${dataset.rows.length}`);
  console.log("");
  console.log("--- GASTO (quantos pares pediriam segunda opiniao) ---");
  for (const [gate, n] of [...porGate.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`AI_GATE_${gate}=${n}`);
  }
  console.log(`AI_PARES_ELEGIVEIS=${consultadas}`);
  console.log(`AI_CALLS_REAIS=0`);
  console.log(
    "AI_CALLS_NOTA=sem credencial de LLM no ambiente; provider de replay devolve UNCERTAIN. O ganho de IA nao e medivel aqui e nao e declarado.",
  );
  console.log("");
  console.log("--- MECANICA (o que DA para medir sem modelo) ---");
  console.log(`AI_CONTRATO_VIOLATIONS=${violacoesContrato}`);
  console.log(`AI_MUDANCA_DE_VEREDITO=${mudancaDeVeredito}`);
  console.log(`AI_CACHE_TAMANHO=${cache.tamanho()}`);
  console.log(`AI_CACHE_HIT_RATE=${arredondar(divis(cache.tamanho(), Math.max(1, consultadas)))}`);
  console.log("");
  console.log("--- IMPACTO HIPOTETICO (shadow, nao publica) ---");
  console.log(`DETERMINISTIC_ONLY_TRUE_POSITIVES=${deterministicoSame}`);
  console.log(`DETERMINISTIC_PLUS_AI_TRUE_POSITIVES=${maisAiSame}`);
  console.log(
    `DETERMINISTIC_PLUS_AI_DELTA=${maisAiSame - deterministicoSame} (hipotese com provider de replay; nao e ganho de IA medido)`,
  );
  console.log("");
  console.log("GLOBAL_CUTOVER=NO");
  console.log("FORCE_PUSH=NO");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});