/**
 * CONSTRUÇÃO DO DATASET ROTULADO (§8) — SOMENTE LEITURA, BLIND.
 *
 * Este script emite os PARES (seed ML × candidato cross-market) com os
 * atributos reais, e NADA mais. Ele não roda o matcher, não roda a política
 * de identidade e não calcula decisão: rotular o ground truth com o mesmo
 * motor que será avaliado tornaria o benchmark circular (ele mediria o
 * matcher concordando consigo mesmo).
 *
 * A ordem correta é:
 *   1. Coleta real dos dados            (xm-probe-ml-seeds, xm-probe-cross-market)
 *   2. Montar os pares e rotular     (ESTE script + anotação explícita)
 *   3. Rodar o matcher e medir       (xm-benchmark-run)
 *
 * Nenhuma escrita no banco. Nenhuma publicação.
 */
import { readFileSync, writeFileSync } from "node:fs";

import {
  derivarCamposDeIdentidade,
  extrairModelo,
  extrairSize,
  extrairStorage,
  tokensDistintivos,
} from "@/services/architecture/v1/benchmark/candidateSearch";

type SeedMl = {
  itemId: string;
  title: string;
  price: number;
  sellerId: string | null;
  catalogProductId: string | null;
  categoryId: string;
  gtin: string | null;
  brand: string | null;
};

type ProbeFile = {
  resultados: Array<{
    seedItemId: string;
    seedTitle: string;
    seedGtin: string | null;
    seedBrand: string | null;
    categoryId: string;
    shopeeCandidates: Array<{
      externalListingId: string;
      title: string;
      price: number;
      seller: string | null;
      queryStrategy: string;
    }>;
  }>;
};

type LinhaRotulo = {
  rowId: string;
  seedMarketplace: string;
  seedExternalId: string;
  seedTitle: string;
  seedBrand: string | null;
  seedModel: string | null;
  seedGtin: string | null;
  seedStorage: string | null;
  seedSize: string | null;
  seedPrice: number;
  candidateMarketplace: string;
  candidateExternalId: string;
  candidateTitle: string;
  candidateBrand: string | null;
  candidateModel: string | null;
  candidateGtin: string | null;
  candidateStorage: string | null;
  candidateSize: string | null;
  candidatePrice: number;
  rank: number;
  queryStrategy: string;
  label: "SAME" | "DIFFERENT" | "AMBIGUOUS";
  reason: string;
};

function marcaDoTitulo(titulo: string, brandConhecido: string | null): string | null {
  if (brandConhecido) return brandConhecido;
  const tokens = titulo.split(/\s+/).filter(Boolean);
  return tokens.length > 0 ? (tokens[0] ?? null) : null;
}

function main() {
  const caminhoProbe = process.argv[2];
  const caminhoSaida = process.argv[3];
  const topN = Number(process.argv[4] ?? "5");

  const probe = JSON.parse(readFileSync(caminhoProbe, "utf8")) as ProbeFile;

  const linhas: LinhaRotulo[] = [];

  for (const resultado of probe.resultados) {
    const campos = derivarCamposDeIdentidade({
      title: resultado.seedTitle,
      brand: resultado.seedBrand,
      gtin: resultado.seedGtin,
    });

    resultado.shopeeCandidates.slice(0, topN).forEach((candidato, indice) => {
      const marcaCandidato = marcaDoTitulo(
        candidato.title,
        marcaDoTitulo(resultado.seedTitle, resultado.seedBrand),
      );

      linhas.push({
        rowId: `ml:${resultado.seedItemId}__shopee:${candidato.externalListingId}`,
        seedMarketplace: "mercadolivre",
        seedExternalId: resultado.seedItemId,
        seedTitle: resultado.seedTitle,
        seedBrand: resultado.seedBrand,
        seedModel: campos.model,
        seedGtin: resultado.seedGtin,
        seedStorage: campos.storage,
        seedSize: campos.size,
        seedPrice: 0,
        candidateMarketplace: "shopee",
        candidateExternalId: candidato.externalListingId,
        candidateTitle: candidato.title,
        candidateBrand: marcaCandidato,
        candidateModel: extrairModelo(candidato.title, marcaCandidato),
        candidateGtin: null,
        candidateStorage: extrairStorage(candidato.title),
        candidateSize: extrairSize(candidato.title),
        candidatePrice: candidato.price,
        rank: indice + 1,
        queryStrategy: candidato.queryStrategy,
        label: "AMBIGUOUS",
        reason: "PENDENTE_ANOTACAO",
      });
    });
  }

  writeFileSync(caminhoSaida, `${JSON.stringify(linhas, null, 2)}\n`, "utf8");

  console.log(`[dataset] pares=${linhas.length} -> ${caminhoSaida}`);
  console.log(
    `[dataset] tokens_distintivos_exemplo=${JSON.stringify(
      tokensDistintivos(probe.resultados[0]?.seedTitle ?? "", probe.resultados[0]?.seedBrand ?? null),
    )}`,
  );
}

void main();