export type ComparableOffer = {
  id: string;
  marketplace: string;
  price: number;
  status: string;
  matchStatus: string;
  available: boolean;
  active: boolean;
  affiliateLink?: string | null;
};

const VALID_COMPARISON_STATUSES = new Set([
  "ACTIVE",
  "PENDING_AFFILIATE",
  "DISCOVERED",
  "UNDER_REVIEW",
]);

export function isValidComparableOffer(
  offer: ComparableOffer,
): boolean {
  return (
    offer.active &&
    offer.available &&
    offer.matchStatus === "EXACT" &&
    VALID_COMPARISON_STATUSES.has(offer.status) &&
    Number.isFinite(offer.price) &&
    offer.price > 0
  );
}

export function isMercadoLivreMarketplace(
  marketplace: string | null | undefined,
): boolean {
  return (
    marketplace?.trim().toUpperCase().replaceAll(" ", "_") ===
    "MERCADO_LIVRE"
  );
}

export function isWaitingAffiliateStatus(
  status: string | null | undefined,
): boolean {
  return status?.trim().toUpperCase() === "WAITING_AFFILIATE";
}

export function canDispatchPendingAffiliateOpportunity(input: {
  marketplace: string;
  status: string;
}): boolean {
  return (
    isMercadoLivreMarketplace(input.marketplace) &&
    isWaitingAffiliateStatus(input.status)
  );
}

export function findSecondLowestOffer(
  excludeId: string,
  offers: ComparableOffer[],
): ComparableOffer | null {
  const others = offers
    .filter(isValidComparableOffer)
    .filter((offer) => offer.id !== excludeId)
    .sort((first, second) => first.price - second.price);

  return others[0] ?? null;
}

export function opportunityDispatchKey(opportunityId: string): string {
  return `opportunity:${opportunityId.trim()}`;
}

export function shouldMarkDispatchDelivered(input: {
  sent: number;
  failed: number;
  skipped?: boolean;
}): boolean {
  if (input.skipped) {
    return false;
  }

  return input.sent > 0;
}

export const PERMANENT_PUSH_FAILURE_STATUSES = new Set([
  404, 410,
]);

export function isPermanentPushFailure(
  statusCode: number | null | undefined,
): boolean {
  if (
    typeof statusCode !== "number" ||
    !Number.isInteger(statusCode)
  ) {
    return false;
  }

  return PERMANENT_PUSH_FAILURE_STATUSES.has(statusCode);
}

export const MARKETPLACE_LABELS: Record<string, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  SHOPEE: "Shopee",
  MAGAZINE_LUIZA: "Magazine Luiza",
  CASAS_BAHIA: "Casas Bahia",
  KABUM: "KaBuM!",
  TERABYTE: "Terabyte",
  ALIEXPRESS: "AliExpress",
  CARREFOUR: "Carrefour",
};

export function marketplaceLabel(marketplace: string | null | undefined) {
  if (!marketplace) {
    return null;
  }

  return (
    MARKETPLACE_LABELS[marketplace] ??
    marketplace.replaceAll("_", " ")
  );
}
