import {
  listarDiscoveryAdaptersAtivos,
} from "./core/registry";

import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
  ProductDiscoveryResult,
} from "./core/types";

import {
  avaliarCompatibilidadeComConsulta,
  criarCanonicalKeyDaIdentidade,
  criarConsultasGlobaisDeIdentidade,
  papelDaIdentidade,
  pontuarEspecificidadeDaConsulta,
  pontuarEvidenciaIdentidade,
  resolverIdentidadeProduto,
} from "@/services/identity";
import { rastrearFiltrosMarketplace } from "./marketplaceTrace";
import { traceMultiloja } from "@/services/multiloja/trace";

const LIMITE_PADRAO = 5;
const LIMITE_MAXIMO = 20;

export type DiscoveryOptions = {
  excludeMarketplace?:
    | DiscoveryCandidate["marketplace"]
    | null;
  mode?: "DEFAULT" | "MULTILOJA";
};

function normalizarTexto(
  valor: string,
): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizarLimite(
  valor?: number,
): number {
  if (
    valor === undefined ||
    !Number.isFinite(valor)
  ) {
    return LIMITE_PADRAO;
  }

  return Math.min(
    LIMITE_MAXIMO,
    Math.max(1, Math.trunc(valor)),
  );
}

function criarChaveCandidato(
  candidato: DiscoveryCandidate,
): string {
  return [
    candidato.marketplace,
    candidato.externalId
      .trim()
      .toLowerCase(),
  ].join(":");
}

function pontuarCompletudeCandidato(
  candidato: DiscoveryCandidate,
): number {
  return (
    Number(Boolean(candidato.image?.trim())) * 3 +
    Number(candidato.price !== null) * 3 +
    Number(Boolean(candidato.affiliateLink?.trim())) * 2 +
    Number(Boolean(candidato.brand?.trim())) +
    Object.keys(candidato.attributes ?? {}).length * 0.1
  );
}

function removerDuplicados(
  candidatos: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  const encontrados =
    new Map<string, DiscoveryCandidate>();

  for (const candidato of candidatos) {
    const chave =
      criarChaveCandidato(candidato);

    const existente =
      encontrados.get(chave);

    if (!existente) {
      encontrados.set(chave, candidato);
      continue;
    }

    const pontuacaoExistente =
      pontuarCompletudeCandidato(existente);
    const pontuacaoNovo =
      pontuarCompletudeCandidato(candidato);

    if (
      pontuacaoNovo > pontuacaoExistente ||
      (
        pontuacaoNovo === pontuacaoExistente &&
        candidato.price !== null &&
        (
          existente.price === null ||
          candidato.price < existente.price
        )
      )
    ) {
      encontrados.set(chave, candidato);
    }
  }

  return Array.from(encontrados.values());
}

function ordenarCandidatos(
  candidatos: DiscoveryCandidate[],
  consulta?: string,
): DiscoveryCandidate[] {
  return [...candidatos].sort(
    (primeiro, segundo) => {
      const primeiroDisponivel =
        primeiro.status === "FOUND" ? 1 : 0;
      const segundoDisponivel =
        segundo.status === "FOUND" ? 1 : 0;

      if (
        primeiroDisponivel !==
        segundoDisponivel
      ) {
        return (
          segundoDisponivel -
          primeiroDisponivel
        );
      }

      if (consulta) {
        const primeiroMatch =
          avaliarCandidatoContraConsulta(
            primeiro,
            consulta,
          );
        const segundoMatch =
          avaliarCandidatoContraConsulta(
            segundo,
            consulta,
          );

        if (primeiroMatch.score !== segundoMatch.score) {
          return segundoMatch.score - primeiroMatch.score;
        }

        const primeiraEspecificidade = pontuarEspecificidadeDaConsulta(
          consulta,
          {
            title: primeiro.title,
            brand: primeiro.brand ?? null,
            attributes: primeiro.attributes ?? {},
          },
        );
        const segundaEspecificidade = pontuarEspecificidadeDaConsulta(
          consulta,
          {
            title: segundo.title,
            brand: segundo.brand ?? null,
            attributes: segundo.attributes ?? {},
          },
        );

        if (primeiraEspecificidade !== segundaEspecificidade) {
          return segundaEspecificidade - primeiraEspecificidade;
        }

        const primeiraIdentidade = pontuarEvidenciaIdentidade({
          product: {
            title: primeiro.title,
            brand: primeiro.brand ?? null,
            attributes: primeiro.attributes ?? {},
          },
        });
        const segundaIdentidade = pontuarEvidenciaIdentidade({
          product: {
            title: segundo.title,
            brand: segundo.brand ?? null,
            attributes: segundo.attributes ?? {},
          },
        });

        if (primeiraIdentidade !== segundaIdentidade) {
          return segundaIdentidade - primeiraIdentidade;
        }
      }

      return (
        (primeiro.price ?? Number.POSITIVE_INFINITY) -
        (segundo.price ?? Number.POSITIVE_INFINITY)
      );
    },
  );
}

function avaliarCandidatoContraConsulta(
  candidato: DiscoveryCandidate,
  consulta: string,
) {
  return avaliarCompatibilidadeComConsulta(
    consulta,
    {
      title: candidato.title,
      brand: candidato.brand ?? null,
      attributes: candidato.attributes ?? {},
    },
  );
}

function filtrarCandidatosPorConsulta(
  candidatos: DiscoveryCandidate[],
  consulta: string,
): DiscoveryCandidate[] {
  const kept: DiscoveryCandidate[] = [];
  const byMarketplace = new Map<
    DiscoveryCandidate["marketplace"],
    Array<{
      title: string;
      externalId: string;
      stage: string;
      status: "KEPT" | "DROPPED";
      reason: string;
      lexicalScore: number;
    }>
  >();

  for (const candidato of candidatos) {
    const match = avaliarCandidatoContraConsulta(
      candidato,
      consulta,
    );
    const events = byMarketplace.get(candidato.marketplace) ?? [];

    events.push({
      title: candidato.title,
      externalId: candidato.externalId,
      stage: "query-identity",
      status: match.compatible ? "KEPT" : "DROPPED",
      reason: match.reason,
      lexicalScore: match.textRelevance,
    });
    byMarketplace.set(candidato.marketplace, events);

    if (match.compatible) {
      kept.push(candidato);
    }
  }

  for (const [marketplace, events] of byMarketplace) {
    rastrearFiltrosMarketplace({
      marketplace,
      query: consulta,
      events: events.filter((event) => event.status === "DROPPED"),
    });
  }

  return kept;
}

function erroTemporarioDiscovery(
  mensagem: string | null | undefined,
): boolean {
  if (!mensagem) {
    return false;
  }

  return /fetch failed|timeout|timed out|429|503|502|500|econnreset|enotfound|eai_again|socket|temporar|indisponivel|rate limit|too many requests|access_denied|403/i.test(
    mensagem,
  );
}

function aguardar(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function executarAdapter(
  adapter: DiscoveryAdapter,
  query: string,
  limit: number,
  mode: "DEFAULT" | "MULTILOJA",
): Promise<MarketplaceDiscoveryResult> {
  if (!adapter.searcher) {
    return {
      marketplace: adapter.marketplace,
      query,
      success: false,
      candidates: [],
      scanned: 0,
      error:
        "Marketplace sem mecanismo de busca configurado.",
    };
  }

  try {
    return await adapter.searcher({
      query,
      normalizedQuery:
        normalizarTexto(query),
      limit,
      mode,
      targetProductId: null,
    });
  } catch (error) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido durante a descoberta.";

    console.error(
      `Erro na busca automatica de ${adapter.marketplaceName}:`,
      error,
    );

    return {
      marketplace: adapter.marketplace,
      query,
      success: false,
      candidates: [],
      scanned: 0,
      error: mensagem.slice(0, 1000),
    };
  }
}

async function executarAdapterComResiliencia(
  adapter: DiscoveryAdapter,
  query: string,
  limit: number,
  mode: "DEFAULT" | "MULTILOJA",
): Promise<MarketplaceDiscoveryResult> {
  const tentativas = 2;
  let ultimo: MarketplaceDiscoveryResult | null = null;

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    ultimo = await executarAdapter(
      adapter,
      query,
      limit,
      mode,
    );

    if (ultimo.success && ultimo.candidates.length > 0) {
      return ultimo;
    }

    const deveRepetir =
      tentativa < tentativas &&
      (
        !ultimo.success ||
        erroTemporarioDiscovery(ultimo.error)
      );

    if (!deveRepetir) {
      return ultimo;
    }

    await aguardar(250 * tentativa);
  }

  return ultimo!;
}

async function executarAdapterComPlanoGlobal(
  adapter: DiscoveryAdapter,
  consultaOriginal: string,
  consultasGlobais: string[],
  limit: number,
  mode: "DEFAULT" | "MULTILOJA",
): Promise<MarketplaceDiscoveryResult> {
  /*
   * Cada marketplace recebe o MESMO plano de consultas.
   * Nenhum resultado de uma loja e usado para definir a busca da outra.
   */
  const resultados = await Promise.all(
    consultasGlobais.map((consulta) =>
      executarAdapterComResiliencia(
        adapter,
        consulta,
        limit,
        mode,
      ),
    ),
  );

  const candidatosBrutos =
    resultados.flatMap(
      (resultado) =>
        resultado.candidates,
    );

  /*
   * O filtro de identidade e unico para DEFAULT e MULTILOJA.
   * MULTILOJA amplia apenas a amostra entregue ao clusterizador.
   */
  const posFiltroConsulta =
    filtrarCandidatosPorConsulta(
      candidatosBrutos,
      consultaOriginal,
    );

  const posDedup =
    removerDuplicados(
      posFiltroConsulta,
    );

  const limiteSaida =
    mode === "MULTILOJA"
      ? Math.min(
          Math.max(limit * 3, 12),
          LIMITE_MAXIMO,
        )
      : limit;

  const candidatos =
    ordenarCandidatos(posDedup, consultaOriginal)
      .slice(0, limiteSaida);

  const sucessos =
    resultados.filter(
      (resultado) =>
        resultado.success,
    );

  const erros =
    resultados
      .filter(
        (resultado) =>
          !resultado.success &&
          Boolean(resultado.error),
      )
      .map(
        (resultado) =>
          resultado.error!,
      );

  return {
    marketplace: adapter.marketplace,
    query: consultaOriginal,
    success: sucessos.length > 0,
    candidates: candidatos,
    scanned: resultados.reduce(
      (total, resultado) =>
        total + resultado.scanned,
      0,
    ),
    error:
      sucessos.length > 0
        ? null
        : erros.length > 0
          ? erros.join(" | ").slice(0, 1000)
          : null,
  };
}

export async function descobrirProdutosComAdapters(
  rawQuery: string,
  adapters: DiscoveryAdapter[],
  rawLimit?: number,
  options: DiscoveryOptions = {},
): Promise<ProductDiscoveryResult> {
  const query = rawQuery.trim();

  if (!query) {
    throw new Error(
      "Informe um termo para a descoberta automatica.",
    );
  }

  const normalizedQuery =
    normalizarTexto(query);

  if (!normalizedQuery) {
    throw new Error(
      "O termo informado nao e valido para busca.",
    );
  }

  const limit =
    normalizarLimite(rawLimit);
  const startedAt = new Date();
  const mode =
    options.mode ?? "DEFAULT";

  const adaptersAtivos = adapters.filter(
    (adapter) =>
      adapter.enabled &&
      adapter.searcher !== null &&
      adapter.marketplace !== options.excludeMarketplace,
  );

  if (adaptersAtivos.length === 0) {
    throw new Error(
      "Nenhum marketplace possui busca automatica habilitada.",
    );
  }

  /*
   * DISCOVERY GLOBAL
   *
   * Todas as lojas sao fontes equivalentes de candidatos. O plano nasce
   * somente da consulta do cliente; Mercado Livre, Amazon, Shopee, Magalu
   * ou AliExpress jamais viram ancora para outra marketplace.
   */
  const consultasGlobais =
    criarConsultasGlobaisDeIdentidade(query);

  const consultas =
    consultasGlobais.length > 0
      ? consultasGlobais
      : [query];

  traceMultiloja("discovery-start", {
    query,
    marketplaces: adaptersAtivos.map((adapter) => adapter.marketplace),
    plan: consultas,
    mode,
  });

  const resultados = await Promise.all(
    adaptersAtivos.map((adapter) =>
      executarAdapterComPlanoGlobal(
        adapter,
        query,
        consultas,
        limit,
        mode,
      ),
    ),
  );

  for (const resultado of resultados) {
    traceMultiloja("marketplace", {
      marketplace: resultado.marketplace,
      success: resultado.success,
      candidates: resultado.candidates.length,
      scanned: resultado.scanned,
      error: resultado.error,
    });

    for (const candidato of resultado.candidates) {
      const identity = resolverIdentidadeProduto({
        title: candidato.title,
        brand: candidato.brand ?? null,
        attributes: candidato.attributes ?? {},
      });
      const match = avaliarCandidatoContraConsulta(candidato, query);

      traceMultiloja("candidate", {
        marketplace: resultado.marketplace,
        title: candidato.title,
        externalId: candidato.externalId,
        price: candidato.price,
        sourceUrl: candidato.sourceUrl,
        productRole: papelDaIdentidade(identity),
        roleReason: identity.roleReason,
        soldItemType: identity.soldItemType,
        hostItemType: identity.hostItemType,
        compatibilityRelation: identity.compatibilityRelation,
        hostModelCandidates: identity.hostModelCandidates,
        identityModelCandidates: identity.identityModelCandidates,
        modelCandidates: identity.compatibleModels,
        selectedModel: identity.model,
        commercialModel: identity.commercialModel,
        manufacturerSku: identity.manufacturerSku,
        variantCodes: identity.variantCodes,
        condition: identity.variants.condition ?? "new",
        modelAmbiguous: identity.modelAmbiguous,
        identityConfidence: identity.identityConfidence,
        multiModelCompatibility: identity.multiModelCompatibility,
        queryTextRelevance: match.textRelevance,
        queryRoleCompatibility: match.roleCompatible,
        queryRelevance: match.compatible ? match.score : 0,
        canonicalKey: criarCanonicalKeyDaIdentidade(identity),
      });
    }
  }

  /*
   * Segunda barreira global depois de unir todas as lojas. Isso impede que
   * qualquer adapter ou caminho MULTILOJA contorne o motor de identidade.
   */
  const candidatos =
    ordenarCandidatos(
      removerDuplicados(
        filtrarCandidatosPorConsulta(
          resultados.flatMap(
            (resultado) =>
              resultado.candidates,
          ),
          query,
        ),
      ),
      query,
    );

  const completedAt = new Date();

  return {
    query,
    normalizedQuery,
    startedAt,
    completedAt,
    results: resultados,
    candidates: candidatos,
    found: candidatos.filter(
      (candidato) =>
        candidato.status === "FOUND",
    ).length,
    errors: resultados.filter(
      (resultado) =>
        !resultado.success,
    ).length,
  };
}

export async function descobrirProdutos(
  rawQuery: string,
  rawLimit?: number,
  options: DiscoveryOptions = {},
): Promise<ProductDiscoveryResult> {
  return descobrirProdutosComAdapters(
    rawQuery,
    listarDiscoveryAdaptersAtivos(),
    rawLimit,
    options,
  );
}
