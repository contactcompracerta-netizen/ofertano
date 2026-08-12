import {
  listarDiscoveryAdaptersAtivos,
} from "./core/registry";

import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
  ProductDiscoveryResult,
} from "./core/types";

const LIMITE_PADRAO = 5;
const LIMITE_MAXIMO = 20;

const MAX_CONSULTAS_REFERENCIA = 4;

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

  for (
    const candidato of candidatos
  ) {
    const chave =
      criarChaveCandidato(
        candidato,
      );

    const existente =
      encontrados.get(chave);

    if (!existente) {
      encontrados.set(
        chave,
        candidato,
      );

      continue;
    }

    const pontuacaoExistente =
      Number(
        Boolean(
          existente.image,
        ),
      ) +
      Number(
        existente.price !== null,
      ) +
      Number(
        Boolean(
          existente.affiliateLink,
        ),
      );

    const pontuacaoNovo =
      Number(
        Boolean(
          candidato.image,
        ),
      ) +
      Number(
        candidato.price !== null,
      ) +
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
    (
      primeiro,
      segundo,
    ) => {
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

function extrairArmazenamentoTitulo(
  valor: string,
): string | null {
  const tokens =
    normalizarTexto(valor)
      .split(" ")
      .filter(Boolean);

  const encontrados =
    new Set<string>();

  for (
    let index = 0;
    index < tokens.length - 1;
    index += 1
  ) {
    const numero =
      tokens[index];

    const unidade =
      tokens[index + 1];

    if (
      !numero ||
      !/^\d+(?:\.\d+)?$/.test(numero) ||
      (
        unidade !== "gb" &&
        unidade !== "tb"
      )
    ) {
      continue;
    }

    /*
     * Ignora valores de RAM:
     * "8 GB RAM"
     * "8 GB de RAM"
     */
    const proximos =
      tokens.slice(
        index + 2,
        index + 5,
      );

    if (
      proximos.includes("ram")
    ) {
      continue;
    }

    encontrados.add(
      `${numero} ${unidade.toUpperCase()}`,
    );
  }

  /*
   * Se o anúncio mistura 128/256 GB,
   * não usamos capacidade ambígua.
   */
  if (
    encontrados.size !== 1
  ) {
    return null;
  }

  return (
    Array.from(
      encontrados,
    )[0] ??
    null
  );
}

function criarConsultaReferencia(
  candidato: DiscoveryCandidate,
  consultaOriginal: string,
): string {
  const consulta =
    consultaOriginal.trim();

  const partes: string[] =
    [];

  const marca =
    candidato.brand?.trim();

  if (marca) {
    const consultaNormalizada =
      ` ${normalizarTexto(consulta)} `;

    const marcaNormalizada =
      normalizarTexto(marca);

    if (
      marcaNormalizada &&
      !consultaNormalizada.includes(
        ` ${marcaNormalizada} `,
      )
    ) {
      partes.push(
        marca,
      );
    }
  }

  partes.push(
    consulta,
  );

  const armazenamentoConsulta =
    extrairArmazenamentoTitulo(
      consulta,
    );

  if (!armazenamentoConsulta) {
    const armazenamentoProduto =
      extrairArmazenamentoTitulo(
        candidato.title,
      );

    if (armazenamentoProduto) {
      partes.push(
        armazenamentoProduto,
      );
    }
  }

  return partes
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");
}
function criarConsultasReferencia(
  candidatos:
    DiscoveryCandidate[],
  consultaOriginal: string,
): string[] {
  const consultas =
    new Map<
      string,
      string
    >();

  /*
   * Mantemos sempre a busca original.
   * As referências canônicas entram como tentativas
   * adicionais, nunca como substituição total.
   */
  consultas.set(
    normalizarTexto(
      consultaOriginal,
    ),
    consultaOriginal,
  );

  for (
    const candidato of candidatos
  ) {
    if (
      candidato.status !==
      "FOUND"
    ) {
      continue;
    }

    const consulta =
      criarConsultaReferencia(candidato, consultaOriginal);

    if (!consulta) {
      continue;
    }

    const chave =
      normalizarTexto(
        consulta,
      );

    if (
      !consultas.has(chave)
    ) {
      consultas.set(
        chave,
        consulta,
      );
    }

    if (
      consultas.size >=
      MAX_CONSULTAS_REFERENCIA
    ) {
      break;
    }
  }

  if (
    consultas.size === 0
  ) {
    return [
      consultaOriginal,
    ];
  }

  return Array.from(
    consultas.values(),
  );
}

async function executarAdapter(
  adapter: DiscoveryAdapter,
  query: string,
  limit: number,
): Promise<MarketplaceDiscoveryResult> {
  if (!adapter.searcher) {
    return {
      marketplace:
        adapter.marketplace,

      query,

      success:
        false,

      candidates:
        [],

      scanned:
        0,

      error:
        "Marketplace sem mecanismo de busca configurado.",
    };
  }

  try {
    return await adapter.searcher({
      query,

      normalizedQuery:
        normalizarTexto(
          query,
        ),

      limit,

      targetProductId:
        null,
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

      success:
        false,

      candidates:
        [],

      scanned:
        0,

      error:
        mensagem.slice(
          0,
          1000,
        ),
    };
  }
}

async function executarAdapterComReferencias(
  adapter: DiscoveryAdapter,
  consultaOriginal: string,
  consultasReferencia: string[],
  limit: number,
): Promise<MarketplaceDiscoveryResult> {
  const resultados =
    await Promise.all(
      consultasReferencia.map(
        (consulta) =>
          executarAdapter(
            adapter,
            consulta,
            limit,
          ),
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
    ).slice(
      0,
      limit,
    );

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
          Boolean(
            resultado.error,
          ),
      )
      .map(
        (resultado) =>
          resultado.error!,
      );

  return {
    marketplace:
      adapter.marketplace,

    query:
      consultaOriginal,

    success:
      sucessos.length > 0,

    candidates:
      candidatos,

    scanned:
      resultados.reduce(
        (
          total,
          resultado,
        ) =>
          total +
          resultado.scanned,
        0,
      ),

    error:
      sucessos.length > 0
        ? null
        : erros.length > 0
          ? erros
              .join(" | ")
              .slice(
                0,
                1000,
              )
          : null,
  };
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
    normalizarTexto(
      query,
    );

  if (!normalizedQuery) {
    throw new Error(
      "O termo informado não é válido para busca.",
    );
  }

  const limit =
    normalizarLimite(
      rawLimit,
    );

  const startedAt =
    new Date();

  const adapters =
    listarDiscoveryAdaptersAtivos();

  if (
    adapters.length === 0
  ) {
    throw new Error(
      "Nenhum marketplace possui busca automática habilitada.",
    );
  }

  /*
   * O Mercado Livre funciona como fonte inicial de
   * identificação do produto canônico.
   *
   * Depois usamos os títulos validados para refinar
   * a busca nos demais marketplaces.
   */
  const referencia =
    adapters.find(
      (adapter) =>
        adapter.marketplace ===
        "MERCADO_LIVRE",
    );

  const demais =
    adapters.filter(
      (adapter) =>
        adapter.marketplace !==
        "MERCADO_LIVRE",
    );

  const resultados:
    MarketplaceDiscoveryResult[] =
      [];

  let resultadoReferencia:
    MarketplaceDiscoveryResult |
    null = null;

  if (referencia) {
    resultadoReferencia =
      await executarAdapter(
        referencia,
        query,
        limit,
      );

    resultados.push(
      resultadoReferencia,
    );
  }

  const consultasReferencia =
    resultadoReferencia?.success &&
    resultadoReferencia
      .candidates
      .length > 0
      ? criarConsultasReferencia(
          resultadoReferencia
            .candidates,
          query,
        )
      : [
          query,
        ];

  const resultadosDemais =
    await Promise.all(
      demais.map(
        (adapter) =>
          executarAdapterComReferencias(
            adapter,
            query,
            consultasReferencia,
            limit,
          ),
      ),
    );

  resultados.push(
    ...resultadosDemais,
  );

  /*
   * Caso o Mercado Livre não esteja habilitado,
   * ainda permitimos que os demais adapters
   * trabalhem normalmente com a consulta original.
   */
  if (
    !referencia &&
    demais.length === 0
  ) {
    throw new Error(
      "Nenhum marketplace possui mecanismo de descoberta disponível.",
    );
  }

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

    results:
      resultados,

    candidates:
      candidatos,

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


