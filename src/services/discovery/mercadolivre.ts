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
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
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


const TERMOS_ACESSORIOS_GERAIS = [
  "capa",
  "capinha",
  "case",
  "pelicula",
  "cabo",
  "carregador",
  "adaptador",
  "suporte",
  "protetor",
  "borracha",
  "anel de vedacao",
  "pino",
  "peso regulador",
  "regulador",
  "valvula",
  "gaxeta",
  "guarnicao",
  "peca de reposicao",
  "kit reparo",
  "flex antena",
];

function contemExpressao(
  textoNormalizado: string,
  expressao: string,
): boolean {
  const texto =
    ` ${textoNormalizado} `;

  const termo =
    ` ${normalizarTexto(expressao)} `;

  return texto.includes(
    termo,
  );
}

function possuiAcessorioNaoSolicitado(
  titulo: string,
  consulta: string,
): boolean {
  const tituloNormalizado =
    normalizarTexto(
      titulo,
    );

  const consultaNormalizada =
    normalizarTexto(
      consulta,
    );

  return TERMOS_ACESSORIOS_GERAIS.some(
    (termo) =>
      contemExpressao(
        tituloNormalizado,
        termo,
      ) &&
      !contemExpressao(
        consultaNormalizada,
        termo,
      ),
  );
}
const FAMILIAS_VARIANTE_ESTRITA = [
  "iphone",
  "galaxy",
  "redmi",
  "poco",
  "moto g",
  "moto e",
  "moto edge",
  "macbook",
  "ipad",
];

const QUALIFICADORES_MODELO = [
  "pro max",
  "pro",
  "max",
  "plus",
  "mini",
  "air",
  "ultra",
  "lite",
  "fe",
];

function extrairQualificadoresModelo(
  valor: string,
): Set<string> {
  const texto =
    ` ${normalizarTexto(valor)} `;

  const encontrados =
    new Set<string>();

  if (texto.includes(" pro max ")) {
    encontrados.add("pro max");
  } else {
    if (texto.includes(" pro ")) {
      encontrados.add("pro");
    }

    if (texto.includes(" max ")) {
      encontrados.add("max");
    }
  }

  for (const qualificador of QUALIFICADORES_MODELO) {
    if (
      qualificador === "pro max" ||
      qualificador === "pro" ||
      qualificador === "max"
    ) {
      continue;
    }

    if (texto.includes(` ${qualificador} `)) {
      encontrados.add(qualificador);
    }
  }

  return encontrados;
}

function conjuntosIguais(
  primeiro: Set<string>,
  segundo: Set<string>,
): boolean {
  if (primeiro.size !== segundo.size) {
    return false;
  }

  for (const valor of primeiro) {
    if (!segundo.has(valor)) {
      return false;
    }
  }

  return true;
}


function extrairNumerosDeModelo(
  valor: string,
): Set<string> {
  const tokens =
    normalizarTexto(valor)
      .split(" ");

  const encontrados =
    new Set<string>();

  for (
    let index = 0;
    index < tokens.length;
    index += 1
  ) {
    const token =
      tokens[index];

    if (
      !token ||
      !/^\d+$/.test(token)
    ) {
      continue;
    }

    const proximo =
      tokens[index + 1];

    /*
     * Números de capacidade não representam
     * o modelo do produto.
     */
    if (
      proximo === "gb" ||
      proximo === "tb"
    ) {
      continue;
    }

    encontrados.add(token);
  }

  return encontrados;
}

function modeloNumericoCompativel(
  titulo: string,
  consulta: string,
): boolean {
  const referencia =
    extrairNumerosDeModelo(
      consulta,
    );

  if (
    referencia.size === 0
  ) {
    return true;
  }

  const candidato =
    extrairNumerosDeModelo(
      titulo,
    );

  for (
    const numero of referencia
  ) {
    if (
      !candidato.has(numero)
    ) {
      return false;
    }
  }

  return true;
}
function varianteCompativel(
  titulo: string,
  consulta: string,
): boolean {
  const consultaNormalizada =
    normalizarTexto(consulta);

  const familiaEstrita =
    FAMILIAS_VARIANTE_ESTRITA.some(
      (familia) =>
        consultaNormalizada.includes(familia),
    );

  if (!familiaEstrita) {
    return true;
  }

  return conjuntosIguais(
    extrairQualificadoresModelo(consulta),
    extrairQualificadoresModelo(titulo),
  );
}

function extrairCapacidades(
  valor: string,
): Set<string> {
  const encontrados =
    new Set<string>();

  const normalizado =
    normalizarTexto(valor);

  const regex =
    /\b(\d+(?:[.,]\d+)?)\s*(gb|tb)\b/gi;

  for (const match of normalizado.matchAll(regex)) {
    const numero =
      match[1]?.replace(",", ".");

    const unidade =
      match[2]?.toLowerCase();

    if (numero && unidade) {
      encontrados.add(
        `${numero}${unidade}`,
      );
    }
  }

  return encontrados;
}

function obterMemoriaInterna(
  produto: CatalogProduct,
): string | null {
  const atributo =
    produto.attributes?.find(
      (item) =>
        item.id ===
        "INTERNAL_MEMORY",
    );

  return (
    atributo?.value_name?.trim() ||
    null
  );
}

function capacidadeCompativel(
  produto: CatalogProduct,
  titulo: string,
  consulta: string,
): boolean {
  const referencia =
    extrairCapacidades(
      consulta,
    );

  if (
    referencia.size === 0
  ) {
    return true;
  }

  /*
   * Prioridade: atributo oficial do catálogo.
   *
   * Isso evita confundir:
   * 256 GB de armazenamento
   * com
   * 8/12 GB de RAM escritos no título.
   */
  const memoriaInterna =
    obterMemoriaInterna(
      produto,
    );

  if (memoriaInterna) {
    const capacidadesMemoria =
      extrairCapacidades(
        memoriaInterna,
      );

    if (
      capacidadesMemoria.size === 0
    ) {
      return false;
    }

    return conjuntosIguais(
      referencia,
      capacidadesMemoria,
    );
  }

  /*
   * Fallback para produtos cujo catálogo
   * não informe INTERNAL_MEMORY.
   */
  const candidato =
    extrairCapacidades(
      titulo,
    );

  if (
    candidato.size === 0
  ) {
    return false;
  }

  for (
    const capacidade of referencia
  ) {
    if (
      !candidato.has(
        capacidade,
      )
    ) {
      return false;
    }
  }

  return true;
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
      "Falha ao descobrir domÃ­nio do Mercado Livre:",
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

    if (
      possuiAcessorioNaoSolicitado(
        titulo,
        query,
      )
    ) {
      return null;
    }

    if (
      !varianteCompativel(
        titulo,
        query,
      )
    ) {
      return null;
    }

    if (
      !modeloNumericoCompativel(
        titulo,
        query,
      )
    ) {
      return null;
    }

    if (
      !capacidadeCompativel(
        produto,
        titulo,
        query,
      )
    ) {
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
       * Alguns produtos ativos de catÃ¡logo nÃ£o possuem
       * publicaÃ§Ãµes disponÃ­veis naquele momento.
       *
       * Nesse caso o Mercado Livre pode responder
       * 404 "No winners found".
       *
       * Isso nÃ£o deve interromper a descoberta inteira.
       */
      console.warn(
        `Produto ${productId} sem ofertas disponÃ­veis:`,
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
         * O candidato representa o produto de catÃ¡logo.
         * A oferta escolhida fornece o menor preÃ§o vÃ¡lido.
         */
        externalId:
          productId,

        /*
         * NÃ£o dependemos de GET /items/{ITEM_ID},
         * pois anÃºncios de terceiros podem retornar 403
         * com o token atual.
         */
        sourceUrl:
          criarUrlCatalogo(
            productId,
            produto.permalink,
          ),

        /*
         * Link afiliado individual serÃ¡ resolvido
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
     * Primeiro descobrimos o domÃ­nio correto.
     *
     * Exemplo:
     * "iPhone 15" -> MLB-CELLPHONES
     *
     * Isso evita retornar capas e acessÃ³rios
     * quando o usuÃ¡rio procura pelo aparelho.
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
     * Pequenos lotes para nÃ£o bombardear
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



