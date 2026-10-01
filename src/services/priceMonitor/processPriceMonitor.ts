import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { saveProduct } from "@/services/database/saveProduct";
import { importarProduto } from "@/services/importers";
import { montarContextoAlertas } from "@/services/priceAlerts/priceContext";
import { createPrismaPriceAlertRepository } from "@/services/priceAlerts/repository";
import { processProductAlerts } from "@/services/priceAlerts/processProductAlerts";
import { buscarEmailDoUsuario } from "@/services/priceAlerts/userEmail";
import { refreshOfertaListingFirst } from "@/services/priceMonitor/listingFirstRefresh";

const LIMITE_PADRAO = 5;
const LIMITE_MAXIMO = 10;

const INTERVALO_SUCESSO_MS = 6 * 60 * 60 * 1000;
const TEMPO_BLOQUEIO_PROCESSAMENTO_MS = 15 * 60 * 1000;

type ResultadoOferta = {
  offerId: string;
  productId: string;
  marketplace: string;
  success: boolean;
  priceBefore: number;
  priceAfter?: number;
  priceChanged?: boolean;
  nextCheckAt: string;
  error?: string;
  /**
   * Caminho de refresh usado. `LISTING_FIRST` = oferta ML com identidade de
   * anuncio (`identityVersion >= 1`), refrescada pelo catalogo.
   * `LEGACY_SOURCE_URL` = importacao por URL.
   */
  refreshPath?: "LISTING_FIRST" | "LEGACY_SOURCE_URL";
  /** Quando a oferta listing-first nao apareceu no catalogo. */
  notSeen?: boolean;
};

function normalizarLimite(valor: number) {
  if (!Number.isFinite(valor)) {
    return LIMITE_PADRAO;
  }

  return Math.min(
    LIMITE_MAXIMO,
    Math.max(1, Math.trunc(valor)),
  );
}

function adicionarMilissegundos(
  data: Date,
  milissegundos: number,
) {
  return new Date(data.getTime() + milissegundos);
}

function proximoCheckDepoisDeErro(
  quantidadeErros: number,
  agora: Date,
) {
  let atrasoMs: number;

  if (quantidadeErros <= 1) {
    atrasoMs = 30 * 60 * 1000;
  } else if (quantidadeErros === 2) {
    atrasoMs = 2 * 60 * 60 * 1000;
  } else if (quantidadeErros === 3) {
    atrasoMs = 6 * 60 * 60 * 1000;
  } else {
    atrasoMs = 24 * 60 * 60 * 1000;
  }

  return adicionarMilissegundos(agora, atrasoMs);
}

function obterMensagemErro(error: unknown) {
  const mensagem =
    error instanceof Error
      ? error.message
      : "Erro desconhecido ao atualizar a oferta.";

  return mensagem.slice(0, 1900);
}

function marketplaceImportadoParaBanco(
  marketplace: string,
) {
  switch (marketplace) {
    case "Mercado Livre":
      return "MERCADO_LIVRE";

    case "Amazon":
      return "AMAZON";

    case "Shopee":
      return "SHOPEE";

    case "Magazine Luiza":
      return "MAGAZINE_LUIZA";

    case "AliExpress":
      return "ALIEXPRESS";

    default:
      return marketplace;
  }
}

function precoMudou(
  anterior: number,
  atual: number,
) {
  return Math.abs(anterior - atual) > 0.009;
}

/*
 * Guarda de identidade rejeitada no Price Monitor.
 *
 * O monitor NAO e responsavel por identidade: ofertas REJECTED nao
 * sao selecionadas para monitoramento (estrategia A). Mesmo que uma
 * oferta REJECTED chegue ao saveProduct por outro caminho, o upsert
 * preserva REJECTED — defesa em profundidade.
 *
 * LISTING-FIRST: a selecao mudou de "toda oferta com sourceUrl" para dois
 * caminhos explicitos:
 *
 *   MERCADO_LIVRE  -> identityVersion >= 1 (anuncio comprovado). NAO exige
 *                     `sourceUrl`: a prova e `externalId` (item_id) +
 *                     `catalogProductId`, e o refresh usa
 *                     `/products/{catalogProductId}/items`.
 *
 *   demais         -> continua exigindo `sourceUrl`, porque o refresh deles
 *                     e a importacao por URL.
 *
 * As 22 ofertas legadas (identityVersion 0, URL `/p/` de catalogo) ficam
 * FORA da selecao. Elas nao sao um erro: sao historico preservado que nao
 * pode ser reescrito por este caminho, e continuar tentando `saveProduct`
 * nelas so inflava `consecutiveErrors` a cada ciclo.
 *
 * Funcao pura e exportada para os testes de regressao.
 */
export function buildPriceMonitorCandidateWhere(
  agora: Date,
): Prisma.MarketplaceOfferWhereInput {
  return {
    active: true,
    matchStatus: {
      not: "REJECTED",
    },
    AND: [
      {
        OR: [
          {
            nextCheckAt: null,
          },
          {
            nextCheckAt: {
              lte: agora,
            },
          },
        ],
      },
      {
        OR: [
          {
            marketplace: {
              not: "MERCADO_LIVRE",
            },
            sourceUrl: {
              not: null,
            },
          },
          {
            marketplace: "MERCADO_LIVRE",
            identityVersion: {
              gte: 1,
            },
          },
        ],
      },
    ],
  };
}

/**
 * PASSO LISTING-FIRST — OBSERVAR NAO E PUBLICAR.
 *
 * `buildPriceMonitorCandidateWhere` exige `active: true`, porque no caminho
 * legado `active` e o unico sinal de que a oferta ainda faz sentido no
 * produto. Para MERCADO_LIVRE listing-first esse sinal nao serve:
 *
 *   - Uma oferta ML v1 NAO tem `sourceUrl` por contrato (a prova esta em
 *     `externalId`/`catalogProductId`/`rawPayload.listing.item_id`), e sem
 *     `sourceUrl` `classifyMercadoLivreListingIdentity` responde
 *     `MISSING_SOURCE_URL` => a oferta NUNCA e publicavel. Publicar exigiria
 *     fabricar uma URL, o que esta proibido.
 *   - Logo `active: false` nessas 25 linhas e consequencia de nao haver URL
 *     publica, nao de o preco estar obsoleto. Deixar o duty de observacao
 *     preso a essa flag mantinha 25 anuncios reais sem nunca serem
 *     refrescados: o preco ficaria congelado ate alguem inventar a URL.
 *
 * O duty de observacao e o duty de publicacao sao separados: este passo
 * seleciona a oferta ML v1 provada INDEPENDENTEMENTE de `active`, e o
 * refresh so escreve preco/vendedor/condicao/envio/rawPayload/
 * lastCheckedAt/contadores — nenhum desses campos publica a oferta. O gate de
 * publicacao continua sendo `isUsablePublicOffer`, intocado.
 *
 * O que este passo NAO abre:
 *   - as 22 legadas (`identityVersion = 0`) seguem fora, por construcao;
 *   - `REJECTED` continua fora (decisao do operador nao e revertida);
 *   - nenhuma outra marketplace e tocada (`marketplace: MERCADO_LIVRE`).
 *
 * Funcao pura e exportada para os testes de regressao.
 */
export function buildListingFirstMonitorCandidateWhere(
  agora: Date,
): Prisma.MarketplaceOfferWhereInput {
  return {
    matchStatus: {
      not: "REJECTED",
    },
    marketplace: "MERCADO_LIVRE",
    identityVersion: {
      gte: 1,
    },
    AND: [
      {
        OR: [
          {
            nextCheckAt: null,
          },
          {
            nextCheckAt: {
              lte: agora,
            },
          },
        ],
      },
    ],
  };
}

/** Oferta efetivamente selecionada pelo monitor. */
type OfertaSelecionada = {
  id: string;
  productId: string;
  marketplace: string;
  sourceUrl: string | null;
  affiliateLink: string | null;
  price: number;
  consecutiveErrors: number;
  identityVersion: number;
  externalId: string | null;
  catalogProductId: string | null;
  rawPayload: Prisma.JsonValue | null;
};

/** Projecao minima para as duas selecoes e para a ordenacao do lote. */
type OfertaCandidata = OfertaSelecionada & {
  active: boolean;
  nextCheckAt: Date | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
};

const SELECAO_OFERTA = {
  id: true,
  productId: true,
  marketplace: true,
  sourceUrl: true,
  affiliateLink: true,
  price: true,
  consecutiveErrors: true,
  identityVersion: true,
  externalId: true,
  catalogProductId: true,
  rawPayload: true,
  active: true,
  nextCheckAt: true,
  lastCheckedAt: true,
  createdAt: true,
} satisfies Prisma.MarketplaceOfferSelect;

const ORDEM_POR_VENCIMENTO: Prisma.MarketplaceOfferOrderByWithRelationInput[] = [
  {
    nextCheckAt: "asc",
  },
  {
    lastCheckedAt: "asc",
  },
  {
    createdAt: "asc",
  },
];

/**
 * `ASC` do Postgres coloca `NULL` por ultimo. Reproduzimos isso em memoria
 * para que a uniao dos dois lotes nao mude a ordem em relacao ao `ORDER BY`
 * do banco (que e quem decide o lote quando um dos dois sobra).
 */
function instanteOrdenavel(
  valor: Date | null,
): number {
  return valor === null
    ? Number.POSITIVE_INFINITY
    : valor.getTime();
}

function compararPorVencimento(
  esquerda: OfertaCandidata,
  direita: OfertaCandidata,
): number {
  const porVencimento =
    instanteOrdenavel(esquerda.nextCheckAt) -
    instanteOrdenavel(direita.nextCheckAt);

  if (porVencimento !== 0) {
    return porVencimento;
  }

  const porUltimoChecagem =
    instanteOrdenavel(esquerda.lastCheckedAt) -
    instanteOrdenavel(direita.lastCheckedAt);

  if (porUltimoChecagem !== 0) {
    return porUltimoChecagem;
  }

  return esquerda.createdAt.getTime() - direita.createdAt.getTime();
}

async function processarOfertaListingFirst(
  oferta: OfertaSelecionada,
  agora: Date,
): Promise<{ resultado: ResultadoOferta; atualizada: boolean; precoAlterado: boolean; erro: boolean }> {
  const refresh = await refreshOfertaListingFirst({
    id: oferta.id,
    productId: oferta.productId,
    externalId: oferta.externalId,
    catalogProductId: oferta.catalogProductId,
    rawPayload: oferta.rawPayload,
    identityVersion: oferta.identityVersion,
    price: oferta.price,
  }, agora);

  if (refresh.status === "ERROR") {
    const quantidadeErros = oferta.consecutiveErrors + 1;
    const nextCheckAt = proximoCheckDepoisDeErro(quantidadeErros, agora);

    await prisma.marketplaceOffer.update({
      where: { id: oferta.id },
      data: {
        lastCheckedAt: agora,
        nextCheckAt,
        consecutiveErrors: quantidadeErros,
        errorMessage: refresh.error,
      },
    });

    return {
      resultado: {
        offerId: oferta.id,
        productId: oferta.productId,
        marketplace: oferta.marketplace,
        success: false,
        priceBefore: oferta.price,
        nextCheckAt: nextCheckAt.toISOString(),
        error: refresh.error,
        refreshPath: "LISTING_FIRST",
      },
      atualizada: false,
      precoAlterado: false,
      erro: true,
    };
  }

  if (refresh.status === "SKIPPED") {
    /*
     * Nao deveria acontecer: a selecao ja filtra identityVersion >= 1.
     * Se acontecer, e uma oferta que perdeu `catalogProductId` — nao
     * contamos como erro e nao tocamos no banco.
     */
    const nextCheckAt = adicionarMilissegundos(agora, INTERVALO_SUCESSO_MS);

    return {
      resultado: {
        offerId: oferta.id,
        productId: oferta.productId,
        marketplace: oferta.marketplace,
        success: false,
        priceBefore: oferta.price,
        nextCheckAt: nextCheckAt.toISOString(),
        error: `[ML_LISTING_FIRST] ignorada: ${refresh.reason}`,
        refreshPath: "LISTING_FIRST",
      },
      atualizada: false,
      precoAlterado: false,
      erro: false,
    };
  }

  if (refresh.status === "NOT_SEEN") {
    /*
     * O catalogo respondeu sem aquele anuncio. Isso NAO e ruptura: o ultimo
     * estado bom permanece e a oferta volta ao ciclo normal. Nao marcamos
     * OUT_OF_STOCK nem trocamos de anuncio.
     */
    const nextCheckAt = adicionarMilissegundos(agora, INTERVALO_SUCESSO_MS);

    await prisma.marketplaceOffer.update({
      where: { id: oferta.id },
      data: {
        nextCheckAt,
      },
    });

    return {
      resultado: {
        offerId: oferta.id,
        productId: oferta.productId,
        marketplace: oferta.marketplace,
        success: true,
        priceBefore: oferta.price,
        priceAfter: oferta.price,
        priceChanged: false,
        nextCheckAt: nextCheckAt.toISOString(),
        refreshPath: "LISTING_FIRST",
        notSeen: true,
      },
      atualizada: false,
      precoAlterado: false,
      erro: false,
    };
  }

  const nextCheckAt = adicionarMilissegundos(agora, INTERVALO_SUCESSO_MS);

  await prisma.marketplaceOffer.update({
    where: { id: oferta.id },
    data: {
      nextCheckAt,
    },
  });

  return {
    resultado: {
      offerId: oferta.id,
      productId: oferta.productId,
      marketplace: oferta.marketplace,
      success: true,
      priceBefore: refresh.priceBefore,
      priceAfter: refresh.priceAfter,
      priceChanged: refresh.priceChanged,
      nextCheckAt: nextCheckAt.toISOString(),
      refreshPath: "LISTING_FIRST",
    },
    atualizada: true,
    precoAlterado: refresh.priceChanged,
    erro: false,
  };
}

export async function processPriceMonitor(
  requestedLimit = LIMITE_PADRAO,
) {
  const limit = normalizarLimite(requestedLimit);
  const agora = new Date();

  /*
   * DOIS LOTES, UMA REGRA DE DEDUP.
   *
   *   1. `buildPriceMonitorCandidateWhere` — nao-ML com `sourceUrl` e ML v1
   *      que esteja `active`. E o lote legado, com as garantias antigas.
   *   2. `buildListingFirstMonitorCandidateWhere` — ML v1 provada, com ou sem
   *      `active`. E o que tira as 25 ofertas de announce real da sombra.
   *
   * A interseccao (ML v1 `active`) aparece nos dois; a chave e `id`, entao a
   * uniao nao gera processamento duplicado nem contadores dobrados. O limite
   * `LIMITE_MAXIMO` e aplicado DEPOIS da uniao, entao nenhum parametro pode
   * elevar o teto.
   */
  const [loteMonitor, loteListingFirst] = await Promise.all([
    prisma.marketplaceOffer.findMany({
      where: buildPriceMonitorCandidateWhere(agora),
      orderBy: ORDEM_POR_VENCIMENTO,
      select: SELECAO_OFERTA,
    }),
    prisma.marketplaceOffer.findMany({
      where: buildListingFirstMonitorCandidateWhere(agora),
      orderBy: ORDEM_POR_VENCIMENTO,
      select: SELECAO_OFERTA,
    }),
  ]);

  const porId = new Map<string, OfertaCandidata>();

  for (const oferta of loteMonitor as OfertaCandidata[]) {
    porId.set(oferta.id, oferta);
  }

  let observadasInativas = 0;

  for (const oferta of loteListingFirst as OfertaCandidata[]) {
    if (!oferta.active) {
      observadasInativas += 1;
    }

    porId.set(oferta.id, oferta);
  }

  const ofertas = [...porId.values()]
    .sort(compararPorVencimento)
    .slice(0, limit);

  const resultados: ResultadoOferta[] = [];

  let atualizadas = 0;
  let precosAlterados = 0;
  let erros = 0;
  let ignoradas = 0;
  let listingFirstProcessadas = 0;
  let legadoIgnorado = 0;

  const dispararAlertas = async (entrada: {
    productId: string;
    previousPrice: number;
    currentPrice: number;
    productName: string;
    marketplace: string;
    store: string | null;
  }) => {
    try {
      const contexto = await montarContextoAlertas(entrada);

      const repositorio =
        await createPrismaPriceAlertRepository(prisma);

      await processProductAlerts(
        contexto,
        {
          repository: repositorio,
          resolverEmailDoUsuario: buscarEmailDoUsuario,
        },
      );
    } catch (errorAlertas) {
      console.error(
        "Erro ao processar alertas de preco (nao interrompe o monitor):",
        errorAlertas instanceof Error
          ? errorAlertas.message
          : "Erro desconhecido.",
      );
    }
  };

  for (const oferta of ofertas) {
    const inicio = new Date();

    const ehListingFirst =
      oferta.marketplace === "MERCADO_LIVRE" &&
      oferta.identityVersion >= 1;

    /*
     * LISTING-FIRST: oferta ML com identidade de anuncio. O refresh NAO usa
     * `sourceUrl` (ela pode ser NULL por contrato) e nunca troca de anuncio.
     */
    if (ehListingFirst) {
      const bloqueadoAte = adicionarMilissegundos(
        inicio,
        TEMPO_BLOQUEIO_PROCESSAMENTO_MS,
      );

      await prisma.marketplaceOffer.update({
        where: { id: oferta.id },
        data: { nextCheckAt: bloqueadoAte },
      });

      const { resultado, atualizada, precoAlterado, erro } =
        await processarOfertaListingFirst(oferta, inicio);

      listingFirstProcessadas += 1;

      if (atualizada) {
        atualizadas += 1;
      }

      if (precoAlterado) {
        precosAlterados += 1;

        await dispararAlertas({
          productId: oferta.productId,
          currentPrice: resultado.priceAfter ?? oferta.price,
          previousPrice: resultado.priceBefore,
          productName: oferta.productId,
          marketplace: oferta.marketplace,
          store: null,
        });
      }

      if (erro) {
        erros += 1;
      }

      resultados.push(resultado);
      continue;
    }

    const sourceUrl = oferta.sourceUrl?.trim() ?? "";

    /*
     * LISTING-FIRST — pertencente ao lote legado? Nao deve chegar aqui: a
     * selecao exclui ML identityVersion 0. Defesa em profundidade.
     */
    if (
      oferta.marketplace === "MERCADO_LIVRE" &&
      oferta.identityVersion < 1
    ) {
      legadoIgnorado += 1;
      continue;
    }

    if (!sourceUrl) {
      const quantidadeErros =
        oferta.consecutiveErrors + 1;

      const nextCheckAt = proximoCheckDepoisDeErro(
        quantidadeErros,
        inicio,
      );

      await prisma.marketplaceOffer.update({
        where: {
          id: oferta.id,
        },
        data: {
          lastCheckedAt: inicio,
          nextCheckAt,
          consecutiveErrors: quantidadeErros,
          errorMessage:
            "Oferta sem URL de origem para monitoramento.",
        },
      });

      erros += 1;
      ignoradas += 1;

      resultados.push({
        offerId: oferta.id,
        productId: oferta.productId,
        marketplace: oferta.marketplace,
        success: false,
        priceBefore: oferta.price,
        nextCheckAt: nextCheckAt.toISOString(),
        error:
          "Oferta sem URL de origem para monitoramento.",
        refreshPath: "LEGACY_SOURCE_URL",
      });

      continue;
    }

    const bloqueadoAte = adicionarMilissegundos(
      inicio,
      TEMPO_BLOQUEIO_PROCESSAMENTO_MS,
    );

    await prisma.marketplaceOffer.update({
      where: {
        id: oferta.id,
      },
      data: {
        nextCheckAt: bloqueadoAte,
      },
    });

    try {
      const produtoImportado =
        await importarProduto(sourceUrl);

      const marketplaceImportado =
        marketplaceImportadoParaBanco(
          produtoImportado.marketplace,
        );

      if (
        marketplaceImportado !== oferta.marketplace
      ) {
        throw new Error(
          `A URL da oferta pertence a ${produtoImportado.marketplace}, mas a oferta cadastrada pertence a ${oferta.marketplace}.`,
        );
      }

      const priceChanged = precoMudou(
        oferta.price,
        produtoImportado.price,
      );

      await saveProduct(
        produtoImportado,
        oferta.affiliateLink,
        {
          targetProductId: oferta.productId,
          discoverySource: "PRICE_MONITOR",
        },
      );

      const fim = new Date();
      const nextCheckAt = adicionarMilissegundos(
        fim,
        INTERVALO_SUCESSO_MS,
      );

      await prisma.marketplaceOffer.update({
        where: {
          id: oferta.id,
        },
        data: {
          lastCheckedAt: fim,
          nextCheckAt,
          consecutiveErrors: 0,
          errorMessage: null,
        },
      });

      atualizadas += 1;

      if (priceChanged) {
        precosAlterados += 1;

        /*
         * FLUXO AUTOMATICO DE ALERTAS: somente depois de o novo preco
         * estar persistido (saveProduct ja gravou preco + historico),
         * processamos os alertas ativos do produto. Falha aqui nunca
         * quebra o monitor: registramos e seguimos.
         */
        await dispararAlertas({
          productId: oferta.productId,
          currentPrice: produtoImportado.price,
          previousPrice: oferta.price,
          productName: produtoImportado.title ?? oferta.productId,
          marketplace: produtoImportado.marketplace,
          store: produtoImportado.seller ?? null,
        });
      }

      resultados.push({
        offerId: oferta.id,
        productId: oferta.productId,
        marketplace: oferta.marketplace,
        success: true,
        priceBefore: oferta.price,
        priceAfter: produtoImportado.price,
        priceChanged,
        nextCheckAt: nextCheckAt.toISOString(),
        refreshPath: "LEGACY_SOURCE_URL",
      });
    } catch (error) {
      const fim = new Date();
      const mensagem = obterMensagemErro(error);

      const quantidadeErros =
        oferta.consecutiveErrors + 1;

      const nextCheckAt = proximoCheckDepoisDeErro(
        quantidadeErros,
        fim,
      );

      await prisma.marketplaceOffer.update({
        where: {
          id: oferta.id,
        },
        data: {
          lastCheckedAt: fim,
          nextCheckAt,
          consecutiveErrors: quantidadeErros,
          errorMessage: mensagem,
        },
      });

      erros += 1;

      resultados.push({
        offerId: oferta.id,
        productId: oferta.productId,
        marketplace: oferta.marketplace,
        success: false,
        priceBefore: oferta.price,
        nextCheckAt: nextCheckAt.toISOString(),
        error: mensagem,
        refreshPath: "LEGACY_SOURCE_URL",
      });
    }
  }

  return {
    success: true,
    requested: requestedLimit,
    limit,
    selected: ofertas.length,
    updated: atualizadas,
    priceChanges: precosAlterados,
    errors: erros,
    skipped: ignoradas,
    listingFirstProcessed: listingFirstProcessadas,
    listingFirstInactiveObserved: observadasInativas,
    legacySkipped: legadoIgnorado,
    results: resultados,
  };
}
