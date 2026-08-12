import { mercadoLivreFetch } from "@/lib/mercadolivre";

import type {
  DiscoveryCandidate,
  DiscoveryQuery,
  MarketplaceDiscoveryResult,
} from "./core/types";

type DomainDiscoveryResult = {
  domain_id?: string;
  domain_name?: string;
  category_id?: string;
  category_name?: string;

  attributes?: Array<{
    id?: string;
    name?: string;
    value_id?: string;
    value_name?: string;
  }>;
};

type ProductSearchResult = {
  id?: string;
  name?: string;
  status?: string;
  domain_id?: string;
};

type ProductSearchResponse = {
  keywords?: string;
  domain_id?: string;

  paging?: {
    total?: number;
    offset?: number;
    limit?: number;
  };

  results?: ProductSearchResult[];
};

type CatalogPicture = {
  id?: string;
  url?: string;
  secure_url?: string;
};

type CatalogAttribute = {
  id?: string;
  name?: string;
  value_name?: string;
};

type CatalogProduct = {
  id?: string;

  name?: string;
  family_name?: string;

  status?: string;
  domain_id?: string;

  permalink?: string;

  pictures?: CatalogPicture[];

  attributes?: CatalogAttribute[];
};

type CatalogOffer = {
  item_id?: string;

  seller_id?: number;

  price?: number;
  original_price?: number | null;

  category_id?: string;
  currency_id?: string;

  condition?: string;

  listing_type_id?: string;

  official_store_id?: number | null;

  tags?: string[];

  shipping?: {
    free_shipping?: boolean;
    local_pick_up?: boolean;
    store_pick_up?: boolean;
    mode?: string;
    logistic_type?: string;
  };
};

type CatalogItemsResponse = {
  paging?: {
    total?: number;
    offset?: number;
    limit?: number;
  };

  results?: CatalogOffer[];
};

function limitarQuantidade(
  valor: number,
): number {
  if (!Number.isFinite(valor)) {
    return 5;
  }

  return Math.min(
    Math.max(
      Math.trunc(valor),
      1,
    ),
    20,
  );
}

function normalizarTexto(
  valor: string,
): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function calcularRelevancia(
  titulo: string,
  consulta: string,
): number {
  const tituloNormalizado =
    normalizarTexto(titulo);

  const termos =
    normalizarTexto(consulta)
      .split(" ")
      .filter(
        (termo) =>
          termo.length >= 2,
      );

  if (termos.length === 0) {
    return 0;
  }

  const encontrados =
    termos.filter(
      (termo) =>
        tituloNormalizado.includes(
          termo,
        ),
    ).length;

  return (
    encontrados /
    termos.length
  );
}

function obterMarca(
  produto: CatalogProduct,
): string | null {
  const atributo =
    produto.attributes?.find(
      (item) =>
        item.id === "BRAND",
    );

  return (
    atributo?.value_name?.trim() ||
    null
  );
}

function obterImagem(
  produto: CatalogProduct,
): string | null {
  const imagem =
    produto.pictures?.find(
      (item) =>
        item.secure_url ||
        item.url,
    );

  return (
    imagem?.secure_url ||
    imagem?.url ||
    null
  );
}

function criarUrlCatalogo(
  productId: string,
  permalink?: string,
): string {
  const url =
    permalink?.trim();

  if (url) {
    return url;
  }

  return `https://www.mercadolivre.com.br/p/${productId}`;
}

function escolherOferta(
  ofertas: CatalogOffer[],
): CatalogOffer | null {
  const validas =
    ofertas.filter(
      (oferta) => {
        if (
          typeof oferta.item_id !==
            "string" ||
          !oferta.item_id.trim()
        ) {
          return false;
        }

        if (
          typeof oferta.price !==
            "number" ||
          !Number.isFinite(
            oferta.price,
          ) ||
          oferta.price <= 0
        ) {
          return false;
        }

        if (
          oferta.currency_id &&
          oferta.currency_id !== "BRL"
        ) {
          return false;
        }

        if (
          oferta.condition &&
          oferta.condition !== "new"
        ) {
          return false;
        }

        return true;
      },
    );

  if (validas.length === 0) {
    return null;
  }

  return [...validas].sort(
    (a, b) =>
      (a.price ??
        Number.POSITIVE_INFINITY) -
      (b.price ??
        Number.POSITIVE_INFINITY),
  )[0];
}

async function descobrirDominio(
  query: string,
): Promise<string | null> {
  try {
    const resposta =
      (await mercadoLivreFetch(
        `/sites/MLB/domain_discovery/search?limit=1&q=${encodeURIComponent(
          query,
        )}`,
      )) as DomainDiscoveryResult[];

    return (
      resposta[0]
        ?.domain_id
        ?.trim() ||
      null
    );
  } catch (error) {
    console.error(
      "Falha ao descobrir domínio do Mercado Livre:",
      error,
    );

    return null;
  }
}

async function carregarCandidato(
  productId: string,
  query: string,
): Promise<
  | {
      candidate: DiscoveryCandidate;
      relevance: number;
    }
  | null
> {
  try {
    const produto =
      (await mercadoLivreFetch(
        `/products/${productId}`,
      )) as CatalogProduct;

    if (
      produto.status &&
      produto.status !== "active"
    ) {
      return null;
    }

    const titulo =
      produto.name?.trim() ||
      produto.family_name?.trim();

    if (!titulo) {
      return null;
    }

    const relevancia =
      calcularRelevancia(
        titulo,
        query,
      );

    if (relevancia < 0.5) {
      return null;
    }

    let ofertas:
      CatalogItemsResponse;

    try {
      ofertas =
        (await mercadoLivreFetch(
          `/products/${productId}/items`,
        )) as CatalogItemsResponse;
    } catch (error) {
      /*
       * Alguns produtos ativos de catálogo não possuem
       * publicações disponíveis naquele momento.
       *
       * Nesse caso o Mercado Livre pode responder
       * 404 "No winners found".
       *
       * Isso não deve interromper a descoberta inteira.
       */
      console.warn(
        `Produto ${productId} sem ofertas disponíveis:`,
        error instanceof Error
          ? error.message
          : error,
      );

      return null;
    }

    const oferta =
      escolherOferta(
        ofertas.results ?? [],
      );

    if (!oferta) {
      return null;
    }

    const preco =
      oferta.price!;

    const precoAntigo =
      typeof oferta.original_price ===
          "number" &&
        Number.isFinite(
          oferta.original_price,
        ) &&
        oferta.original_price >
          preco
        ? oferta.original_price
        : null;

    return {
      relevance: relevancia,

      candidate: {
        marketplace:
          "MERCADO_LIVRE",

        marketplaceName:
          "Mercado Livre",

        /*
         * O candidato representa o produto de catálogo.
         * A oferta escolhida fornece o menor preço válido.
         */
        externalId:
          productId,

        /*
         * Não dependemos de GET /items/{ITEM_ID},
         * pois anúncios de terceiros podem retornar 403
         * com o token atual.
         */
        sourceUrl:
          criarUrlCatalogo(
            productId,
            produto.permalink,
          ),

        /*
         * Link afiliado individual será resolvido
         * posteriormente pelo fluxo de afiliados.
         */
        affiliateLink:
          null,

        title:
          titulo,

        image:
          obterImagem(
            produto,
          ),

        price:
          preco,

        oldPrice:
          precoAntigo,

        category:
          oferta.category_id ??
          null,

        brand:
          obterMarca(
            produto,
          ),

        seller:
          typeof oferta.seller_id ===
            "number"
            ? String(
                oferta.seller_id,
              )
            : null,

        status:
          "FOUND",

        error:
          null,
      },
    };
  } catch (error) {
    console.error(
      `Falha ao analisar produto ${productId}:`,
      error,
    );

    return null;
  }
}

export async function buscarMercadoLivre(
  request: DiscoveryQuery,
): Promise<MarketplaceDiscoveryResult> {
  const query =
    request.query.trim();

  const limit =
    limitarQuantidade(
      request.limit,
    );

  if (!query) {
    return {
      marketplace:
        "MERCADO_LIVRE",

      query,

      success:
        false,

      candidates:
        [],

      scanned:
        0,

      error:
        "Consulta vazia.",
    };
  }

  try {
    /*
     * Primeiro descobrimos o domínio correto.
     *
     * Exemplo:
     * "iPhone 15" -> MLB-CELLPHONES
     *
     * Isso evita retornar capas e acessórios
     * quando o usuário procura pelo aparelho.
     */
    const domainId =
      await descobrirDominio(
        query,
      );

    const searchLimit =
      Math.min(
        Math.max(
          limit * 6,
          20,
        ),
        50,
      );

    const parametros =
      new URLSearchParams({
        status: "active",
        site_id: "MLB",
        limit:
          String(
            searchLimit,
          ),
        q: query,
      });

    if (domainId) {
      parametros.set(
        "domain_id",
        domainId,
      );
    }

    const pesquisa =
      (await mercadoLivreFetch(
        `/products/search?${parametros.toString()}`,
      )) as ProductSearchResponse;

    const productIds =
      Array.from(
        new Set(
          (
            pesquisa.results ??
            []
          )
            .filter(
              (produto) =>
                typeof produto.id ===
                  "string" &&
                Boolean(
                  produto.id.trim(),
                ) &&
                produto.status !==
                  "inactive",
            )
            .map(
              (produto) =>
                produto.id!.trim(),
            ),
        ),
      );

    if (
      productIds.length ===
      0
    ) {
      return {
        marketplace:
          "MERCADO_LIVRE",

        query,

        success:
          true,

        candidates:
          [],

        scanned:
          0,

        error:
          null,
      };
    }

    const encontrados: Array<{
      candidate: DiscoveryCandidate;
      relevance: number;
    }> = [];

    let scanned =
      0;

    /*
     * Pequenos lotes para não bombardear
     * a API do Mercado Livre.
     */
    for (
      let index = 0;
      index <
      productIds.length;
      index += 4
    ) {
      const lote =
        productIds.slice(
          index,
          index + 4,
        );

      scanned +=
        lote.length;

      const resultados =
        await Promise.all(
          lote.map(
            (productId) =>
              carregarCandidato(
                productId,
                query,
              ),
          ),
        );

      for (
        const resultado of
          resultados
      ) {
        if (resultado) {
          encontrados.push(
            resultado,
          );
        }
      }

      if (
        encontrados.length >=
        limit
      ) {
        break;
      }
    }

    const candidatos =
      encontrados
        .sort(
          (a, b) => {
            if (
              b.relevance !==
              a.relevance
            ) {
              return (
                b.relevance -
                a.relevance
              );
            }

            return (
              (a.candidate.price ??
                Number.POSITIVE_INFINITY) -
              (b.candidate.price ??
                Number.POSITIVE_INFINITY)
            );
          },
        )
        .slice(
          0,
          limit,
        )
        .map(
          (resultado) =>
            resultado.candidate,
        );

    return {
      marketplace:
        "MERCADO_LIVRE",

      query,

      success:
        true,

      candidates:
        candidatos,

      scanned,

      error:
        null,
    };
  } catch (error) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido.";

    return {
      marketplace:
        "MERCADO_LIVRE",

      query,

      success:
        false,

      candidates:
        [],

      scanned:
        0,

      error:
        mensagem.slice(
          0,
          1000,
        ),
    };
  }
}