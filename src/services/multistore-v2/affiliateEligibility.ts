import type { AffiliateStatus, MarketplaceCode } from "./types";
import { isAbortError, composeAbortSignal } from "@/lib/searchAbort";
import { withTimeout, type SearchDeadline } from "./timeBudget";
import { traceV2 } from "./trace";

const GENERIC_MERCADO_LIVRE_FALLBACK = /meli\.la\/1i7te2c\/?$/i;

export type AffiliateAssessment = {
  status: AffiliateStatus;
  affiliateLink: string | null;
  source: "ADAPTER" | "RESOLVER" | "NONE";
  reason: string;
};

export type AffiliateResolverInput = {
  marketplace: MarketplaceCode;
  externalId: string;
  sourceUrl: string;
  affiliateLink: string | null;
  declaredStatus?: AffiliateStatus | null;
};

export type AffiliateResolverResult = {
  status: AffiliateStatus;
  affiliateLink?: string | null;
  reason?: string;
};

export type AffiliateResolver = (
  input: AffiliateResolverInput,
  signal?: AbortSignal,
) => Promise<AffiliateResolverResult>;

function normalizeUrl(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

export function urlsAreEquivalent(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  const left = normalizeUrl(first);
  const right = normalizeUrl(second);
  return Boolean(left) && left === right;
}

export function isConfirmedAffiliateLink(
  affiliateLink: string | null | undefined,
  sourceUrl: string | null | undefined,
): boolean {
  const link = affiliateLink?.trim() ?? "";
  if (!link) {
    return false;
  }

  if (urlsAreEquivalent(link, sourceUrl)) {
    return false;
  }

  if (GENERIC_MERCADO_LIVRE_FALLBACK.test(link.replace(/^https?:\/\//i, ""))) {
    return false;
  }

  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "meli.la" || host.endsWith(".meli.la")) {
      return url.pathname.replace(/\/+$/, "").toLowerCase() !== "/1i7te2c";
    }
    return true;
  } catch {
    return false;
  }
}

export function classifyListingAffiliate(input: {
  marketplace: MarketplaceCode;
  sourceUrl: string;
  affiliateLink: string | null | undefined;
  declaredStatus?: AffiliateStatus | null;
}): AffiliateAssessment {
  const declared = input.declaredStatus ?? null;
  if (declared === "INELIGIBLE") {
    return {
      status: "INELIGIBLE",
      affiliateLink: null,
      source: "ADAPTER",
      reason: "Anuncio declarado inelegivel pelo programa de afiliados.",
    };
  }

  if (declared === "ERROR") {
    return {
      status: "ERROR",
      affiliateLink: null,
      source: "ADAPTER",
      reason: "Falha tecnica ao determinar elegibilidade de afiliado.",
    };
  }

  if (declared === "UNKNOWN") {
    return {
      status: "UNKNOWN",
      affiliateLink: null,
      source: "NONE",
      reason: "Elegibilidade de afiliado ainda nao confirmada.",
    };
  }

  const provided = input.affiliateLink?.trim() || null;
  if (provided && urlsAreEquivalent(provided, input.sourceUrl)) {
    return {
      status: "UNKNOWN",
      affiliateLink: null,
      source: "NONE",
      reason: "sourceUrl nao pode ser promovida a affiliateLink.",
    };
  }

  if (isConfirmedAffiliateLink(provided, input.sourceUrl)) {
    return {
      status: "READY",
      affiliateLink: provided,
      source: "ADAPTER",
      reason: "Link afiliado distinto da URL comum do anuncio.",
    };
  }

  if (declared === "READY") {
    return {
      status: "UNKNOWN",
      affiliateLink: null,
      source: "NONE",
      reason: "READY sem link afiliado distinto da sourceUrl nao e monetizavel.",
    };
  }

  return {
    status: "UNKNOWN",
    affiliateLink: null,
    source: "NONE",
    reason:
      input.marketplace === "MERCADO_LIVRE"
        ? "Mercado Livre nao possui endpoint de elegibilidade no Ofertano; afiliado permanece UNKNOWN."
        : "Link afiliado nao confirmado.",
  };
}

export async function resolveListingAffiliate(
  input: AffiliateResolverInput,
  options: {
    resolver?: AffiliateResolver;
    signal?: AbortSignal;
    deadline?: SearchDeadline;
  } = {},
): Promise<AffiliateAssessment> {
  const baseline = classifyListingAffiliate(input);
  if (baseline.status === "READY" || baseline.status === "INELIGIBLE") {
    return baseline;
  }

  if (!options.resolver || input.marketplace !== "MERCADO_LIVRE") {
    return baseline;
  }

  if (options.signal?.aborted || options.deadline?.expired()) {
    return {
      status: "UNKNOWN",
      affiliateLink: null,
      source: "NONE",
      reason: "TIMEOUT: elegibilidade de afiliado nao coube no orcamento.",
    };
  }

  const resolverBudgetMs = Math.min(
    800,
    Math.max(
      0,
      (options.deadline?.remainingMs() ?? 800) -
        (options.deadline?.responseReserveMs ?? 0) -
        50,
    ),
  );
  if (resolverBudgetMs <= 0) {
    return {
      status: "UNKNOWN",
      affiliateLink: null,
      source: "NONE",
      reason: "TIMEOUT: elegibilidade de afiliado nao coube no orcamento.",
    };
  }
  const child = composeAbortSignal(
    resolverBudgetMs,
    options.signal,
    options.deadline?.signal,
  );

  try {
    const raced = await withTimeout(
      options.resolver(input, child.signal),
      resolverBudgetMs,
      child.signal,
    );
    if (raced.status === "timeout") {
      child.abort();
      return {
        status: "UNKNOWN",
        affiliateLink: null,
        source: "RESOLVER",
        reason: "TIMEOUT: validacao de afiliado interrompida pelo orcamento.",
      };
    }
    const resolved = raced.value;
    if (resolved.status === "INELIGIBLE") {
      return {
        status: "INELIGIBLE",
        affiliateLink: null,
        source: "RESOLVER",
        reason:
          resolved.reason ??
          "Programa de afiliados recusou este anuncio.",
      };
    }

    if (resolved.status === "ERROR") {
      return {
        status: "ERROR",
        affiliateLink: null,
        source: "RESOLVER",
        reason: resolved.reason ?? "Erro tecnico na validacao de afiliado.",
      };
    }

    if (
      resolved.status === "READY" &&
      isConfirmedAffiliateLink(resolved.affiliateLink ?? null, input.sourceUrl)
    ) {
      return {
        status: "READY",
        affiliateLink: resolved.affiliateLink?.trim() || null,
        source: "RESOLVER",
        reason: resolved.reason ?? "Resolver confirmou link afiliado.",
      };
    }

    return {
      status: "UNKNOWN",
      affiliateLink: null,
      source: "RESOLVER",
      reason: resolved.reason ?? "Resolver nao confirmou afiliado.",
    };
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted || options.deadline?.expired()) {
      return {
        status: "UNKNOWN",
        affiliateLink: null,
        source: "RESOLVER",
        reason: "TIMEOUT: validacao de afiliado interrompida pelo orcamento.",
      };
    }

    return {
      status: "ERROR",
      affiliateLink: null,
      source: "RESOLVER",
      reason:
        error instanceof Error
          ? error.message.slice(0, 180)
          : "Erro tecnico na validacao de afiliado.",
    };
  } finally {
    child.cleanup();
  }
}

export function affiliateRank(status: AffiliateStatus | undefined): number {
  if (status === "READY") {
    return 3;
  }
  if (status === "UNKNOWN" || status === "ERROR") {
    return 1;
  }
  return 0;
}

export function traceAffiliateAssessment(
  input: AffiliateResolverInput & {
    status: AffiliateStatus;
    selectedForCluster?: boolean;
    fallbackAttempt?: boolean;
    reason?: string;
  },
): void {
  traceV2("affiliate", {
    marketplace: input.marketplace,
    externalId: input.externalId,
    affiliateStatus: input.status,
    affiliateSource: input.affiliateLink ? "affiliateLink" : "none",
    fallbackAttempt: input.fallbackAttempt ?? false,
    selectedForCluster: input.selectedForCluster ?? false,
    reason: input.reason,
  });
}
