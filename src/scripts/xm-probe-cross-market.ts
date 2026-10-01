/**
 * PROBE REAL CROSS-MARKET (§5 Shopee, §6 Amazon/SerpApi, §7 Magalu, §14 recall).
 *
 * Para cada seed ML real, deriva as consultas candidatas (§15), consulta as
 * fontes cross-market e registra candidatos. NÃO roda o matcher aqui: este
 * script mede SEARCH. O matcher é medido à parte (§9) para que
 * SEARCH FAILURE nunca seja confundido com IDENTITY FAILURE (§16).
 *
 * SOMENTE LEITURA. Nenhum write. Nenhuma publicação.
 *
 * Uso:
 *   npx tsx --env-file=.env.local src/scripts/xm-probe-cross-market.ts \
 *     <seeds.json> <saida.json> [maxSeeds] [fontesCsv]
 */
import { readFileSync, writeFileSync } from "node:fs";

import { ShopeeMarketplaceConnector } from "@/services/architecture/v1/connectors/shopee/shopeeConnector";
import type { NormalizedMarketplaceListingV1 } from "@/services/architecture/v1/types/normalizedListingV1";
import {
  derivarCamposDeIdentidade,
  gerarConsultasDeCandidato,
  type CandidateQueryV1,
  type CandidateQueryStrategy,
} from "@/services/architecture/v1/benchmark/candidateSearch";

type SeedMl = {
  itemId: string;
  title: string;
  price: number;
  sellerId: string | null;
  catalogProductId: string | null;
  categoryId: string;
  seedQuery: string;
  gtin: string | null;
  brand: string | null;
};

export type DiagnosticoFonte =
  | "OK"
  | "AUTH"
  | "RATE_LIMIT"
  | "API_CONTRACT"
  | "QUERY"
  | "PARSER"
  | "NETWORK"
  | "ZERO_RESULTS"
  | "QUOTA"
  | "OTHER";

export function classificarFalha(detalhe: string): DiagnosticoFonte {
  const baixo = detalhe.toLowerCase();

  if (/run out of searches|quota|insufficient|plan limit/.test(baixo)) return "QUOTA";
  if (/429|rate limit|too many|throttl/.test(baixo)) return "RATE_LIMIT";
  if (/401|403|unauthorized|forbidden|signature|credential|app_id|access denied/.test(baixo))
    return "AUTH";
  if (/http 5|fetch failed|econn|enotfound|socket|network|timeout/.test(baixo))
    return "NETWORK";
  if (/graphql_error|invalid_payload|unexpected|nao-json|undefined is not/.test(baixo))
    return "API_CONTRACT";
  if (/parser|normaliz|zod|invalid_type/.test(baixo)) return "PARSER";
  return "OTHER";
}

async function coletarShopee(
  consultas: CandidateQueryV1[],
  porEstrategia: Record<string, number>,
): Promise<{
  candidatos: NormalizedMarketplaceListingV1[];
  requests: number;
  sucessos: number;
  falhas: number;
  diagnosticos: Record<string, number>;
}> {
  const candidatos: NormalizedMarketplaceListingV1[] = [];
  const vistos = new Set<string>();
  const diagnosticos: Record<string, number> = {};
  let requests = 0;
  let sucessos = 0;
  let falhas = 0;

  const acrescentar = (
    itens: NormalizedMarketplaceListingV1[],
    estrategia: CandidateQueryStrategy,
  ) => {
    let marca = porEstrategia[estrategia] ?? 0;
    for (const item of itens) {
      if (vistos.has(item.externalListingId)) continue;
      vistos.add(item.externalListingId);
      candidatos.push({ ...item, __queryStrategy: estrategia } as NormalizedMarketplaceListingV1);
      marca += 1;
    }
    porEstrategia[estrategia] = marca;
  };

  for (const consulta of consultas) {
    const connector = new ShopeeMarketplaceConnector({
      keywords: [consulta.query],
      pageSize: 20,
      maxPages: 1,
    });

    requests += 1;
    try {
      const batch = await connector.collect(null);
      sucessos += 1;
      acrescentar(batch.items, consulta.strategy);
    } catch (error) {
      falhas += 1;
      const mensagem = error instanceof Error ? error.message : String(error);
      const codigo = classificarFalha(mensagem);
      diagnosticos[codigo] = (diagnosticos[codigo] ?? 0) + 1;
      if (falhas <= 3) {
        console.error(
          `[shopee] consulta "${consulta.query}" falhou (${codigo}): ${mensagem.slice(0, 130)}`,
        );
      }
    }
  }

  return { candidatos, requests, sucessos, falhas, diagnosticos };
}

async function main() {
  const caminhoSeeds = process.argv[2];
  const caminhoSaida = process.argv[3];
  const maxSeeds = Number(process.argv[4] ?? "20");

  if (!caminhoSeeds || !caminhoSaida) {
    console.error("uso: xm-probe-cross-market <seeds.json> <saida.json> [maxSeeds]");
    process.exit(2);
  }

  const seeds = JSON.parse(readFileSync(caminhoSeeds, "utf8")) as SeedMl[];
  const selecionadas = seeds.slice(0, maxSeeds);

  console.log(
    `[probe] seeds=${selecionadas.length} (de ${seeds.length}) fonte=shopee`,
  );

  const porEstrategia: Record<string, number> = {};
  const resultados = [] as Array<{
    seedItemId: string;
    seedTitle: string;
    seedGtin: string | null;
    seedBrand: string | null;
    categoryId: string;
    consultas: CandidateQueryV1[];
    shopeeRequests: number;
    shopeeSuccess: number;
    shopeeErrors: number;
    shopeeZeroResults: number;
    shopeeCandidates: Array<{
      externalListingId: string;
      title: string;
      price: number;
      seller: string | null;
      queryStrategy: CandidateQueryStrategy;
    }>;
  }>;

  let shopeeRequests = 0;
  let shopeeSuccess = 0;
  let shopeeErrors = 0;
  let shopeeZero = 0;
  let shopeeCandidatesTotal = 0;
  const diagnosticosGlobais: Record<string, number> = {};

  for (const seed of selecionadas) {
    const campos = derivarCamposDeIdentidade(seed);
    const consultas = gerarConsultasDeCandidato(campos, 6);

    const resultado = await coletarShopee(consultas, porEstrategia);

    shopeeRequests += resultado.requests;
    shopeeSuccess += resultado.sucessos;
    shopeeErrors += resultado.falhas;
    if (resultado.candidatos.length === 0) shopeeZero += 1;
    shopeeCandidatesTotal += resultado.candidatos.length;

    for (const [chave, valor] of Object.entries(resultado.diagnosticos)) {
      diagnosticosGlobais[chave] = (diagnosticosGlobais[chave] ?? 0) + valor;
    }

    resultados.push({
      seedItemId: seed.itemId,
      seedTitle: seed.title,
      seedGtin: seed.gtin,
      seedBrand: seed.brand,
      categoryId: seed.categoryId,
      consultas,
      shopeeRequests: resultado.requests,
      shopeeSuccess: resultado.sucessos,
      shopeeErrors: resultado.falhas,
      shopeeZeroResults: resultado.candidatos.length === 0 ? 1 : 0,
      shopeeCandidates: resultado.candidatos.slice(0, 20).map((c) => ({
        externalListingId: c.externalListingId,
        title: c.catalog.title ?? "",
        price: c.commerce.price as number,
        seller: c.seller?.name ?? null,
        queryStrategy: (c as { __queryStrategy?: CandidateQueryStrategy }).__queryStrategy ?? "DISTINCTIVE",
      })),
    });

    console.log(
      `[probe] ${seed.itemId} "${seed.title.slice(0, 50)}" consultas=${consultas.length} candidatos=${resultado.candidatos.length} erros=${resultado.falhas}`,
    );
  }

  writeFileSync(
    caminhoSaida,
    `${JSON.stringify(
      {
        probeVersion: "cross-market-probe-v1",
        fontePrimaria: "shopee",
        totalSeeds: selecionadas.length,
        shopeeRequests,
        shopeeSuccess,
        shopeeErrors,
        shopeeZeroResults: shopeeZero,
        shopeeCandidatesTotal,
        porEstrategia,
        diagnosticos: diagnosticosGlobais,
        resultados,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log("\n=== PROBE CROSS-MARKET ===");
  console.log(`SHOPEE_REQUESTS=${shopeeRequests}`);
  console.log(`SHOPEE_SUCCESS=${shopeeSuccess}`);
  console.log(`SHOPEE_CANDIDATES=${shopeeCandidatesTotal}`);
  console.log(`SHOPEE_ZERO_RESULTS=${shopeeZero}`);
  console.log(`SHOPEE_ERRORS=${shopeeErrors}`);
  console.log(`SHOPEE_DIAGNOSTICOS=${JSON.stringify(diagnosticosGlobais)}`);
  console.log(`SHOPEE_BY_STRATEGY=${JSON.stringify(porEstrategia)}`);
  console.log(`PROBE_SAVED=${caminhoSaida}`);
}

void main();