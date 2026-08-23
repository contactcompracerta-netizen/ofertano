import type { QueryIntent } from "./types";
import {
  classifyProductClass,
  distinctiveTokensOf,
  extractCapacity,
  extractColor,
  extractIdentityNumbers,
  extractMaterial,
  extractModelTokens,
  extractQuantity,
  inferRole,
  isAccessoryHead,
  tokenize,
} from "./normalizeCandidate";

export function buildQueryIntent(query: string): QueryIntent {
  const rawQuery = query.replace(/\s+/g, " ").trim();
  const tokens = tokenize(rawQuery);
  const role = inferRole(rawQuery);
  const requestedRole =
    tokens.some(isAccessoryHead) || role === "ACCESSORY" || role === "REPLACEMENT_PART"
      ? role === "REPLACEMENT_PART"
        ? "REPLACEMENT_PART"
        : "ACCESSORY"
      : tokens.length > 0
        ? "MAIN"
        : "UNKNOWN";

  const productClass = classifyProductClass(rawQuery);
  const modelTokens = extractModelTokens(tokens);
  const capacity = extractCapacity(tokens);
  const quantity = extractQuantity(tokens);
  const color = extractColor(tokens);
  const material = extractMaterial(tokens);
  const importantAttributes: Record<string, string> = {
    ...(capacity ? { capacity } : {}),
    ...(quantity ? { quantity } : {}),
    ...(color ? { color } : {}),
    ...(material ? { material } : {}),
  };

  return {
    rawQuery,
    normalizedQuery: tokens.join(" "),
    requestedRole,
    productClass,
    brand: null,
    modelTokens,
    variantTokens: [color, material].filter((item): item is string => Boolean(item)),
    importantAttributes,
    normalizedTokens: tokens,
    distinctiveTokens: distinctiveTokensOf(tokens),
    identityNumbers: extractIdentityNumbers(tokens),
  };
}
