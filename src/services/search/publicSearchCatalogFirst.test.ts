import assert from "node:assert/strict";

import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  DiscoveryQuery,
  MarketplaceDiscoveryResult,
} from "../discovery/core/types";
import type { MarketplaceName } from "../importers/core/types";
import { searchCatalogOrDiscover } from "./searchCatalogOrDiscover";
import type { PublicSearchOptions } from "./searchCatalogOrDiscover";

/*
 * BUSCA PÚBLICA — CATALOG-FIRST
 *
 * O motor Multi Loja V2 (`searchMultistoreV2`) faz uma CAÇADA ao vivo: ele
 * consulta as fontes e monta clusters do momento. Ele NÃO lê o catálogo.
 *
 * Sem a mesclagem do catálogo, um produto já publicado e público (Multi Loja
 * real, dentro do gate central) nunca aparecia na busca pública: o usuário
 * digitava o nome exato e recebia "Nenhum produto encontrado" com o produto
 * no ar. Foi exatamente o que aconteceu com o Redmi Buds 6 Play em produção.
 *
 * Estes casos travam o contrato:
 * - catálogo visível + V2 sem resultado => CATALOG (não NOT_FOUND);
 * - catálogo SEM Multi Loja pública => não aparece (gate central);
 * - oferta ML de CATÁLOGO (`/p/`) não conta como loja para a visibilidade;
 * - id repetido entre catálogo e descoberta => aparece uma vez, versão do
 *   catálogo;
 * - leitura do catálogo QUEBRADA => a rota não quebra, cai em NOT_FOUND.
 */

const QUERY = "Redmi Buds 6 Play";

process.env.PUBLIC_SEARCH_PERSISTENCE_ENABLED = "false";

type CatalogReader = NonNullable<PublicSearchOptions["searchCatalogFn"]>;
type CatalogProduct = Awaited<ReturnType<CatalogReader>>;
type CatalogItem = CatalogProduct[number];

function oferta(catalogProduct: {
  marketplace: string;
  price: number;
  externalId?: string | null;
  sourceUrl?: string | null;
  available?: boolean;
  status?: string;
}) {
  return {
    marketplace: catalogProduct.marketplace,
    active: true,
    matchStatus: "EXACT" as const,
    available: catalogProduct.available ?? true,
    status: catalogProduct.status ?? "ACTIVE",
    price: catalogProduct.price,
    externalId: catalogProduct.externalId ?? `id-${catalogProduct.marketplace}`,
    sourceUrl:
      catalogProduct.sourceUrl ?? `https://loja.example/${catalogProduct.marketplace}`,
  };
}

function produtoPublicavel(
  id: string,
  nome = "Fone de Ouvido Sem Fio Xiaomi Redmi Buds 6 Play Bluetooth",
): CatalogItem {
  return {
    id,
    name: nome,
    canonicalName: nome,
    image: "https://img.example/produto.jpeg",
    price: 105,
    oldPrice: null,
    discount: null,
    store: "Shopee",
    brand: "Xiaomi",
    offers: [
      oferta({ marketplace: "SHOPEE", price: 105 }),
      oferta({ marketplace: "MAGAZINE_LUIZA", price: 107.91 }),
    ],
  } as unknown as CatalogItem;
}

function catalogoDe(variacao: string): PublicSearchOptions["searchCatalogFn"] {
  return async () => {
    if (variacao === "erro") {
      throw new Error("catalogo indisponivel");
    }

    if (variacao === "vazio") {
      return [];
    }

    if (variacao === "so-loja") {
      return [
        {
          id: "produto-so-loja",
          name: QUERY,
          image: "https://img.example/um.jpeg",
          price: 90,
          store: "Shopee",
          offers: [oferta({ marketplace: "SHOPEE", price: 90 })],
        },
      ] as unknown as CatalogItem[];
    }

    if (variacao === "ml-catalogo") {
      return [
        {
          id: "produto-ml-catalogo",
          name: QUERY,
          image: "https://img.example/ml.jpeg",
          price: 63,
          store: "Mercado Livre",
          offers: [
            oferta({
              marketplace: "MERCADO_LIVRE",
              price: 63,
              externalId: "MLB123",
              // Rota de CATÁLOGO do ML: agrega N anúncios, não é anúncio.
              sourceUrl:
                "https://www.mercadolivre.com.br/produto/p/MLB123",
            }),
          ],
        },
      ] as unknown as CatalogItem[];
    }

    return [produtoPublicavel("produto-catalogo")];
  };
}

/** Todos os adapters V2 respondem vazio: o motor V2 não encontra cluster. */
function adaptersSemResultado(): DiscoveryAdapter[] {
  const markets: Array<[DiscoveryAdapter["marketplace"], MarketplaceName]> = [
    ["MERCADO_LIVRE", "Mercado Livre"],
    ["AMAZON", "Amazon"],
    ["SHOPEE", "Shopee"],
    ["MAGAZINE_LUIZA", "Magazine Luiza"],
    ["ALIEXPRESS", "AliExpress"],
  ];

  return markets.map(([marketplace, marketplaceName]) => ({
    marketplace,
    marketplaceName,
    enabled: true,
    searcher: async (request: DiscoveryQuery): Promise<MarketplaceDiscoveryResult> => ({
      marketplace,
      query: request.query,
      success: true,
      scanned: 0,
      candidates: [],
      error: null,
    }),
  }));
}

function candidato(
  marketplace: DiscoveryAdapter["marketplace"],
  marketplaceName: MarketplaceName,
  externalId: string,
  price: number,
): DiscoveryCandidate {
  /*
   * A URL do ML precisa ser a página COMPRÁVEL da listing concreta
   * (`MLB-` + 8+ dígitos), senão a identidade é rejeitada e o candidato nem
   * entra como usable.
   */
  const sourceUrl =
    marketplace === "MERCADO_LIVRE"
      ? `https://produto.mercadolivre.com.br/${externalId.slice(0, 3)}-${externalId.slice(3)}-xiaomi-redmi`
      : `https://loja.example/${externalId}`;

  return {
    marketplace,
    marketplaceName,
    externalId,
    sourceUrl,
    affiliateLink: `https://aff.example/${externalId}`,
    title: "Fone de Ouvido Sem Fio Xiaomi Redmi Buds 6 Play Bluetooth",
    image: "https://img.example/produto.jpeg",
    price,
    oldPrice: null,
    brand: "Xiaomi",
    attributes: {},
    status: "FOUND",
    error: null,
  };
}

async function run(searchCatalogFn: PublicSearchOptions["searchCatalogFn"]) {
  return searchCatalogOrDiscover(QUERY, 5, {
    adapters: adaptersSemResultado(),
    searchCatalogFn,
  });
}

async function runComDescobertaDuplicada() {
  return searchCatalogOrDiscover(QUERY, 5, {
    adapters: [
      {
        marketplace: "MERCADO_LIVRE",
        marketplaceName: "Mercado Livre",
        enabled: true,
        searcher: async (
          request: DiscoveryQuery,
        ): Promise<MarketplaceDiscoveryResult> => ({
          marketplace: "MERCADO_LIVRE",
          query: request.query,
          success: true,
          scanned: 1,
          candidates: [
            candidato("MERCADO_LIVRE", "Mercado Livre", "MLB90000001", 63),
          ],
          error: null,
        }),
      },
      {
        marketplace: "AMAZON",
        marketplaceName: "Amazon",
        enabled: true,
        searcher: async (
          request: DiscoveryQuery,
        ): Promise<MarketplaceDiscoveryResult> => ({
          marketplace: "AMAZON",
          query: request.query,
          success: true,
          scanned: 1,
          candidates: [candidato("AMAZON", "Amazon", "amz900001", 64)],
          error: null,
        }),
      },
    ],
    searchCatalogFn: async () => [produtoPublicavel("produto-catalogo")],
  });
}

async function main() {
  // 1. Catálogo público + V2 sem resultado: a busca ENTREGA o produto.
  const comCatalogo = await run(catalogoDe("cheio"));
  assert.equal(
    comCatalogo.source,
    "CATALOG",
    "catalogo visivel + V2 vazio => source CATALOG",
  );
  assert.equal(
    comCatalogo.products.length,
    1,
    "produto publico do catalogo aparece na busca",
  );
  assert.equal(comCatalogo.products[0]?.id, "produto-catalogo");
  assert.equal(
    comCatalogo.products[0]?.offers.length,
    2,
    "as DUAS ofertas validas do catalogo vem na busca",
  );

  // 2. Produto do catálogo SEM Multi Loja não é publicado pela busca.
  const soLoja = await run(catalogoDe("so-loja"));
  assert.equal(
    soLoja.products.length,
    0,
    "catalogo com uma loja so NAO entra na busca publica",
  );
  assert.equal(soLoja.source, "NOT_FOUND");

  // 3. Oferta ML de CATÁLOGO (`/p/`) não conta como loja.
  const mlCatalogo = await run(catalogoDe("ml-catalogo"));
  assert.equal(
    mlCatalogo.products.length,
    0,
    "oferta ML de catalogo (/p/) nao torna o produto publico",
  );
  assert.equal(mlCatalogo.source, "NOT_FOUND");

  // 4. Catálogo vazio e V2 vazio continua sendo "nenhum resultado".
  const vazio = await run(catalogoDe("vazio"));
  assert.equal(vazio.source, "NOT_FOUND");
  assert.equal(vazio.products.length, 0);

  // 5. Catálogo quebrado NÃO derruba a rota.
  const quebrado = await run(catalogoDe("erro"));
  assert.equal(quebrado.source, "NOT_FOUND");
  assert.equal(quebrado.products.length, 0);

  // 6. Mesmo id no catálogo e na descoberta => uma linha só, do catálogo.
  const duplicado = await runComDescobertaDuplicada();
  const ids = duplicado.products.map((produto) => produto.id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "id repetido entre catalogo e descoberta aparece uma vez",
  );
  assert.ok(
    ids.includes("produto-catalogo"),
    "produto do catalogo continua na lista mesmo com o V2 respondendo",
  );

  console.log("busca publica catalog-first: invariantes passaram");
}

void main();