/**
 * REFRESH-ONLY: atualizacao de uma oferta JA CONHECIDA.
 *
 * Por que este modulo existe
 * --------------------------
 * O Price Monitor nasceu como um importador comPapers extras: ele chamava
 * `importarProduto(sourceUrl)` e depois `saveProduct(...)`. `saveProduct` e o
 * MESMO caminho de DESCOBERTA que cria produto novo — ele resolve
 * `canonicalKey`, procura um produto compativel e, se nao encontra, faz
 * `create`. Uma oferta de Shopee cujo `sourceUrl` passasse a resolver para
 * outro `itemId` produzia, portanto, um Product NOVO com uma oferta NOVA,
 * enquanto a oferta original continuava parada. Em producao isso deixou
 * produtos `LIVE_COMPLETE`/`LIVE_PARTIAL` ativos com uma unica loja,
 * criados pelo monitor.
 *
 * O monitor nao tem autoridade para decidir identidade de produto. Ele sabe
 * atualizar preco. Reatribuir binding e trabalho do `IdentityPolicy` com
 * `CandidateBlockingKey` e `EXACT_UNIQUE`, e nao de um cron de preco.
 *
 * O contrato deste modulo
 * -----------------------
 *   oferta CONHECIDA -> estado atual na fonte
 *                    -> valida identidade
 *                    -> atualiza A MESMA oferta (por `id`)
 *                    -> PriceHistory da MESMA oferta
 *                    -> sincroniza publicacao do `productId` existente
 *
 * E o que ele nunca faz: criar Product, criar oferta, resolver Product,
 * mover binding entre produtos, ou gravar `Product.active`.
 *
 * O `productId` gravado na oferta e AUTORITATIVO. O monitor nao o recalcula.
 */

import type { Marketplace } from "@prisma/client";

/** Superfície mínima do Prisma — serve `prisma` e `tx`. */
export type RefreshDb = {
  marketplaceOffer: {
    findFirst: (args: never) => Promise<unknown>;
    update: (args: never) => Promise<unknown>;
  };
  priceHistory: {
    findFirst: (args: never) => Promise<unknown>;
    create: (args: never) => Promise<unknown>;
  };
};

/** Oferta persistida, do ponto de vista do refresh. */
export type OfertaConhecida = {
  offerId: string;
  productId: string;
  marketplace: Marketplace;
  /** Identidade gravada. Autoritativa: a fonte precisa concordar. */
  externalId: string | null;
  sourceUrl: string | null;
  affiliateLink: string | null;
  price: number;
  seller: string | null;
  stock: number | null;
  available: boolean;
};

/** Estado lido da fonte, ja normalizado. */
export type FonteNormalizada = {
  marketplace: Marketplace;
  externalId: string;
  price: number;
  oldPrice: number | null;
  seller: string | null;
  stock: number | null;
  available: boolean;
  /**
   * Link de afiliado do anuncio. So substitui o gravado quando o substituidor
   * e seguro; `null` nunca apaga um link valido.
   */
  affiliateLink: string | null;
  sourceUrl: string | null;
};

/**
 * Veredito da validacao de identidade da fonte.
 *
 * A distincao entre os dois modos de falha e deliberada: mudanca de
 * marketplace e erro de CONFIGURACAO (a `sourceUrl` aponta para outro
 * marketplace), mudanca de `externalId` e mudanca de ANUNCIO (a URL continua
 * do mesmo marketplace mas resolve outro item). Nenhum dos dois permite
 * escrita: apenas registram o que a fonte disse e param.
 */
export type VereditoIdentidade =
  | { status: "SAME_IDENTITY"; fonte: FonteNormalizada }
  | {
      status: "SOURCE_MARKETPLACE_CHANGED";
      persistedMarketplace: Marketplace;
      sourceMarketplace: Marketplace;
    }
  | {
      status: "SOURCE_IDENTITY_CHANGED";
      persistedMarketplace: Marketplace;
      sourceMarketplace: Marketplace;
      persistedExternalId: string | null;
      sourceExternalId: string;
    };

/**
 * Comparacao de identidade.
 *
 * Fail-closed por construcao: so `SAME_IDENTITY` libera escrita, e ele exige
 * marketplace igual E `externalId` exatamente igual. Divergencia em qualquer
 * um dos dois e zero write.
 *
 * Comparacao textual exata, sem normalizacao esperta: para Shopee a identidade
 * e `<shopId>.<itemId>` e um itemId diferente NAO e o mesmo produto, mesmo
 * que o titulo seja parecido. Colapsar os dois (por titulo, por
 * `canonicalKey`, por marketplace) seria repetir, no monitor, o erro que o
 * modulo existe para impedir.
 */
export function validarIdentidadeDaFonte(
  oferta: OfertaConhecida,
  fonte: FonteNormalizada,
): VereditoIdentidade {
  if (fonte.marketplace !== oferta.marketplace) {
    return {
      status: "SOURCE_MARKETPLACE_CHANGED",
      persistedMarketplace: oferta.marketplace,
      sourceMarketplace: fonte.marketplace,
    };
  }

  const persistido = oferta.externalId?.trim() ?? "";

  if (
    persistido === "" ||
    fonte.externalId.trim() !== persistido
  ) {
    return {
      status: "SOURCE_IDENTITY_CHANGED",
      persistedMarketplace: oferta.marketplace,
      sourceMarketplace: fonte.marketplace,
      persistedExternalId: persistido === "" ? null : persistido,
      sourceExternalId: fonte.externalId.trim(),
    };
  }

  return {
    status: "SAME_IDENTITY",
    fonte,
  };
}

export type ResultadoRefreshConhecida =
  | {
      status: "UPDATED" | "NOOP";
      offerId: string;
      productId: string;
      priceBefore: number;
      priceAfter: number;
      priceChanged: boolean;
      /** `true` quando houve gravacao na oferta (NOOP nao grava). */
      written: boolean;
    }
  | {
      status: "SOURCE_MARKETPLACE_CHANGED";
      offerId: string;
      productId: string;
      error: string;
    }
  | {
      status: "SOURCE_IDENTITY_CHANGED";
      offerId: string;
      productId: string;
      error: string;
    }
  | {
      status: "ERROR";
      offerId: string;
      productId: string;
      error: string;
    };

/** Campos gravados num refresh valido. `productId`/`marketplace`/`externalId` NUNCA entram aqui. */
export type RefreshWrite = {
  price: number;
  oldPrice: number | null;
  seller: string | null;
  stock: number | null;
  available: boolean;
  affiliateLink: string | null;
  sourceUrl: string | null;
  lastCheckedAt: Date;
  nextCheckAt: Date;
  consecutiveErrors: number;
  errorMessage: null;
  lastPriceChangeAt?: Date;
};

export type DependenciasRefresh = {
  db: RefreshDb;
  /** Normaliza `sourceUrl` em estado de fonte. */
  lerFonte: (
    oferta: OfertaConhecida,
  ) => Promise<FonteNormalizada>;
  /** Link de afiliado seguro segundo o gate central. */
  linkAfiliadoSeguro: (link: string | null) => boolean;
  /** Sincroniza a publicacao do produto EXISTENTE. Nunca cria produto. */
  sincronizarPublicacao: (
    productId: string,
    agora: Date,
  ) => Promise<void>;
  /** Verdadeiro quando o preco e utilizavel para gravacao e historico. */
  precoUtilizavel: (preco: unknown) => number | null;
  /** Decide se o preco novo merece uma entrada de PriceHistory. */
  historicoPrecisaNovaEntrada: (args: {
    precoAnterior: number | null;
    precoNovo: number;
  }) => boolean;
  agora: Date;
  proximoCheckAposSucesso: Date;
};

function erroDeMarketplace(
  oferta: OfertaConhecida,
  veredito: Extract<
    VereditoIdentidade,
    { status: "SOURCE_MARKETPLACE_CHANGED" }
  >,
): string {
  return (
    `[PRICE_MONITOR_REFRESH_ONLY] a sourceUrl da oferta ${oferta.offerId} ` +
    `resolve para ${veredito.sourceMarketplace}, mas a oferta persistida ` +
    `pertence a ${veredito.persistedMarketplace}. ` +
    `Nada foi escrito: o monitor atualiza oferta conhecida, nao resolve ` +
    `produto.`
  );
}

function erroDeIdentidade(
  oferta: OfertaConhecida,
  veredito: Extract<
    VereditoIdentidade,
    { status: "SOURCE_IDENTITY_CHANGED" }
  >,
): string {
  return (
    `[PRICE_MONITOR_REFRESH_ONLY] a sourceUrl da oferta ${oferta.offerId} ` +
    `resolve agora para o anuncio ${veredito.sourceExternalId}, mas a ` +
    `oferta persistida esta ligada ao anuncio ` +
    `${veredito.persistedExternalId ?? "(vazio)"} em ` +
    `${veredito.persistedMarketplace}. ` +
    `Nada foi escrito e nenhum binding foi movido: um anuncio diferente nao ` +
    `e o mesmo produto. Revisao manual necessaria.`
  );
}

/**
 * Monta a escrita preservando o binding.
 *
 * `sourceUrl` so e reescrita quando a identidade conferiu: apontar a
 * `sourceUrl` de outra oferta seria trocar a fonte silenciosamente. Link de
 * afiliado e assimétrico por evidencia — um link novo e seguro pode
 * substituir o gravado, mas um link ausente NUNCA apaga um link valido, e um
 * link inseguro tambem nao substitui nada.
 */
export function montarRefreshConhecido({
  oferta,
  fonte,
  deps,
  preco,
}: {
  oferta: OfertaConhecida;
  fonte: FonteNormalizada;
  deps: DependenciasRefresh;
  preco: number;
}): RefreshWrite {
  const linkNovoSeguro = deps.linkAfiliadoSeguro(
    fonte.affiliateLink,
  );

  const affiliateLink = linkNovoSeguro
    ? (fonte.affiliateLink as string)
    : oferta.affiliateLink;

  const mudouPreco =
    Math.abs(oferta.price - preco) > 0.009;

  return {
    price: preco,
    oldPrice: fonte.oldPrice,
    seller: fonte.seller,
    stock: fonte.stock,
    available: fonte.available,
    affiliateLink,
    sourceUrl: oferta.sourceUrl,
    lastCheckedAt: deps.agora,
    nextCheckAt: deps.proximoCheckAposSucesso,
    consecutiveErrors: 0,
    errorMessage: null,
    ...(mudouPreco ? { lastPriceChangeAt: deps.agora } : {}),
  };
}

/**
 * Refresh de oferta conhecida, fail-closed.
 *
 * A fonte e consultada ANTES de qualquer escrita. Se a identidade nao
 * conferir, o retorno e um veredito de erro e NENHUM banco e tocado — nem a
 * oferta, nem o produto, nem o historico.
 */
export async function refreshKnownMarketplaceOffer(
  oferta: OfertaConhecida,
  deps: DependenciasRefresh,
): Promise<ResultadoRefreshConhecida> {
  let fonte: FonteNormalizada;

  try {
    fonte = await deps.lerFonte(oferta);
  } catch (error) {
    return {
      status: "ERROR",
      offerId: oferta.offerId,
      productId: oferta.productId,
      error:
        error instanceof Error
          ? error.message
          : "Erro desconhecido ao consultar a fonte.",
    };
  }

  const veredito = validarIdentidadeDaFonte(
    oferta,
    fonte,
  );

  if (veredito.status === "SOURCE_MARKETPLACE_CHANGED") {
    return {
      status: "SOURCE_MARKETPLACE_CHANGED",
      offerId: oferta.offerId,
      productId: oferta.productId,
      error: erroDeMarketplace(oferta, veredito),
    };
  }

  if (veredito.status === "SOURCE_IDENTITY_CHANGED") {
    return {
      status: "SOURCE_IDENTITY_CHANGED",
      offerId: oferta.offerId,
      productId: oferta.productId,
      error: erroDeIdentidade(oferta, veredito),
    };
  }

  const preco = deps.precoUtilizavel(
    veredito.fonte.price,
  );

  if (preco === null) {
    return {
      status: "ERROR",
      offerId: oferta.offerId,
      productId: oferta.productId,
      error:
        `[PRICE_MONITOR_REFRESH_ONLY] ${oferta.offerId}: preco ausente ou ` +
        `invalido (${JSON.stringify(veredito.fonte.price)}). ` +
        `Oferta nao foi alterada.`,
    };
  }

  const escrita = montarRefreshConhecido({
    oferta,
    fonte: veredito.fonte,
    deps,
    preco,
  });

  const ultimoHistorico = (await deps.db.priceHistory.findFirst(
    {
      where: {
        offerId: oferta.offerId,
      },
      orderBy: {
        recordedAt: "desc",
      },
      select: {
        price: true,
      },
    } as never,
  )) as { price: number } | null;

  const mudouPreco =
    Math.abs(oferta.price - preco) > 0.009;

  const precisaHistorico = deps.historicoPrecisaNovaEntrada({
    precoAnterior: ultimoHistorico?.price ?? null,
    precoNovo: preco,
  });

  await deps.db.marketplaceOffer.update({
    where: {
      id: oferta.offerId,
    },
    data: escrita,
  } as never);

  if (precisaHistorico) {
    await deps.db.priceHistory.create({
      data: {
        productId: oferta.productId,
        offerId: oferta.offerId,
        marketplace: oferta.marketplace,
        price: preco,
        oldPrice: veredito.fonte.oldPrice,
        source: "PRICE_MONITOR",
      },
    } as never);
  }

  /*
   * Publicacao sincronizada a partir do `productId` JA gravado na oferta. O
   * monitor nao escreve `Product.active`: quem decide vigencia e o reconciliador
   * canonico, e so que ele depende das ofertas.
   */
  await deps.sincronizarPublicacao(
    oferta.productId,
    deps.agora,
  );

  return {
    status: mudouPreco ? "UPDATED" : "NOOP",
    offerId: oferta.offerId,
    productId: oferta.productId,
    priceBefore: oferta.price,
    priceAfter: preco,
    priceChanged: mudouPreco,
    written: true,
  };
}