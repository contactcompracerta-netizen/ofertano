import prisma from "@/lib/prisma";
import { saveProduct } from "@/services/database/saveProduct";
import { importarProduto } from "@/services/importers";

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

export async function processPriceMonitor(
  requestedLimit = LIMITE_PADRAO,
) {
  const limit = normalizarLimite(requestedLimit);
  const agora = new Date();

  const ofertas = await prisma.marketplaceOffer.findMany({
    where: {
      active: true,
      sourceUrl: {
        not: null,
      },
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
    },
  });

  const resultados: ResultadoOferta[] = [];

  let atualizadas = 0;
  let precosAlterados = 0;
  let erros = 0;
  let ignoradas = 0;

  for (const oferta of ofertas) {
    const inicio = new Date();
    const sourceUrl = oferta.sourceUrl?.trim() ?? "";

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
    results: resultados,
  };
}