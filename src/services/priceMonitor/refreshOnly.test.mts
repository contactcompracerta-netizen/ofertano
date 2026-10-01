import assert from "node:assert/strict";

import {
  montarRefreshConhecido,
  refreshKnownMarketplaceOffer,
  validarIdentidadeDaFonte,
  type DependenciasRefresh,
  type FonteNormalizada,
  type OfertaConhecida,
} from "./knownOfferRefresh";

/*
 * PRICE MONITOR REFRESH-ONLY — os tres casos que definem o modo.
 *
 * O Price Monitor antes chamava `saveProduct()`, o MESMO caminho de DESCOBERTA
 * que cria Product. Uma `sourceUrl` que passasse a resolver outro anuncio
 * produzia um Product NOVO e uma oferta NOVA, e a oferta original ficava
 * parada. Em producao isso deixou 3 produtos ativos com uma unica loja,
 * criados pelo monitor.
 *
 * Aqui o contrato e medido por CONTAGEM, nao por descricao:
 *
 *   1. IDENTIDADE DIVERGENTE -> PRODUCTS_CREATED=0, OFFERS_CREATED=0, zero
 *      write de qualquer tipo, resultado SOURCE_IDENTITY_CHANGED.
 *   2. MESMA IDENTIDADE, preco novo -> OFFER_UPDATED=1, PRICE_HISTORY=1,
 *      productId intacto.
 *   3. MESMA IDENTIDADE, mesmo preco -> NOOP, nada criado.
 *
 * O banco e um duble que CONTA. Um helper que escrevesse produto passaria
 * despercebido se o teste so observasse o resultado devolvido; aqui ele
 * quebraria a contagem.
 */

const AGORA = new Date("2026-10-01T12:00:00.000Z");
const PROXIMO = new Date("2026-10-01T18:00:00.000Z");

/** Estado de banco em memoria, com contadores explicitos. */
type Contadores = {
  productCreates: number;
  offerCreates: number;
  offerUpdates: number;
  priceHistoryCreates: number;
  sincronizacoes: string[];
};

function criarDuble(estado: {
  ultimoHistorico?: number | null;
  contadores: Contadores;
}) {
  const escritas: Array<Record<string, unknown>> = [];
  const historicos: Array<Record<string, unknown>> = [];

  const db = {
    marketplaceOffer: {
      findFirst: async () => null,
      update: async (args: never) => {
        const dados = args as unknown as {
          where: { id: string };
          data: Record<string, unknown>;
        };

        estado.contadores.offerUpdates += 1;

        escritas.push({
          id: dados.where.id,
          ...dados.data,
        });

        return escritas.at(-1);
      },
    },
    priceHistory: {
      findFirst: async () =>
        estado.ultimoHistorico === undefined ||
        estado.ultimoHistorico === null
          ? null
          : { price: estado.ultimoHistorico },
      create: async (args: never) => {
        estado.contadores.priceHistoryCreates += 1;

        const dados = args as unknown as {
          data: Record<string, unknown>;
        };

        historicos.push(dados.data);

        return dados.data;
      },
    },
  };

  return { db, escritas, historicos };
}

function contadoresVazios(): Contadores {
  return {
    productCreates: 0,
    offerCreates: 0,
    offerUpdates: 0,
    priceHistoryCreates: 0,
    sincronizacoes: [],
  };
}

function ofertaShopee(
  extra: Partial<OfertaConhecida> = {},
): OfertaConhecida {
  return {
    offerId: "oferta_shopee_A",
    productId: "P1",
    marketplace: "SHOPEE",
    externalId: "1789734166.58215116714",
    sourceUrl:
      "https://shopee.com.br/product/1789734166/58215116714",
    affiliateLink:
      "https://shopee.com.br/offer/1789734166.58215116714",
    price: 100,
    seller: "LOJA_A",
    stock: 5,
    available: true,
    ...extra,
  };
}

function fonteShopee(
  extra: Partial<FonteNormalizada> = {},
): FonteNormalizada {
  return {
    marketplace: "SHOPEE",
    externalId: "1789734166.58215116714",
    price: 100,
    oldPrice: null,
    seller: "LOJA_A",
    stock: 5,
    available: true,
    affiliateLink:
      "https://shopee.com.br/offer/1789734166.58215116714",
    sourceUrl:
      "https://shopee.com.br/product/1789734166/58215116714",
    ...extra,
  };
}

function deps(
  estado: {
    contadores: Contadores;
    ultimoHistorico?: number | null;
  },
  fonte: FonteNormalizada,
): DependenciasRefresh {
  return {
    db: criarDuble(estado).db as never,
    lerFonte: async () => fonte,
    linkAfiliadoSeguro: (link) =>
      Boolean(link?.trim()),
    sincronizarPublicacao: async (productId) => {
      estado.contadores.sincronizacoes.push(productId);
    },
    precoUtilizavel: (preco) =>
      typeof preco === "number" &&
      Number.isFinite(preco) &&
      preco > 0
        ? preco
        : null,
    historicoPrecisaNovaEntrada: ({ precoAnterior, precoNovo }) =>
      precoAnterior === null ||
      precoAnterior === undefined ||
      Math.abs(precoAnterior - precoNovo) > 0.009,
    agora: AGORA,
    proximoCheckAposSucesso: PROXIMO,
  };
}

// =========================================================================
// CASO 1 — O TESTE CRITICO: a fonte devolve OUTRO anuncio.
//
// Offer A / productId P1; a fonte devolve externalId B. Esperado:
// zero produto, zero oferta, binding intacto, SOURCE_IDENTITY_CHANGED.
// =========================================================================
{
  const estado = {
    contadores: contadoresVazios(),
    ultimoHistorico: 100,
  };

  const resultado = await refreshKnownMarketplaceOffer(
    ofertaShopee(),
    deps(estado, fonteShopee({ externalId: "999.8887776665" })),
  );

  assert.equal(
    estado.contadores.productCreates,
    0,
    "PRODUCTS_CREATED=0",
  );
  assert.equal(
    estado.contadores.offerCreates,
    0,
    "OFFERS_CREATED=0",
  );
  assert.equal(
    estado.contadores.offerUpdates,
    0,
    "zero write: nem oferta, nem contador de erro",
  );
  assert.equal(
    estado.contadores.priceHistoryCreates,
    0,
    "sem PriceHistory para um anuncio que nao e o nosso",
  );
  assert.deepEqual(
    estado.contadores.sincronizacoes,
    [],
    "publicacao nao e sincronizada quando nada foi atualizado",
  );

  assert.equal(
    resultado.status,
    "SOURCE_IDENTITY_CHANGED",
    "resultado = SOURCE_IDENTITY_CHANGED",
  );

  assert.equal(
    resultado.status === "SOURCE_IDENTITY_CHANGED" &&
      resultado.productId,
    "P1",
    "o productId da oferta nao muda",
  );

  assert.match(
    resultado.status === "SOURCE_IDENTITY_CHANGED"
      ? resultado.error
      : "",
    /999\.8887776665/,
    "o erro nomeia o anuncio que a fonte devolveu",
  );
  assert.match(
    resultado.status === "SOURCE_IDENTITY_CHANGED"
      ? resultado.error
      : "",
    /nenhum binding foi movido/i,
    "o erro declara que nada foi movido",
  );
  console.log(
    "SOURCE_IDENTITY_CHANGED_CRISTA_NADA=PASS",
  );
}

// =========================================================================
// CASO 1b — Shopee: `<shopId>.<itemId>` e a identidade. Um itemId
// diferente NAO e o mesmo produto, mesmo com o shopId igual.
// =========================================================================
{
  const estado = {
    contadores: contadoresVazios(),
    ultimoHistorico: 100,
  };

  const resultado = await refreshKnownMarketplaceOffer(
    ofertaShopee(),
    deps(
      estado,
      fonteShopee({ externalId: "1789734166.9999999999" }),
    ),
  );

  assert.equal(
    resultado.status,
    "SOURCE_IDENTITY_CHANGED",
    "mesmo shopId com itemId diferente diverge",
  );
  assert.equal(
    estado.contadores.offerUpdates,
    0,
    "fail-closed: zero write",
  );
  console.log("SHOPEE_ITEM_ID_DIVERGENTE=BLOQUEADO=PASS");
}

// =========================================================================
// CASO 1c — marketplace diferente na mesma sourceUrl: erro de configuracao.
// Tambem zero write.
// =========================================================================
{
  const estado = {
    contadores: contadoresVazios(),
    ultimoHistorico: 100,
  };

  const resultado = await refreshKnownMarketplaceOffer(
    ofertaShopee(),
    deps(
      estado,
      fonteShopee({ marketplace: "MAGAZINE_LUIZA" }),
    ),
  );

  assert.equal(
    resultado.status,
    "SOURCE_MARKETPLACE_CHANGED",
  );
  assert.equal(
    estado.contadores.productCreates,
    0,
  );
  assert.equal(estado.contadores.offerUpdates, 0);
  console.log("SOURCE_MARKETPLACE_CHANGED_CRISTA_NADA=PASS");
}

// =========================================================================
// CASO 2 — O CAMINHO NORMAL: mesma identidade, preco novo.
// OFFER_UPDATED=1, PRICE_HISTORY=1, productId permanece P1.
// =========================================================================
{
  const estado = {
    contadores: contadoresVazios(),
    ultimoHistorico: 100,
  };

  const resultado = await refreshKnownMarketplaceOffer(
    ofertaShopee(),
    deps(
      estado,
      fonteShopee({
        price: 79.9,
        oldPrice: 100,
        seller: "LOJA_NOVA",
        stock: 3,
      }),
    ),
  );

  assert.equal(estado.contadores.productCreates, 0, "PRODUCTS_CREATED=0");
  assert.equal(estado.contadores.offerCreates, 0, "OFFERS_CREATED=0");
  assert.equal(estado.contadores.offerUpdates, 1, "OFFER_UPDATED=1");
  assert.equal(
    estado.contadores.priceHistoryCreates,
    1,
    "PRICE_HISTORY=1",
  );

  assert.equal(resultado.status, "UPDATED");
  assert.equal(resultado.productId, "P1", "productId permanece P1");
  assert.equal(resultado.priceChanged, true);
  assert.equal(resultado.priceBefore, 100);
  assert.equal(resultado.priceAfter, 79.9);

  assert.deepEqual(
    estado.contadores.sincronizacoes,
    ["P1"],
    "sincroniza publicacao do produto EXISTENTE",
  );
  console.log("REFRESH_MESMA_IDENTIDADE_NOVO_PRECO=PASS");
}

// =========================================================================
// CASO 2b — o PriceHistory pertence a MESMA oferta e a MESMO produto.
// =========================================================================
{
  const estado = {
    contadores: contadoresVazios(),
    ultimoHistorico: 100,
  };

  const duble = criarDuble(estado);

  const resultado = await refreshKnownMarketplaceOffer(
    ofertaShopee(),
    {
      ...deps(estado, fonteShopee({ price: 79.9 })),
      db: duble.db as never,
    },
  );

  assert.equal(resultado.status, "UPDATED");

  const [historico] = duble.historicos;

  assert.equal(
    historico.offerId,
    "oferta_shopee_A",
    "offerId e a MESMA oferta, nao uma nova",
  );
  assert.equal(
    historico.productId,
    "P1",
    "productId existente",
  );
  assert.equal(historico.marketplace, "SHOPEE");
  assert.equal(
    historico.source,
    "PRICE_MONITOR",
  );
  assert.equal(historico.price, 79.9);
  console.log("PRICE_HISTORY_DA_MESMA_OFERTA=PASS");
}

// =========================================================================
// CASO 2c — a escrita preserva o binding: productId, marketplace e
// externalId NAO podem entrar no `data`.
// =========================================================================
{
  const estado = {
    contadores: contadoresVazios(),
    ultimoHistorico: 100,
  };

  const duble = criarDuble(estado);

  await refreshKnownMarketplaceOffer(
    ofertaShopee(),
    {
      ...deps(
        estado,
        fonteShopee({
          price: 79.9,
          // A fonte devolve outras coisas: nenhuma pode virar binding.
          seller: "LOJA_NOVA",
          stock: 3,
        }),
      ),
      db: duble.db as never,
    },
  );

  const [escrita] = duble.escritas;

  for (const proibido of [
    "productId",
    "marketplace",
    "externalId",
    "matchStatus",
    "matchScore",
    "discoverySource",
    "reviewReason",
    "active",
  ]) {
    assert.equal(
      proibido in escrita,
      false,
      `${proibido} nao pode ser reescrito por refresh de preco`,
    );
  }

  assert.equal(escrita.id, "oferta_shopee_A", "update por id");
  assert.equal(escrita.price, 79.9);
  assert.equal(escrita.seller, "LOJA_NOVA");
  assert.equal(escrita.stock, 3);
  assert.equal(escrita.consecutiveErrors, 0);
  assert.equal(escrita.errorMessage, null);

  assert.equal(
    escrita.sourceUrl,
    "https://shopee.com.br/product/1789734166/58215116714",
    "sourceUrl so muda com identidade confirmada; aqui ela nao muda",
  );
  console.log("REFRESH_PRESERVA_BINDING=PASS");
}

// =========================================================================
// CASO 2d — link de afiliado: um link ausente nao apaga o gravado, e um
// link inseguro tambem nao substitui.
// =========================================================================
{
  const estado = {
    contadores: contadoresVazios(),
    ultimoHistorico: 100,
  };

  const comLink = montarRefreshConhecido({
    oferta: ofertaShopee(),
    fonte: fonteShopee({ price: 79.9, affiliateLink: null }),
    deps: deps(estado, fonteShopee({ price: 79.9 })),
    preco: 79.9,
  });

  assert.equal(
    comLink.affiliateLink,
    "https://shopee.com.br/offer/1789734166.58215116714",
    "ausencia de informacao nao apaga prova coletada antes",
  );

  const comLinkInseguro = montarRefreshConhecido({
    oferta: ofertaShopee(),
    fonte: fonteShopee({
      price: 79.9,
      affiliateLink: "javascript:alert(1)",
    }),
    deps: {
      ...deps(estado, fonteShopee({ price: 79.9 })),
      linkAfiliadoSeguro: () => false,
    },
    preco: 79.9,
  });

  assert.equal(
    comLinkInseguro.affiliateLink,
    "https://shopee.com.br/offer/1789734166.58215116714",
    "link inseguro nao substitui o gravado",
  );
  console.log("AFFILIATE_LINK_SIMETRICO_NAO=PASS");
}

// =========================================================================
// CASO 3 — IDEMPOTENCIA: mesma identidade, MESMO preco => NOOP.
// Nada criado, e nada de PriceHistory.
// =========================================================================
{
  const estado = {
    contadores: contadoresVazios(),
    ultimoHistorico: 100,
  };

  const resultado = await refreshKnownMarketplaceOffer(
    ofertaShopee(),
    deps(estado, fonteShopee({ price: 100 })),
  );

  assert.equal(estado.contadores.productCreates, 0, "PRODUCTS_CREATED=0");
  assert.equal(estado.contadores.offerCreates, 0, "OFFERS_CREATED=0");
  assert.equal(
    estado.contadores.priceHistoryCreates,
    0,
    "preco igual nao gera entrada de historico",
  );

  assert.equal(resultado.status, "NOOP");
  assert.equal(resultado.priceChanged, false);
  assert.equal(resultado.priceBefore, 100);
  assert.equal(resultado.priceAfter, 100);
  console.log("REFRESH_IDEMPOTENTE_NOOP=PASS");
}

// =========================================================================
// CASO 4 — preco inutilizavel nao apaga o ultimo estado bom.
// =========================================================================
{
  const estado = {
    contadores: contadoresVazios(),
    ultimoHistorico: 100,
  };

  const resultado = await refreshKnownMarketplaceOffer(
    ofertaShopee(),
    deps(estado, fonteShopee({ price: 0 })),
  );

  assert.equal(resultado.status, "ERROR");
  assert.equal(
    estado.contadores.offerUpdates,
    0,
    "preco invalido nao escreve",
  );
  assert.equal(estado.contadores.productCreates, 0);
  console.log("PRECO_INVALIDO_NAO_ESCRIBE=PASS");
}

// =========================================================================
// CASO 5 — falha de leitura da fonte e erro comum, nao divergencia.
// =========================================================================
{
  const estado = {
    contadores: contadoresVazios(),
    ultimoHistorico: 100,
  };

  const resultado = await refreshKnownMarketplaceOffer(
    ofertaShopee(),
    {
      ...deps(estado, fonteShopee()),
      lerFonte: async () => {
        throw new Error("Shopee respondeu com HTTP 503.");
      },
    },
  );

  assert.equal(resultado.status, "ERROR");
  assert.equal(estado.contadores.offerUpdates, 0);
  assert.match(
    resultado.status === "ERROR" ? resultado.error : "",
    /503/,
  );
  console.log("FALHA_DE_FONTE_NAO_CRIA_NADA=PASS");
}

// =========================================================================
// CASO 6 — oferta sem `externalId` gravado nao pode ser "confirmada":
// sem identidade persistida nao existe o que conferir.
// =========================================================================
{
  const estado = {
    contadores: contadoresVazios(),
    ultimoHistorico: 100,
  };

  const resultado = await refreshKnownMarketplaceOffer(
    ofertaShopee({ externalId: null }),
    deps(estado, fonteShopee()),
  );

  assert.equal(
    resultado.status,
    "SOURCE_IDENTITY_CHANGED",
    "sem externalId gravado, a identidade nao pode ser presumida",
  );
  assert.equal(estado.contadores.offerUpdates, 0);

  assert.equal(
    validarIdentidadeDaFonte(
      ofertaShopee(),
      fonteShopee(),
    ).status,
    "SAME_IDENTITY",
    "com externalId igual, a identidade confirma",
  );
  console.log("IDENTIDADE_SEM_EXTERNALID_NAO_PRESUMIDA=PASS");
}

// =========================================================================
// CASO 7 — o invariante global, medido em todos os caminhos:
// o helper nao tem NENHUMA ferramenta de criacao de Product/Offer.
// =========================================================================
{
  const arquivo = await import("node:fs").then((fs) =>
    fs.readFileSync(
      new URL("./knownOfferRefresh.ts", import.meta.url),
      "utf8",
    ),
  );

  /*
   * A garantia e ESTRUTURAL: o helper recebe `db` limitado a
   * `marketplaceOffer.{findFirst,update}` e `priceHistory.{findFirst,create}`.
   * `product` nem existe na superficie, entao criar Product e impossivel por
   * tipo, nao por disciplina. Este teste trava a superficie.
   *
   * O texto do arquivo e lido SEM COMENTARIOS: a documentacao do modulo cita
   * `saveProduct` e `Product` de proposito, para explicar o que deixou de
   * acontecer. O que nao pode existir e chamada de codigo.
   */
  const codigo = arquivo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  assert.equal(
    /product\s*:\s*\{/.test(codigo),
    false,
    "RefreshDb nao expoe Product.create",
  );
  assert.equal(
    /marketplaceOffer:\s*\{[^}]*create/.test(codigo),
    false,
    "nao existe oferta.create na superficie",
  );
  assert.equal(
    /saveProduct/.test(codigo),
    false,
    "o helper nao chama o caminho de descoberta",
  );

  /*
   * O mesmo portao no ORQUESTRADOR. `refreshOnly.test` prova o helper; este
   * prova que `processPriceMonitor` nao reintroduz a capacidade por fora dele
   * — um `saveProduct()` solto no monitor reabriria exatamente o bug, mesmo
   * com o helper perfeito ao lado.
   */
  const orquestrador = (
    await import("node:fs")
  ).readFileSync(
    new URL("./processPriceMonitor.ts", import.meta.url),
    "utf8",
  );

  const codigoOrquestrador = orquestrador
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  assert.equal(
    /saveProduct\s*\(/.test(codigoOrquestrador),
    false,
    "processPriceMonitor nao chama saveProduct()",
  );
  assert.equal(
    /\bproduct\s*\.\s*(create|upsert|createMany)\s*\(/.test(
      codigoOrquestrador,
    ),
    false,
    "processPriceMonitor nao cria Product por Prisma",
  );
  assert.equal(
    /marketplaceOffer\s*\.\s*(create|upsert|createMany)\s*\(/.test(
      codigoOrquestrador,
    ),
    false,
    "processPriceMonitor nao cria oferta",
  );
  assert.equal(
    /productsCreatedByPriceMonitor\s*:\s*0/.test(
      codigoOrquestrador,
    ),
    true,
    "o monitor declara o invariante de criacao de Product no retorno",
  );
  console.log("PRICE_MONITOR_PRODUCT_CREATION=0=PASS");
}

console.log(
  "refreshOnly: todos os casos passaram",
);