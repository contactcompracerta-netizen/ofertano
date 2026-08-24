export const LISTING_OCCURRENCE_STORAGE_KEY =
  "ofertano:analytics:listingOccurrence";
export const LISTING_OCCURRENCE_REUSE_MS = 8000;
export const IMPRESSION_VISIBILITY_THRESHOLD = 0.45;
export const PRODUCT_IMPRESSION_DEDUPE_MS = 6 * 60 * 60 * 1000;

export type ListingOccurrence = {
  id: string;
  surface: string;
  scope: string;
  startedAt: number;
};

export type ImpressionVisibilityEntry = {
  isIntersecting: boolean;
  intersectionRatio: number;
};

export function isImpressionVisible(
  entry: ImpressionVisibilityEntry | null | undefined,
): boolean {
  if (!entry?.isIntersecting) {
    return false;
  }

  return entry.intersectionRatio >= IMPRESSION_VISIBILITY_THRESHOLD - 0.001;
}

export function shouldReuseListingOccurrence(
  previous: ListingOccurrence | null | undefined,
  next: { surface: string; scope: string },
  now: number,
): boolean {
  if (!previous) {
    return false;
  }

  return (
    previous.surface === next.surface &&
    previous.scope === next.scope &&
    now - previous.startedAt < LISTING_OCCURRENCE_REUSE_MS
  );
}

export function parseListingOccurrence(
  raw: string | null | undefined,
): ListingOccurrence | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ListingOccurrence>;

    if (
      typeof parsed.id !== "string" ||
      parsed.id.trim().length < 8 ||
      typeof parsed.surface !== "string" ||
      typeof parsed.scope !== "string" ||
      typeof parsed.startedAt !== "number"
    ) {
      return null;
    }

    return {
      id: parsed.id.trim(),
      surface: parsed.surface,
      scope: parsed.scope,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

export function occurrenceIdFromMetadata(
  metadata: { occurrenceId?: unknown } | null | undefined,
): string | null {
  const value = metadata?.occurrenceId;

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : null;
}

export function uniqueMarketplaces(
  values: Array<string | null | undefined> | null | undefined,
  limit = 8,
): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  const unique: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();

    if (!trimmed || unique.includes(trimmed)) {
      continue;
    }

    unique.push(trimmed);

    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

export function buildClientDuplicateKey(event: {
  eventType: string;
  productId?: string | null;
  query?: string | null;
  marketplace?: string | null;
  position?: number | null;
  metadata?: Record<string, unknown> | null;
}): string {
  if (event.eventType === "PRODUCT_IMPRESSION") {
    return [
      "PRODUCT_IMPRESSION",
      occurrenceIdFromMetadata(event.metadata) ?? "",
      event.productId ?? "",
    ].join("|");
  }

  return [
    event.eventType,
    event.productId ?? "",
    event.query ?? "",
    event.marketplace ?? "",
    event.position ?? "",
  ].join("|");
}

export class TimedDedupeIndex {
  private readonly recentKeys = new Map<string, number>();

  shouldSkip(key: string, windowMs: number, now = Date.now()): boolean {
    const previous = this.recentKeys.get(key);

    if (previous && now - previous < windowMs) {
      return true;
    }

    this.recentKeys.set(key, now);

    if (this.recentKeys.size > 200) {
      const cutoff = now - 30 * 60 * 1000;

      for (const [entry, time] of this.recentKeys) {
        if (time < cutoff) {
          this.recentKeys.delete(entry);
        }
      }
    }

    return false;
  }

  reset() {
    this.recentKeys.clear();
  }
}

export function duplicateWindowMs(eventType: string): number {
  switch (eventType) {
    case "MARKETPLACE_CLICK":
      return 2500;
    case "PRODUCT_VIEW":
      return 60_000;
    case "PRODUCT_IMPRESSION":
      return PRODUCT_IMPRESSION_DEDUPE_MS;
    default:
      return 8000;
  }
}

export function decideImpressionTrack(input: {
  alreadySent: boolean;
  visible: boolean;
}): "track" | "skip" {
  if (input.alreadySent || !input.visible) {
    return "skip";
  }

  return "track";
}
