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

const CONCEPT_QUERY = "Smartphone Aurora Pulse AX90 256GB";
const CONCEPT_PHONE_A =
  "Smartphone Aurora Pulse AX90 256GB";
const CONCEPT_PHONE_B =
  "Aurora Pulse AX90 5G 256GB Smartphone";
const CONCEPT_CASE = "Capa Aurora Pulse AX90";
const CONCEPT_FILM = "Pelicula Aurora Pulse AX90";

assert.equal(
  avaliarCompatibilidadeComConsulta(
    CONCEPT_QUERY,
    listing(CONCEPT_PHONE_A, "Aurora"),
  ).compatible,
  true,
);
assert.equal(
  avaliarCompatibilidadeComConsulta(
    CONCEPT_QUERY,
    listing(CONCEPT_PHONE_B, "Aurora"),
  ).compatible,
  true,
);
assert.equal(
  avaliarCompatibilidadeComConsulta(
    CONCEPT_QUERY,
    listing(CONCEPT_CASE, "Aurora"),
  ).compatible,
  false,
  "Capa sem 'para' nao pode passar no filtro da consulta do aparelho.",
);
assert.equal(
  avaliarCompatibilidadeComConsulta(
    CONCEPT_QUERY,
    listing(CONCEPT_FILM, "Aurora"),
  ).compatible,
  false,
  "Pelicula nao pode passar no filtro da consulta do aparelho.",
);

assert.equal(
  avaliarCompatibilidadeExataEntreImports(
    listing(CONCEPT_PHONE_A, "Aurora"),
    listing(CONCEPT_PHONE_B, "Aurora"),
  ).exact,
  true,
  "Smartphones equivalentes com titulos diferentes devem ser EXACT.",
);
assert.equal(
  avaliarCompatibilidadeExataEntreImports(
    listing(CONCEPT_PHONE_A, "Aurora"),
    listing(CONCEPT_CASE, "Aurora"),
  ).exact,
  false,
);

const conceptualCluster = escolherClusterExatoDaPesquisaPublica(
  CONCEPT_QUERY,
  [
    offer({
      marketplace: "Mercado Livre",
      externalId: "ml-ax90",
      title: CONCEPT_PHONE_A,
      price: 1899,
      brand: "Aurora",
    }),
    offer({
      marketplace: "Amazon",
      externalId: "amz-ax90",
      title: CONCEPT_PHONE_B,
      price: 1749,
      brand: "Aurora",
    }),
    offer({
      marketplace: "Magazine Luiza",
      externalId: "mag-ax90",
      title: "Aurora Pulse AX90 Smartphone 256GB Dual Chip",
      price: 1990,
      brand: "Aurora",
    }),
    offer({
      marketplace: "Shopee",
      externalId: "shp-ax90",
      title: "Smartphone Aurora Pulse AX90 256 GB 5G",
      price: 1810,
      brand: "Aurora",
    }),
    offer({
      marketplace: "AliExpress",
      externalId: "ali-capa",
      title: CONCEPT_CASE,
      price: 10,
      brand: "Aurora",
    }),
    offer({
      marketplace: "Shopee",
      externalId: "shp-pelicula",
      title: CONCEPT_FILM,
      price: 18.99,
      brand: "Aurora",
    }),
  ],
);

assert.equal(
  conceptualCluster.length,
  4,
  "Quatro lojas do mesmo smartphone devem formar um unico cluster.",
);
assert.equal(
  new Set(conceptualCluster.map((item) => item.product.marketplace)).size,
  4,
);
assert.ok(
  conceptualCluster.every((item) => item.product.price >= 1700),
  "Acessorio barato nao pode entrar no cluster nem virar identidade.",
);
assert.ok(
  conceptualCluster.every(
    (item) =>
      !/capa|pelicula/i.test(item.product.title),
  ),
);

const queryWithoutStorage = "Smartphone Aurora Pulse AX90";
const clusterWithoutStorage = escolherClusterExatoDaPesquisaPublica(
  queryWithoutStorage,
  [
    offer({
      marketplace: "Mercado Livre",
      externalId: "ml-ax90-main",
      title: CONCEPT_PHONE_A,
      price: 1899,
      brand: "Aurora",
    }),
    offer({
      marketplace: "AliExpress",
      externalId: "ali-capa-barata",
      title: CONCEPT_CASE,
      price: 9.46,
      brand: "Aurora",
    }),
    offer({
      marketplace: "Shopee",
      externalId: "shp-cabo",
      title: "Cabo carregador Aurora Pulse AX90",
      price: 18.99,
      brand: "Aurora",
    }),
    offer({
      marketplace: "Amazon",
      externalId: "amz-ax90-main",
      title: CONCEPT_PHONE_B,
      price: 1749,
      brand: "Aurora",
    }),
  ],
);

assert.equal(
  clusterWithoutStorage.length,
  2,
  "Sem armazenamento na consulta, o cluster ainda deve ser so do aparelho.",
);
assert.ok(
  clusterWithoutStorage.every((item) => item.product.price >= 1700),
  "Preco baixo de acessorio nao pode definir o Product principal.",
);

const headphoneQuery = "Fone Aurora Tune ZX20";
const headphoneCluster = escolherClusterExatoDaPesquisaPublica(
  headphoneQuery,
  [
    offer({
      marketplace: "Magazine Luiza",
      externalId: "mag-zx20",
      title: "Fone de Ouvido Aurora Tune ZX20 Bluetooth",
      price: 231.92,
      brand: "Aurora",
    }),
    offer({
      marketplace: "Amazon",
      externalId: "amz-zx20",
      title: "Aurora Tune ZX20 Headset Bluetooth",
      price: 219,
      brand: "Aurora",
    }),
    offer({
      marketplace: "Mercado Livre",
      externalId: "ml-zx20",
      title: "Headphone Aurora Tune ZX20",
      price: 249,
      brand: "Aurora",
    }),
  ],
);

assert.ok(
  headphoneCluster.length >= 2,
  "Fones equivalentes com titulos diferentes devem formar Multi Loja.",
);

const HEADPHONE_QUERY = "Headphone Aurora ZX100";
const HEADPHONE_MAIN_A = "Headphone Aurora ZX100 Bluetooth";
const HEADPHONE_MAIN_B = "Fone Bluetooth Aurora ZX100";
const HEADPHONE_PADS =
  "Almofadas de substituicao para Aurora ZX90 ZX100 ZX200 ZX300 JR10";
const HEADPHONE_CASE = "Case compativel Aurora ZX100";

assert.equal(
  avaliarCompatibilidadeComConsulta(
    HEADPHONE_QUERY,
    listing(HEADPHONE_MAIN_A, "Aurora"),
  ).compatible,
  true,
);
assert.equal(
  avaliarCompatibilidadeComConsulta(
    HEADPHONE_QUERY,
    listing(HEADPHONE_MAIN_B, "Aurora"),
  ).compatible,
  true,
);
assert.equal(
  avaliarCompatibilidadeComConsulta(
    HEADPHONE_QUERY,
    listing(HEADPHONE_PADS, "Aurora"),
  ).compatible,
  false,
  "Almofada de varios modelos nao disputa a referencia MAIN.",
);
assert.equal(
  avaliarCompatibilidadeComConsulta(
    HEADPHONE_QUERY,
    listing(HEADPHONE_CASE, "Aurora"),
  ).compatible,
  false,
);

const headphoneAccessoryCluster = escolherClusterExatoDaPesquisaPublica(
  HEADPHONE_QUERY,
  [
    offer({
      marketplace: "Amazon",
      externalId: "amz-zx100",
      title: HEADPHONE_MAIN_A,
      price: 900,
      brand: "Aurora",
    }),
    offer({
      marketplace: "Shopee",
      externalId: "shp-zx100",
      title: HEADPHONE_MAIN_B,
      price: 870,
      brand: "Aurora",
    }),
    offer({
      marketplace: "Magazine Luiza",
      externalId: "mag-zx100",
      title: "Aurora ZX100 Headset",
      price: 920,
      brand: "Aurora",
    }),
    offer({
      marketplace: "AliExpress",
      externalId: "ali-pads",
      title: HEADPHONE_PADS,
      price: 20,
      brand: "Aurora",
    }),
    offer({
      marketplace: "AliExpress",
      externalId: "ali-case",
      title: HEADPHONE_CASE,
      price: 18,
      brand: "Aurora",
    }),
  ],
);

assert.equal(
  headphoneAccessoryCluster.length,
  3,
  "Tres lojas MAIN equivalentes formam o cluster; AliExpress so com peca nao entra.",
);
assert.deepEqual(
  headphoneAccessoryCluster.map((item) => item.product.marketplace).sort(),
  ["Amazon", "Magazine Luiza", "Shopee"],
);
assert.ok(
  headphoneAccessoryCluster.every((item) => item.product.price >= 800),
  "Preco da peca nao interfere na identidade do cluster.",
);
assert.ok(
  headphoneAccessoryCluster.every(
    (item) => !/almofad|case/i.test(item.product.title),
  ),
);

const padQueryCluster = escolherClusterExatoDaPesquisaPublica(
  "almofada Aurora ZX100",
  [
    offer({
      marketplace: "AliExpress",
      externalId: "ali-pad-query",
      title: HEADPHONE_PADS,
      price: 20,
      brand: "Aurora",
    }),
    offer({
      marketplace: "Amazon",
      externalId: "amz-headphone-query",
      title: HEADPHONE_MAIN_A,
      price: 900,
      brand: "Aurora",
    }),
  ],
);

assert.equal(
  padQueryCluster.length,
  1,
  "Consulta de peca deve persistir a peca, nao o headphone.",
);
assert.match(padQueryCluster[0]!.product.title, /almofad/i);

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
      adapter("ALIEXPRESS", "AliExpress", async () => {
        throw new Error("aliexpress down");
      }),
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
  assert.equal(
    discovery.results.find((result) => result.marketplace === "ALIEXPRESS")
      ?.success,
    false,
    "A falha de uma loja nao pode impedir o Discovery das demais.",
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

  const LONG_QUERY =
    "Headphone MarcaR Wave Wireless Rosa Resistente à Água";
  const seenQueries: string[] = [];

  const progressiveDiscovery = await descobrirProdutosComAdapters(
    LONG_QUERY,
    [
      adapter("MERCADO_LIVRE", "Mercado Livre", async ({ query }) => {
        seenQueries.push(query);
        const compact = query.replace(/\s+/g, " ").trim();

        if (compact === LONG_QUERY) {
          return {
            marketplace: "MERCADO_LIVRE",
            query,
            success: true,
            scanned: 20,
            candidates: [],
          };
        }

        if (/marcar/.test(query.toLowerCase()) || /wave/.test(query.toLowerCase())) {
          return {
            marketplace: "MERCADO_LIVRE",
            query,
            success: true,
            scanned: 8,
            candidates: [
              {
                marketplace: "MERCADO_LIVRE",
                marketplaceName: "Mercado Livre",
                externalId: "MLB-WAVE",
                sourceUrl: "https://loja.example/MLB-WAVE",
                affiliateLink: "https://aff.example/MLB-WAVE",
                title: LONG_QUERY,
                image: "https://img.example/wave.jpg",
                price: 189,
                oldPrice: null,
                brand: null,
                attributes: {},
                status: "FOUND",
              },
            ],
          };
        }

        return {
          marketplace: "MERCADO_LIVRE",
          query,
          success: true,
          scanned: 3,
          candidates: [],
        };
      }),
      adapter("AMAZON", "Amazon", async ({ query }) => ({
        marketplace: "AMAZON",
        query,
        success: true,
        scanned: 0,
        candidates: [],
      })),
    ],
    5,
    { mode: "MULTILOJA" },
  );

  assert.ok(
    seenQueries.some((item) => item === LONG_QUERY),
    "A consulta completa deve ir para o adapter.",
  );
  assert.ok(
    seenQueries.some(
      (item) =>
        item.length < LONG_QUERY.length &&
        /marcar|wave/.test(item.toLowerCase()),
    ),
    "O plano deve enviar fallback progressivo com termos distintivos.",
  );
  assert.ok(
    progressiveDiscovery.candidates.some(
      (item) => item.externalId === "MLB-WAVE",
    ),
    "O produto do fallback deve ser validado e preservado.",
  );

  const isolatedZero = await descobrirProdutosComAdapters(
    LONG_QUERY,
    [
      adapter("MERCADO_LIVRE", "Mercado Livre", async ({ query }) => ({
        marketplace: "MERCADO_LIVRE",
        query,
        success: true,
        scanned: 16,
        candidates: [],
      })),
      adapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => ({
        marketplace: "MAGAZINE_LUIZA",
        query: LONG_QUERY,
        success: true,
        scanned: 4,
        candidates: [
          {
            marketplace: "MAGAZINE_LUIZA",
            marketplaceName: "Magazine Luiza",
            externalId: "mag-wave",
            sourceUrl: "https://loja.example/mag-wave",
            affiliateLink: "https://aff.example/mag-wave",
            title: LONG_QUERY,
            image: "https://img.example/wave.jpg",
            price: 199,
            oldPrice: null,
            brand: null,
            attributes: {},
            status: "FOUND",
          },
        ],
      })),
    ],
    5,
    { mode: "MULTILOJA" },
  );

  assert.equal(
    isolatedZero.results.find((item) => item.marketplace === "MERCADO_LIVRE")
      ?.success,
    true,
  );
  assert.equal(
    isolatedZero.results.find((item) => item.marketplace === "MERCADO_LIVRE")
      ?.candidates.length,
    0,
  );
  assert.ok(
    isolatedZero.candidates.some((item) => item.externalId === "mag-wave"),
    "Zero candidatos em uma loja nao pode impedir as demais.",
  );
}

const STRUCTURAL_QUERY = "Headphone MarcaX ZX100";
const STRUCTURAL_MAIN_A = "Headphone MarcaX ZX100 Bluetooth";
const STRUCTURAL_MAIN_B = "Fone Bluetooth MarcaX ZX100";
const STRUCTURAL_MAIN_C = "Headphone MarcaX ZX100 Preto";
const STRUCTURAL_CASE =
  "Estojo de armazenamento de headphone para MarcaX ZX100 ZX200 ZX300 ZX400 ZX500 ZX600 bolsa rigida de transporte";

const structuralCluster = escolherClusterExatoDaPesquisaPublica(
  STRUCTURAL_QUERY,
  [
    offer({
      marketplace: "Amazon",
      externalId: "amz-zx100-main",
      title: STRUCTURAL_MAIN_A,
      price: 280,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "Shopee",
      externalId: "shp-zx100-main",
      title: STRUCTURAL_MAIN_B,
      price: 250,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "Magazine Luiza",
      externalId: "mag-zx100-main",
      title: STRUCTURAL_MAIN_C,
      price: 300,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "AliExpress",
      externalId: "ali-zx100-case",
      title: STRUCTURAL_CASE,
      price: 20,
      brand: "MarcaX",
    }),
  ],
);

assert.equal(
  structuralCluster.length,
  3,
  "Tres MAIN inequívocos formam o cluster; o estojo de 6 modelos nao disputa referencia.",
);
assert.ok(
  structuralCluster.every((item) => item.product.price >= 200),
  "Acessorio barato nao vira referencia MAIN independentemente do preco.",
);
assert.ok(
  structuralCluster.every(
    (item) => !/estojo|bolsa|transporte/i.test(item.product.title),
  ),
);
assert.ok(
  structuralCluster.some((item) => item.product.title === STRUCTURAL_MAIN_A),
);

const CONSENSUS_QUERY = "Headphone MarcaX ZX100";
const consensusCluster = escolherClusterExatoDaPesquisaPublica(
  CONSENSUS_QUERY,
  [
    offer({
      marketplace: "Amazon",
      externalId: "amz-zx100-a",
      title: "Headphone MarcaX ZX100 Bluetooth",
      price: 280,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "Amazon",
      externalId: "amz-zx100-b",
      title: "Headphone MarcaX ZX100 Preto",
      price: 275,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "Shopee",
      externalId: "shp-zx100-a",
      title: "Fone Bluetooth MarcaX ZX100",
      price: 250,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "Shopee",
      externalId: "shp-zx100-b",
      title: "Headphone MarcaX ZX100",
      price: 255,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "Magazine Luiza",
      externalId: "mag-zx100-a",
      title: "Headphone MarcaX ZX100 Headset",
      price: 300,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "Magazine Luiza",
      externalId: "mag-zx100-b",
      title: "MarcaX ZX100 Headphone",
      price: 290,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "Mercado Livre",
      externalId: "ml-zx100-a",
      title: "Headphone MarcaX ZX100 Azul",
      price: 270,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "Mercado Livre",
      externalId: "ml-zx100-b",
      title: "Headphone MarcaX ZX100 Bluetooth 5.3",
      price: 268,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "Shopee",
      externalId: "shp-zx100-sku",
      title: "Headphone MarcaX ZX100 MXZX100 Branco - REEMBALADO",
      price: 199,
      brand: "MarcaX",
    }),
    offer({
      marketplace: "AliExpress",
      externalId: "ali-zx100-amb",
      title: "Headphone MarcaX ZX100 ZX200 kit",
      price: 210,
      brand: "MarcaX",
    }),
  ],
);

assert.ok(
  consensusCluster.length >= 3,
  "Consenso ZX100 em varias lojas deve formar Multi Loja.",
);
assert.ok(
  new Set(consensusCluster.map((item) => item.product.marketplace)).size >= 3,
);
const consensusReference = consensusCluster[0];
assert.ok(consensusReference);
assert.equal(
  /REEMBALADO/i.test(consensusReference.product.title),
  false,
  "REEMBALADO nao vira ancora quando existem anuncios novos equivalentes.",
);
assert.ok(
  /ZX100/i.test(consensusReference.product.title),
  "Referencia deve permanecer no grupo comercial ZX100.",
);

const distinctivePersistQuery = "Headphone MarcaR Wireless Rosa";
const distinctivePersistCluster = escolherClusterExatoDaPesquisaPublica(
  distinctivePersistQuery,
  [
    offer({
      marketplace: "Amazon",
      externalId: "amz-p47",
      title: "Headphone Wireless Rosa P47",
      price: 79,
      brand: "Generica",
    }),
    offer({
      marketplace: "Magazine Luiza",
      externalId: "mag-marcas",
      title: "Headphone MarcaS Wireless Rosa",
      price: 899,
      brand: "MarcaS",
    }),
    offer({
      marketplace: "Mercado Livre",
      externalId: "ml-marcar",
      title: "Headphone MarcaR Wireless Rosa",
      price: 149,
      brand: "MarcaR",
    }),
  ],
);

assert.equal(
  distinctivePersistCluster.length,
  1,
  "Persistencia publica nao pode aceitar produto sem a entidade distintiva da consulta.",
);
assert.match(distinctivePersistCluster[0]!.product.title, /MarcaR/i);

void runAsyncCases()
  .then(() => {
    console.log("public search multi loja: todos os casos estruturais passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
