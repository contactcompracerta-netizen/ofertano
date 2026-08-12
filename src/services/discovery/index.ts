import {
    listarDiscoveryAdaptersAtivos,
  } from "./core/registry";
  
  import type {
    DiscoveryCandidate,
    MarketplaceDiscoveryResult,
    ProductDiscoveryResult,
  } from "./core/types";
  
  const LIMITE_PADRAO = 5;
  const LIMITE_MAXIMO = 20;
  
  function normalizarTexto(
    valor: string,
  ): string {
    return valor
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
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
      Math.max(
        1,
        Math.trunc(valor),
      ),
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
  
  function removerDuplicados(
    candidatos: DiscoveryCandidate[],
  ): DiscoveryCandidate[] {
    const encontrados =
      new Map<
        string,
        DiscoveryCandidate
      >();
  
    for (const candidato of candidatos) {
      const chave =
        criarChaveCandidato(candidato);
  
      const existente =
        encontrados.get(chave);
  
      if (!existente) {
        encontrados.set(
          chave,
          candidato,
        );
  
        continue;
      }
  
      /*
       * Se o mesmo item aparecer mais de uma vez,
       * preservamos o candidato com dados mais úteis.
       */
      const pontuacaoExistente =
        Number(Boolean(existente.image)) +
        Number(existente.price !== null) +
        Number(
          Boolean(
            existente.affiliateLink,
          ),
        );
  
      const pontuacaoNovo =
        Number(Boolean(candidato.image)) +
        Number(candidato.price !== null) +
        Number(
          Boolean(
            candidato.affiliateLink,
          ),
        );
  
      if (
        pontuacaoNovo >
        pontuacaoExistente
      ) {
        encontrados.set(
          chave,
          candidato,
        );
      }
    }
  
    return Array.from(
      encontrados.values(),
    );
  }
  
  function ordenarCandidatos(
    candidatos: DiscoveryCandidate[],
  ): DiscoveryCandidate[] {
    return [...candidatos].sort(
      (primeiro, segundo) => {
        const primeiroDisponivel =
          primeiro.status === "FOUND"
            ? 1
            : 0;
  
        const segundoDisponivel =
          segundo.status === "FOUND"
            ? 1
            : 0;
  
        if (
          primeiroDisponivel !==
          segundoDisponivel
        ) {
          return (
            segundoDisponivel -
            primeiroDisponivel
          );
        }
  
        const primeiroPreco =
          primeiro.price ??
          Number.POSITIVE_INFINITY;
  
        const segundoPreco =
          segundo.price ??
          Number.POSITIVE_INFINITY;
  
        return (
          primeiroPreco -
          segundoPreco
        );
      },
    );
  }
  
  export async function descobrirProdutos(
    rawQuery: string,
    rawLimit?: number,
  ): Promise<ProductDiscoveryResult> {
    const query =
      rawQuery.trim();
  
    if (!query) {
      throw new Error(
        "Informe um termo para a descoberta automática.",
      );
    }
  
    const normalizedQuery =
      normalizarTexto(query);
  
    if (!normalizedQuery) {
      throw new Error(
        "O termo informado não é válido para busca.",
      );
    }
  
    const limit =
      normalizarLimite(rawLimit);
  
    const startedAt =
      new Date();
  
    const adapters =
      listarDiscoveryAdaptersAtivos();
  
    if (adapters.length === 0) {
      throw new Error(
        "Nenhum marketplace possui busca automática habilitada.",
      );
    }
  
    const resultados =
      await Promise.all(
        adapters.map(
          async (
            adapter,
          ): Promise<MarketplaceDiscoveryResult> => {
            if (!adapter.searcher) {
              return {
                marketplace:
                  adapter.marketplace,
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
                normalizedQuery,
                limit,
                targetProductId: null,
              });
            } catch (error) {
              const mensagem =
                error instanceof Error
                  ? error.message
                  : "Erro desconhecido durante a descoberta.";
  
              console.error(
                `Erro na busca automática de ${adapter.marketplaceName}:`,
                error,
              );
  
              return {
                marketplace:
                  adapter.marketplace,
                query,
                success: false,
                candidates: [],
                scanned: 0,
                error:
                  mensagem.slice(
                    0,
                    1000,
                  ),
              };
            }
          },
        ),
      );
  
    const candidatos =
      ordenarCandidatos(
        removerDuplicados(
          resultados.flatMap(
            (resultado) =>
              resultado.candidates,
          ),
        ),
      );
  
    const completedAt =
      new Date();
  
    return {
      query,
      normalizedQuery,
  
      startedAt,
      completedAt,
  
      results: resultados,
  
      candidates: candidatos,
  
      found:
        candidatos.filter(
          (candidato) =>
            candidato.status ===
            "FOUND",
        ).length,
  
      errors:
        resultados.filter(
          (resultado) =>
            !resultado.success,
        ).length,
    };
  }