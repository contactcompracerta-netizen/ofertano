import { mercadoLivreFetch } from "@/lib/mercadolivre";
import {
  activeSearchAbort,
  composeAbortSignal,
  isSearchAborted,
  remainingBudgetMs,
  withSearchAbort,
} from "@/lib/searchAbort";
import {
  buildQueryCore,
  type QueryCore,
} from "@/services/multistore-v2/queryCore";
import { buildSearchPlan } from "@/services/multistore-v2/queryPlan";
import {
  extractVoltage,
  extractModelTokens,
  normalizeMultistoreText,
  tokenize,
} from "@/services/multistore-v2/normalizeCandidate";
import {
  classifyProductConcept,
  compareProductConcepts,
  type ProductConceptId,
} from "@/services/multistore-v2/productConcepts";

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
import {
  extractMercadoLivreIdentitiesFromUrl,
  isUserProductId,
  normalizeListingId,
} from "./mercadolivreIds";
import {
  traceMlAcquisition,
  traceMlSourceEnd,
  traceMlSourceStart,
  type MlTraceTerminal,
} from "./mlAcquisitionTrace";
import {
  createMlStageBudgetClock,
  resolveMlTotalBudgetMs,
  runMlStage,
  type MlListingSource,
  type MlStageKind,
} from "./mlStageBudget";

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
    queryCore?: QueryCore,
    signal?: AbortSignal,
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

export type MlAcquisitionStagePlan = {
  listingStages: MlListingSource[];
  includesDomain: boolean;
  includesCatalogHydration: boolean;
  includesVariants: boolean;
  includesCatalogIds: boolean;
};

export function buildMlAcquisitionStagePlan(
  sources: Pick<
    MercadoLivreAcquisitionSources,
    "searchPublicLista" | "searchPublicJm" | "searchPublicListings"
  >,
): MlAcquisitionStagePlan {
  const listingStages: MlListingSource[] = ["items-api"];
  if (sources.searchPublicLista) {
    listingStages.push("public-search-lista");
  }
  if (sources.searchPublicJm) {
    listingStages.push("public-search-jm");
  }
  if (!sources.searchPublicLista && !sources.searchPublicJm) {
    listingStages.push("public-search");
  }

  return {
    listingStages,
    includesDomain: true,
    includesCatalogHydration: true,
    includesVariants: true,
    includesCatalogIds: true,
  };
}

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

    const first = resposta[0];
    const domainId = first?.domain_id?.trim();
    if (!domainId) {
      return null;
    }

    if (!domainDiscoveryMatchesQuery(first, query)) {
      return null;
    }

    return domainId;
  } catch (error) {
    console.error(
      "Falha ao descobrir domínio do Mercado Livre:",
      error,
    );

    return null;
  }
}

type ProductCentralEvidence = {
  hasCentralEvidence: boolean;
  reason: string;
  classMatch: boolean;
  brandMatch: boolean;
  modelMatch: boolean;
  anchorMatch: boolean;
};

function createCandidateConceptClassifier(): (
  candidateTitle: string,
) => ProductConceptId {
  const cache = new Map<string, ProductConceptId>();

  return (candidateTitle: string): ProductConceptId => {
    const normalizedTitle = normalizeMultistoreText(candidateTitle);
    const cached = cache.get(normalizedTitle);
    if (cached) {
      return cached;
    }

    const productClass = classifyProductConcept(normalizedTitle).id;
    cache.set(normalizedTitle, productClass);
    return productClass;
  };
}

function normalizedPhraseOccurs(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function createProductCentralEvidenceAssessor(
  queryCore: QueryCore,
  classifyCandidate: (candidateTitle: string) => ProductConceptId,
): (candidateTitle: string) => ProductCentralEvidence {
  const queryClass = queryCore.productClass;
  const queryBrand = queryCore.brand
    ? normalizeMultistoreText(queryCore.brand)
    : null;
  const queryModels = queryCore.modelTokens
    .map((token) => normalizeMultistoreText(token))
    .filter(Boolean);
  const queryAnchors = queryCore.identityAnchors
    .map((anchor) => normalizeMultistoreText(anchor.value))
    .filter(Boolean);
  const requiredAnchors = queryCore.identityAnchors
    .filter((anchor) => anchor.required)
    .map((anchor) => normalizeMultistoreText(anchor.value))
    .filter(Boolean);
  const cache = new Map<string, ProductCentralEvidence>();

  return (candidateTitle: string): ProductCentralEvidence => {
    const candidateText = normalizeMultistoreText(candidateTitle);
    const cached = cache.get(candidateText);
    if (cached) {
      return cached;
    }

    const candidateClass = classifyCandidate(candidateText);
    const classCompatibility =
      queryClass === "UNKNOWN"
        ? "UNKNOWN"
        : compareProductConcepts(queryClass, candidateClass);
    const classMatch =
      queryClass !== "UNKNOWN" &&
      classCompatibility === "MATCH";
    const brandMatch =
      queryBrand === null ||
      normalizedPhraseOccurs(candidateText, queryBrand);
    const candidateModelTokens = queryModels.length > 0
      ? new Set(
          extractModelTokens(tokenize(candidateText)).map((token) =>
            normalizeMultistoreText(token),
          ),
        )
      : null;
    const modelMatch =
      queryModels.length === 0 ||
      queryModels.some((token) =>
        candidateModelTokens?.has(token),
      );
    const compactCandidate = candidateText.replace(/\s+/g, "");
    const matchesAnchor = (anchor: string): boolean =>
      compactCandidate.includes(anchor.replace(/\s+/g, ""));
    const anchorMatch =
      queryAnchors.length === 0 ||
      queryAnchors.every(matchesAnchor);
    const result = (input: ProductCentralEvidence): ProductCentralEvidence => {
      cache.set(candidateText, input);
      return input;
    };

    if (queryClass !== "UNKNOWN" && classCompatibility === "CONFLICT") {
      return result({
        hasCentralEvidence: false,
        reason: "classe em conflito com a consulta",
        classMatch: false,
        brandMatch,
        modelMatch,
        anchorMatch,
      });
    }

    if (queryBrand && !brandMatch) {
      return result({
        hasCentralEvidence: false,
        reason: "marca da consulta ausente no candidato",
        classMatch,
        brandMatch: false,
        modelMatch,
        anchorMatch,
      });
    }

    if (queryModels.length > 0 && !modelMatch) {
      return result({
        hasCentralEvidence: false,
        reason: "modelo da consulta ausente no candidato",
        classMatch,
        brandMatch,
        modelMatch: false,
        anchorMatch,
      });
    }

    if (
      requiredAnchors.length > 0 &&
      !requiredAnchors.every(matchesAnchor)
    ) {
      return result({
        hasCentralEvidence: false,
        reason: "âncora obrigatória da consulta ausente no candidato",
        classMatch,
        brandMatch,
        modelMatch,
        anchorMatch: false,
      });
    }

    const hasMatchedIdentity =
      Boolean(queryBrand && brandMatch) ||
      (queryModels.length > 0 && modelMatch) ||
      (queryAnchors.length > 0 && anchorMatch);
    const hasCentralEvidence = classMatch || hasMatchedIdentity;

    return result({
      hasCentralEvidence,
      reason: hasCentralEvidence
        ? classMatch
          ? "classe compatível com a consulta"
          : "identidade forte da consulta foi confirmada"
        : "sem núcleo de produto nem identidade forte",
      classMatch,
      brandMatch,
      modelMatch,
      anchorMatch,
    });
  };
}

export function assessProductCentralEvidence(
  query: string,
  candidateTitle: string,
): ProductCentralEvidence {
  const queryCore = buildQueryCore(query);
  return createProductCentralEvidenceAssessor(
    queryCore,
    createCandidateConceptClassifier(),
  )(candidateTitle);
}

function domainDiscoveryMatchesQuery(
  domain: DomainDiscoveryResult,
  query: string,
): boolean {
  const core = buildQueryCore(query);
  const domainText = normalizeMultistoreText(
    [domain.domain_name, domain.category_name, domain.domain_id]
      .filter(Boolean)
      .join(" "),
  );

  const domainClass = classifyProductConcept(domainText).id;
  if (core.productClass !== "UNKNOWN") {
    if (domainClass === "UNKNOWN") {
      return false;
    }

    if (compareProductConcepts(core.productClass, domainClass) === "CONFLICT") {
      return false;
    }
  }

  return true;
}

function buildCatalogSearchQueries(query: string, queryCore: QueryCore): string[] {
  const plan = buildSearchPlan(query, queryCore);
  const productCore = plan.filter((variant) =>
    variantHasProductCoreForCatalog(variant, queryCore),
  );

  return Array.from(
    new Set([query, ...productCore, ...plan]),
  ).slice(0, 6);
}

function variantHasProductCoreForCatalog(
  variant: string,
  queryCore: QueryCore,
): boolean {
  const normalizedVariant = normalizeMultistoreText(variant);
  if (queryCore.productClass !== "UNKNOWN") {
    const variantClass = classifyProductConcept(normalizedVariant).id;
    if (variantClass === queryCore.productClass) {
      return true;
    }
  }

  if (queryCore.brand) {
    return normalizedVariant.includes(queryCore.brand);
  }

  return queryCore.identityAnchors.some((anchor) =>
    normalizedVariant.replace(/\s+/g, "").includes(anchor.value),
  );
}

function evaluationCompleteness(item: CandidateEvaluation): number {
  const candidate = item.kept?.candidate;
  if (!candidate) {
    return 0;
  }

  return (
    Number(Boolean(candidate.title.trim())) * 3 +
    Number(candidate.price != null && candidate.price > 0) * 3 +
    Number(Boolean(candidate.sourceUrl.trim())) * 2 +
    Number(Boolean(candidate.image?.trim()))
  );
}

function consolidateEvaluations(
  items: CandidateEvaluation[],
): CandidateEvaluation[] {
  const byId = new Map<string, CandidateEvaluation>();
  const leftovers: CandidateEvaluation[] = [];

  for (const item of items) {
    const listingId =
      normalizeListingId(item.kept?.candidate.externalId || item.externalId) ??
      "";
    if (!listingId || isUserProductId(listingId)) {
      leftovers.push(item);
      continue;
    }

    const current = byId.get(listingId);
    if (!current || evaluationCompleteness(item) > evaluationCompleteness(current)) {
      byId.set(listingId, {
        ...item,
        externalId: listingId,
      });
    }
  }

  return [...byId.values(), ...leftovers];
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
  const fromPermalink = extractMercadoLivreIdentitiesFromUrl(permalink);
  const rawId =
    item.id?.trim() ||
    fromPermalink.listingIds[0] ||
    "";
  const listingFromRaw = isUserProductId(rawId)
    ? fromPermalink.listingIds[0] ?? ""
    : normalizeListingId(rawId) ?? fromPermalink.listingIds[0] ?? "";
  const itemId = listingFromRaw;
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

  if (isUserProductId(rawId) && !itemId) {
    return recusarCandidato(
      titulo,
      rawId,
      "catalog-only",
      "Identidade MLBU sem listing MLB compravel.",
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
    const partialUsable =
      mode === "MULTILOJA" &&
      Boolean(titulo) &&
      Boolean(externalId) &&
      Boolean(sourceUrl);
    if (!partialUsable) {
      return recusarCandidato(
        titulo,
        externalId,
        "price",
        "Item sem preco compravel.",
        lexical.score,
      );
    }
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
    typeof item.price === "number" &&
    Number.isFinite(item.price) &&
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
        price: typeof item.price === "number" && item.price > 0 ? item.price : null,
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
  queryCore?: QueryCore,
  signal?: AbortSignal,
): Promise<CandidateEvaluation> {
  try {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const produto =
      (await mercadoLivreFetch(
        `/products/${productId}`,
        { signal },
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

    if (mode === "MULTILOJA") {
      const core = queryCore ?? buildQueryCore(query);
      if (core.attributes.voltage) {
        const titleVoltage = extractVoltage(titulo);
        if (titleVoltage && titleVoltage !== core.attributes.voltage) {
          return recusarCandidato(
            titulo,
            productId,
            "variant",
            "Voltagem incompativel com a consulta.",
            lexical.score,
          );
        }
      }

      if (!capacidadeCompativel(produto, titulo, query)) {
        return recusarCandidato(
          titulo,
          productId,
          "capacity",
          "Capacidade da consulta incompativel com o anuncio.",
          lexical.score,
        );
      }
    } else {
      const recusaTitulo =
        avaliarTituloParaDiscovery(query, titulo, productId);

      if (recusaTitulo) {
        return recusaTitulo;
      }

      if (!capacidadeCompativel(produto, titulo, query)) {
        return recusarCandidato(
          titulo,
          productId,
          "capacity",
          "Capacidade da consulta incompativel com o anuncio.",
          lexical.score,
        );
      }
    }

    const listingFromPermalink = extractMercadoLivreIdentitiesFromUrl(
      produto.permalink ?? "",
    );
    const listingIdFromCatalog =
      listingFromPermalink.listingIds.find((id) => !isUserProductId(id)) ??
      null;

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
      }
    }

    if (!oferta && listingIdFromCatalog && mode === "MULTILOJA") {
      const listingUrl = criarUrlPublicaItem(listingIdFromCatalog);
      if (listingUrl) {
        return {
          title: titulo,
          externalId: listingIdFromCatalog,
          stage: "candidate",
          status: "KEPT",
          reason: "Listing extraido do catalogo/user-product sem winner da API.",
          lexicalScore: lexical.score,
          kept: {
            relevance: lexical.score,
            candidate: {
              marketplace: "MERCADO_LIVRE",
              marketplaceName: "Mercado Livre",
              externalId: listingIdFromCatalog,
              sourceUrl: listingUrl,
              affiliateLink: null,
              title: titulo,
              image: obterImagem(produto),
              price: produto.buy_box_winner?.price ?? null,
              oldPrice: null,
              category: null,
              brand: obterMarca(produto),
              seller: null,
              status: "FOUND",
              error: null,
            },
          },
        };
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

    const itemIdRaw = oferta.item_id?.trim() ?? "";
    const itemId =
      normalizeListingId(itemIdRaw) ??
      listingIdFromCatalog ??
      "";

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

function mapFetchStatusToTerminal(
  status: MercadoLivreSourceFetch<unknown[]>["status"],
): MlTraceTerminal {
  switch (status) {
    case "SUCCESS":
      return "SUCCESS";
    case "EMPTY":
      return "EMPTY_VALID";
    case "BLOCKED":
      return "BLOCKED";
    case "UNUSABLE":
      return "ERROR";
    case "ERROR":
    default:
      return "ERROR";
  }
}

function mapFetchStatusToOutcome(
  status: MercadoLivreSourceFetch<unknown[]>["status"],
): "SUCCESS" | "EMPTY_VALID" | "BLOCKED" | "ERROR" | "UNUSABLE" {
  switch (status) {
    case "SUCCESS":
      return "SUCCESS";
    case "EMPTY":
      return "EMPTY_VALID";
    case "BLOCKED":
      return "BLOCKED";
    case "UNUSABLE":
      return "UNUSABLE";
    case "ERROR":
    default:
      return "ERROR";
  }
}

function inferMercadoLivreSearchOutcome(input: {
  candidatoCount: number;
  sourceOutcomes: Array<
    "SUCCESS" | "EMPTY_VALID" | "BLOCKED" | "ERROR" | "UNUSABLE"
  >;
  listingSourcesTried: string[];
}): MarketplaceDiscoveryResult["searchOutcome"] {
  if (input.candidatoCount > 0) {
    return "SEARCH_COMPLETED";
  }

  if (input.sourceOutcomes.some((item) => item === "BLOCKED")) {
    return "BLOCKED";
  }

  if (input.sourceOutcomes.some((item) => item === "UNUSABLE")) {
    return "UNUSABLE";
  }

  if (input.sourceOutcomes.some((item) => item === "ERROR")) {
    return "ERROR";
  }

  if (
    input.listingSourcesTried.length > 0 &&
    input.sourceOutcomes.some(
      (item) => item === "SUCCESS" || item === "EMPTY_VALID",
    )
  ) {
    return "EMPTY_VALID";
  }

  if (
    input.sourceOutcomes.length > 0 &&
    input.sourceOutcomes.every((item) => item === "EMPTY_VALID")
  ) {
    return "EMPTY_VALID";
  }

  return "ERROR";
}

function keptEvaluationCount(evaluations: CandidateEvaluation[]): number {
  return evaluations.filter((item) => item.kept).length;
}

function createCatalogProductScorer(
  query: string,
  core: QueryCore,
  classifyCandidate: (candidateTitle: string) => ProductConceptId,
): {
  score: (product: ProductSearchResult) => number;
  sort: (results: ProductSearchResult[]) => ProductSearchResult[];
} {
  const normalizedQuery = normalizeMultistoreText(query);
  const scores = new WeakMap<ProductSearchResult, number>();

  const score = (product: ProductSearchResult): number => {
    const cached = scores.get(product);
    if (cached !== undefined) {
      return cached;
    }

    const title = product.name ?? "";
    const lexical = pontuarCoberturaLexicalPonderada(query, title).score;
    const normalizedTitle = normalizeMultistoreText(title);
    let value = lexical;

    if (core.brand && normalizedTitle.includes(core.brand)) {
      value += 20;
    }

    for (const model of core.modelTokens) {
      if (model.length >= 2 && normalizedTitle.includes(model)) {
        value += 12;
      }
    }

    for (const anchor of core.identityNumbers) {
      if (anchor.length >= 2 && normalizedTitle.includes(anchor)) {
        value += 10;
      }
    }

    const compactTitle = normalizedTitle.replace(/\s+/g, "");
    for (const anchor of core.identityAnchors) {
      if (compactTitle.includes(anchor.value)) {
        value += 18;
      } else if (anchor.required) {
        value -= 35;
      }
    }

    for (const token of core.distinctiveContext) {
      if (normalizedTitle.includes(token)) {
        value += 6;
      }
    }

    if (
      /\bkit\b|\bcombo\b|\+/.test(normalizedTitle) &&
      !/\bkit\b|\bcombo\b|\+/.test(normalizedQuery)
    ) {
      value -= 40;
    }

    if (core.productClass !== "UNKNOWN") {
      const titleClass = classifyCandidate(title);
      if (titleClass === core.productClass) {
        value += 25;
      } else if (titleClass !== "UNKNOWN" && titleClass !== core.productClass) {
        value -= 40;
      }
    }

    const queryVoltage = core.attributes.voltage;
    if (queryVoltage) {
      const titleVoltage = extractVoltage(title);
      if (titleVoltage === queryVoltage) {
        value += 30;
      } else if (titleVoltage && titleVoltage !== queryVoltage) {
        value -= 100;
      }
    }

    for (const [attribute, attributeValue] of Object.entries(core.attributes)) {
      if (attribute === "voltage" || !attributeValue) {
        continue;
      }
      const compactValue = normalizeMultistoreText(attributeValue).replace(
        /\s+/g,
        "",
      );
      if (compactValue.length >= 2 && compactTitle.includes(compactValue)) {
        value += 8;
      }
    }

    scores.set(product, value);
    return value;
  };

  return {
    score,
    sort: (results) =>
      [...results].sort((first, second) => score(second) - score(first)),
  };
}

export async function buscarMercadoLivreComFontes(
  request: DiscoveryQuery,
  sources: MercadoLivreAcquisitionSources,
): Promise<MarketplaceDiscoveryResult> {
  const query = request.query.trim();
  const relevanceQuery = request.normalizedQuery?.trim() || query;
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

  const queryCore = buildQueryCore(relevanceQuery);
  const classifyCandidate = createCandidateConceptClassifier();
  const catalogScorer = createCatalogProductScorer(
    relevanceQuery,
    queryCore,
    classifyCandidate,
  );
  const assessCentralEvidence =
    createProductCentralEvidenceAssessor(queryCore, classifyCandidate);
  const queryHasCentralRequirements =
    queryCore.productClass !== "UNKNOWN" ||
    Boolean(queryCore.brand) ||
    queryCore.modelTokens.length > 0 ||
    queryCore.identityAnchors.length > 0;

  const sourcesTried: string[] = [];
  const blockedSources: string[] = [];
  const unusableSources: string[] = [];
  const rawTotal = { value: 0 };
  const evaluations: CandidateEvaluation[] = [];
  const catalogEvidence = new WeakMap<
    ProductSearchResult,
    ProductCentralEvidence
  >();
  const centralEvidenceForCatalog = (
    product: ProductSearchResult,
  ): ProductCentralEvidence => {
    const cached = catalogEvidence.get(product);
    if (cached) {
      return cached;
    }

    const evidence = assessCentralEvidence(product.name ?? "");
    catalogEvidence.set(product, evidence);
    return evidence;
  };
  const partitionCatalogResults = (
    products: ProductSearchResult[],
  ): {
    central: ProductSearchResult[];
    nonCentral: ProductSearchResult[];
  } => {
    const central: ProductSearchResult[] = [];
    const nonCentral: ProductSearchResult[] = [];
    for (const product of products) {
      if (centralEvidenceForCatalog(product).hasCentralEvidence) {
        central.push(product);
      } else {
        nonCentral.push(product);
      }
    }
    return { central, nonCentral };
  };
  const minimalEvidenceCache = new WeakMap<CandidateEvaluation, boolean>();
  const hasMinimalQueryEvidence = (
    evaluation: CandidateEvaluation,
  ): boolean => {
    const cached = minimalEvidenceCache.get(evaluation);
    if (cached !== undefined) {
      return cached;
    }

    if (!evaluation.kept) {
      minimalEvidenceCache.set(evaluation, false);
      return false;
    }

    const candidateTitle = (
      evaluation.title || evaluation.kept.candidate.title || ""
    ).trim();
    if (!candidateTitle) {
      minimalEvidenceCache.set(evaluation, false);
      return false;
    }

    const portao = candidatoPodeSeguirNoDiscovery(
      relevanceQuery,
      candidateTitle,
    );
    if (!portao.keep) {
      minimalEvidenceCache.set(evaluation, false);
      return false;
    }

    const centralEvidence = assessCentralEvidence(candidateTitle);
    let supported = centralEvidence.hasCentralEvidence;
    if (!supported && !queryHasCentralRequirements) {
      const lexical = pontuarCoberturaLexicalPonderada(
        relevanceQuery,
        candidateTitle,
      );
      supported = lexical.score >= 0.18 || lexical.queryCoverage >= 0.2;
    }

    minimalEvidenceCache.set(evaluation, supported);
    return supported;
  };
  let scanned = 0;
  const sourceOutcomes: Array<
    "SUCCESS" | "EMPTY_VALID" | "BLOCKED" | "ERROR" | "UNUSABLE"
  > = [];
  const listingSourcesTried: string[] = [];
  const parentAbort = activeSearchAbort();
  const contextualBudgetMs = remainingBudgetMs();
  const requestedBudgetMs = resolveMlTotalBudgetMs(request.signal);
  const effectiveBudgetMs = Number.isFinite(contextualBudgetMs)
    ? Math.min(requestedBudgetMs, contextualBudgetMs)
    : requestedBudgetMs;
  const budgetClock = createMlStageBudgetClock(effectiveBudgetMs);
  const acquisitionAbort = composeAbortSignal(
    budgetClock.totalMs,
    request.signal,
    parentAbort?.signal,
  );
  let closed = false;

  const shouldStop = () =>
    closed ||
    acquisitionAbort.signal.aborted ||
    Date.now() >= budgetClock.deadlineAt ||
    isSearchAborted() ||
    request.signal?.aborted === true;

  const closeAcquisition = () => {
    if (closed) {
      return;
    }
    closed = true;
    acquisitionAbort.abort();
    acquisitionAbort.cleanup();
  };

  const runInStageContext = <T,>(
    stageSignal: AbortSignal,
    stageBudgetMs: number,
    run: () => Promise<T>,
  ): Promise<T> =>
    withSearchAbort(
      {
        signal: stageSignal,
        fetchMs: Math.max(
          1,
          Math.min(parentAbort?.fetchMs ?? stageBudgetMs, stageBudgetMs),
        ),
        deadlineAt: Math.min(
          budgetClock.deadlineAt,
          Date.now() + Math.max(0, stageBudgetMs),
        ),
      },
      run,
    );
  const supportedEvaluationCount = (): number =>
    evaluations.filter(
      (item) => item.kept && hasMinimalQueryEvidence(item),
    ).length;
  const targetUsable =
    queryCore.brand || queryCore.hasStrongIdentity
      ? 1
      : Math.min(4, limit);
  const hasCoverageGoal = (): boolean =>
    supportedEvaluationCount() >= targetUsable;
  let resolveCoverageGoalReached: (() => void) | null = null;
  const coverageGoalReached = new Promise<void>((resolve) => {
    resolveCoverageGoalReached = resolve;
  });
  const resolveCoverageGoalIfReached = (): void => {
    if (hasCoverageGoal()) {
      resolveCoverageGoalReached?.();
    }
  };

  try {
    const searchLimit = Math.min(Math.max(limit * 6, 20), 50);
    const catalogIds: string[] = [];

    const coletarItens = async (
      source:
        | "items-api"
        | "public-search"
        | "public-search-lista"
        | "public-search-jm",
      fetch: MercadoLivreSourceFetch<SiteSearchItem[]>,
    ) => {
      if (shouldStop()) {
        return;
      }

      if (source === "items-api" || source.startsWith("public-search")) {
        listingSourcesTried.push(source);
      }

      sourceOutcomes.push(mapFetchStatusToOutcome(fetch.status));
      const before = keptEvaluationCount(evaluations);
      let items = fetch.data ?? [];

      if (items.length > 0 && sources.hydratePublicItem) {
        const incomplete = items.filter(
          (item) => !item.title?.trim() || item.price == null || !item.permalink,
        );
        if (incomplete.length > 0) {
          const hydrationBudget = budgetClock.stageBudgetMs("variant-public");
          const hydrated = await runMlStage(
            "variant-public",
            budgetClock,
            acquisitionAbort.signal,
            (stageSignal) =>
              runInStageContext(stageSignal, hydrationBudget, () =>
                hidratarItensComPaginaPublica(
                  incomplete,
                  sources.hydratePublicItem!,
                ),
              ),
          );
          if (hydrated.status === "result") {
            const byId = new Map(
              hydrated.value.items
                .filter((item) => item.id)
                .map((item) => [item.id!, item]),
            );
            items = items.map((item) =>
              item.id && byId.has(item.id)
                ? { ...item, ...byId.get(item.id)! }
                : item,
            );
          }
        }
      }

      if (closed) {
        return;
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

      const after = keptEvaluationCount(evaluations);
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

    const queryPlan = buildSearchPlan(relevanceQuery, queryCore);
    const stagePlan = buildMlAcquisitionStagePlan(sources);

    traceMlAcquisition("ENTRY", {
      query,
      relevanceQuery,
      limit,
      mode: request.mode,
      budgetMs: budgetClock.totalMs,
    });
    traceMlAcquisition("QUERY_PLAN", {
      query,
      plan: queryPlan,
      acquisitionStages: stagePlan.listingStages,
    });

    const executarFonteComOrcamento = async <T,>(
      stage: MlStageKind,
      run: () => Promise<MercadoLivreSourceFetch<T[]>>,
    ): Promise<MercadoLivreSourceFetch<T[]>> => {
      const stageStartedAt = Date.now();
      const stageBudget = budgetClock.stageBudgetMs(stage);
      traceMlSourceStart(stage, {
        query,
        budgetMs: stageBudget,
        remainingMs: budgetClock.remainingMs(),
      });
      let terminal: MlTraceTerminal = "ERROR";
      try {
        if (shouldStop()) {
          terminal = request.signal?.aborted ? "ABORTED" : "TIMEOUT";
          return {
            status: "ERROR",
            httpStatus: null,
            data: [],
            reason: "TIMEOUT: orcamento de busca esgotado.",
          };
        }

        const raced = await runMlStage(
          stage,
          budgetClock,
          acquisitionAbort.signal,
          (stageSignal) =>
            runInStageContext(stageSignal, stageBudget, async () => {
              try {
                return await run();
              } catch (error) {
                return {
                  ...classificarErroFonteMercadoLivre(error),
                  data: [],
                };
              }
            }),
        );

        if (raced.status === "aborted") {
          terminal = "ABORTED";
          return {
            status: "ERROR",
            httpStatus: null,
            data: [],
            reason: "ABORTED.",
          };
        }

        if (raced.status === "timeout") {
          terminal = "TIMEOUT";
          return {
            status: "ERROR",
            httpStatus: null,
            data: [],
            reason: "TIMEOUT: orcamento de busca esgotado.",
          };
        }

        terminal = mapFetchStatusToTerminal(raced.value.status);
        return raced.value;
      } finally {
        traceMlSourceEnd(stage, terminal, {
          query,
          elapsedMs: Date.now() - stageStartedAt,
          remainingMs: budgetClock.remainingMs(),
          candidates: keptEvaluationCount(evaluations),
        });
      }
    };

    const runListingSource = async (
      source: MlListingSource,
      run: () => Promise<MercadoLivreSourceFetch<SiteSearchItem[]>>,
    ): Promise<void> => {
      traceMlAcquisition("CANDIDATES", {
        query,
        source,
        phase: "before",
        count: keptEvaluationCount(evaluations),
      });
      const fetch = await executarFonteComOrcamento(source, run);
      await coletarItens(source, fetch);
      traceMlAcquisition("CANDIDATES", {
        query,
        source,
        phase: "after",
        count: keptEvaluationCount(evaluations),
      });
    };

    const resolveCatalogResults = async (): Promise<ProductSearchResult[]> => {
      const rankCatalogResults = (
        pass: "primary" | "fallback" | "final",
        results: ProductSearchResult[],
      ): ProductSearchResult[] => {
        const startedAt = Date.now();
        traceMlAcquisition("CATALOG_RANK_START", {
          query,
          pass,
          candidates: results.length,
          remainingMs: budgetClock.remainingMs(),
        });
        const ranked = catalogScorer.sort(results);
        traceMlAcquisition("CATALOG_RANK_END", {
          query,
          pass,
          candidates: results.length,
          durationMs: Date.now() - startedAt,
          remainingMs: budgetClock.remainingMs(),
        });
        return ranked;
      };

      const domainFetch = await executarFonteComOrcamento("domain", async () => {
        try {
          const domainId = await sources.discoverDomain(relevanceQuery);
          return {
            status: "SUCCESS" as const,
            httpStatus: 200,
            data: domainId ? [domainId] : [],
          };
        } catch (error) {
          return {
            ...classificarErroFonteMercadoLivre(error),
            data: [] as string[],
          };
        }
      });
      if (closed) {
        return [];
      }
      const domainId = domainFetch.data[0] ?? null;
      sourceOutcomes.push(mapFetchStatusToOutcome(domainFetch.status));

      const catalogQueries = buildCatalogSearchQueries(
        relevanceQuery,
        queryCore,
      );
      const catalogResults: ProductSearchResult[] = [];

      for (const catalogQuery of catalogQueries) {
        if (shouldStop()) {
          break;
        }

        const catalogWithDomain = await executarFonteComOrcamento("catalog", () =>
          sources.searchCatalog(catalogQuery, searchLimit, domainId),
        );
        if (closed) {
          break;
        }
        if (catalogResults.length === 0) {
          sourceOutcomes.push(mapFetchStatusToOutcome(catalogWithDomain.status));
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
        }

        catalogResults.push(...catalogWithDomain.data);

        let rankedCatalogResults = rankCatalogResults("primary", catalogResults);
        let partitionedCatalogResults = partitionCatalogResults(
          rankedCatalogResults,
        );
        const hasCentralCatalogResult =
          partitionedCatalogResults.central.length > 0;
        let usedDomainFallback = false;

        if (
          domainId &&
          catalogQuery === catalogQueries[0] &&
          !hasCentralCatalogResult
        ) {
          const catalogNoDomain = await executarFonteComOrcamento("catalog", () =>
            sources.searchCatalog(catalogQuery, searchLimit, null),
          );
          if (closed) {
            break;
          }
          sourceOutcomes.push(mapFetchStatusToOutcome(catalogNoDomain.status));
          catalogResults.push(...catalogNoDomain.data);
          usedDomainFallback = true;
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

        if (usedDomainFallback) {
          rankedCatalogResults = rankCatalogResults("fallback", catalogResults);
          partitionedCatalogResults = partitionCatalogResults(rankedCatalogResults);
        }
        const bestCentralProduct = partitionedCatalogResults.central[0];
        if (
          hasCoverageGoal() ||
          bestCentralProduct
        ) {
          break;
        }
      }

      const deduped = Array.from(
        new Map(
          catalogResults
            .filter((produto) => produto.id?.trim())
            .map((produto) => [produto.id!.trim(), produto]),
        ).values(),
      );

      return rankCatalogResults("final", deduped);
    };

    const hydrateCatalogIfNeeded = async (): Promise<void> => {
      if (shouldStop() || hasCoverageGoal()) {
        return;
      }

      const catalogResults = await resolveCatalogResults();
      if (shouldStop() || hasCoverageGoal()) {
        return;
      }

      const catalogHydrationLimit = Math.min(Math.max(limit, 6), 8);
      const selectedProducts = Array.from(
        new Map(
          catalogResults
            .filter((product) => Boolean(product.id?.trim()))
            .map((product) => [product.id!.trim(), product] as const),
        ).values(),
      );
      const partitionedProducts = partitionCatalogResults(selectedProducts);
      const prioritizedProducts = [
        ...partitionedProducts.central,
        ...partitionedProducts.nonCentral,
      ].slice(0, catalogHydrationLimit);
      const productIds = prioritizedProducts.map((product) => product.id!.trim());
      const beforeHydration = keptEvaluationCount(evaluations);
      const hydrationBudget = budgetClock.stageBudgetMs("catalog-hydration");

      type HydrationAttempt = {
        productId: string;
        title: string;
        rank: number;
        score: number;
        startedAt: number;
        finishedAt: number | null;
        terminal: "PENDING" | "KEPT" | "DROPPED" | "ERROR";
        evaluation: CandidateEvaluation | null;
      };
      let attempts: HydrationAttempt[] = [];

      traceMlAcquisition("HYDRATION_BATCH_START", {
        query,
        productIds: productIds.length,
        budgetMs: hydrationBudget,
        selected: prioritizedProducts.map((product, index) =>
          `${index + 1}:${product.id}:${catalogScorer.score(product)}:${
            product.name ?? "(sem titulo)"
          }`,
        ),
      });

      const hydrationRaced = await runMlStage(
        "catalog-hydration",
        budgetClock,
        acquisitionAbort.signal,
        async (stageSignal) => {
          const batchAbort = composeAbortSignal(null, stageSignal);
          let resolveBatchCoverageGoal: (() => void) | null = null;
          const batchCoverageGoalReached = new Promise<void>((resolve) => {
            resolveBatchCoverageGoal = resolve;
          });
          const hasBatchCoverageGoal = (): boolean =>
            supportedEvaluationCount() +
              attempts.filter(
                (attempt) =>
                  attempt.terminal === "KEPT" &&
                  attempt.evaluation &&
                  hasMinimalQueryEvidence(attempt.evaluation),
              ).length >=
            targetUsable;
          const registerSupportedEvaluation = (
            evaluation: CandidateEvaluation,
          ) => {
            if (!evaluation.kept) {
              return;
            }

            const hasUsableKept = hasMinimalQueryEvidence(evaluation);
            if (!hasUsableKept) {
              return;
            }

            if (hasBatchCoverageGoal()) {
              resolveBatchCoverageGoal?.();
              batchAbort.abort();
            }
          };

          attempts = prioritizedProducts.map((product, index) => ({
            productId: product.id!.trim(),
            title: product.name?.trim() || product.id!.trim(),
            rank: index + 1,
            score: catalogScorer.score(product),
            startedAt: Date.now(),
            finishedAt: null,
            terminal: "PENDING",
            evaluation: null,
          }));

          try {
            await runInStageContext(
              batchAbort.signal,
              hydrationBudget,
              async () => {
                const tasks = attempts.map(async (attempt) => {
                  try {
                    const evaluation = await sources.loadCatalogCandidate(
                      attempt.productId,
                      relevanceQuery,
                      request.mode,
                      queryCore,
                      batchAbort.signal,
                    );
                    if (batchAbort.signal.aborted) {
                      attempt.terminal = "DROPPED";
                      return;
                    }
                    attempt.evaluation = evaluation;
                    const hasUsableKept =
                      evaluation.kept &&
                      hasMinimalQueryEvidence(evaluation);
                    attempt.terminal = hasUsableKept ? "KEPT" : "DROPPED";
                    if (hasUsableKept) {
                      registerSupportedEvaluation(evaluation);
                    }
                  } catch (error) {
                    if (batchAbort.signal.aborted) {
                      attempt.terminal = "DROPPED";
                      return;
                    }
                    attempt.terminal = "ERROR";
                    attempt.evaluation = recusarCandidato(
                      attempt.title,
                      attempt.productId,
                      "error",
                      error instanceof Error
                        ? error.message.slice(0, 180)
                        : "Falha ao carregar produto de catalogo.",
                      0,
                    );
                  } finally {
                    attempt.finishedAt = Date.now();
                  }
                });

                const allSettled = Promise.allSettled(tasks).then(() => undefined);
                await Promise.race([allSettled, batchCoverageGoalReached]);
                if (hasBatchCoverageGoal()) {
                  batchAbort.abort();
                  return;
                }
                if (batchAbort.signal.aborted) {
                  return;
                }
              },
            );
          } finally {
            batchAbort.cleanup();
          }
        },
      );

      const completedAttempts = attempts.filter(
        (attempt) => attempt.evaluation !== null && attempt.terminal !== "PENDING",
      );
      if (!closed) {
        scanned += attempts.length;
        evaluations.push(
          ...completedAttempts.map((attempt) => attempt.evaluation!),
        );
        resolveCoverageGoalIfReached();
      }

      const stageTerminal =
        hydrationRaced.status === "timeout"
          ? "TIMEOUT"
          : hydrationRaced.status === "aborted"
            ? "ABORTED"
            : attempts.every((attempt) => attempt.terminal !== "PENDING")
              ? "SUCCESS"
              : "ABORTED";

      for (const attempt of attempts) {
        traceMlAcquisition("HYDRATION_ITEM", {
          query,
          productId: attempt.productId,
          title: attempt.title,
          rank: attempt.rank,
          score: attempt.score,
          terminal: attempt.terminal,
          elapsedMs:
            (attempt.finishedAt ?? Date.now()) - attempt.startedAt,
          reason: attempt.evaluation?.reason,
          externalId: attempt.evaluation?.externalId,
        });
      }

      traceMlAcquisition("HYDRATION_BATCH_END", {
        query,
        terminal: stageTerminal,
        before: beforeHydration,
        after: keptEvaluationCount(evaluations),
        attempted: attempts.length,
        completed: completedAttempts.length,
      });

      const usableFromCatalog = completedAttempts.filter(
        (attempt) =>
          attempt.evaluation && hasMinimalQueryEvidence(attempt.evaluation),
      ).length;
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
            : `Catalogo sem publicacao compravel: ${completedAttempts.length}/${attempts.length} hidratacoes concluiram.`,
      });
    };

    const finalizeDiscovery = (): MarketplaceDiscoveryResult => {
      closeAcquisition();
      const consolidated = consolidateEvaluations(evaluations);
      rastrearFiltrosMarketplace({
        marketplace: "MERCADO_LIVRE",
        query,
        events: consolidated,
      });

      const kept = consolidated.filter(hasMinimalQueryEvidence);
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
      const searchOutcome = inferMercadoLivreSearchOutcome({
        candidatoCount: candidatos.length,
        sourceOutcomes,
        listingSourcesTried,
      });

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
        success: searchOutcome !== "ERROR" && searchOutcome !== "BLOCKED",
        candidates: candidatos,
        scanned,
        error: null,
        degraded: blockedSources.length > 0,
        blockedSources,
        unusableSources,
        sourcesTried,
        searchOutcome,
      };
    };

    const runPrimaryListingLane = async (): Promise<void> => {
      if (
        stagePlan.listingStages.includes("items-api") &&
        !shouldStop() &&
        !hasCoverageGoal()
      ) {
        await runListingSource("items-api", () =>
          sources.searchItemsApi(query, searchLimit),
        );
      }
    };

    const runPublicListingFallbacks = async (): Promise<void> => {
      for (const source of stagePlan.listingStages) {
        if (source === "items-api") {
          continue;
        }
        if (shouldStop() || hasCoverageGoal()) {
          break;
        }

        if (source === "public-search-lista" && sources.searchPublicLista) {
          await runListingSource("public-search-lista", () =>
            sources.searchPublicLista!(query, searchLimit),
          );
          continue;
        }

        if (source === "public-search-jm" && sources.searchPublicJm) {
          await runListingSource("public-search-jm", () =>
            sources.searchPublicJm!(query, searchLimit),
          );
          continue;
        }

        if (source === "public-search") {
          await runListingSource("public-search", () =>
            sources.searchPublicListings(query, searchLimit),
          );
        }
      }
    };

    const waitForParallelLanes = async (): Promise<void> => {
      /*
       * items-api e catalogo continuam em paralelo. HTML publico e fallback:
       * ele so comeca se essas fontes primarias terminarem sem cobertura. Isso
       * evita que um parser HTML pesado atrase catalogo, hidratacao e timers.
       */
      const listingLane = runPrimaryListingLane();
      const catalogLane = hydrateCatalogIfNeeded();
      const primaryLanes = Promise.allSettled([listingLane, catalogLane]);

      void listingLane.catch(() => undefined);
      void catalogLane.catch(() => undefined);

      await Promise.race([primaryLanes, coverageGoalReached]);

      if (hasCoverageGoal()) {
        traceMlAcquisition("EXIT", {
          query,
          candidates: supportedEvaluationCount(),
          elapsedMs: budgetClock.elapsedMs(),
        });
        return;
      }

      // A Promise.race pode ter acordado antes de as lanes terminarem; sem
      // cobertura, aguardamos as duas para preservar o fallback publico.
      await primaryLanes;

      if (!shouldStop() && !hasCoverageGoal()) {
        await runPublicListingFallbacks();
      }
    };

    await waitForParallelLanes();

    if (hasCoverageGoal()) {
      return finalizeDiscovery();
    }

    if (shouldStop() && supportedEvaluationCount() > 0) {
      return finalizeDiscovery();
    }

    if (!hasCoverageGoal()) {
      const publicBlocked =
        blockedSources.includes("public-search") ||
        (blockedSources.includes("public-search-lista") &&
          blockedSources.includes("public-search-jm"));
      if (!publicBlocked && !shouldStop()) {
        const variants = gerarVariantesDeConsultaPublica(query).filter(
          (variant) => variant.toLowerCase() !== query.toLowerCase(),
        );
        for (const variant of variants.slice(0, 2)) {
          if (shouldStop()) {
            break;
          }
          if (hasCoverageGoal()) {
            break;
          }
          if (sources.searchPublicLista) {
            await coletarItens(
              "public-search-lista",
              await executarFonteComOrcamento("variant-public", () =>
                sources.searchPublicLista!(variant, searchLimit),
              ),
            );
          } else {
            await coletarItens(
              "public-search",
              await executarFonteComOrcamento("variant-public", () =>
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
      if (shouldStop()) {
        break;
      }
      if (hasCoverageGoal()) {
        break;
      }
      if (seenCatalog.has(catalogId)) {
        continue;
      }
      seenCatalog.add(catalogId);
      scanned += 1;
      const catalogIdRaced = await runMlStage(
        "catalog-ids",
        budgetClock,
        request.signal,
        async () => {
          try {
            return await sources.loadCatalogCandidate(
              catalogId,
              query,
              request.mode,
              queryCore,
            );
          } catch (error) {
            return recusarCandidato(
              catalogId,
              catalogId,
              "error",
              error instanceof Error
                ? error.message.slice(0, 180)
                : "Falha ao carregar produto de catalogo.",
              0,
            );
          }
        },
      );
      if (catalogIdRaced.status !== "result") {
        continue;
      }
      evaluations.push(catalogIdRaced.value);
      resolveCoverageGoalIfReached();
    }

    if (shouldStop() && supportedEvaluationCount() > 0) {
      traceMlAcquisition("EXIT", {
        query,
        candidates: supportedEvaluationCount(),
        elapsedMs: budgetClock.elapsedMs(),
      });
      return finalizeDiscovery();
    }

    traceMlAcquisition("EXIT", {
      query,
      candidates: supportedEvaluationCount(),
      elapsedMs: budgetClock.elapsedMs(),
    });
    return finalizeDiscovery();
  } catch (error) {
    closeAcquisition();
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido.";

    if (supportedEvaluationCount() > 0) {
      const consolidated = consolidateEvaluations(evaluations);
      const kept = consolidated.filter(hasMinimalQueryEvidence);
      const candidatos = kept
        .slice(0, limit)
        .map((item) => item.kept!.candidate);
      const searchOutcome = inferMercadoLivreSearchOutcome({
        candidatoCount: candidatos.length,
        sourceOutcomes,
        listingSourcesTried,
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
    }

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
