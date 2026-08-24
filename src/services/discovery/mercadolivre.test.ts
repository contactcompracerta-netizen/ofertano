import assert from "node:assert/strict";

import {
  buscarMercadoLivreComFontes,
  type MercadoLivreAcquisitionSources,
} from "./mercadolivre";
import type { DiscoveryQuery } from "./core/types";
import {
  avaliarStatusDaPaginaPublica,
  classificarErroFonteMercadoLivre,
  extrairItensDaPaginaDeBuscaPublica,
} from "./mercadolivrePublicSearch";

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

const listingItem = item({
  id: "MLB111222333",
  title: "Headphone MarcaX Wireless Rosa",
});

async function runAcquisitionCases() {
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
    false,
    "TESTE C: items-api bloqueada nao dispara HTML publico.",
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
    true,
    "TESTE D: ML degradado continua success para isolar lojas.",
  );
  assert.equal(testD.candidates.length, 0);
  assert.equal(testD.degraded, true);
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
