import assert from "node:assert/strict";

import {
  buildRawListingContextFromImport,
} from "./processQueue";

import type {
  ProductImport,
} from "../importers/core/types";

import type {
  RawListingPersistenceContext,
} from "../database/saveProduct";

type RawListingMarketplace =
  RawListingPersistenceContext["marketplace"];

const produto = (
  overrides: Partial<ProductImport> = {},
): ProductImport => ({
  marketplace: "Mercado Livre",
  externalId: "MLB4171634813",
  url: "https://produto.mercadolivre.com.br/MLB-4171634813-fone-bluetooth-_JM",
  title: "Fone Bluetooth Teste",
  description: null,
  brand: null,
  category: null,
  image: "https://http2.mlstatic.com/img.jpg",
  images: [],
  price: 129.9,
  oldPrice: null,
  discount: null,
  installments: null,
  rating: null,
  reviews: null,
  sales: null,
  stock: null,
  seller: null,
  attributes: {},
  ...overrides,
});

/*
 * Arquitetura V1 (FASE 6) — rawListingContext na fila de importação.
 *
 * O fluxo REAL de ingestão (processImportQueue -> saveProduct) precisa
 * entregar o contexto raw para o hook shadow (inerte por default). Sem
 * ele, a Architecture V1 nunca receberia a listing real em produção via
 * import-queue. O helper é aditivo: só constrói o contexto, não altera
 * Product/MarketplaceOffer/PriceHistory/publicação.
 */

// 1. Mercado Livre -> contexto completo com o enum DB exato
{
  const contexto =
    buildRawListingContextFromImport(produto());

  assert.deepEqual(contexto, {
    marketplace: "MERCADO_LIVRE",
    externalId: "MLB4171634813",
    sourceUrl:
      "https://produto.mercadolivre.com.br/MLB-4171634813-fone-bluetooth-_JM",
    title: "Fone Bluetooth Teste",
    price: 129.9,
  });
}

// 2. Nome humano de cada marketplace -> enum DB (caso a fila cresça além de ML)
{
  const casos: Array<
    [ProductImport["marketplace"], RawListingMarketplace]
  > = [
    ["Mercado Livre", "MERCADO_LIVRE"],
    ["Amazon", "AMAZON"],
    ["Shopee", "SHOPEE"],
    ["Magazine Luiza", "MAGAZINE_LUIZA"],
    ["AliExpress", "ALIEXPRESS"],
  ];

  for (const [nome, codigo] of casos) {
    const contexto =
      buildRawListingContextFromImport(
        produto({ marketplace: nome }),
      );
    assert.equal(
      contexto?.marketplace,
      codigo,
      `marketplace humano ${nome} deve virar ${codigo}`,
    );
  }
}

// 3. URL inválida => sem contexto (nunca alimenta o shadow)
{
  const contexto =
    buildRawListingContextFromImport(
      produto({ url: "ftp://nao-http" }),
    );
  assert.equal(contexto, undefined);
}

// 4. Sem externalId => sem contexto
{
  const contexto =
    buildRawListingContextFromImport(
      produto({ externalId: "  " }),
    );
  assert.equal(contexto, undefined);
}

// 5. Sem url => sem contexto
{
  const contexto =
    buildRawListingContextFromImport(
      produto({ url: "" }),
    );
  assert.equal(contexto, undefined);
}