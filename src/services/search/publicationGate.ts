import type {
  DiscoveryMarketplace,
  MarketplaceDiscoveryResult,
  MarketplaceSearchOutcome,
} from "@/services/discovery/core/types";
import { traceMultiloja } from "@/services/multiloja/trace";

export const MARKETPLACE_SEARCH_COMPLETED_OUTCOMES: ReadonlyArray<
  MarketplaceSearchOutcome
> = ["SEARCH_COMPLETED", "EMPTY_VALID"];

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

export type PublicationGateInput = PublicSearchCoverage & {
  query: string;
  exactOffers: Array<{ product: { marketplace: string } }>;
};

export type PublicationGateDecision = {
  query: string;
  enabledMarketplaces: DiscoveryMarketplace[];
  attemptedMarketplaces: DiscoveryMarketplace[];
  completedMarketplaces: DiscoveryMarketplace[];
  blockedMarketplaces: DiscoveryMarketplace[];
  erroredMarketplaces: DiscoveryMarketplace[];
  unusableMarketplaces: DiscoveryMarketplace[];
  notRunMarketplaces: DiscoveryMarketplace[];
  exactMarketplaces: DiscoveryMarketplace[];
  marketplacesAttempted: number;
  marketplacesSearchCompleted: number;
  marketplacesBlocked: number;
  marketplacesErrored: number;
  effectiveMarketplaceSearchCount: number;
  exactMarketplaceCount: number;
  publicationEligible: boolean;
  status: "ELIGIBLE" | "SEARCH_INCOMPLETE" | "INSUFFICIENT_EXACT";
  reason: string;
};

export function marketplaceBuscaRealmenteConcluida(
  outcome: MarketplaceSearchOutcome,
): boolean {
  return (
    outcome === "SEARCH_COMPLETED" || outcome === "EMPTY_VALID"
  );
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

export function avaliarPublicationGate(
  input: PublicationGateInput,
): PublicationGateDecision {
  const enabledMarketplaces = uniqueMarketplaces(
    input.enabledMarketplaces,
  );
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

  const marketplacesSearchCompleted = completedMarketplaces.length;
  const exactMarketplaceCount = exactMarketplaces.length;
  const marketplacesAttempted = attemptedMarketplaces.length;
  const marketplacesBlocked = blockedMarketplaces.length;
  const marketplacesErrored = erroredMarketplaces.length;

  if (marketplacesSearchCompleted < 2) {
    return {
      query: input.query,
      enabledMarketplaces,
      attemptedMarketplaces,
      completedMarketplaces,
      blockedMarketplaces,
      erroredMarketplaces,
      unusableMarketplaces,
      notRunMarketplaces,
      exactMarketplaces,
      marketplacesAttempted,
      marketplacesSearchCompleted,
      marketplacesBlocked,
      marketplacesErrored,
      effectiveMarketplaceSearchCount: marketplacesSearchCompleted,
      exactMarketplaceCount,
      publicationEligible: false,
      status: "SEARCH_INCOMPLETE",
      reason:
        "Cobertura insuficiente de marketplaces para comparação.",
    };
  }

  if (exactMarketplaceCount < 2) {
    return {
      query: input.query,
      enabledMarketplaces,
      attemptedMarketplaces,
      completedMarketplaces,
      blockedMarketplaces,
      erroredMarketplaces,
      unusableMarketplaces,
      notRunMarketplaces,
      exactMarketplaces,
      marketplacesAttempted,
      marketplacesSearchCompleted,
      marketplacesBlocked,
      marketplacesErrored,
      effectiveMarketplaceSearchCount: marketplacesSearchCompleted,
      exactMarketplaceCount,
      publicationEligible: false,
      status: "INSUFFICIENT_EXACT",
      reason:
        exactMarketplaceCount === 1
          ? "Somente uma oferta EXACT encontrada; comparação Multi Loja insuficiente."
          : "Nenhuma oferta EXACT encontrada; comparação Multi Loja insuficiente.",
    };
  }

  return {
    query: input.query,
    enabledMarketplaces,
    attemptedMarketplaces,
    completedMarketplaces,
    blockedMarketplaces,
    erroredMarketplaces,
    unusableMarketplaces,
    notRunMarketplaces,
    exactMarketplaces,
    marketplacesAttempted,
    marketplacesSearchCompleted,
    marketplacesBlocked,
    marketplacesErrored,
    effectiveMarketplaceSearchCount: marketplacesSearchCompleted,
    exactMarketplaceCount,
    publicationEligible: true,
    status: "ELIGIBLE",
    reason: "Comparação Multi Loja elegível para publicação.",
  };
}

export function rastrearPublicationGate(
  decision: PublicationGateDecision,
): void {
  traceMultiloja("publication-gate", {
    query: decision.query,
    enabledMarketplaces: decision.enabledMarketplaces,
    attemptedMarketplaces: decision.attemptedMarketplaces,
    completedMarketplaces: decision.completedMarketplaces,
    blockedMarketplaces: decision.blockedMarketplaces,
    erroredMarketplaces: decision.erroredMarketplaces,
    unusableMarketplaces: decision.unusableMarketplaces,
    notRunMarketplaces: decision.notRunMarketplaces,
    exactMarketplaces: decision.exactMarketplaces,
    effectiveMarketplaceSearchCount:
      decision.effectiveMarketplaceSearchCount,
    exactMarketplaceCount: decision.exactMarketplaceCount,
    publicationEligible: decision.publicationEligible,
    status: decision.status,
    reason: decision.reason,
  });
}
