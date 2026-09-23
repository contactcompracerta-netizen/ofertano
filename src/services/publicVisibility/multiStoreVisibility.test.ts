import assert from "node:assert/strict";

import {
  PUBLIC_MULTISTORE_MIN_MARKETPLACES,
  hasPublicMultiStore,
  isUsablePublicOffer,
  countDistinctPublicMarketplaces,
  countDistinctNonEmptyMarketplaces,
} from "./multiStoreVisibility";

type Offer = {
  marketplace: string;
  active?: boolean;
  available?: boolean;
  status?: string;
  matchStatus?: string;
  price?: number | null;
};

const oferta = (
  marketplace: string,
  overrides: Partial<Offer> = {},
): Offer => ({
  marketplace,
  active: true,
  matchStatus: "EXACT",
  available: true,
  status: "ACTIVE",
  price: 100,
  ...overrides,
});

// 1. ZERO_OFFERS_HIDDEN
assert.equal(
  hasPublicMultiStore([]),
  false,
  "sem ofertas nao aparece",
);

// 2. ONE_VALID_MARKETPLACE_HIDDEN
assert.equal(
  hasPublicMultiStore([oferta("MERCADO_LIVRE")]),
  false,
  "uma loja valida nao aparece",
);

// 3. TWO_OFFERS_SAME_MARKETPLACE_HIDDEN
assert.equal(
  hasPublicMultiStore([
    oferta("MERCADO_LIVRE", { marketplace: "MERCADO_LIVRE" }),
    oferta("MERCADO_LIVRE", { marketplace: "MERCADO_LIVRE", price: 90 }),
  ]),
  false,
  "duas ofertas da mesma loja nao constituem multi loja",
);

// 4. TWO_DISTINCT_MARKETPLACES_VISIBLE
assert.equal(
  hasPublicMultiStore([
    oferta("MERCADO_LIVRE", { marketplace: "MERCADO_LIVRE" }),
    oferta("AMAZON", { marketplace: "AMAZON" }),
  ]),
  true,
  "duas lojas distintas visiveis",
);

// 5. THREE_DISTINCT_MARKETPLACES_VISIBLE
assert.equal(
  hasPublicMultiStore([
    oferta("MERCADO_LIVRE", { marketplace: "MERCADO_LIVRE" }),
    oferta("AMAZON", { marketplace: "AMAZON" }),
    oferta("SHOPEE", { marketplace: "SHOPEE" }),
  ]),
  true,
  "tres lojas distintas visiveis",
);

// 6. INVALID_SECOND_MARKETPLACE_DOES_NOT_QUALIFY
assert.equal(
  hasPublicMultiStore([
    oferta("MERCADO_LIVRE", { marketplace: "MERCADO_LIVRE" }),
    oferta("AMAZON", {
      marketplace: "AMAZON",
      available: false,
    }),
  ]),
  false,
  "segunda loja indisponivel nao qualifica",
);

assert.equal(
  hasPublicMultiStore([
    oferta("MERCADO_LIVRE", { marketplace: "MERCADO_LIVRE" }),
    oferta("AMAZON", {
      marketplace: "AMAZON",
      status: "UNAVAILABLE",
    }),
  ]),
  false,
  "segunda loja UNAVAILABLE nao qualifica",
);

assert.equal(
  hasPublicMultiStore([
    oferta("MERCADO_LIVRE", { marketplace: "MERCADO_LIVRE" }),
    oferta("AMAZON", {
      marketplace: "AMAZON",
      price: 0,
    }),
  ]),
  false,
  "segunda loja sem preco valido nao qualifica",
);

assert.equal(
  hasPublicMultiStore([
    oferta("MERCADO_LIVRE", { marketplace: "MERCADO_LIVRE" }),
    oferta("AMAZON", {
      marketplace: "AMAZON",
      matchStatus: "REVIEW",
    }),
  ]),
  false,
  "segunda loja nao EXACT nao qualifica",
);

// 7. PUBLIC_SEARCH_DOES_NOT_RETURN_SINGLE_STORE
// O boundary da pesquisa publica (searchCatalogOrDiscover) so libera
// produtos com >= 2 marketplaces distintos entre as ofertas do cluster.
assert.equal(
  countDistinctNonEmptyMarketplaces([oferta("SHOPEE")]) >= 2,
  false,
  "pesquisa nao deve devolver cluster single store",
);
assert.equal(
  countDistinctNonEmptyMarketplaces([
    oferta("SHOPEE", { marketplace: "SHOPEE" }),
    oferta("MERCADO_LIVRE", { marketplace: "MERCADO_LIVRE" }),
  ]) >= 2,
  true,
  "pesquisa devolve cluster com 2 lojas distintas",
);
assert.equal(
  countDistinctNonEmptyMarketplaces([
    oferta("SHOPEE", { marketplace: "SHOPEE" }),
    oferta("SHOPEE", { marketplace: "SHOPEE" }),
  ]) >= 2,
  false,
  "pesquisa nao conta 2 ofertas da mesma loja como multi loja",
);

// 8. HOME_DOES_NOT_RETURN_SINGLE_STORE
// A Home filtra os produtos por hasPublicMultiStore antes de renderizar.
const homeProducts = [
  {
    id: "a",
    name: "Single loja",
    offers: [oferta("MERCADO_LIVRE")],
  },
  {
    id: "b",
    name: "Multi loja",
    offers: [
      oferta("MERCADO_LIVRE"),
      oferta("AMAZON", { marketplace: "AMAZON" }),
    ],
  },
];
const homeVisiveis = homeProducts.filter(hasPublicMultiStore);
assert.deepEqual(
  homeVisiveis.map((p) => p.id),
  ["b"],
  "Home oculta single store e mantem multistore",
);

// 9. PRODUCT_PAGE_BLOCKS_SINGLE_STORE
// A pagina /produto/[id] chama hasPublicMultiStore e notFound() se falso.
const singleStoreProduct = {
  id: "x",
  name: "Produto single loja",
  offers: [oferta("MERCADO_LIVRE")],
};
assert.equal(
  hasPublicMultiStore(singleStoreProduct),
  false,
  "pagina de produto bloqueia single store",
);

const multiStoreProduct = {
  id: "y",
  name: "Produto multi loja",
  offers: [
    oferta("MERCADO_LIVRE"),
    oferta("AMAZON", { marketplace: "AMAZON" }),
  ],
};
assert.equal(
  hasPublicMultiStore(multiStoreProduct),
  true,
  "pagina de produto mantem multistore",
);

// 10. EXISTING_VALID_MULTISTORE_REMAINS_VISIBLE
assert.equal(
  hasPublicMultiStore([
    { marketplace: "SHOPEE", active: true, available: true, status: "ACTIVE", matchStatus: "EXACT", price: 50 },
    { marketplace: "MERCADO_LIVRE", active: true, available: true, status: "ACTIVE", matchStatus: "EXACT", price: 48 },
    { marketplace: "ALIEXPRESS", active: true, available: true, status: "ACTIVE", matchStatus: "EXACT", price: 55 },
  ]),
  true,
  "multistore existente permanece visivel",
);

// Sanidade: isUsablePublicOffer / countDistinctPublicMarketplaces
assert.equal(
  countDistinctPublicMarketplaces([
    oferta("SHOPEE", { marketplace: "SHOPEE" }),
    oferta("SHOPEE", { marketplace: "SHOPEE" }),
  ]),
  1,
  "contagem distinta ignora loja repetida",
);
assert.equal(
  isUsablePublicOffer(oferta("AMAZON", { marketplace: "AMAZON" })),
  true,
  "oferta valida e utilizavel",
);
assert.equal(
  isUsablePublicOffer(
    oferta("AMAZON", { marketplace: "AMAZON", available: false }),
  ),
  false,
  "oferta indisponivel nao e utilizavel",
);

/*
 * INVARIANTE DE PUBLICACAO AUTOMATICA
 *
 * publicarProdutoComMultiloja decide com EXATAMENTE esta expressao:
 *   countDistinctPublicMarketplaces(ofertas) >= minimumExactStores
 * e processImportQueue passa minimumExactStores =
 * PUBLIC_MULTISTORE_MIN_MARKETPLACES para ProductOpportunity automatica.
 * Assim "publicado" nunca pode divirgir de "visivel publicamente".
 */
assert.equal(
  PUBLIC_MULTISTORE_MIN_MARKETPLACES,
  2,
  "minimo publico de marketplaces e 2",
);

const gatePublicacaoAutomatica = (
  ofertas: Offer[],
  minimo: number = PUBLIC_MULTISTORE_MIN_MARKETPLACES,
): boolean =>
  countDistinctPublicMarketplaces(ofertas) >= minimo;

// A. 1 oferta Mercado Livre => 1 marketplace => publicacao rejeitada
{
  const ofertas = [oferta("MERCADO_LIVRE")];
  assert.equal(
    countDistinctPublicMarketplaces(ofertas),
    1,
    "A: uma oferta Mercado Livre conta 1 marketplace publico",
  );
  assert.equal(
    gatePublicacaoAutomatica(ofertas),
    false,
    "A: publicacao automatica rejeitada com 1 marketplace",
  );
  assert.equal(
    hasPublicMultiStore(ofertas),
    false,
    "A: produto permanece publicamente oculto",
  );
}

// B. Mercado Livre + Magalu => 2 => aceita
{
  const ofertas = [
    oferta("MERCADO_LIVRE"),
    oferta("MAGAZINE_LUIZA"),
  ];
  assert.equal(
    countDistinctPublicMarketplaces(ofertas),
    2,
    "B: Mercado Livre + Magalu contam 2 marketplaces",
  );
  assert.equal(
    gatePublicacaoAutomatica(ofertas),
    true,
    "B: publicacao automatica aceita com 2 marketplaces",
  );
  assert.equal(
    hasPublicMultiStore(ofertas),
    true,
    "B: produto fica publicamente visivel",
  );
}

// C. duas entradas do mesmo marketplace continuam 1
{
  const ofertas = [
    oferta("MERCADO_LIVRE"),
    oferta("MERCADO_LIVRE", { price: 90 }),
  ];
  assert.equal(
    countDistinctPublicMarketplaces(ofertas),
    1,
    "C: duas entradas do mesmo marketplace continuam 1",
  );
  assert.equal(
    gatePublicacaoAutomatica(ofertas),
    false,
    "C: duas ofertas da mesma loja nao publicam",
  );
}

// D. oferta ERROR nao conta
{
  const ofertas = [
    oferta("MERCADO_LIVRE"),
    oferta("AMAZON", { status: "ERROR" }),
  ];
  assert.equal(
    gatePublicacaoAutomatica(ofertas),
    false,
    "D: oferta ERROR nao conta para o gate",
  );
}

// E. oferta UNAVAILABLE nao conta
{
  const ofertas = [
    oferta("MERCADO_LIVRE"),
    oferta("SHOPEE", { status: "UNAVAILABLE" }),
  ];
  assert.equal(
    gatePublicacaoAutomatica(ofertas),
    false,
    "E: oferta UNAVAILABLE nao conta para o gate",
  );
}

// F. available=false nao conta
{
  const ofertas = [
    oferta("MERCADO_LIVRE"),
    oferta("ALIEXPRESS", { available: false }),
  ];
  assert.equal(
    gatePublicacaoAutomatica(ofertas),
    false,
    "F: oferta indisponivel nao conta para o gate",
  );
}

// G. price <= 0 nao conta
{
  const ofertas = [
    oferta("MERCADO_LIVRE"),
    oferta("AMAZON", { price: 0 }),
  ];
  assert.equal(
    gatePublicacaoAutomatica(ofertas),
    false,
    "G: preco zerado nao conta para o gate",
  );

  assert.equal(
    gatePublicacaoAutomatica([
      oferta("MERCADO_LIVRE"),
      oferta("AMAZON", { price: -10 }),
    ]),
    false,
    "G: preco negativo nao conta para o gate",
  );
}

console.log("multiStoreVisibility: todos os casos passaram");
