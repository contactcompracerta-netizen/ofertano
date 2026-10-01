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

  const ofertas = await prisma.marketplaceOffer.findMany({
    where: buildPriceMonitorCandidateWhere(agora),
    orderBy: [
      {
        nextCheckAt: "asc",
      },
      {
        lastCheckedAt: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    take: limit,
    select: {
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
    },
  });

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
    legacySkipped: legadoIgnorado,
    results: resultados,
  };
}
