/**
 * DIAGNÓSTICO MAGALU (§7).
 *
 * PERGUNTA QUE ESTE SCRIPT RESPONDE: "20 candidatos, 0 certified" — aonde foi?
 *
 * Resposta honesta exige separar três coisas que a frase esconde:
 *
 *   A. A busca achou produtos?        -> `scanned` (produtos crus da fonte)
 *   B. Os filtros do discovery aceitaram? -> `candidates.length`
 *   C. O motor de identidade certificou?  -> `evaluateIdentityConfidence`
 *
 * E, para C, cada rejeição é CLASSIFICADA — porque "0 certified" sozinho não
 * diz se o problema é a política (matcher estrito demais), a fonte (sem marca
 * nem GTIN estruturado), a busca (query larga demais) ou o dado (candidato
 * que é outro produto de fato).
 *
 * NENHUMA REGRA FOI AFROUXADA. Este script só observa. Se a política estiver
 * certa e a fonte for cega, o conserto é na fonte, não na política.
 *
 * SOMENTE LEITURA. Nenhum write. Nenhuma publicação.
 *
 * Uso:
 *   npx tsx --env-file=.env.local src/scripts/xm-probe-magalu.ts \
 *     <seeds.json> [maxSeeds]
 */
import { readFileSync, writeFileSync } from "node:fs";

import { buscarMagazineLuiza } from "@/services/discovery/magazineluiza";
import { evaluateIdentityConfidence } from "@/services/architecture/v1/identity/identityConfidence";
import { buildFakeListing } from "@/services/architecture/v1/fake/fakeConnectors";
import type { NormalizedMarketplaceListingV1 } from "@/services/architecture/v1/types/normalizedListingV1";
import {
  extrairSize,
  extrairStorage,
} from "@/services/architecture/v1/benchmark/candidateSearch";

type SeedMl = {
  itemId: string;
  title: string;
  categoryId: string;
  gtin: string | null;
  brand: string | null;
  seedQuery: string;
};

type CandidatoMagalu = {
  externalId: string;
  title: string;
  brand: string | null;
  price: number | null;
  sourceUrl: string;
};

type Classificacao =
  | "CERTIFIED_MATCHED"
  | "WRONG_PRODUCT"
  | "MISSING_IDENTITY"
  | "SEARCH_BROAD"
  | "MATCHER_STRICT"
  | "INSUFFICIENT_EVIDENCE";

/* ----------------------------------------------------------------- HELPERS */

function listingDaSeed(seed: SeedMl): NormalizedMarketplaceListingV1 {
  return buildFakeListing({
    marketplaceId: "mercadolivre",
    externalListingId: seed.itemId,
    identity: {
      gtin: seed.gtin ? [seed.gtin] : [],
      brand: seed.brand,
      manufacturerModel: null,
      model: null,
      mpn: null,
    },
    catalog: { title: seed.title, category: seed.categoryId },
    variant: {
      storage: extrairStorage(seed.title),
      memory: null,
      voltage: null,
      size: extrairSize(seed.title),
    },
    commerce: { price: 1000 },
  });
}

function listingDoCandidato(c: CandidatoMagalu): NormalizedMarketplaceListingV1 {
  return buildFakeListing({
    marketplaceId: "magazine_luiza",
    externalListingId: c.externalId,
    identity: {
      gtin: [],
      brand: c.brand,
      manufacturerModel: null,
      model: null,
      mpn: null,
    },
    catalog: { title: c.title, category: null },
    variant: { storage: null, memory: null, voltage: null, size: null },
    commerce: { price: c.price ?? 1000 },
  });
}

/** Tokens Alfanuméricos longos do título: o que realmente identifica algo. */
function tokensDistintivos(titulo: string): Set<string> {
  const crus = titulo.toLowerCase().match(/[a-z]{2,}[0-9][a-z0-9-]*|[a-z]+[0-9]{2,}[a-z0-9]*/g) ?? [];
  return new Set(crus.filter((t) => t.length >= 4));
}

/**
 * Classifica a rejeição. A ordem importa: primeiro o que é PROVADO, depois o
 * que é FALTA DE DADO, e só no fim o que é julgamento do motor.
 */
function classificar(
  decisao: ReturnType<typeof evaluateIdentityConfidence>,
  seed: SeedMl,
  cand: CandidatoMagalu,
): Classificacao {
  if (decisao.confidence === "EXACT") return "CERTIFIED_MATCHED";

  const compartilhamAlgo = [...tokensDistintivos(seed.title)].some((t) =>
    cand.title.toLowerCase().includes(t),
  );

  // 1. Conflito estrutural provado: o motor tem motivo Objective para discordar.
  if (decisao.hardConflicts.length > 0) return "WRONG_PRODUCT";

  // 2. Nada em comum entre os dois títulos: a busca trouxe outro assunto.
  if (!compartilhamAlgo) return "SEARCH_BROAD";

  // 3. Há elemento comum e não há conflito, mas a fonte não entrega identidade
  //    estruturada (a Magalu declara `gtin: false` e devolve `model: null`).
  if (!cand.brand) return "MISSING_IDENTITY";

  // 4. Sobrou REVIEW com elementos comuns e marca dos dois lados: aqui a
  //    decisão é do motor, não da fonte. Se o ground truth disser SAME, é
  //    policy estrita demais; se não disser, é evidência insuficiente mesmo.
  return decisao.confidence === "REVIEW" ? "INSUFFICIENT_EVIDENCE" : "MATCHER_STRICT";
}

/* -------------------------------------------------------------------- MAIN */

async function main(): Promise<void> {
  const [caminhoSeeds, maxSeedsArg] = process.argv.slice(2);
  const seeds = JSON.parse(readFileSync(caminhoSeeds, "utf8")) as SeedMl[];
  const maxSeeds = Number(maxSeedsArg ?? 20);
  const selecionadas = seeds.slice(0, maxSeeds);

  const contagem: Record<Classificacao, number> = {
    CERTIFIED_MATCHED: 0,
    WRONG_PRODUCT: 0,
    MISSING_IDENTITY: 0,
    SEARCH_BROAD: 0,
    MATCHER_STRICT: 0,
    INSUFFICIENT_EVIDENCE: 0,
  };

  const detalhes: Array<{
    seed: string;
    status: string;
    scanned: number;
    candidates: number;
    error: string | null;
    rejeicoes: Array<{ title: string; brand: string | null; confianca: string; classificacao: Classificacao; reasons: string[] }>;
  }> = [];

  let requests = 0;
  let sucessos = 0;
  let vazios = 0;
  let erros = 0;
  let totalScanned = 0;
  let totalCandidatos = 0;

  for (const seed of selecionadas) {
    requests += 1;
    const resultado = await buscarMagazineLuiza({
      query: seed.title,
      normalizedQuery: seed.title.toLowerCase(),
      limit: 20,
      mode: "MULTILOJA",
      targetProductId: null,
    });

    if (resultado.success) sucessos += 1;
    else erros += 1;
    if (resultado.success && resultado.candidates.length === 0) vazios += 1;

    totalScanned += resultado.scanned;
    totalCandidatos += resultado.candidates.length;

    const rejeicoes = resultado.candidates.slice(0, 10).map((c) => {
      const cand: CandidatoMagalu = {
        externalId: c.externalId,
        title: c.title,
        brand: c.brand ?? null,
        price: c.price ?? null,
        sourceUrl: c.sourceUrl,
      };
      const decisao = evaluateIdentityConfidence(listingDaSeed(seed), listingDoCandidato(cand));
      const classificacao = classificar(decisao, seed, cand);
      contagem[classificacao] += 1;
      return {
        title: c.title,
        brand: cand.brand,
        confianca: decisao.confidence,
        classificacao,
        reasons: decisao.reasonCodes.slice(0, 4),
      };
    });

    detalhes.push({
      seed: seed.title,
      status: resultado.success ? "OK" : "ERRO",
      scanned: resultado.scanned,
      candidates: resultado.candidates.length,
      error: resultado.error ?? null,
      rejeicoes,
    });

    console.log(
      `[magalu] "${seed.title.slice(0, 44)}" scanned=${resultado.scanned} candidatos=${resultado.candidates.length} erro=${resultado.error?.slice(0, 60) ?? "-"}`,
    );
  }

  const saida = { detalhes, contagem, metricas: { requests, sucessos, vazios, erros, totalScanned, totalCandidatos } };
  writeFileSync("/tmp/opencode/magalu_diag.json", JSON.stringify(saida, null, 2), "utf8");

  console.log("");
  console.log("=== MAGALU: FUNIL DE BUSCA (§7) ===");
  console.log(`MAGALU_REQUESTS=${requests}`);
  console.log(`MAGALU_SUCCESS=${sucessos}`);
  console.log(`MAGALU_ZERO_RESULTS=${vazios}`);
  console.log(`MAGALU_ERRORS=${erros}`);
  console.log(`MAGALU_PRODUCTS_SCANNED=${totalScanned}`);
  console.log(`MAGALU_CANDIDATES_AFTER_DISCOVERY_FILTERS=${totalCandidatos}`);
  console.log(
    `MAGALU_DISCOVERY_ACCEPT_RATE=${totalScanned === 0 ? 0 : Math.round((totalCandidatos / totalScanned) * 10000) / 10000}`,
  );
  console.log(`MAGALU_CANDIDATES_CLASSIFIED=${Object.values(contagem).reduce((a, b) => a + b, 0)}`);
  console.log(`MAGALU_CERTIFIED_MATCHED=${contagem.CERTIFIED_MATCHED}`);
  console.log("");
  console.log("--- CLASSIFICACAO DE CADA REJEICAO ---");
  for (const [k, v] of Object.entries(contagem).sort((a, b) => b[1] - a[1])) {
    console.log(`MAGALU_REJECT_${k}=${v}`);
  }
  console.log("MAGALU_DIAG_SAVED=/tmp/opencode/magalu_diag.json");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
