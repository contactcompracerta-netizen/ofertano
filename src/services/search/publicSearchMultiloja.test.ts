import assert from "node:assert/strict";

import { decidirAlvoDaOferta } from "../database/saveProduct";
import {
  descobrirProdutosComAdapters,
} from "../discovery";
import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
} from "../discovery/core/types";
import {
  avaliarCompatibilidadeComConsulta,
  avaliarCompatibilidadeExataEntreImports,
  criarConsultasGlobaisDeIdentidade,
} from "../identity";
import type { ProductImport } from "../importers/core/types";
import { escolherClusterExatoDaPesquisaPublica } from "./persistPublicSearchCluster";
import type { PublicSearchOffer } from "./persistPublicSearchCluster";

const QUERY =
  "Smartphone NovaTech Pulse NTX20-41-8C3 128GB 5G";

const SAME_TITLE =
  "Smartphone NovaTech Pulse NTX20-41-8C3 128GB 5G Dual Chip";

const SAME_TITLE_UNICODE =
  "Smartphone NovaTech Pulse NTX20‑41‑8C3 128GB 5G";

const SUBMODEL_TITLE =
  "Smartphone NovaTech Pulse NTX20-41-9D1 128GB 5G";

const ACCESSORY_TITLE =
  "Capa para NovaTech Pulse NTX20-41-8C3 128GB";

function listing(
  title: string,
  brand: string | null = "NovaTech",
  attributes: Record<string, string> = {},
) {
  return { title, brand, attributes };
}

function offer(input: {
  marketplace: ProductImport["marketplace"];
  externalId: string;
  title: string;
  price: number;
  brand?: string | null;
  attributes?: Record<string, string>;
  affiliateLink?: string | null;
}): PublicSearchOffer {
  const affiliateLink =
    input.affiliateLink === undefined
      ? `https://aff.example/${input.externalId}`
      : input.affiliateLink;

  return {
    product: {
      marketplace: input.marketplace,
      externalId: input.externalId,
      url: `https://loja.example/${input.externalId}`,
      affiliateLink,
      title: input.title,
      description: null,
      brand: input.brand ?? "NovaTech",
      category: "Eletronicos",
      image: "https://img.example/produto.jpg",
      images: ["https://img.example/produto.jpg"],
      price: input.price,
      oldPrice: input.price + 200,
      discount: null,
      installments: null,
      rating: null,
      reviews: null,
      sales: null,
      stock: 8,
      seller: null,
      attributes: input.attributes ?? {},
    },
    affiliateLink,
  };
}

function candidate(input: {
  marketplace: DiscoveryCandidate["marketplace"];
  marketplaceName: DiscoveryCandidate["marketplaceName"];
  title: string;
  externalId: string;
  price: number;
}): DiscoveryCandidate {
  return {
    marketplace: input.marketplace,
    marketplaceName: input.marketplaceName,
    externalId: input.externalId,
    sourceUrl: `https://loja.example/${input.externalId}`,
    affiliateLink: `https://aff.example/${input.externalId}`,
    title: input.title,
    image: "https://img.example/produto.jpg",
    price: input.price,
    oldPrice: null,
    brand: "NovaTech",
    attributes: {},
    status: "FOUND",
  };
}

function adapter(
  marketplace: DiscoveryAdapter["marketplace"],
  marketplaceName: DiscoveryAdapter["marketplaceName"],
  searcher: NonNullable<DiscoveryAdapter["searcher"]>,
): DiscoveryAdapter {
  return {
    marketplace,
    marketplaceName,
    enabled: true,
    searcher,
  };
}

const sameProductOffers: PublicSearchOffer[] = [
  offer({
    marketplace: "Mercado Livre",
    externalId: "MLB111",
    title: SAME_TITLE,
    price: 2199,
  }),
  offer({
    marketplace: "Amazon",
    externalId: "B00NTX8C3",
    title: SAME_TITLE_UNICODE,
    price: 1899,
  }),
  offer({
    marketplace: "Magazine Luiza",
    externalId: "mag-9d1",
    title: SUBMODEL_TITLE,
    price: 1599,
  }),
  offer({
    marketplace: "Shopee",
    externalId: "shopee-capa",
    title: ACCESSORY_TITLE,
    price: 49.9,
  }),
];

assert.equal(
  avaliarCompatibilidadeExataEntreImports(
    listing(SAME_TITLE),
    listing(SAME_TITLE_UNICODE),
  ).exact,
  true,
  "O mesmo SKU com hifen ASCII e Unicode deve ser EXACT.",
);

assert.equal(
  avaliarCompatibilidadeExataEntreImports(
    listing(SAME_TITLE),
    listing(SUBMODEL_TITLE),
  ).exact,
  false,
  "Submodelo diferente nao pode ser EXACT.",
);

assert.equal(
  avaliarCompatibilidadeExataEntreImports(
    listing(SAME_TITLE),
    listing(ACCESSORY_TITLE),
  ).exact,
  false,
  "Acessorio nao pode ser EXACT do produto principal.",
);

assert.equal(
  avaliarCompatibilidadeComConsulta(QUERY, listing(SUBMODEL_TITLE)).compatible,
  false,
  "A consulta com SKU especifico deve recusar submodelo vizinho.",
);

assert.equal(
  avaliarCompatibilidadeComConsulta(QUERY, listing(ACCESSORY_TITLE)).compatible,
  false,
  "A consulta do produto principal deve recusar acessorio.",
);

assert.equal(
  avaliarCompatibilidadeComConsulta(QUERY, listing(SAME_TITLE)).compatible,
  true,
  "O mesmo SKU da consulta deve ser aceito.",
);

const cluster = escolherClusterExatoDaPesquisaPublica(
  QUERY,
  sameProductOffers,
);

assert.equal(cluster.length, 2, "O cluster EXACT deve ter duas lojas do mesmo SKU.");
assert.deepEqual(
  cluster.map((item) => item.product.marketplace).sort(),
  ["Amazon", "Mercado Livre"],
);
assert.equal(
  Math.min(...cluster.map((item) => item.product.price)),
  1899,
  "A oferta mais barata do cluster precisa ser preservada.",
);
assert.ok(
  cluster.every((item) => Boolean(item.affiliateLink?.trim())),
  "Os links afiliados das ofertas EXACT devem ser preservados.",
);

const queryPlan = criarConsultasGlobaisDeIdentidade(
  `${QUERY} 7891234567895`,
);

assert.ok(
  queryPlan.some((consulta) => /NTX20-41-8C3/i.test(consulta)),
  "O plano de busca deve conter o SKU original, inclusive com hifens.",
);
assert.ok(
  queryPlan.includes("7891234567895"),
  "O plano de busca deve incluir GTIN/EAN quando a consulta trouxer um codigo global.",
);

const alvoNovo = decidirAlvoDaOferta({
  targetProductId: null,
  verifiedExactMatch: false,
  targetExiste: false,
  ofertaExistenteProductId: null,
});
assert.equal(alvoNovo.usarTarget, false);
assert.equal(alvoNovo.desanexarOfertaExistente, false);

const alvoCanonico = decidirAlvoDaOferta({
  targetProductId: "product-canonico",
  verifiedExactMatch: true,
  targetExiste: true,
  ofertaExistenteProductId: "product-duplicado",
});
assert.equal(alvoCanonico.usarTarget, true);
assert.equal(
  alvoCanonico.desanexarOfertaExistente,
  true,
  "Uma oferta ja gravada em outro Product deve ser desanexada para nao duplicar o canonico.",
);

const alvoMesmoProduto = decidirAlvoDaOferta({
  targetProductId: "product-canonico",
  verifiedExactMatch: true,
  targetExiste: true,
  ofertaExistenteProductId: "product-canonico",
});
assert.equal(alvoMesmoProduto.usarTarget, true);
assert.equal(alvoMesmoProduto.desanexarOfertaExistente, false);

async function persistirComSalvadorSimulado(
  offers: PublicSearchOffer[],
): Promise<string[]> {
  let productId: string | null = null;
  const ids: string[] = [];

  for (const item of offers) {
    const existingOfferProductId =
      item.product.externalId === "ja-existia-em-outro"
        ? "product-duplicado"
        : null;

    const decisao = decidirAlvoDaOferta({
      targetProductId: productId,
      verifiedExactMatch: Boolean(productId),
      targetExiste: Boolean(productId),
      ofertaExistenteProductId: existingOfferProductId,
    });

    const savedId = decisao.usarTarget
      ? productId!
      : productId ?? "product-canonico";

    ids.push(savedId);
    productId = savedId;
  }

  return ids;
}

async function runAsyncCases() {
  const persistedIds = await persistirComSalvadorSimulado([
    offer({
      marketplace: "Mercado Livre",
      externalId: "MLB111",
      title: SAME_TITLE,
      price: 2199,
    }),
    offer({
      marketplace: "Amazon",
      externalId: "ja-existia-em-outro",
      title: SAME_TITLE_UNICODE,
      price: 1899,
    }),
  ]);

  assert.equal(new Set(persistedIds).size, 1);
  assert.equal(persistedIds[0], "product-canonico");

  let amazonCalls = 0;

  const discovery = await descobrirProdutosComAdapters(
    QUERY,
    [
      adapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
        marketplace: "MERCADO_LIVRE",
        query: QUERY,
        success: true,
        scanned: 3,
        candidates: [
          candidate({
            marketplace: "MERCADO_LIVRE",
            marketplaceName: "Mercado Livre",
            title: SAME_TITLE,
            externalId: "MLB111",
            price: 2199,
          }),
        ],
      })),
      adapter("AMAZON", "Amazon", async () => {
        amazonCalls += 1;
        throw new Error("fetch failed");
      }),
      adapter("SHOPEE", "Shopee", async () => ({
        marketplace: "SHOPEE",
        query: QUERY,
        success: true,
        scanned: 2,
        candidates: [
          candidate({
            marketplace: "SHOPEE",
            marketplaceName: "Shopee",
            title: SAME_TITLE,
            externalId: "shp-8c3",
            price: 2050,
          }),
        ],
      })),
      adapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => ({
        marketplace: "MAGAZINE_LUIZA",
        query: QUERY,
        success: true,
        scanned: 4,
        candidates: [
          candidate({
            marketplace: "MAGAZINE_LUIZA",
            marketplaceName: "Magazine Luiza",
            title: SUBMODEL_TITLE,
            externalId: "mag-9d1",
            price: 1599,
          }),
        ],
      })),
    ],
    5,
    { mode: "MULTILOJA" },
  );

  assert.equal(
    discovery.results.find((result) => result.marketplace === "AMAZON")?.success,
    false,
    "Amazon indisponivel deve falhar sozinha.",
  );
  assert.ok(amazonCalls >= 2, "Falha temporaria deve ser re tentada.");
  assert.equal(
    discovery.results.find((result) => result.marketplace === "MERCADO_LIVRE")
      ?.success,
    true,
  );
  assert.equal(
    discovery.results.find((result) => result.marketplace === "SHOPEE")?.success,
    true,
  );
  assert.ok(
    discovery.candidates.some(
      (item) => item.marketplace === "MERCADO_LIVRE" && item.externalId === "MLB111",
    ),
  );
  assert.ok(
    discovery.candidates.some(
      (item) => item.marketplace === "SHOPEE" && item.externalId === "shp-8c3",
    ),
  );
  assert.equal(
    discovery.candidates.some((item) => item.externalId === "mag-9d1"),
    false,
    "Submodelo de outra loja nao pode atravessar o filtro global da consulta.",
  );

  const clusterAposDiscovery = escolherClusterExatoDaPesquisaPublica(
    QUERY,
    discovery.candidates.map((item) =>
      offer({
        marketplace: item.marketplaceName,
        externalId: item.externalId,
        title: item.title,
        price: item.price ?? 0,
        affiliateLink: item.affiliateLink,
      }),
    ),
  );

  assert.ok(clusterAposDiscovery.length >= 2);
  assert.equal(
    new Set(clusterAposDiscovery.map((item) => item.product.marketplace)).size,
    clusterAposDiscovery.length,
  );
}

void runAsyncCases()
  .then(() => {
    console.log("public search multi loja: todos os casos estruturais passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
