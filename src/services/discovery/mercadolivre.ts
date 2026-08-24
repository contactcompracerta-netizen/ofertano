import { mercadoLivreFetch } from "@/lib/mercadolivre";

import type {
  DiscoveryCandidate,
  DiscoveryQuery,
  MarketplaceDiscoveryResult,
} from "./core/types";
import {
  candidatoPodeSeguirNoDiscovery,
  ehAcessorioNaoSolicitadoPelaConsulta,
  pontuarCoberturaLexicalPonderada,
} from "@/services/identity";
import type { MarketplaceFilterEvent } from "./marketplaceTrace";
import {
  rastrearFiltrosMarketplace,
  rastrearFonteMercadoLivre,
  rastrearResumoMercadoLivre,
} from "./marketplaceTrace";
import {
  buscarEstrategiaPublicaMercadoLivre,
  buscarPaginaPublicaMercadoLivre,
  classificarErroFonteMercadoLivre,
  type MercadoLivreListingItem,
  type MercadoLivreSourceFetch,
} from "./mercadolivrePublicSearch";
import {
  gerarVariantesDeConsultaPublica,
  hidratarItensComPaginaPublica,
  rastrearAquisicaoMercadoLivre,
  rastrearResumoAquisicaoMercadoLivre,
  buscarPaginaPublicaDoAnuncio,
} from "./mercadolivrePublicHydration";

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

type CatalogBuyBox = {
  item_id?: string;
  price?: number;
  original_price?: number | null;
  permalink?: string;
  seller_id?: number;
  status?: string;
  condition?: string;
  currency_id?: string;
  thumbnail?: string;
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

  buy_box_winner?: CatalogBuyBox | null;
};

type CatalogOffer = {
  item_id?: string;
  id?: string;

  seller_id?: number;

  price?: number;
  original_price?: number | null;

  category_id?: string;
  currency_id?: string;

  condition?: string;
  status?: string;

  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;

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

type SiteSearchItem = MercadoLivreListingItem;

type SiteSearchResponse = {
  results?: SiteSearchItem[];
};

type MultigetItemResponse = {
  code?: number;
  body?: SiteSearchItem & {
    message?: string;
  };
};

export type MercadoLivreAcquisitionSources = {
  discoverDomain: (query: string) => Promise<string | null>;
  searchCatalog: (
    query: string,
    limit: number,
    domainId: string | null,
  ) => Promise<MercadoLivreSourceFetch<ProductSearchResult[]>>;
  loadCatalogCandidate: (
    productId: string,
    query: string,
    mode?: DiscoveryQuery["mode"],
  ) => Promise<CandidateEvaluation>;
  searchItemsApi: (
    query: string,
    limit: number,
  ) => Promise<MercadoLivreSourceFetch<SiteSearchItem[]>>;
  searchPublicListings: (
    query: string,
    limit: number,
  ) => Promise<MercadoLivreSourceFetch<SiteSearchItem[]>>;
  searchPublicLista?: (
    query: string,
    limit: number,
  ) => Promise<MercadoLivreSourceFetch<SiteSearchItem[]>>;
  searchPublicJm?: (
    query: string,
    limit: number,
  ) => Promise<MercadoLivreSourceFetch<SiteSearchItem[]>>;
  hydratePublicItem?: (
    item: SiteSearchItem,
  ) => Promise<SiteSearchItem | null>;
};

type CandidateEvaluation = MarketplaceFilterEvent & {
  kept?: {
    candidate: DiscoveryCandidate;
    relevance: number;
  };
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

const TERMOS_ACESSORIOS_GERAIS = [
  "capa",
  "capinha",
  "case",
  "pelicula",
  "cabo",
  "carregador",
  "adaptador",
  "suporte",
  "base",
  "bases",
  "stand",
  "stands",
  "pedestal",
  "pedestais",
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
  if (ehAcessorioNaoSolicitadoPelaConsulta(consulta, titulo)) {
    return true;
  }

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
     * Números de capacidade ou quantidade (3 gavetas) não
     * representam o modelo do produto.
     */
    if (
      proximo === "gb" ||
      proximo === "tb" ||
      proximo === "gaveta" ||
      proximo === "gavetas" ||
      proximo === "peca" ||
      proximo === "pecas" ||
      proximo === "porta" ||
      proximo === "portas" ||
      proximo === "unidade" ||
      proximo === "unidades" ||
      proximo === "lugar" ||
      proximo === "lugares" ||
      proximo === "cor" ||
      proximo === "cores"
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

function normalizarCodigoItem(
  valor: string,
): string {
  return valor
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

function criarUrlPublicaItem(
  itemId: string,
): string | null {
  const codigo =
    normalizarCodigoItem(itemId);

  const match =
    codigo.match(/^MLB(\d+)$/);

  if (!match?.[1]) {
    return null;
  }

  return (
    `https://produto.mercadolivre.com.br/MLB-${match[1]}`
  );
}

function obterUrlOfertaIndividual(
  oferta: CatalogOffer,
): string | null {
  const itemId =
    oferta.item_id?.trim();

  if (!itemId) {
    return null;
  }

  const permalink =
    oferta.permalink?.trim();

  if (permalink) {
    try {
      const url = new URL(permalink);

      const host = url.hostname
        .toLowerCase()
        .replace(/^www\./, "");

      const hostMercadoLivre =
        host === "mercadolivre.com.br" ||
        host.endsWith(".mercadolivre.com.br") ||
        host === "mercadolibre.com" ||
        host.endsWith(".mercadolibre.com");

      if (hostMercadoLivre) {
        /*
         * /p/ é catálogo genérico e não representa
         * a publicação individual escolhida.
         */
        if (!/^\/p\//i.test(url.pathname)) {
          const codigoItem =
            normalizarCodigoItem(itemId);

          const codigoUrl =
            normalizarCodigoItem(
              `${url.pathname}${url.search}`,
            );

          if (
            codigoItem &&
            codigoUrl.includes(codigoItem)
          ) {
            return url.toString();
          }
        }
      }
    } catch {
      // Continua para o fallback seguro pelo ITEM_ID.
    }
  }

  /*
   * O endpoint /products/{CATALOG_ID}/items pode devolver
   * um ITEM_ID real sem permalink. Nesses casos usamos
   * a rota pública individual derivada do próprio ITEM_ID.
   *
   * Nunca usamos a URL /p/ do catálogo como oferta.
   */
  return criarUrlPublicaItem(
    itemId,
  );
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

        /*
         * A oferta precisa ter ITEM_ID e produzir uma URL
         * individual. Se o Mercado Livre omitir permalink,
         * usamos a rota pública derivada do ITEM_ID.
         */
        if (!obterUrlOfertaIndividual(oferta)) {
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
          oferta.status === "inactive" ||
          oferta.status === "closed"
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

function ofertaDoBuyBoxDoCatalogo(
  produto: CatalogProduct,
): CatalogOffer | null {
  const winner = produto.buy_box_winner;
  const itemId = winner?.item_id?.trim();

  if (!winner || !itemId) {
    return null;
  }

  return {
    item_id: itemId,
    id: itemId,
    seller_id: winner.seller_id,
    price: winner.price,
    original_price: winner.original_price ?? null,
    currency_id: winner.currency_id,
    condition: winner.condition ?? "new",
    status: winner.status ?? "active",
    permalink: winner.permalink,
    thumbnail: winner.thumbnail,
  };
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

function recusarCandidato(
  title: string,
  externalId: string,
  stage: string,
  reason: string,
  lexicalScore: number,
): CandidateEvaluation {
  return {
    title,
    externalId,
    stage,
    status: "DROPPED",
    reason,
    lexicalScore,
  };
}

function avaliarTituloParaDiscovery(
  query: string,
  titulo: string,
  externalId: string,
): CandidateEvaluation | null {
  const lexical =
    pontuarCoberturaLexicalPonderada(
      query,
      titulo,
    );
  const portao =
    candidatoPodeSeguirNoDiscovery(
      query,
      titulo,
    );

  if (!portao.keep) {
    return recusarCandidato(
      titulo,
      externalId,
      "lexical",
      portao.reason,
      lexical.score,
    );
  }

  if (
    possuiAcessorioNaoSolicitado(
      titulo,
      query,
    )
  ) {
    return recusarCandidato(
      titulo,
      externalId,
      "accessory",
      "Acessorio nao solicitado pela consulta.",
      lexical.score,
    );
  }

  if (
    !varianteCompativel(
      titulo,
      query,
    )
  ) {
    return recusarCandidato(
      titulo,
      externalId,
      "variant",
      "Qualificador de familia incompativel com a consulta.",
      lexical.score,
    );
  }

  if (
    !modeloNumericoCompativel(
      titulo,
      query,
    )
  ) {
    return recusarCandidato(
      titulo,
      externalId,
      "model-number",
      "Numero de modelo da consulta ausente no titulo.",
      lexical.score,
    );
  }

  return null;
}

async function pesquisarCatalogo(
  query: string,
  searchLimit: number,
  domainId: string | null,
): Promise<MercadoLivreSourceFetch<ProductSearchResult[]>> {
  try {
    const parametros =
      new URLSearchParams({
        status: "active",
        site_id: "MLB",
        limit: String(searchLimit),
        q: query,
      });

    if (domainId) {
      parametros.set("domain_id", domainId);
    }

    const pesquisa =
      (await mercadoLivreFetch(
        `/products/search?${parametros.toString()}`,
      )) as ProductSearchResponse;

    const data = (pesquisa.results ?? []).filter(
      (produto) =>
        typeof produto.id === "string" &&
        Boolean(produto.id.trim()) &&
        produto.status !== "inactive",
    );

    return {
      status: data.length > 0 ? "SUCCESS" : "EMPTY",
      httpStatus: 200,
      data,
      reason:
        data.length > 0
          ? undefined
          : "Catalogo sem produtos para a consulta.",
    };
  } catch (error) {
    return {
      ...classificarErroFonteMercadoLivre(error),
      data: [],
    };
  }
}

async function pesquisarItens(
  query: string,
  searchLimit: number,
): Promise<MercadoLivreSourceFetch<SiteSearchItem[]>> {
  try {
    const parametros =
      new URLSearchParams({
        q: query,
        limit: String(Math.min(searchLimit, 50)),
      });

    const pesquisa =
      (await mercadoLivreFetch(
        `/sites/MLB/search?${parametros.toString()}`,
      )) as SiteSearchResponse;

    const data = pesquisa.results ?? [];

    return {
      status: data.length > 0 ? "SUCCESS" : "EMPTY",
      httpStatus: 200,
      data,
      reason:
        data.length > 0
          ? undefined
          : "API de anuncios avulsos sem resultados.",
    };
  } catch (error) {
    return {
      ...classificarErroFonteMercadoLivre(error),
      data: [],
    };
  }
}

async function hidratarAnunciosAvulsos(
  items: SiteSearchItem[],
): Promise<SiteSearchItem[]> {
  const ids = Array.from(
    new Set(
      items
        .map((item) => item.id?.replace(/-/g, "").toUpperCase())
        .filter((id): id is string => Boolean(id && /^MLB\d+$/.test(id))),
    ),
  ).slice(0, 20);

  if (ids.length === 0) {
    return items;
  }

  const precisaHidratar = items.some(
    (item) => !item.title?.trim() || item.price == null || !item.permalink,
  );

  if (!precisaHidratar) {
    return items;
  }

  try {
    const resposta =
      (await mercadoLivreFetch(
        `/items?ids=${encodeURIComponent(ids.join(","))}`,
      )) as MultigetItemResponse[];

    if (!Array.isArray(resposta)) {
      return items;
    }

    const byId = new Map<string, SiteSearchItem>();

    for (const entrada of resposta) {
      const body = entrada.body;
      const id = body?.id?.replace(/-/g, "").toUpperCase();

      if (entrada.code !== 200 || !id) {
        continue;
      }

      byId.set(id, {
        ...body,
        id,
      });
    }

    return items.map((item) => {
      const id = item.id?.replace(/-/g, "").toUpperCase();
      const hydrated = id ? byId.get(id) : undefined;

      return hydrated
        ? { ...item, ...hydrated, id }
        : item;
    });
  } catch {
    return items;
  }
}

async function hidratarPaginaPublica(
  pagina: MercadoLivreSourceFetch<SiteSearchItem[]>,
): Promise<MercadoLivreSourceFetch<SiteSearchItem[]>> {
  if (pagina.status !== "SUCCESS" || pagina.data.length === 0) {
    return pagina;
  }

  const extractedCount = pagina.data.length;
  const hidratados = await hidratarAnunciosAvulsos(pagina.data);
  const withTitle = hidratados.filter(
    (item) => Boolean(item.id) && Boolean(item.title?.trim()),
  );

  /*
   * Nao zerar data quando o parser achou IDs. rawCount precisa
   * refletir a extracao; itens sem titulo caem no converter.
   */
  const data = withTitle.length > 0 ? withTitle : hidratados;

  return {
    ...pagina,
    data,
    reason:
      withTitle.length > 0
        ? pagina.reason
        : `Busca publica extraiu ${extractedCount} ID(s) mas nenhum anuncio hidratou titulo.`,
  };
}

async function pesquisarPaginaPublica(
  query: string,
): Promise<MercadoLivreSourceFetch<SiteSearchItem[]>> {
  return hidratarPaginaPublica(await buscarPaginaPublicaMercadoLivre(query));
}

async function pesquisarPaginaPublicaLista(
  query: string,
): Promise<MercadoLivreSourceFetch<SiteSearchItem[]>> {
  return hidratarPaginaPublica(
    await buscarEstrategiaPublicaMercadoLivre(query, "public-search-lista"),
  );
}

async function pesquisarPaginaPublicaJm(
  query: string,
): Promise<MercadoLivreSourceFetch<SiteSearchItem[]>> {
  return hidratarPaginaPublica(
    await buscarEstrategiaPublicaMercadoLivre(query, "public-search-jm"),
  );
}

function converterItemBusca(
  item: SiteSearchItem,
  query: string,
  mode?: DiscoveryQuery["mode"],
): CandidateEvaluation {
  const titulo = item.title?.trim() ?? "";
  const permalink = item.permalink?.trim() ?? "";
  const idFromPermalink = permalink.match(/MLB-?(\d{8,})/i)?.[1];
  const itemId =
    item.id?.trim() ||
    (idFromPermalink ? `MLB${idFromPermalink}` : "");
  const sourceUrl =
    permalink ||
    (itemId ? `https://www.mercadolivre.com.br/item/${itemId}` : "");
  const externalId = itemId || sourceUrl;
  const lexical =
    pontuarCoberturaLexicalPonderada(query, titulo);

  if (!titulo || !externalId) {
    return recusarCandidato(
      titulo || "(sem titulo)",
      itemId || "(sem id)",
      "normalize",
      "Item sem titulo e sem id/url.",
      lexical.score,
    );
  }

  if (mode !== "MULTILOJA") {
    const recusaTitulo =
      avaliarTituloParaDiscovery(query, titulo, externalId);

    if (recusaTitulo) {
      return recusaTitulo;
    }
  }

  /*
   * Anuncios internacionais/CBT entram se forem compraveis.
   * Nao filtramos tags, logistic_type, catalogo vs item ou seller.
   */
  if (
    typeof item.price !== "number" ||
    !Number.isFinite(item.price) ||
    item.price <= 0
  ) {
    return recusarCandidato(
      titulo,
      externalId,
      "price",
      "Item sem preco compravel.",
      lexical.score,
    );
  }

  if (item.currency_id && item.currency_id !== "BRL") {
    return recusarCandidato(
      titulo,
      externalId,
      "currency",
      `Moeda ${item.currency_id} fora do marketplace MLB.`,
      lexical.score,
    );
  }

  if (item.condition && item.condition !== "new") {
    return recusarCandidato(
      titulo,
      externalId,
      "condition",
      `Condicao ${item.condition} nao e oferta nova compravel.`,
      lexical.score,
    );
  }

  const brand =
    item.attributes?.find((attribute) => attribute.id === "BRAND")
      ?.value_name?.trim() || null;

  const oldPrice =
    typeof item.original_price === "number" &&
    Number.isFinite(item.original_price) &&
    item.original_price > item.price
      ? item.original_price
      : null;

  return {
    title: titulo,
    externalId,
    stage: "candidate",
    status: "KEPT",
    reason: "Item compravel preservado pelo Discovery.",
    lexicalScore: lexical.score,
    kept: {
      relevance: lexical.score,
      candidate: {
        marketplace: "MERCADO_LIVRE",
        marketplaceName: "Mercado Livre",
        externalId,
        sourceUrl,
        affiliateLink: null,
        title: titulo,
        image: item.thumbnail?.trim() || null,
        price: item.price,
        oldPrice,
        category: item.category_id ?? null,
        brand,
        seller:
          typeof item.seller?.id === "number"
            ? String(item.seller.id)
            : item.seller?.nickname ?? null,
        status: "FOUND",
        error: null,
      },
    },
  };
}

async function carregarCandidato(
  productId: string,
  query: string,
  mode?: DiscoveryQuery["mode"],
): Promise<CandidateEvaluation> {
  try {
    const produto =
      (await mercadoLivreFetch(
        `/products/${productId}`,
      )) as CatalogProduct;

    if (
      produto.status &&
      produto.status !== "active"
    ) {
      return recusarCandidato(
        produto.name?.trim() || productId,
        productId,
        "catalog-status",
        `Produto de catalogo ${produto.status}.`,
        0,
      );
    }

    const titulo =
      produto.name?.trim() ||
      produto.family_name?.trim();

    if (!titulo) {
      return recusarCandidato(
        productId,
        productId,
        "normalize",
        "Produto de catalogo sem titulo.",
        0,
      );
    }

    const lexical =
      pontuarCoberturaLexicalPonderada(query, titulo);

    if (mode !== "MULTILOJA") {
      const recusaTitulo =
        avaliarTituloParaDiscovery(query, titulo, productId);

      if (recusaTitulo) {
        return recusaTitulo;
      }

      if (
        !capacidadeCompativel(
          produto,
          titulo,
          query,
        )
      ) {
        return recusarCandidato(
          titulo,
          productId,
          "capacity",
          "Capacidade da consulta incompativel com o anuncio.",
          lexical.score,
        );
      }
    }

    let oferta =
      escolherOferta(
        [
          ofertaDoBuyBoxDoCatalogo(
            produto,
          ),
        ].filter(
          (item): item is CatalogOffer =>
            Boolean(item),
        ),
      );

    /*
     * Sem buy_box_winner, tentamos /items. 404
     * "No winners found" nao pode derrubar o
     * Discovery inteiro.
     */
    if (!oferta) {
      try {
        const ofertas =
          (await mercadoLivreFetch(
            `/products/${productId}/items`,
          )) as CatalogItemsResponse;

        oferta = escolherOferta(
          ofertas.results ?? [],
        );
      } catch (error) {
        console.warn(
          `Produto ${productId} sem ofertas disponíveis:`,
          error instanceof Error
            ? error.message
            : error,
        );

        return recusarCandidato(
          titulo,
          productId,
          "offers-fetch",
          "Catalogo sem publicacao compravel no momento.",
          lexical.score,
        );
      }
    }

    if (!oferta) {
      return recusarCandidato(
        titulo,
        productId,
        "offer-select",
        "Nenhuma oferta compravel (preco, URL, status, moeda ou condicao).",
        lexical.score,
      );
    }

    const itemId =
      oferta.item_id?.trim();

    const sourceUrl =
      obterUrlOfertaIndividual(
        oferta,
      );

    if (!itemId || !sourceUrl) {
      return recusarCandidato(
        titulo,
        productId,
        "url",
        "Oferta sem item_id ou URL individual.",
        lexical.score,
      );
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
      title: titulo,
      externalId: itemId,
      stage: "candidate",
      status: "KEPT",
      reason: "Oferta de catalogo compravel preservada pelo Discovery.",
      lexicalScore: lexical.score,
      kept: {
        relevance: lexical.score,
        candidate: {
          marketplace:
            "MERCADO_LIVRE",
          marketplaceName:
            "Mercado Livre",
          externalId:
            itemId,
          sourceUrl,
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
      },
    };
  } catch (error) {
    console.error(
      `Falha ao analisar produto ${productId}:`,
      error,
    );

    return recusarCandidato(
      productId,
      productId,
      "error",
      error instanceof Error
        ? error.message.slice(0, 180)
        : "Falha ao carregar produto de catalogo.",
      0,
    );
  }
}

function fontesPadraoMercadoLivre(): MercadoLivreAcquisitionSources {
  return {
    discoverDomain: descobrirDominio,
    searchCatalog: pesquisarCatalogo,
    loadCatalogCandidate: carregarCandidato,
    searchItemsApi: pesquisarItens,
    searchPublicListings: pesquisarPaginaPublica,
    searchPublicLista: pesquisarPaginaPublicaLista,
    searchPublicJm: pesquisarPaginaPublicaJm,
    hydratePublicItem: async (item) =>
      (await buscarPaginaPublicaDoAnuncio(item)).data,
  };
}

function registrarFonte(
  query: string,
  source: string,
  fetch: MercadoLivreSourceFetch<unknown[]>,
  usableCount: number,
  sourcesTried: string[],
  blockedSources: string[],
  unusableSources: string[],
  rawTotal: { value: number },
): void {
  sourcesTried.push(source);
  rawTotal.value += fetch.data.length;

  if (fetch.status === "BLOCKED" && !blockedSources.includes(source)) {
    blockedSources.push(source);
  }

  if (fetch.status === "UNUSABLE" && !unusableSources.includes(source)) {
    unusableSources.push(source);
  }

  rastrearFonteMercadoLivre({
    source,
    query,
    status: fetch.status,
    httpStatus: fetch.httpStatus,
    rawCount: fetch.data.length,
    usableCount,
    reason: fetch.reason,
  });
}

export async function buscarMercadoLivreComFontes(
  request: DiscoveryQuery,
  sources: MercadoLivreAcquisitionSources,
): Promise<MarketplaceDiscoveryResult> {
  const query = request.query.trim();
  const limit = limitarQuantidade(request.limit);

  if (!query) {
    return {
      marketplace: "MERCADO_LIVRE",
      query,
      success: false,
      candidates: [],
      scanned: 0,
      error: "Consulta vazia.",
    };
  }

  const sourcesTried: string[] = [];
  const blockedSources: string[] = [];
  const unusableSources: string[] = [];
  const rawTotal = { value: 0 };
  const evaluations: CandidateEvaluation[] = [];
  let scanned = 0;

  try {
    const searchLimit = Math.min(Math.max(limit * 6, 20), 50);
    const executarFonte = async <T,>(
      run: () => Promise<MercadoLivreSourceFetch<T[]>>,
    ): Promise<MercadoLivreSourceFetch<T[]>> => {
      try {
        return await run();
      } catch (error) {
        return {
          ...classificarErroFonteMercadoLivre(error),
          data: [],
        };
      }
    };

    let domainId: string | null = null;
    try {
      domainId = await sources.discoverDomain(query);
    } catch {
      domainId = null;
    }

    const catalogWithDomain = await executarFonte(() =>
      sources.searchCatalog(query, searchLimit, domainId),
    );
    let catalogResults = catalogWithDomain.data;
    registrarFonte(
      query,
      domainId ? "catalog" : "catalog-no-domain",
      catalogWithDomain,
      0,
      sourcesTried,
      blockedSources,
      unusableSources,
      rawTotal,
    );

    if (catalogResults.length === 0 && domainId) {
      const catalogNoDomain = await executarFonte(() =>
        sources.searchCatalog(query, searchLimit, null),
      );
      catalogResults = catalogNoDomain.data;
      registrarFonte(
        query,
        "catalog-no-domain",
        catalogNoDomain,
        0,
        sourcesTried,
        blockedSources,
        unusableSources,
        rawTotal,
      );
    }

    const catalogHydrationLimit = Math.min(
      Math.max(limit * 2, 8),
      16,
    );
    const productIds = Array.from(
      new Set(
        catalogResults
          .map((produto) => produto.id?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    ).slice(0, catalogHydrationLimit);

    for (let index = 0; index < productIds.length; index += 4) {
      const lote = productIds.slice(index, index + 4);
      scanned += lote.length;
      evaluations.push(
        ...(await Promise.all(
          lote.map(async (productId) => {
            try {
              return await sources.loadCatalogCandidate(
                productId,
                query,
                request.mode,
              );
            } catch (error) {
              return recusarCandidato(
                productId,
                productId,
                "error",
                error instanceof Error
                  ? error.message.slice(0, 180)
                  : "Falha ao carregar produto de catalogo.",
                0,
              );
            }
          }),
        )),
      );

      if (evaluations.filter((item) => item.status === "KEPT").length >= limit) {
        break;
      }
    }

    const usableFromCatalog = evaluations.filter((item) => item.kept).length;
    const catalogSourceName = sourcesTried.includes("catalog")
      ? "catalog"
      : "catalog-no-domain";
    rastrearFonteMercadoLivre({
      source: `${catalogSourceName}-usable`,
      query,
      status: usableFromCatalog > 0 ? "SUCCESS" : "EMPTY",
      httpStatus: 200,
      rawCount: productIds.length,
      usableCount: usableFromCatalog,
      reason:
        usableFromCatalog > 0
          ? undefined
          : "Catalogo sem publicacao compravel (No winners found ou oferta invalida).",
    });

    const catalogIds: string[] = [];

    const coletarItens = async (
      source:
        | "items-api"
        | "public-search"
        | "public-search-lista"
        | "public-search-jm",
      fetch: MercadoLivreSourceFetch<SiteSearchItem[]>,
    ) => {
      const before = evaluations.filter((item) => item.kept).length;
      let items = fetch.data ?? [];

      if (items.length > 0 && sources.hydratePublicItem) {
        const hydrated = await hidratarItensComPaginaPublica(
          items,
          sources.hydratePublicItem,
        );
        items = hydrated.items;
      }

      const seen = new Set(
        evaluations
          .map((item) => item.externalId.trim())
          .filter(Boolean),
      );

      for (const item of items) {
        const itemId = item.id?.trim() ?? "";
        if (itemId && seen.has(itemId)) {
          continue;
        }
        if (itemId) {
          seen.add(itemId);
        }
        scanned += 1;
        evaluations.push(converterItemBusca(item, query, request.mode));
      }

      const after = evaluations.filter((item) => item.kept).length;
      if (fetch.catalogIds?.length) {
        catalogIds.push(...fetch.catalogIds);
      }
      registrarFonte(
        query,
        source,
        { ...fetch, data: items },
        Math.max(0, after - before),
        sourcesTried,
        blockedSources,
        unusableSources,
        rawTotal,
      );
      rastrearAquisicaoMercadoLivre({
        query,
        source,
        requestedUrl: fetch.diagnostics?.requestedUrl ?? "",
        finalUrl: fetch.diagnostics?.finalUrl ?? "",
        httpStatus: fetch.httpStatus,
        contentType: fetch.diagnostics?.contentType ?? "",
        bodyLength: fetch.diagnostics?.bodyLength ?? items.length,
        pageTitle: fetch.diagnostics?.pageTitle ?? "",
        idsFound: items.filter((item) => item.id).length,
        cardsFound: items.length,
        jsonLdFound: fetch.diagnostics?.containsJsonLd ? 1 : 0,
        embeddedStateFound: fetch.diagnostics?.containsStructuredState ? 1 : 0,
        partialCandidates: items.filter((item) => Boolean(item.id || item.permalink)).length,
        usableCandidates: Math.max(0, after - before),
        status: fetch.status,
        reason: fetch.reason ?? "",
      });
    };

    await coletarItens(
      "items-api",
      await executarFonte(() => sources.searchItemsApi(query, searchLimit)),
    );

    if (sources.searchPublicLista || sources.searchPublicJm) {
      if (sources.searchPublicLista) {
        await coletarItens(
          "public-search-lista",
          await executarFonte(() => sources.searchPublicLista!(query, searchLimit)),
        );
      }

      if (sources.searchPublicJm) {
        await coletarItens(
          "public-search-jm",
          await executarFonte(() => sources.searchPublicJm!(query, searchLimit)),
        );
      }
    } else {
      await coletarItens(
        "public-search",
        await executarFonte(() => sources.searchPublicListings(query, searchLimit)),
      );
    }

    if (evaluations.filter((item) => item.kept).length === 0) {
      const publicBlocked =
        blockedSources.includes("public-search") ||
        (blockedSources.includes("public-search-lista") &&
          blockedSources.includes("public-search-jm"));
      if (!publicBlocked) {
        const variants = gerarVariantesDeConsultaPublica(query).filter(
          (variant) => variant.toLowerCase() !== query.toLowerCase(),
        );
        for (const variant of variants.slice(0, 2)) {
          if (evaluations.filter((item) => item.kept).length > 0) {
            break;
          }
          if (sources.searchPublicLista) {
            await coletarItens(
              "public-search-lista",
              await executarFonte(() =>
                sources.searchPublicLista!(variant, searchLimit),
              ),
            );
          } else {
            await coletarItens(
              "public-search",
              await executarFonte(() =>
                sources.searchPublicListings(variant, searchLimit),
              ),
            );
          }
        }
      }
    }

    const seenCatalog = new Set(
      evaluations.map((item) => item.externalId.trim()).filter(Boolean),
    );
    for (const catalogId of Array.from(new Set(catalogIds))) {
      if (seenCatalog.has(catalogId)) {
        continue;
      }
      seenCatalog.add(catalogId);
      scanned += 1;
        try {
          evaluations.push(
            await sources.loadCatalogCandidate(catalogId, query, request.mode),
          );
        } catch (error) {
          evaluations.push(
            recusarCandidato(
              catalogId,
              catalogId,
              "error",
              error instanceof Error
                ? error.message.slice(0, 180)
                : "Falha ao carregar produto de catalogo.",
              0,
            ),
          );
        }
    }

    rastrearFiltrosMarketplace({
      marketplace: "MERCADO_LIVRE",
      query,
      events: evaluations,
    });

    const kept = evaluations.filter((item) => item.kept);
    const candidatos = kept
      .sort((first, second) => {
        const firstRelevance = first.kept?.relevance ?? 0;
        const secondRelevance = second.kept?.relevance ?? 0;

        if (secondRelevance !== firstRelevance) {
          return secondRelevance - firstRelevance;
        }

        return (
          (first.kept?.candidate.price ?? Number.POSITIVE_INFINITY) -
          (second.kept?.candidate.price ?? Number.POSITIVE_INFINITY)
        );
      })
      .slice(0, limit)
      .map((item) => item.kept!.candidate);

    rastrearResumoMercadoLivre({
      query,
      sourcesTried,
      blockedSources,
      rawTotal: rawTotal.value,
      normalized: evaluations.length,
      accepted: candidatos.length,
    });

    const partialCandidates = evaluations.filter(
      (item) => item.externalId && item.externalId !== "(sem id)",
    ).length;
    const listingSources = sourcesTried.filter(
      (source) =>
        source === "items-api" || source.startsWith("public-search"),
    );
    const listingCompleted = listingSources.filter(
      (source) =>
        !blockedSources.includes(source) &&
        !unusableSources.includes(source),
    );
    const searchOutcome =
      candidatos.length > 0
        ? "SEARCH_COMPLETED"
        : listingSources.length > 0 && listingCompleted.length === 0
          ? "BLOCKED"
          : "EMPTY_VALID";

    rastrearResumoAquisicaoMercadoLivre({
      query,
      sourcesTried,
      blockedSources,
      partialCandidates,
      usableCandidates: candidatos.length,
      result: searchOutcome,
    });

    return {
      marketplace: "MERCADO_LIVRE",
      query,
      success: true,
      candidates: candidatos,
      scanned,
      error: null,
      degraded: blockedSources.length > 0,
      blockedSources,
      unusableSources,
      sourcesTried,
      searchOutcome,
    };
  } catch (error) {
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido.";

    rastrearResumoMercadoLivre({
      query,
      sourcesTried,
      blockedSources,
      rawTotal: rawTotal.value,
      normalized: evaluations.length,
      accepted: 0,
    });

    return {
      marketplace: "MERCADO_LIVRE",
      query,
      success: false,
      candidates: [],
      scanned,
      error: mensagem.slice(0, 1000),
      degraded: blockedSources.length > 0,
      blockedSources,
      unusableSources,
      sourcesTried,
      searchOutcome: "ERROR",
    };
  }
}

export async function buscarMercadoLivre(
  request: DiscoveryQuery,
): Promise<MarketplaceDiscoveryResult> {
  return buscarMercadoLivreComFontes(
    request,
    fontesPadraoMercadoLivre(),
  );
}
