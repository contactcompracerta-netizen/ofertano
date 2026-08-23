import type {
  DiscoveryMarketplace,
  MarketplaceDiscoveryResult,
  MarketplaceSearchOutcome,
} from "@/services/discovery/core/types";
import { traceMultiloja } from "@/services/multiloja/trace";

const BLOCKED_ERROR_RE =
  /captcha|challenge|access[_\s-]?denied|403|blocked|bloquead|login|robot|unusual traffic|too many requests|429|rate limit/i;

const UNUSABLE_ERROR_RE =
  /unusable|sem estrutura|nao interpretavel|não interpretável|pagina invalida|página inválida|sem mecanismo de busca/i;

const MARKETPLACE_NAME_TO_CODE: Record<string, DiscoveryMarketplace> = {
  "Mercado Livre": "MERCADO_LIVRE",
  MERCADO_LIVRE: "MERCADO_LIVRE",
  Amazon: "AMAZON",
  AMAZON: "AMAZON",
  Shopee: "SHOPEE",
  SHOPEE: "SHOPEE",
  "Magazine Luiza": "MAGAZINE_LUIZA",
  MAGAZINE_LUIZA: "MAGAZINE_LUIZA",
  AliExpress: "ALIEXPRESS",
  ALIEXPRESS: "ALIEXPRESS",
};

export type PublicSearchCoverage = {
  enabledMarketplaces: DiscoveryMarketplace[];
  results: MarketplaceDiscoveryResult[];
};

export type SearchCompletionInput = PublicSearchCoverage & {
  query: string;
  exactOffers: Array<{ product: { marketplace: string } }>;
};

export type SearchCompletionDecision = {
  query: string;
  enabledMarketplaces: DiscoveryMarketplace[];
  attemptedMarketplaces: DiscoveryMarketplace[];
  notRunMarketplaces: DiscoveryMarketplace[];
  exactMarketplaces: DiscoveryMarketplace[];
  blockedMarketplaces: DiscoveryMarketplace[];
  erroredMarketplaces: DiscoveryMarketplace[];
  unusableMarketplaces: DiscoveryMarketplace[];
  completedMarketplaces: DiscoveryMarketplace[];
  allEnabledAttempted: boolean;
  publicationAllowed: boolean;
  comparisonCoverage: "FULL_ATTEMPT" | "PARTIAL" | "MISSING";
  exactMarketplaceCount: number;
  result:
    | "SINGLE_EXACT_AFTER_FULL_SEARCH"
    | "MULTI_EXACT_AFTER_FULL_SEARCH"
    | "NO_EXACT_AFTER_FULL_SEARCH"
    | "EARLY_PUBLISH_BLOCKED"
    | "COVERAGE_MISSING";
  reason: string;
};

export function reduzirSearchOutcomes(
  outcomes: MarketplaceSearchOutcome[],
): MarketplaceSearchOutcome {
  if (outcomes.some((outcome) => outcome === "SEARCH_COMPLETED")) {
    return "SEARCH_COMPLETED";
  }

  if (outcomes.some((outcome) => outcome === "EMPTY_VALID")) {
    return "EMPTY_VALID";
  }

  if (outcomes.some((outcome) => outcome === "BLOCKED")) {
    return "BLOCKED";
  }

  if (outcomes.some((outcome) => outcome === "UNUSABLE")) {
    return "UNUSABLE";
  }

  if (outcomes.some((outcome) => outcome === "ERROR")) {
    return "ERROR";
  }

  return "NOT_RUN";
}

export function codigoDoMarketplace(
  value: string | null | undefined,
): DiscoveryMarketplace | null {
  const trimmed = value?.trim() ?? "";

  if (!trimmed) {
    return null;
  }

  return MARKETPLACE_NAME_TO_CODE[trimmed] ?? null;
}

export function classificarBuscaDoMarketplace(
  result: MarketplaceDiscoveryResult | null | undefined,
): MarketplaceSearchOutcome {
  if (!result) {
    return "NOT_RUN";
  }

  if ((result.candidates?.length ?? 0) > 0) {
    return "SEARCH_COMPLETED";
  }

  if (result.searchOutcome) {
    return result.searchOutcome;
  }

  const error = result.error ?? "";
  const blockedSources = result.blockedSources ?? [];
  const unusableSources = result.unusableSources ?? [];
  const sourcesTried = result.sourcesTried ?? [];
  const completedSources = sourcesTried.filter(
    (source) =>
      !blockedSources.includes(source) &&
      !unusableSources.includes(source),
  );

  if (!result.success) {
    if (blockedSources.length > 0 || BLOCKED_ERROR_RE.test(error)) {
      return "BLOCKED";
    }

    if (unusableSources.length > 0 || UNUSABLE_ERROR_RE.test(error)) {
      return "UNUSABLE";
    }

    return "ERROR";
  }

  if (completedSources.length > 0) {
    return "EMPTY_VALID";
  }

  if (sourcesTried.length === 0) {
    if (blockedSources.length > 0 || BLOCKED_ERROR_RE.test(error)) {
      return "BLOCKED";
    }

    if (unusableSources.length > 0 || UNUSABLE_ERROR_RE.test(error)) {
      return "UNUSABLE";
    }

    return "EMPTY_VALID";
  }

  if (blockedSources.length > 0 && unusableSources.length === 0) {
    return "BLOCKED";
  }

  if (unusableSources.length > 0 && blockedSources.length === 0) {
    return "UNUSABLE";
  }

  if (blockedSources.length > 0 || unusableSources.length > 0) {
    return "BLOCKED";
  }

  return "EMPTY_VALID";
}

function uniqueMarketplaces(
  values: Array<DiscoveryMarketplace | null>,
): DiscoveryMarketplace[] {
  return Array.from(
    new Set(
      values.filter((value): value is DiscoveryMarketplace => value !== null),
    ),
  );
}

export function avaliarSearchCompletionBarrier(
  input: SearchCompletionInput,
): SearchCompletionDecision {
  const enabledMarketplaces = uniqueMarketplaces(input.enabledMarketplaces);
  const resultsByMarketplace = new Map(
    input.results.map((result) => [result.marketplace, result]),
  );

  const attemptedMarketplaces: DiscoveryMarketplace[] = [];
  const completedMarketplaces: DiscoveryMarketplace[] = [];
  const blockedMarketplaces: DiscoveryMarketplace[] = [];
  const erroredMarketplaces: DiscoveryMarketplace[] = [];
  const unusableMarketplaces: DiscoveryMarketplace[] = [];
  const notRunMarketplaces: DiscoveryMarketplace[] = [];

  for (const marketplace of enabledMarketplaces) {
    const outcome = classificarBuscaDoMarketplace(
      resultsByMarketplace.get(marketplace),
    );

    switch (outcome) {
      case "SEARCH_COMPLETED":
      case "EMPTY_VALID":
        attemptedMarketplaces.push(marketplace);
        completedMarketplaces.push(marketplace);
        break;
      case "BLOCKED":
        attemptedMarketplaces.push(marketplace);
        blockedMarketplaces.push(marketplace);
        break;
      case "UNUSABLE":
        attemptedMarketplaces.push(marketplace);
        unusableMarketplaces.push(marketplace);
        break;
      case "ERROR":
        attemptedMarketplaces.push(marketplace);
        erroredMarketplaces.push(marketplace);
        break;
      case "NOT_RUN":
        notRunMarketplaces.push(marketplace);
        break;
    }
  }

  const exactMarketplaces = uniqueMarketplaces(
    input.exactOffers.map((offer) =>
      codigoDoMarketplace(offer.product.marketplace),
    ),
  );
  const exactMarketplaceCount = exactMarketplaces.length;
  const allEnabledAttempted =
    enabledMarketplaces.length > 0 &&
    notRunMarketplaces.length === 0 &&
    attemptedMarketplaces.length === enabledMarketplaces.length;

  const base = {
    query: input.query,
    enabledMarketplaces,
    attemptedMarketplaces,
    notRunMarketplaces,
    exactMarketplaces,
    blockedMarketplaces,
    erroredMarketplaces,
    unusableMarketplaces,
    completedMarketplaces,
    exactMarketplaceCount,
  };

  if (enabledMarketplaces.length === 0) {
    return {
      ...base,
      allEnabledAttempted: false,
      publicationAllowed: false,
      comparisonCoverage: "MISSING",
      result: "COVERAGE_MISSING",
      reason: "Cobertura de marketplaces nao informada; persistencia bloqueada.",
    };
  }

  if (!allEnabledAttempted) {
    return {
      ...base,
      allEnabledAttempted: false,
      publicationAllowed: false,
      comparisonCoverage: "PARTIAL",
      result: "EARLY_PUBLISH_BLOCKED",
      reason:
        enabledMarketplaces.length >= 2 && attemptedMarketplaces.length < 2
          ? "Somente uma loja foi executada; as demais permaneceram NOT_RUN."
          : "Nem todas as lojas habilitadas foram tentadas; early publish bloqueado.",
    };
  }

  if (exactMarketplaceCount === 0) {
    return {
      ...base,
      allEnabledAttempted: true,
      publicationAllowed: false,
      comparisonCoverage: "FULL_ATTEMPT",
      result: "NO_EXACT_AFTER_FULL_SEARCH",
      reason: "Busca completa sem oferta EXACT para persistir.",
    };
  }

  return {
    ...base,
    allEnabledAttempted: true,
    publicationAllowed: true,
    comparisonCoverage: "FULL_ATTEMPT",
    result:
      exactMarketplaceCount === 1
        ? "SINGLE_EXACT_AFTER_FULL_SEARCH"
        : "MULTI_EXACT_AFTER_FULL_SEARCH",
    reason:
      exactMarketplaceCount === 1
        ? "Oferta unica encontrada apos comparacao ampla de todas as lojas."
        : "Ofertas EXACT encontradas apos busca completa das lojas habilitadas.",
  };
}

export function rastrearSearchCompletion(
  decision: SearchCompletionDecision,
): void {
  traceMultiloja("search-completion", {
    query: decision.query,
    enabledMarketplaces: decision.enabledMarketplaces,
    attemptedMarketplaces: decision.attemptedMarketplaces,
    notRunMarketplaces: decision.notRunMarketplaces,
    exactMarketplaces: decision.exactMarketplaces,
    allEnabledAttempted: decision.allEnabledAttempted,
    publicationAllowed: decision.publicationAllowed,
    comparisonCoverage: decision.comparisonCoverage,
    exactMarketplaceCount: decision.exactMarketplaceCount,
    result: decision.result,
    reason: decision.reason,
  });
}
