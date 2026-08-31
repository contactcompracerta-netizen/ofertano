import assert from "node:assert/strict";

import {
  assessProductCentralEvidence,
  buscarMercadoLivreComFontes,
  type MercadoLivreAcquisitionSources,
} from "./mercadolivre";
import type { DiscoveryQuery } from "./core/types";
import {
  avaliarStatusDaPaginaPublica,
  buscarEstrategiaPublicaMercadoLivre,
  classificarErroFonteMercadoLivre,
  extrairItensDaPaginaDeBuscaPublica,
} from "./mercadolivrePublicSearch";
import {
  extrairProdutoDaPaginaPublica,
  gerarVariantesDeConsultaPublica,
  hidratarItensComPaginaPublica,
} from "./mercadolivrePublicHydration";

const QUERY = "Headphone MarcaX Wireless Rosa";

function request(query = QUERY): DiscoveryQuery {
  return {
    query,
    normalizedQuery: query.toLowerCase(),
    limit: 5,
    mode: "MULTILOJA",
  };
}

function item(input: {
  id: string;
  title: string;
  price?: number;
  tags?: string[];
  logisticType?: string;
}) {
  return {
    id: input.id,
    title: input.title,
    price: input.price ?? 149,
    permalink: `https://produto.mercadolivre.com.br/${input.id}`,
    thumbnail: "https://http2.mlstatic.com/item.jpg",
    condition: "new",
    currency_id: "BRL",
    tags: input.tags,
    shipping: input.logisticType
      ? { logistic_type: input.logisticType }
      : undefined,
  };
}

function fontes(
  overrides: Partial<MercadoLivreAcquisitionSources>,
): MercadoLivreAcquisitionSources {
  return {
    discoverDomain: async () => "MLB-HEADPHONES",
    searchCatalog: async () => ({
      status: "EMPTY",
      httpStatus: 200,
      data: [],
      reason: "Catalogo vazio.",
    }),
    loadCatalogCandidate: async (productId) => ({
      title: productId,
      externalId: productId,
      stage: "offers-fetch",
      status: "DROPPED",
      reason: "Catalogo sem publicacao compravel no momento.",
      lexicalScore: 0.2,
    }),
    searchItemsApi: async () => ({
      status: "EMPTY",
      httpStatus: 200,
      data: [],
    }),
    searchPublicListings: async () => ({
      status: "EMPTY",
      httpStatus: 200,
      data: [],
    }),
    ...overrides,
  };
}

const blockedItemsApi: MercadoLivreAcquisitionSources["searchItemsApi"] =
  async () => ({
    status: "BLOCKED",
    httpStatus: 403,
    data: [],
    reason: "API de anuncios avulsos retornou 403.",
  });

const html = `
  <a href="https://produto.mercadolivre.com.br/MLB-4224584697-fones-de-ouvido-wireless-rosa-_JM">Anuncio</a>
  <script>{"id":"MLB4224584697","title":"Headphone MarcaX Wireless Rosa","price":149}</script>
`;

assert.ok(
  extrairItensDaPaginaDeBuscaPublica(html).some(
    (entry) => entry.id === "MLB4224584697",
  ),
  "A pagina publica de busca deve expor o anuncio individual.",
);

const catalogHtml = `
  <a href="https://www.mercadolivre.com.br/fones-de-ouvido-ihome-wireless-rosa/p/MLB2102485316?wid=MLB4995511477">iHome</a>
`;
assert.ok(
  extrairItensDaPaginaDeBuscaPublica(catalogHtml).some(
    (entry) => entry.id === "MLB4995511477",
  ),
  "wid ao lado de /p/ precisa virar anuncio compravel, nao ser descartado como catalogo.",
);

const userProductHtml = `
  <a href="https://www.mercadolivre.com.br/polia-virabrequim/up/MLBU123456789?pdp_filters=item_id%3AMLB1967745737">Polia</a>
`;
assert.ok(
  extrairItensDaPaginaDeBuscaPublica(userProductHtml).some(
    (entry) => entry.id === "MLB1967745737",
  ),
  "pdp_filters em URL /up/MLBU precisa expor o listing MLB.",
);
assert.equal(
  extrairItensDaPaginaDeBuscaPublica(userProductHtml).some(
    (entry) => entry.id === "MLB123456789",
  ),
  false,
  "MLBU nao pode virar listing MLB.",
);

const blocked = classificarErroFonteMercadoLivre(
  new Error(
    "Mercado Livre /sites/MLB/search?q=teste falhou autenticado (403) e publico (403).",
  ),
);
assert.equal(blocked.status, "BLOCKED");
assert.equal(blocked.httpStatus, 403);

const jsonLdHtml = `
<html>
  <head>
    <title>Headphone MarcaX | Mercado Livre</title>
    <script type="application/ld+json">
      {"@type":"ItemList","itemListElement":[
        {"@type":"ListItem","item":{"@type":"Product","name":"Headphone MarcaX Wireless Rosa","sku":"MLB4224584697","url":"https://produto.mercadolivre.com.br/MLB-4224584697-headphone","offers":{"@type":"Offer","price":"149.90","availability":"https://schema.org/InStock"}}}
      ]}
    </script>
  </head>
  <body class="ui-search-page"></body>
</html>
`;

const jsonLdItems = extrairItensDaPaginaDeBuscaPublica(jsonLdHtml);
assert.ok(
  jsonLdItems.some((entry) => entry.id === "MLB4224584697"),
  "TESTE 9: JSON-LD da pagina publica deve expor o anuncio.",
);
assert.equal(
  jsonLdItems.find((entry) => entry.id === "MLB4224584697")?.title,
  "Headphone MarcaX Wireless Rosa",
);
assert.equal(
  avaliarStatusDaPaginaPublica(jsonLdHtml, 200, {
    requestedUrl: "https://lista.mercadolivre.com.br/headphone",
    finalUrl: "https://lista.mercadolivre.com.br/headphone",
    contentType: "text/html",
  }),
  "SUCCESS",
);

const challengeHtml = `
<html>
  <head><title>Just a moment</title></head>
  <body>
    <div id="challenge-running">Please wait</div>
    <script src="https://challenges.cloudflare.com/turnstile"></script>
  </body>
</html>
`;
const challengeStatus = avaliarStatusDaPaginaPublica(challengeHtml, 200, {
  requestedUrl: "https://lista.mercadolivre.com.br/headphone",
  finalUrl: "https://lista.mercadolivre.com.br/headphone",
  contentType: "text/html",
});
assert.ok(
  challengeStatus === "BLOCKED" || challengeStatus === "UNUSABLE",
  "TESTE 10: HTTP 200 de desafio nao pode ser EMPTY.",
);
assert.notEqual(challengeStatus, "EMPTY");

const emptyHtml = `
<html>
  <head><title>Headphone | Mercado Livre</title></head>
  <body class="ui-search-page">
    <h2>Nao encontramos resultados para sua busca</h2>
    <div class="ui-search-layout"></div>
  </body>
</html>
`;
assert.equal(
  avaliarStatusDaPaginaPublica(emptyHtml, 200, {
    requestedUrl: "https://lista.mercadolivre.com.br/headphone-xyz",
    finalUrl: "https://lista.mercadolivre.com.br/headphone-xyz",
    contentType: "text/html",
  }),
  "EMPTY",
  "TESTE 11: pagina valida sem resultados e EMPTY verdadeiro.",
);

const completeCardHtml = `
<html>
  <body class="ui-search-page">
    <li class="ui-search-layout__item">
      <a href="https://produto.mercadolivre.com.br/MLB-4224584697-headphone">
        <h2 class="ui-search-item__title">Headphone MarcaX Wireless Rosa</h2>
        <span class="andes-money-amount__fraction">149</span>
        <img src="https://http2.mlstatic.com/item.jpg" />
      </a>
    </li>
  </body>
</html>
`;
const completeCard = extrairItensDaPaginaDeBuscaPublica(completeCardHtml).find(
  (entry) => entry.id === "MLB4224584697",
);
assert.equal(completeCard?.title, "Headphone MarcaX Wireless Rosa");
assert.equal(completeCard?.price, 149);
assert.ok(completeCard?.permalink?.includes("MLB-4224584697"));

const productPage = extrairProdutoDaPaginaPublica(`
<html>
  <head>
    <title>Headphone MarcaX Wireless Rosa</title>
    <meta property="og:title" content="Headphone MarcaX Wireless Rosa" />
    <meta property="og:url" content="https://produto.mercadolivre.com.br/MLB-4224584697-headphone" />
    <meta property="product:price:amount" content="149.90" />
    <script type="application/ld+json">
      {"@type":"Product","name":"Headphone MarcaX Wireless Rosa","sku":"MLB4224584697","url":"https://produto.mercadolivre.com.br/MLB-4224584697-headphone","offers":{"@type":"Offer","price":"149.90"}}
    </script>
  </head>
</html>
`);
assert.equal(productPage?.id, "MLB4224584697");
assert.equal(productPage?.title, "Headphone MarcaX Wireless Rosa");
assert.equal(productPage?.price, 149.9);

const queryVariants = gerarVariantesDeConsultaPublica(
  "Ihome wireless rosa resistente a agua",
);
assert.equal(queryVariants[0], "Ihome wireless rosa resistente a agua");
assert.ok(queryVariants.length >= 2);

const listingItem = item({
  id: "MLB111222333",
  title: "Headphone MarcaX Wireless Rosa",
});

async function runAcquisitionCases() {
  const originalFetch = globalThis.fetch;
  try {
    const largeChallengeHtml = `${challengeHtml}${"x".repeat(1_500_000)}`;
    globalThis.fetch = (async () =>
      new Response(largeChallengeHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as typeof fetch;

    const challengeStartedAt = Date.now();
    const largeChallenge = await buscarEstrategiaPublicaMercadoLivre(
      "Headphone MarcaX Wireless Rosa",
      "public-search-lista",
    );
    const challengeElapsedMs = Date.now() - challengeStartedAt;

    assert.equal(largeChallenge.status, "BLOCKED");
    assert.equal(largeChallenge.data.length, 0);
    assert.ok(
      challengeElapsedMs < 1_000,
      `pagina grande de desafio precisa usar classificacao rapida (${challengeElapsedMs}ms)`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const testA = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [listingItem],
      }),
    }),
  );
  assert.equal(
    testA.candidates.length,
    1,
    "TESTE A: item search encontra anuncio avulso.",
  );
  assert.equal(testA.candidates[0]?.externalId, "MLB111222333");
  assert.equal(testA.degraded, false);

  const testB = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLB-CATALOG-1",
            name: "Fones de ouvido sem fio MarcaX",
            status: "active",
          },
        ],
      }),
      loadCatalogCandidate: async () => ({
        title: "Fones de ouvido sem fio MarcaX",
        externalId: "MLB-CATALOG-1",
        stage: "offers-fetch",
        status: "DROPPED",
        reason: "Catalogo sem publicacao compravel no momento.",
        lexicalScore: 0.7,
      }),
      searchItemsApi: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [listingItem],
      }),
    }),
  );
  assert.equal(
    testB.candidates.some((entry) => entry.externalId === "MLB-CATALOG-1"),
    false,
    "TESTE B: catalogo sem winner nao vira produto.",
  );
  assert.equal(testB.candidates[0]?.externalId, "MLB111222333");

  const testC = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: blockedItemsApi,
      searchPublicListings: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [listingItem],
      }),
    }),
  );
  assert.equal(
    testC.success,
    true,
    "TESTE C: 403 na API nao encerra o Discovery.",
  );
  assert.equal(testC.degraded, true);
  assert.ok(testC.blockedSources?.includes("items-api"));
  assert.equal(
    testC.sourcesTried?.includes("public-search"),
    true,
    "TESTE C: items-api bloqueada continua para HTML publico.",
  );
  assert.equal(
    testC.candidates.some((entry) => entry.externalId === "MLB111222333"),
    true,
    "TESTE C: card publico vira candidato utilizavel.",
  );

  const testD = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchCatalog: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "Catalogo bloqueado.",
      }),
      searchItemsApi: blockedItemsApi,
      searchPublicListings: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "Busca publica HTML retornou 403.",
      }),
    }),
  );
  assert.equal(
    testD.success,
    false,
    "TESTE D: ML totalmente bloqueado nao simula busca concluida.",
  );
  assert.equal(testD.candidates.length, 0);
  assert.equal(testD.searchOutcome, "BLOCKED");
  assert.ok((testD.blockedSources?.length ?? 0) >= 1);

  const testE = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          item({
            id: "MLB999888777",
            title: "Headphone MarcaX Wireless Rosa",
            tags: ["cbt_item", "kvs_primary"],
            logisticType: "fulfillment",
          }),
        ],
      }),
    }),
  );
  assert.equal(
    testE.candidates.some((entry) => entry.externalId === "MLB999888777"),
    true,
    "TESTE E: anuncio internacional compravel nao e rejeitado por tag/logistica.",
  );

  const testF = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLB-CAT-KEEP",
            name: "Fones de ouvido sem fio MarcaX",
            status: "active",
          },
        ],
      }),
      loadCatalogCandidate: async () => ({
        title: "Fones de ouvido sem fio MarcaX",
        externalId: "MLB-CAT-KEEP",
        stage: "candidate",
        status: "KEPT",
        reason: "Oferta de catalogo compravel.",
        lexicalScore: 0.8,
        kept: {
          relevance: 0.8,
          candidate: {
            marketplace: "MERCADO_LIVRE",
            marketplaceName: "Mercado Livre",
            externalId: "MLB-CAT-KEEP",
            sourceUrl: "https://produto.mercadolivre.com.br/MLB-CAT-KEEP",
            affiliateLink: null,
            title: "Fones de ouvido sem fio MarcaX",
            image: "https://http2.mlstatic.com/item.jpg",
            price: 159,
            oldPrice: null,
            category: null,
            brand: "MarcaX",
            seller: null,
            status: "FOUND",
            error: null,
          },
        },
      }),
      searchItemsApi: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [listingItem],
      }),
    }),
  );
  assert.equal(
    testF.candidates.some((entry) => entry.externalId === "MLB-CAT-KEEP"),
    true,
    "TESTE F: catalogo com oferta valida continua.",
  );
  assert.equal(
    testF.candidates.some((entry) => entry.externalId === "MLB111222333"),
    true,
    "TESTE F: API de anuncios nao pode ser pulada quando o catalogo ja devolveu oferta.",
  );

  const catalogWithoutWinner = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLB-CATALOG-EMPTY",
            name: "Headphone MarcaX Wireless Rosa",
            status: "active",
          },
        ],
      }),
      loadCatalogCandidate: async () => ({
        title: "Headphone MarcaX Wireless Rosa",
        externalId: "MLB-CATALOG-EMPTY",
        stage: "offers-fetch",
        status: "DROPPED",
        reason: "Catalogo sem publicacao compravel no momento.",
        lexicalScore: 0.7,
      }),
      searchItemsApi: blockedItemsApi,
      searchPublicListings: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [listingItem],
      }),
    }),
  );
  assert.equal(
    catalogWithoutWinner.candidates.some(
      (entry) => entry.externalId === "MLB111222333",
    ),
    true,
    "Catalogo sem winner + busca publica entrega candidato.",
  );

  const idsSurviveHydrationFailure = await hidratarItensComPaginaPublica(
    [
      {
        id: "MLB4224584697",
        permalink: "https://produto.mercadolivre.com.br/MLB-4224584697",
      },
    ],
    async () => {
      throw new Error("hidratacao falhou");
    },
  );
  assert.equal(idsSurviveHydrationFailure.items.length, 1);
  assert.equal(idsSurviveHydrationFailure.items[0]?.id, "MLB4224584697");

  const hydratedFromItemPage = await hidratarItensComPaginaPublica(
    [
      {
        id: "MLB4224584697",
        permalink: "https://produto.mercadolivre.com.br/MLB-4224584697",
      },
    ],
    async () => ({
      id: "MLB4224584697",
      title: "Headphone MarcaX Wireless Rosa",
      price: 149,
      permalink: "https://produto.mercadolivre.com.br/MLB-4224584697-headphone",
    }),
  );
  assert.equal(
    hydratedFromItemPage.items[0]?.title,
    "Headphone MarcaX Wireless Rosa",
  );
  assert.equal(hydratedFromItemPage.items[0]?.price, 149);

  const blockedItemPage = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: blockedItemsApi,
      searchPublicListings: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "Pagina publica bloqueada.",
      }),
    }),
  );
  assert.equal(blockedItemPage.success, false);
  assert.equal(blockedItemPage.searchOutcome, "BLOCKED");
  assert.ok(blockedItemPage.blockedSources?.includes("public-search"));

  const otherBrandStillAcquired = await buscarMercadoLivreComFontes(
    request("Headphone Wireless Rosa"),
    fontes({
      searchItemsApi: blockedItemsApi,
      searchPublicListings: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          item({
            id: "MLB555444333",
            title: "Headphone Sony Wireless Rosa",
          }),
        ],
      }),
    }),
  );
  assert.equal(
    otherBrandStillAcquired.candidates.some(
      (entry) => entry.externalId === "MLB555444333",
    ),
    true,
    "Aquisicao ML nao aplica regra de marca; entrega o candidato para o Matcher.",
  );

  const oneSourceBlocked = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: blockedItemsApi,
      searchPublicLista: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "lista bloqueada",
      }),
      searchPublicJm: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [listingItem],
      }),
    }),
  );
  assert.equal(
    oneSourceBlocked.candidates.some(
      (entry) => entry.externalId === "MLB111222333",
    ),
    true,
    "Uma fonte bloqueada nao impede outra fonte publica de entregar candidato.",
  );

  const thrownItemsApi = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: async () => {
        throw new Error("Mercado Livre /sites/MLB/search falhou autenticado (403).");
      },
      searchPublicListings: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [listingItem],
      }),
    }),
  );
  assert.equal(
    thrownItemsApi.candidates.some((entry) => entry.externalId === "MLB111222333"),
    true,
    "items-api lancando 403 continua para HTML publico.",
  );
  assert.ok(thrownItemsApi.blockedSources?.includes("items-api"));

  const noIdCard = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: blockedItemsApi,
      searchPublicListings: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            title: "Headphone MarcaX Wireless Rosa",
            price: 149,
            permalink: "https://produto.mercadolivre.com.br/MLB-4224584697-headphone",
            thumbnail: "https://http2.mlstatic.com/item.jpg",
          },
        ],
      }),
    }),
  );
  assert.equal(
    noIdCard.candidates.some((entry) =>
      entry.externalId.includes("4224584697") || entry.sourceUrl.includes("4224584697"),
    ),
    true,
    "Card publico com title+price+url e utilizavel sem items-api.",
  );

  const noneAvailable = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      discoverDomain: async () => {
        throw new Error("dominio falhou");
      },
      searchCatalog: async () => {
        throw new Error("catalogo HTTP 403");
      },
      searchItemsApi: async () => {
        throw new Error("items HTTP 403");
      },
      searchPublicListings: async () => {
        throw new Error("html HTTP 403");
      },
    }),
  );
  assert.equal(noneAvailable.candidates.length, 0);
  assert.ok(
    noneAvailable.searchOutcome === "BLOCKED" || noneAvailable.searchOutcome === "ERROR",
    "Nenhuma fonte ML disponivel nao pode crashar.",
  );

  const catalogOnlyKeepsGoing = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLBU123456789",
            name: "Headphone MarcaX Wireless Rosa",
            status: "active",
          },
        ],
      }),
      loadCatalogCandidate: async () => ({
        title: "Headphone MarcaX Wireless Rosa",
        externalId: "MLBU123456789",
        stage: "offers-fetch",
        status: "DROPPED",
        reason: "Catalogo sem listing compravel.",
        lexicalScore: 0.4,
      }),
      searchItemsApi: blockedItemsApi,
      searchPublicLista: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "lista 403",
      }),
      searchPublicJm: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [listingItem],
      }),
    }),
  );
  assert.equal(
    catalogOnlyKeepsGoing.candidates.some((entry) => entry.externalId === "MLB111222333"),
    true,
    "catalogo sem listing nao encerra a cadeia; public-search-jm ainda entrega",
  );
  assert.equal(
    catalogOnlyKeepsGoing.searchOutcome,
    "SEARCH_COMPLETED",
  );

  const partialSurvivesHydration403 = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLBU123456789",
            name: "Headphone MarcaX Wireless Rosa",
            status: "active",
          },
        ],
      }),
      loadCatalogCandidate: async () => ({
        title: "Headphone MarcaX Wireless Rosa",
        externalId: "MLBU123456789",
        stage: "offers-fetch",
        status: "DROPPED",
        reason: "Catalogo sem winner.",
        lexicalScore: 0.4,
      }),
      searchItemsApi: blockedItemsApi,
      searchPublicListings: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLB1967745737",
            title: "Headphone MarcaX Wireless Rosa",
            permalink: "https://produto.mercadolivre.com.br/MLB-1967745737",
            price: 149,
          },
        ],
      }),
      hydratePublicItem: async () => {
        throw new Error("HTTP 403");
      },
    }),
  );
  assert.equal(
    partialSurvivesHydration403.candidates.some(
      (entry) => entry.externalId === "MLB1967745737",
    ),
    true,
    "listing com titulo/preco no HTML sobrevive a hidratacao 403",
  );

  const catalogBlockedPublicOk = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchCatalog: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "catalog 403",
      }),
      searchItemsApi: blockedItemsApi,
      searchPublicListings: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [listingItem],
      }),
    }),
  );
  assert.equal(catalogBlockedPublicOk.searchOutcome, "SEARCH_COMPLETED");
  assert.equal(
    catalogBlockedPublicOk.candidates.some((entry) => entry.externalId === "MLB111222333"),
    true,
  );

  const slowCatalogFastListing = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      discoverDomain: async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return "MLB-HEADPHONES";
      },
      searchCatalog: async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return {
          status: "SUCCESS",
          httpStatus: 200,
          data: [
            {
              id: "MLB-CATALOG-SLOW",
              name: "Headphone MarcaX Wireless Rosa",
              status: "active",
            },
          ],
        };
      },
      loadCatalogCandidate: async () => ({
        title: "Headphone MarcaX Wireless Rosa",
        externalId: "MLB-CATALOG-SLOW",
        stage: "offers-fetch",
        status: "DROPPED",
        reason: "Catalogo sem winner.",
        lexicalScore: 0.4,
      }),
      searchItemsApi: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [listingItem],
      }),
    }),
  );
  assert.equal(
    slowCatalogFastListing.candidates.some((entry) => entry.externalId === "MLB111222333"),
    true,
    "anuncio rapido retorna antes da hidratacao lenta de catalogo",
  );

  const allBlocked = await buscarMercadoLivreComFontes(
    request(),
    fontes({
      searchItemsApi: blockedItemsApi,
      searchPublicListings: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "html 403",
      }),
      searchCatalog: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "catalog 403",
      }),
    }),
  );
  assert.equal(allBlocked.candidates.length, 0);
  assert.notEqual(allBlocked.searchOutcome, "EMPTY_VALID");
  assert.ok(
    allBlocked.searchOutcome === "BLOCKED" || allBlocked.searchOutcome === "ERROR",
  );

  const successNotErasedByEmpty = await buscarMercadoLivreComFontes(
    request("Headphone MarcaX"),
    fontes({
      searchItemsApi: async (query) => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: query.includes("MarcaX") ? [listingItem] : [],
      }),
      searchPublicListings: async (queryText) => ({
        status: "EMPTY",
        httpStatus: 200,
        data: [],
        reason: queryText.includes("variante-inexistente") ? "vazio" : undefined,
      }),
    }),
  );
  assert.equal(successNotErasedByEmpty.searchOutcome, "SEARCH_COMPLETED");
  assert.equal(
    successNotErasedByEmpty.candidates.some((entry) => entry.externalId === "MLB111222333"),
    true,
    "sucesso anterior nao e apagado por fonte vazia posterior",
  );

  const catalogSorted = await buscarMercadoLivreComFontes(
    request("Headphone MarcaX Wireless Rosa"),
    fontes({
      searchItemsApi: async () => ({
        status: "EMPTY",
        httpStatus: 200,
        data: [],
      }),
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLB-IRRELEVANT",
            name: "Capa para celular transparente",
            status: "active",
          },
          {
            id: "MLB-RELEVANT",
            name: "Headphone MarcaX Wireless Rosa",
            status: "active",
          },
        ],
      }),
      loadCatalogCandidate: async (productId) => ({
        title:
          productId === "MLB-RELEVANT"
            ? "Headphone MarcaX Wireless Rosa"
            : "Capa para celular transparente",
        externalId: productId,
        stage: "candidate",
        status: productId === "MLB-RELEVANT" ? "KEPT" : "DROPPED",
        reason: productId === "MLB-RELEVANT" ? "ok" : "irrelevante",
        lexicalScore: productId === "MLB-RELEVANT" ? 0.9 : 0.1,
        kept:
          productId === "MLB-RELEVANT"
            ? {
                relevance: 0.9,
                candidate: {
                  marketplace: "MERCADO_LIVRE",
                  marketplaceName: "Mercado Livre",
                  externalId: "MLB-RELEVANT-LISTING",
                  sourceUrl: "https://produto.mercadolivre.com.br/MLB-RELEVANT-LISTING",
                  affiliateLink: null,
                  title: "Headphone MarcaX Wireless Rosa",
                  image: "https://http2.mlstatic.com/item.jpg",
                  price: 149,
                  oldPrice: null,
                  category: null,
                  brand: "MarcaX",
                  seller: null,
                  status: "FOUND",
                  error: null,
                },
              }
            : undefined,
      }),
    }),
  );
  assert.equal(
    catalogSorted.candidates.some((entry) => entry.externalId === "MLB-RELEVANT-LISTING"),
    true,
    "catalogo relevante e priorizado antes de item nao relacionado",
  );

  const relevantCatalogHydration = await buscarMercadoLivreComFontes(
    request("Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V"),
    fontes({
      searchItemsApi: async () => ({
        status: "EMPTY",
        httpStatus: 200,
        data: [],
      }),
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLB-IRRELEVANT-FOOD",
            name: "Água Na Lata Com Gás - Pack Com 12 Unidades",
            status: "active",
          },
          {
            id: "MLB-RELEVANT-ASPIRADOR",
            name: "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V",
            status: "active",
          },
        ],
      }),
      loadCatalogCandidate: async (productId) => {
        if (productId === "MLB-IRRELEVANT-FOOD") {
          return {
            title: "Água Na Lata Com Gás - Pack Com 12 Unidades",
            externalId: "MLB-IRRELEVANT-FOOD",
            stage: "candidate",
            status: "KEPT",
            reason: "compravel mas sem evidência mínima da consulta.",
            lexicalScore: 0.12,
            kept: {
              relevance: 0.12,
              candidate: {
                marketplace: "MERCADO_LIVRE",
                marketplaceName: "Mercado Livre",
                externalId: "MLB-IRRELEVANT-LISTING",
                sourceUrl: "https://produto.mercadolivre.com.br/MLB-IRRELEVANT-LISTING",
                affiliateLink: null,
                title: "Água Na Lata Com Gás - Pack Com 12 Unidades",
                image: "https://http2.mlstatic.com/item.jpg",
                price: 39.9,
                oldPrice: null,
                category: null,
                brand: null,
                seller: null,
                status: "FOUND",
                error: null,
              },
            },
          };
        }

        return {
          title: "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V",
          externalId: "MLB-RELEVANT-ASPIRADOR",
          stage: "candidate",
          status: "KEPT",
          reason: "produto relevante da consulta.",
          lexicalScore: 0.97,
          kept: {
            relevance: 0.97,
            candidate: {
              marketplace: "MERCADO_LIVRE",
              marketplaceName: "Mercado Livre",
              externalId: "MLB-RELEVANT-LISTING",
              sourceUrl: "https://produto.mercadolivre.com.br/MLB-RELEVANT-LISTING",
              affiliateLink: null,
              title: "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V",
              image: "https://http2.mlstatic.com/item.jpg",
              price: 399.9,
              oldPrice: null,
              category: null,
              brand: "WAP",
              seller: null,
              status: "FOUND",
              error: null,
            },
          },
        };
      },
    }),
  );
  assert.equal(
    relevantCatalogHydration.candidates.some(
      (entry) => entry.externalId === "MLB-RELEVANT-LISTING",
    ),
    true,
    "item irrelevante compravel nao pode encerrar a hidracao antes do candidato real",
  );

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 250);

  const partialBeforeSlowHydration = await buscarMercadoLivreComFontes(
    { ...request("Produto Teste Parcial"), signal: controller.signal },
    fontes({
      searchItemsApi: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "listagem bloqueada",
      }),
      searchCatalog: async () => ({
        status: "SUCCESS",
        httpStatus: 200,
        data: [
          {
            id: "MLB-GOOD",
            name: "Produto Teste Parcial Original",
            status: "active",
          },
          {
            id: "MLB-SLOW",
            name: "Produto Teste Parcial Extra",
            status: "active",
          },
        ],
      }),
      loadCatalogCandidate: async (productId) => {
        if (productId === "MLB-SLOW") {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          return {
            title: "Produto Teste Parcial Extra",
            externalId: "MLB-SLOW-LISTING",
            stage: "candidate",
            status: "DROPPED",
            reason: "lento demais",
            lexicalScore: 0.1,
          };
        }

        return {
          title: "Produto Teste Parcial Original",
          externalId: "MLB111222333",
          stage: "candidate",
          status: "KEPT",
          reason: "catalogo valido",
          lexicalScore: 0.9,
          kept: {
            relevance: 0.9,
            candidate: {
              marketplace: "MERCADO_LIVRE",
              marketplaceName: "Mercado Livre",
              externalId: "MLB111222333",
              sourceUrl: "https://produto.mercadolivre.com.br/MLB111222333",
              affiliateLink: null,
              title: "Produto Teste Parcial Original",
              image: "https://http2.mlstatic.com/item.jpg",
              price: 299,
              oldPrice: null,
              category: null,
              brand: null,
              seller: null,
              status: "FOUND",
              error: null,
            },
          },
        };
      },
    }),
  );

  assert.equal(partialBeforeSlowHydration.searchOutcome, "SEARCH_COMPLETED");
  assert.equal(
    partialBeforeSlowHydration.candidates.some(
      (entry) => entry.externalId === "MLB111222333",
    ),
    true,
    "candidato valido do catalogo sobrevive a hidratacao lenta apos abort",
  );

  let catalogDomainCalls = 0;
  const domainMismatchFallback = await buscarMercadoLivreComFontes(
    request("Headphone MarcaX Wireless Rosa"),
    fontes({
      discoverDomain: async () => "MLB-MINERAL_WATERS",
      searchItemsApi: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "403",
      }),
      searchPublicLista: async () => ({
        status: "BLOCKED",
        httpStatus: 200,
        data: [],
        reason: "anti-bot",
      }),
      searchPublicJm: async () => ({
        status: "BLOCKED",
        httpStatus: 200,
        data: [],
        reason: "anti-bot",
      }),
      searchCatalog: async (_queryText, _limit, domainId) => {
        catalogDomainCalls += 1;
        if (domainId === "MLB-MINERAL_WATERS") {
          return {
            status: "SUCCESS",
            httpStatus: 200,
            data: [
              {
                id: "MLB-WATER",
                name: "Agua Mineral Com Gas 510ml Kit Com 12",
                status: "active",
              },
            ],
          };
        }

        return {
          status: "SUCCESS",
          httpStatus: 200,
          data: [
            {
              id: "MLB-HEADPHONE",
              name: "Headphone MarcaX Wireless Rosa",
              status: "active",
            },
          ],
        };
      },
      loadCatalogCandidate: async () => ({
        title: "Headphone MarcaX Wireless Rosa",
        externalId: "MLB3468142988",
        stage: "candidate",
        status: "KEPT",
        reason: "catalogo valido",
        lexicalScore: 0.95,
        kept: {
          relevance: 0.95,
          candidate: {
            marketplace: "MERCADO_LIVRE",
            marketplaceName: "Mercado Livre",
            externalId: "MLB3468142988",
            sourceUrl:
              "https://produto.mercadolivre.com.br/MLB3468142988-headphone-marcax",
            affiliateLink: null,
            title: "Headphone MarcaX Wireless Rosa",
            image: "https://http2.mlstatic.com/item.jpg",
            price: 299,
            oldPrice: 696,
            category: null,
            brand: "Marcax",
            seller: null,
            status: "FOUND",
            error: null,
          },
        },
      }),
    }),
  );

  assert.ok(
    catalogDomainCalls >= 2,
    "catalogo deve refazer busca sem dominio quando o dominio retorna produtos irrelevantes",
  );
  assert.equal(domainMismatchFallback.searchOutcome, "SEARCH_COMPLETED");
  assert.equal(
    domainMismatchFallback.candidates.some(
      (entry) => entry.externalId === "MLB3468142988",
    ),
    true,
    "headphone permanece apos fallback de dominio incorreto",
  );

  let domainCalls = 0;
  let catalogDomainArg: string | null | undefined = "unset";
  const vacuumFastPath = await buscarMercadoLivreComFontes(
    request(
      "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V",
    ),
    fontes({
      discoverDomain: async () => {
        domainCalls += 1;
        return "MLB-MINERAL_WATERS";
      },
      searchItemsApi: async () => ({
        status: "BLOCKED",
        httpStatus: 403,
        data: [],
        reason: "403",
      }),
      searchCatalog: async (_queryText, _limit, domainId) => {
        catalogDomainArg = domainId ?? null;
        return {
          status: "SUCCESS",
          httpStatus: 200,
          data: [
            {
              id: "MLB5093933269",
              name: "Aspirador De Pó E Água Wap Gtw Inox 12 1400w 220v",
              status: "active",
            },
          ],
        };
      },
      loadCatalogCandidate: async () => ({
        title: "Aspirador De Pó E Água Wap Gtw Inox 12 1400w 220v",
        externalId: "MLB5093933269",
        stage: "candidate",
        status: "KEPT",
        reason: "catalogo valido",
        lexicalScore: 0.95,
        kept: {
          relevance: 0.95,
          candidate: {
            marketplace: "MERCADO_LIVRE",
            marketplaceName: "Mercado Livre",
            externalId: "MLB5093933269",
            sourceUrl:
              "https://produto.mercadolivre.com.br/MLB5093933269-aspirador-wap-gtw-inox-12-220v",
            affiliateLink: null,
            title: "Aspirador De Pó E Água Wap Gtw Inox 12 1400w 220v",
            image: "https://http2.mlstatic.com/item.jpg",
            price: 299,
            oldPrice: null,
            category: null,
            brand: "WAP",
            seller: null,
            status: "FOUND",
            error: null,
          },
        },
      }),
    }),
  );

  assert.ok(domainCalls >= 1, "aquisicao padrao consulta discoverDomain");
  assert.equal(catalogDomainArg, "MLB-MINERAL_WATERS");
  assert.equal(vacuumFastPath.searchOutcome, "SEARCH_COMPLETED");
  assert.equal(
    vacuumFastPath.candidates.some((entry) => entry.externalId === "MLB5093933269"),
    true,
  );

  const waterOnly = assessProductCentralEvidence(
    "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V",
    "Água Na Lata Com Gás - Pack Com 12 Unidades",
  );
  assert.equal(waterOnly.hasCentralEvidence, false, "água em lata não prova aspirador");

  const aspiradorReal = assessProductCentralEvidence(
    "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V",
    "Aspirador De Pó E Água Wap Gtw Inox 12 1400w Bocal Sopro 220v",
  );
  assert.equal(aspiradorReal.hasCentralEvidence, true, "aspirador real mantem evidência central");
}

void runAcquisitionCases()
  .then(() => {
    console.log(
      "mercadolivre discovery acquisition: todos os casos globais passaram",
    );
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
