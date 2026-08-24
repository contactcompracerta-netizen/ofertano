import { createHash } from "node:crypto";

export function dedupWindowMs(eventType: string): number {
  switch (eventType) {
    case "PRODUCT_IMPRESSION":
      return 30 * 60 * 1000;
    case "PRODUCT_VIEW":
      return 5 * 60 * 1000;
    case "MARKETPLACE_CLICK":
      return 3 * 1000;
    case "FAVORITE_ADD":
    case "FAVORITE_REMOVE":
      return 2 * 1000;
    case "SEARCH":
    case "SEARCH_RESULT":
    case "ZERO_RESULT":
      return 10 * 1000;
    default:
      return 5 * 1000;
  }
}

export function buildEventHash(input: {
  eventType: string;
  sessionId: string;
  productId: string | null;
  query: string | null;
  marketplace: string | null;
  position: number | null;
  createdAt: Date;
}): string {
  const windowMs = dedupWindowMs(input.eventType);
  const bucket = Math.floor(input.createdAt.getTime() / windowMs);
  const raw = [
    input.eventType,
    input.sessionId,
    input.productId ?? "",
    input.query ?? "",
    input.marketplace ?? "",
    input.position ?? "",
    String(bucket),
  ].join("|");

  return createHash("sha256").update(raw).digest("hex");
}
