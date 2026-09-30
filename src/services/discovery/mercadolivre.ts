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
import { inferConditionFromQuery } from "@/services/multistore-v2/querySanitizer";
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
  classifyMercadoLivreListingIdentity,
  extractMercadoLivreCatalogProductId,
  isMercadoLivreCatalogSourceUrl,
  isValidMercadoLivreListingIdentity,
  mercadoLivreSourceUrlProvesListing,
  resolveMercadoLivreListingSourceUrl,
} from "@/services/mercadoLivre/listingIdentity";
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
  catalogProductId?: string | null;
  /*
   * Proveniencia da lane que produziu a avaliacao. `CATALOG` e
   * terminal para fins de oferta: nunca chega ao `externalId`.
   */
  origin?: "LISTING" | "CATALOG";
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

    const hasMatchedIdentity =
      Boolean(queryBrand && brandMatch) ||
      (queryModels.length > 0 && modelMatch) ||
      (queryAnchors.length > 0 && anchorMatch);

    if (
      requiredAnchors.length > 0 &&
      !requiredAnchors.every(matchesAnchor) &&
      !hasMatchedIdentity
    ) {
      return result({
        hasCentralEvidence: false,
        reason: "âncora obrigatória da consulta ausente no candidato",
        classMatch,
        brandMatch,
        modelMatch,
        anchorMatch,
      });
    }
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

function evaluationStrength(item: CandidateEvaluation): number {
  const candidateRelevance = item.kept?.relevance ?? item.lexicalScore ?? 0;

  return (
    /*
     * Proveniencia LISTING ganha de CATALOG: o mesmo id pode aparecer
     * nas duas lanes (catalogo e anuncio compartilham a forma MLB+digits)
     * e a evidencia de anuncio e sempre a mais forte.
     */
    Number(item.origin !== "CATALOG") * 4_000 +
    Number(Boolean(item.kept)) * 1_000 +
    Number(Boolean(item.kept && item.kept.relevance > 0.5)) * 500 +
    candidateRelevance * 100 +
    evaluationCompleteness(item) * 10 +
    (item.lexicalScore ?? 0) * 20
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
    if (
      !current ||
      evaluationStrength(item) > evaluationStrength(current)
    ) {
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
  catalogProductId: string | null = null,
  origin: "LISTING" | "CATALOG" = "LISTING",
): CandidateEvaluation {
  return {
    title,
    externalId,
    stage,
    status: "DROPPED",
    reason,
    lexicalScore,
    catalogProductId,
    origin,
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

  /*
   * catalog_product_id e METADADO estrutural. Ele nunca substitui o
   * listingItemId e nunca pode virar `externalId`.
   */
  const catalogProductId =
    extractMercadoLivreCatalogProductId(
      (item as { catalog_product_id?: string | null }).catalog_product_id ??
        null,
    ) ??
    fromPermalink.catalogIds.find(
      (id) => id !== itemId,
    ) ??
    null;

  /*
   * sourceUrl precisa representar a LISTING concreta. URL /p/ de catalogo
   * e recusada; quando o permalink nao prova o item_id, derivamos a rota
   * publica individual do proprio ITEM_ID.
   */
  const sourceUrl =
    resolveMercadoLivreListingSourceUrl(permalink, itemId) ?? "";
  const externalId = itemId;
  const lexical =
    pontuarCoberturaLexicalPonderada(query, titulo);

  if (!titulo || !externalId) {
    return recusarCandidato(
      titulo || "(sem titulo)",
      itemId || "(sem id)",
      "normalize",
      "Item sem titulo e sem id/url.",
      lexical.score,
      catalogProductId,
    );
  }

  if (isUserProductId(rawId) && !itemId) {
    return recusarCandidato(
      titulo,
      rawId,
      "catalog-only",
      "Identidade MLBU sem listing MLB compravel.",
      lexical.score,
      catalogProductId,
    );
  }

  /*
   * LISTING-FIRST: so uma listing concreta comprovada vira oferta.
   * Sem ITEM_ID real + URL que prove aquele ITEM_ID, ZERO WRITE.
   */
  const listingIdentity = classifyMercadoLivreListingIdentity({
    listingItemId: itemId,
    sourceUrl,
    origin: "listing",
  });

  if (!listingIdentity.valid) {
    return recusarCandidato(
      titulo,
      itemId,
      "listing-identity",
      `LISTING_FIRST: ${listingIdentity.rejection}. ` +
        "Catalogo nao e oferta; exige anuncio concreto com ITEM_ID.",
      lexical.score,
      catalogProductId,
    );
  }

  if (
    isMercadoLivreCatalogSourceUrl(permalink) &&
    !mercadoLivreSourceUrlProvesListing(permalink, itemId)
  ) {
    return recusarCandidato(
      titulo,
      itemId,
      "catalog-source-url",
      "LISTING_FIRST: permalink de catalogo /p/ nao identifica a oferta.",
      lexical.score,
      catalogProductId,
    );
  }

  if (mode !== "MULTILOJA") {
    const recusaTitulo =
      avaliarTituloParaDiscovery(query, titulo, externalId);

    if (recusaTitulo) {
      return {...recusaTitulo, catalogProductId};
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
        catalogProductId,
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
      catalogProductId,
    );
  }

  const queryCondition = inferConditionFromQuery(query);
  if (item.condition && item.condition !== "new") {
    const normalizedItemCondition = String(item.condition).trim().toLowerCase();
    const compatibleConditions = new Set<string>([
      "new",
      "used",
      "refurbished",
      "repackaged",
      "open-box",
      "open box",
    ]);

    if (!queryCondition) {
      return recusarCandidato(
        titulo,
        externalId,
        "condition",
        `Condicao ${item.condition} nao e oferta nova compravel.`,
        lexical.score,
        catalogProductId,
      );
    }

    const normalizedQueryCondition = queryCondition.toLowerCase();
    const isCompatibleCondition =
      normalizedQueryCondition === normalizedItemCondition ||
      (normalizedQueryCondition === "used" &&
        ["used", "refurbished"].includes(normalizedItemCondition)) ||
      (normalizedQueryCondition === "refurbished" &&
        ["used", "refurbished"].includes(normalizedItemCondition)) ||
      (normalizedQueryCondition === "repackaged" &&
        ["repackaged", "open-box", "open box"].includes(normalizedItemCondition));

    if (!compatibleConditions.has(normalizedItemCondition) || !isCompatibleCondition) {
      return recusarCandidato(
        titulo,
        externalId,
        "condition",
        `Condicao ${item.condition} nao e compatível com a consulta.`,
        lexical.score,
        catalogProductId,
      );
    }
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
    reason: "Listing concreta preservada pelo Discovery.",
    lexicalScore: lexical.score,
    catalogProductId,
    origin: "LISTING",
    kept: {
      relevance: lexical.score,
      candidate: {
        marketplace: "MERCADO_LIVRE",
        marketplaceName: "Mercado Livre",
        externalId,
        sourceUrl,
        listingItemId: itemId,
        catalogProductId,
        origin: "LISTING",
        sellerId:
          typeof item.seller?.id === "number"
            ? String(item.seller.id)
            : null,
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
        productId,
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
        productId,
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

    /*
     * LISTING-FIRST (gate estrutural): produto de catalogo NUNCA vira
     * MarketplaceOffer.
     *
     * O que fica permitido aqui e exatamente o que a missao permite:
     * enriquecimento, matching auxiliar, catalogo interno e atributos
     * estruturais. Nao existe mais "pegar o cheapest item" nem "usar o
     * buy_box atual e fingir que era a oferta descoberta": os dois mudam
     * seller/preco e destroem a identidade do anuncio.
     *
     * O catalogo mantem o productId como METADADO (catalogProductId) para
     * correlacionar o anuncio encontrado em seguida, mas o candidato
     * termina DROPPED.
     */
    const catalogProductId =
      extractMercadoLivreCatalogProductId(productId) ??
      extractMercadoLivreCatalogProductId(produto.permalink ?? "") ??
      productId.trim();

    return recusarCandidato(
      titulo,
      productId,
      "catalog-only",
      "LISTING_FIRST/CATALOG_PRODUCT_NOT_LISTING: produto de catalogo e " +
        "enriquecimento, nunca oferta. Exige anuncio concreto com ITEM_ID.",
      lexical.score,
      catalogProductId,
      "CATALOG",
    );
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
  blockedListingSources: string[];
}): MarketplaceDiscoveryResult["searchOutcome"] {
  if (input.candidatoCount > 0) {
    return "SEARCH_COMPLETED";
  }

  /*
   * FAIL CLOSED: as fontes de ANUNCIO foram bloqueadas e nao existe
   * fallback para produto de catalogo. Melhor zero oferta do que uma
   * oferta de seller/preco errado.
   */
  if (
    input.listingSourcesTried.length > 0 &&
    input.blockedListingSources.length > 0 &&
    input.blockedListingSources.length >= input.listingSourcesTried.length &&
    !input.sourceOutcomes.some(
      (item) => item === "SUCCESS" || item === "EMPTY_VALID",
    )
  ) {
    return "LISTING_SOURCE_BLOCKED";
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
    if (!supported) {
      const lexical = pontuarCoberturaLexicalPonderada(
        relevanceQuery,
        candidateTitle,
      );
      const fallbackThreshold = queryHasCentralRequirements ? 0.5 : 0.18;
      const fallbackCoverage = queryHasCentralRequirements ? 0.35 : 0.2;
      supported =
        lexical.score >= fallbackThreshold ||
        lexical.queryCoverage >= fallbackCoverage;
    }

    minimalEvidenceCache.set(evaluation, supported);
    return supported;
  };
  /*
   * Gate final LISTING-FIRST (fail closed).
   *
   * Nenhum candidato sai daqui sem passar por
   * `isValidMercadoLivreListingIdentity`: ITEM_ID concreto + origem
   * listing + sourceUrl que prova aquele ITEM_ID. Qualquer coisa que
   * veio de produto de catalogo e descartada com zero write.
   *
   * A origem usada aqui e a PROVENIENCIA REAL da lane, nunca uma
   * constante: uma lane de catalogo que se comporte errado (devolvendo
   * `status: "KEPT"` com um id numerico e uma URL `produto.`) continua
   * sendo rejeitada, porque `origin: "CATALOG"` e terminal.
   */
  const candidatosComListingReal = (
    kept: CandidateEvaluation[],
  ): DiscoveryCandidate[] =>
    kept
      .filter((item) => item.origin !== "CATALOG")
      .flatMap((item) => (item.kept ? [item.kept.candidate] : []))
      .filter((candidate) =>
        isValidMercadoLivreListingIdentity({
          externalId: candidate.externalId,
          listingItemId: candidate.listingItemId ?? candidate.externalId,
          sourceUrl: candidate.sourceUrl,
          origin:
            candidate.origin === "CATALOG"
              ? "catalog"
              : "listing",
        }),
      );

  let scanned = 0;
  const sourceOutcomes: Array<
    "SUCCESS" | "EMPTY_VALID" | "BLOCKED" | "ERROR" | "UNUSABLE"
  > = [];
  const listingSourcesTried: string[] = [];
  let catalogFoundUsableCandidate = false;
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
  /*
   * LISTING-FIRST: cobertura de OFERTA so conta o que pode virar oferta.
   *
   * Uma avaliacao de proveniencia CATALOG e terminal no gate final
   * (`candidatosComListingReal`), logo ela nunca produz oferta. Contar
   * aqui faria o goal de cobertura ser satisfeito com 2 produtos de
   * catalogo, abortando o lote e SKIPANDO o fallback publico — o resultado
   * seria `EMPTY_VALID` com zero oferta e nenhuma tentativa de buscar
   * anuncio. "catalogo nunca compoe cobertura de oferta".
   */
  const isOfferEligibleEvaluation = (
    item: CandidateEvaluation,
  ): boolean =>
    item.origin !== "CATALOG" &&
    Boolean(item.kept) &&
    hasMinimalQueryEvidence(item);
  const supportedEvaluationCount = (): number =>
    evaluations.filter(isOfferEligibleEvaluation).length;
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

      /*
       * LISTING-FIRST: o dedup por id so pode ser formado por avaliacoes que
       * realmente podem virar oferta.
       *
       * Incluir aqui uma avaliacao de proveniencia CATALOG faz a lane de
       * catalogo "reservar" um id e descarta silenciosamente o ANUNCIO real
       * que vier depois com o mesmo id (`seen.has(itemId)` -> `continue`).
       * O resultado seria perder uma oferta legitima enquanto o produto de
       * catalogo, terminal, nao entra em `candidates` — oferta zero sem
       * motivo. Catalogo nao pode reivindicar identidade de anuncio.
       */
      const seen = new Set(
        evaluations
          .filter((item) => item.origin !== "CATALOG")
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
                  isOfferEligibleEvaluation(attempt.evaluation),
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

            const attemptForEvaluation = attempts.find(
              (attempt) => attempt.evaluation === evaluation,
            );
            const hasStrongOutOfOrderCandidate =
              attemptForEvaluation !== undefined &&
              attemptForEvaluation.rank > 1;
            if (hasBatchCoverageGoal() || hasStrongOutOfOrderCandidate) {
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
                    /*
                     * LISTING-FIRST: a proveniencia e a da LANE, nunca a que a
                     * fonte se declara.
                     *
                     * A lane de catalogo e terminal para fins de oferta. O
                     * carimbo `origin: "CATALOG"` e obrigatorio porque o gate
                     * final filtra por `item.origin !== "CATALOG"`: sem o
                     * carimbo, `undefined !== "CATALOG"` passa e um PRODUTO DE
                     * CATALOGO vira oferta sempre que a fonte devolver
                     * `status: "KEPT"`, um id com forma de MLB e uma URL
                     * `produto.mercadolivre.com.br/MLB...` que parece de
                     * listing. CATALOG PRODUCT != MARKETPLACE OFFER.
                     */
                    const catalogEvaluation: CandidateEvaluation = {
                      ...evaluation,
                      origin: "CATALOG",
                    };
                    attempt.evaluation = catalogEvaluation;
                    const hasUsableKept =
                      catalogEvaluation.kept &&
                      hasMinimalQueryEvidence(catalogEvaluation);
                    attempt.terminal = hasUsableKept ? "KEPT" : "DROPPED";
                    if (hasUsableKept) {
                      registerSupportedEvaluation(catalogEvaluation);
                    }
                  } catch (error) {
                    if (batchAbort.signal.aborted) {
                      attempt.terminal = "DROPPED";
                      return;
                    }
                    attempt.terminal = "ERROR";
                    /* Mesmo no erro a proveniencia e da lane de catalogo. */
                    attempt.evaluation = recusarCandidato(
                      attempt.title,
                      attempt.productId,
                      "error",
                      error instanceof Error
                        ? error.message.slice(0, 180)
                        : "Falha ao carregar produto de catalogo.",
                      0,
                      null,
                      "CATALOG",
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

      const kept = consolidated
        .filter(hasMinimalQueryEvidence)
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
        .slice(0, limit);
      const candidatos = candidatosComListingReal(kept);

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
        blockedListingSources: listingSourcesTried.filter((source) =>
          blockedSources.includes(source),
        ),
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
        success:
          searchOutcome !== "ERROR" &&
          searchOutcome !== "BLOCKED" &&
          searchOutcome !== "LISTING_SOURCE_BLOCKED",
        candidates: candidatos,
        scanned,
        error: null,
        degraded: blockedSources.length > 0,
        blockedSources,
        unusableSources,
        sourcesTried,
        searchOutcome,
        discoveryMode: "LISTING_FIRST",
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
          continue;
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

      if (
        supportedEvaluationCount() > 0 &&
        !blockedSources.includes("items-api")
      ) {
        catalogFoundUsableCandidate = true;
        traceMlAcquisition("EXIT", {
          query,
          candidates: supportedEvaluationCount(),
          elapsedMs: budgetClock.elapsedMs(),
        });
        return;
      }

      if (!shouldStop() && !hasCoverageGoal()) {
        await runPublicListingFallbacks();
      }
    };

    await waitForParallelLanes();

    if (hasCoverageGoal() || catalogFoundUsableCandidate) {
      return finalizeDiscovery();
    }

    if (shouldStop() && supportedEvaluationCount() > 0) {
      return finalizeDiscovery();
    }

    if (!hasCoverageGoal() && !catalogFoundUsableCandidate) {
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

    const blockedListingSources = listingSourcesTried.filter((source) =>
      blockedSources.includes(source),
    );

    if (supportedEvaluationCount() > 0) {
      const kept = consolidateEvaluations(evaluations)
        .filter(hasMinimalQueryEvidence)
        .slice(0, limit);
      const candidatos = candidatosComListingReal(kept);
      const searchOutcome = inferMercadoLivreSearchOutcome({
        candidatoCount: candidatos.length,
        sourceOutcomes,
        listingSourcesTried,
        blockedListingSources,
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
        discoveryMode: "LISTING_FIRST",
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
      searchOutcome:
        blockedListingSources.length > 0 &&
        blockedListingSources.length >= listingSourcesTried.length
          ? "LISTING_SOURCE_BLOCKED"
          : "ERROR",
      discoveryMode: "LISTING_FIRST",
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
