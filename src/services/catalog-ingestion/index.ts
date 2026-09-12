export type IngestionSeedSource =
  | "searchRequest"
  | "singleMarketplace"
  | "recentQuery"
  | "favorito"
  | "opportunity"
  | "popularCategory";

export type CatalogIngestionSeed = {
  source: IngestionSeedSource;
  query?: string;
  normalizedQuery?: string;
  productId?: string;
  productName?: string;
  reasons?: string[];
};

export type CatalogIngestionCandidate = {
  marketplace: "MERCADO_LIVRE" | "AMAZON" | "SHOPEE" | "MAGAZINE_LUIZA" | "ALIEXPRESS";
  marketplaceName: string;
  externalId: string;
  sourceUrl: string;
  title: string;
  image: string | null;
  price: number | null;
  oldPrice: number | null;
  affiliateLink?: string | null;
  brand?: string | null;
  category?: string | null;
  attributes?: Record<string, string> | null;
  seller?: string | null;
  status: "FOUND" | "NOT_FOUND" | "UNAVAILABLE" | "ERROR";
  error?: string | null;
};

export type CatalogIngestionAdapter = {
  key: "mercadolivre" | "amazon" | "shopee" | "magazineluiza" | "aliexpress";
  searcher: (query: string) => Promise<CatalogIngestionCandidate[]>;
};

export type CatalogIngestionBatchResult = {
  seedsProcessed: number;
  candidatesFound: number;
  candidatesRejected: number;
  productsCreated: number;
  productsUpdated: number;
  offersCreated: number;
  offersUpdated: number;
  upgradedSingleToComparable: number;
  marketplaceErrors: string[];
  elapsedMs: number;
  dryRun: boolean;
};

export function buildSeedPlan(
  seeds: CatalogIngestionSeed[],
  options: { seedLimit?: number } = {},
): CatalogIngestionSeed[] {
  const limit = Math.max(1, options.seedLimit ?? 50);
  const ranked = [...seeds].sort((a, b) => {
    const aWeight = getSeedWeight(a);
    const bWeight = getSeedWeight(b);
    return bWeight - aWeight;
  });

  return ranked.slice(0, limit);
}

function getSeedWeight(seed: CatalogIngestionSeed): number {
  const sourceWeight: Record<IngestionSeedSource, number> = {
    searchRequest: 100,
    recentQuery: 90,
    singleMarketplace: 85,
    favorito: 60,
    opportunity: 55,
    popularCategory: 40,
  };

  return sourceWeight[seed.source] ?? 10;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_KEYWORDS = new Set([
  "notebook",
  "monitor",
  "tv",
  "smart",
  "tvs",
  "celular",
  "fone",
  "headphone",
  "aspirador",
  "panela",
  "chuteira",
  "society",
  "filtro",
  "lavadora",
  "chaveiro",
  "oferta",
  "produto",
  "gamer",
  "eletronico",
  "eletrônicos",
  "eletronicos",
  "acessorio",
  "acessório",
  "acessorios",
  "acessórios",
  "categoria",
]);

function extractBrandFromTitle(title: string): string | null {
  const text = normalizeText(title);
  if (!text) {
    return null;
  }

  const tokens = text.split(" ").filter(Boolean);
  if (tokens.length >= 2 && !GENERIC_KEYWORDS.has(tokens[0])) {
    return tokens[0].charAt(0).toUpperCase() + tokens[0].slice(1);
  }

  return null;
}

export function isCandidateEligible(
  candidate: CatalogIngestionCandidate,
  query: string,
): boolean {
  if (!candidate || candidate.status !== "FOUND") {
    return false;
  }

  if (!candidate.title?.trim()) {
    return false;
  }

  const queryText = normalizeText(query);
  const titleText = normalizeText(candidate.title);

  if (!queryText || !titleText) {
    return false;
  }

  const queryTokens = new Set(queryText.split(" ").filter(Boolean));
  const titleTokens = new Set(titleText.split(" ").filter(Boolean));
  const overlap = [...queryTokens].filter((token) => titleTokens.has(token));

  if (overlap.length === 0) {
    return false;
  }

  if (candidate.brand && candidate.brand.trim()) {
    const candidateBrand = normalizeText(candidate.brand);
    const queryBrandTerms = queryText
      .split(" ")
      .filter((token) => token.length > 2 && !GENERIC_KEYWORDS.has(token));

    const queryBrandConflict = queryBrandTerms.some((term) => {
      if (term === candidateBrand) {
        return false;
      }

      return !titleText.includes(term);
    });

    if (queryBrandConflict && candidateBrand && !queryText.includes(candidateBrand)) {
      return false;
    }
  }

  const accessoryTerms = new Set([
    "acessorio",
    "acessorio",
    "capa",
    "filtro",
    "bateria",
    "adaptador",
    "carregador",
    "case",
    "peça",
    "peca",
    "reparo",
    "parafuso",
  ]);
  const titleContainsAccessory = [...titleTokens].some((token) => accessoryTerms.has(token));
  if (titleContainsAccessory && !queryText.includes("filtro") && !queryText.includes("bateria") && !queryText.includes("carregador")) {
    return false;
  }

  return true;
}

export async function runCatalogIngestionBatch({
  seeds,
  adapters,
  dryRun = true,
  batchLimit = 10,
  clock = Date.now,
}: {
  seeds: CatalogIngestionSeed[];
  adapters: CatalogIngestionAdapter[];
  dryRun?: boolean;
  batchLimit?: number;
  clock?: () => number;
}): Promise<CatalogIngestionBatchResult> {
  const startedAt = clock();
  const plan = buildSeedPlan(seeds, { seedLimit: batchLimit });
  const marketplaceErrors: string[] = [];
  let candidatesFound = 0;
  let candidatesRejected = 0;
  let productsCreated = 0;
  let productsUpdated = 0;
  let offersCreated = 0;
  let offersUpdated = 0;
  let upgradedSingleToComparable = 0;

  for (const seed of plan) {
    const query = seed.normalizedQuery ?? seed.query ?? seed.productName ?? "";
    if (!query) {
      continue;
    }

    for (const adapter of adapters) {
      try {
        const results = await adapter.searcher(query);
        for (const candidate of results) {
          if (isCandidateEligible(candidate, query)) {
            candidatesFound += 1;
          } else {
            candidatesRejected += 1;
          }
        }
      } catch (error) {
        marketplaceErrors.push(`${adapter.key}:${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (dryRun) {
    productsCreated = 0;
    productsUpdated = 0;
    offersCreated = 0;
    offersUpdated = 0;
    upgradedSingleToComparable = 0;
  }

  return {
    seedsProcessed: plan.length,
    candidatesFound,
    candidatesRejected,
    productsCreated,
    productsUpdated,
    offersCreated,
    offersUpdated,
    upgradedSingleToComparable,
    marketplaceErrors,
    elapsedMs: Math.max(0, clock() - startedAt),
    dryRun,
  };
}
