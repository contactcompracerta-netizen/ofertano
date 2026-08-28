import type { IdentityAnchor, ProductRole, QueryIntent } from "./types";
import {
  canonicalClassToken,
  candidateCoversConcept,
  classifyProductConcept,
  compareProductConcepts,
  conceptLexicalTokens,
  isAutomotiveConcept,
  isVehicleBrandToken,
  isWeakModifier,
  isGenericDescriptor,
  normalizeConceptText,
  type ConceptCompatibility,
  type ProductConceptId,
} from "./productConcepts";
import {
  detectHostSplit,
  extractCapacity,
  extractColor,
  extractAge,
  extractQueryYear,
  extractIdentityNumbers,
  extractMaterial,
  extractModelTokens,
  extractQuantity,
  extractSize,
  inferRole,
  isStopWord,
  isAttributeWord,
  isAccessoryHead,
  isReplacementHead,
  normalizeMultistoreText,
  tokenize,
  wordsOf,
} from "./normalizeCandidate";
import {
  compactIdentity,
  extractIdentityAnchors,
  hasStrongIdentity,
} from "./identityAnchors";

const KNOWN_BRANDS = new Set([
  "ihome",
  "jbl",
  "samsung",
  "xiaomi",
  "motorola",
  "philips",
  "logitech",
  "sony",
  "lg",
  "dell",
  "lenovo",
  "acer",
  "positivo",
  "multilaser",
  "electrolux",
  "brastemp",
  "consul",
  "mondial",
  "arno",
  "oster",
  "bosch",
  "midea",
  "gree",
  "tramontina",
  "cadence",
  "britania",
  "novatech",
  "marcax",
]);

export type QueryCore = {
  rawQuery: string;
  normalizedQuery: string;
  soldText: string;
  hostText: string | null;
  hostRelation: string | null;
  productClass: ProductConceptId;
  productClassConfidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  productCoreLabels: string[];
  brand: string | null;
  modelTokens: string[];
  identityAnchors: IdentityAnchor[];
  identityNumbers: string[];
  attributes: Record<string, string>;
  compatibilityTokens: string[];
  weakModifiers: string[];
  requestedRole: ProductRole;
  distinctiveTokens: string[];
  distinctiveContext: string[];
  normalizedTokens: string[];
  hasStrongIdentity: boolean;
};

export function splitSoldAndHost(text: string): {
  sold: string;
  host: string | null;
  relation: string | null;
} {
  return detectHostSplit(normalizeMultistoreText(text));
}

export function inferSoldRole(soldText: string, hostText?: string | null): ProductRole {
  const combined = [soldText, hostText].filter(Boolean).join(" ");
  return inferRole(combined);
}

function extractKnownBrand(text: string, productClass: ProductConceptId): string | null {
  const words = wordsOf(text);
  for (const word of words) {
    if (!KNOWN_BRANDS.has(word)) {
      continue;
    }

    if (isAutomotiveConcept(productClass) && isVehicleBrandToken(word)) {
      continue;
    }

    return word;
  }

  return null;
}

export function buildQueryCore(query: string): QueryCore {
  const rawQuery = query.replace(/\s+/g, " ").trim();
  const split = splitSoldAndHost(rawQuery);
  const classified = classifyProductConcept(split.sold || rawQuery);
  const soldTokens = tokenize(split.sold);
  const allTokens = tokenize(rawQuery);
  const brand = extractKnownBrand(rawQuery, classified.id);
  const brandTokens = brand
    ? brand.split(" ").filter((token) => token.length >= 3)
    : [];
  const capacity = extractCapacity(soldTokens);
  const quantity = extractQuantity(soldTokens);
  const color = extractColor(soldTokens);
  const age = extractAge(tokenize(rawQuery));
  const year = extractQueryYear(rawQuery);
  const material = extractMaterial(soldTokens);
  const size = extractSize(soldTokens);
  const modelTokens = extractModelTokens(soldTokens);
  const identityAnchors = extractIdentityAnchors(rawQuery).filter((anchor) => {
    if (!split.host) {
      return true;
    }

    const inSold = compactIdentity(split.sold).includes(anchor.value);
    const inHost = compactIdentity(split.host).includes(anchor.value);
    return inSold || !inHost;
  });
  const identityNumbers = extractIdentityNumbers(soldTokens).filter(
    (number) => !/^(19|20)\d{2}$/.test(number),
  );
  const weakModifiers = wordsOf(rawQuery).filter(isWeakModifier);
  const compatibilityTokens = split.host
    ? tokenize(split.host).filter((token) => !isWeakModifier(token))
    : [];
  const productCoreLabels = [
    classified.matchedPhrase,
    canonicalClassToken(classified.id),
  ].filter((item): item is string => Boolean(item && item.trim()));
  const absorbedCoreTokens = new Set([
    ...productCoreLabels.flatMap((label) =>
      normalizeConceptText(label)
        .split(" ")
        .filter((token) => token.length > 0 && !isWeakModifier(token)),
    ),
    ...conceptLexicalTokens(classified.id),
  ]);

  const distinctiveTokens = Array.from(
    new Set(
      [
        ...brandTokens,
        ...soldTokens.filter((token) => {
          if (isWeakModifier(token) || isStopWord(token) || token.length < 3) {
            return false;
          }

          if (/^\d+$/.test(token) || /^(19|20)\d{2}$/.test(token)) {
            return false;
          }

          if (absorbedCoreTokens.has(token)) {
            return false;
          }

          return true;
        }),
      ],
    ),
  );
  const distinctiveContext = distinctiveTokens.filter((token) => {
    if (isGenericDescriptor(token) || isAttributeWord(token) || isAccessoryHead(token) || isReplacementHead(token)) {
      return false;
    }

    if (brandTokens.includes(token)) {
      return false;
    }

    if (modelTokens.includes(token)) {
      return false;
    }

    if (Object.values({
      ...(capacity ? { capacity } : {}),
      ...(quantity ? { quantity } : {}),
      ...(color ? { color } : {}),
      ...(material ? { material } : {}),
      ...(size ? { size } : {}),
      ...(age ? { age } : {}),
    }).some((value) => value === token || value.includes(token))) {
      return false;
    }

    return true;
  });

  return {
    rawQuery,
    normalizedQuery: allTokens.join(" "),
    soldText: split.sold,
    hostText: split.host,
    hostRelation: split.relation,
    productClass: classified.id,
    productClassConfidence: classified.confidence,
    productCoreLabels: Array.from(new Set(productCoreLabels)),
    brand,
    modelTokens,
    identityAnchors,
    identityNumbers,
    attributes: {
      ...(capacity ? { capacity } : {}),
      ...(quantity ? { quantity } : {}),
      ...(color ? { color } : {}),
      ...(material ? { material } : {}),
      ...(size ? { size } : {}),
      ...(age ? { age } : {}),
      ...(year ? { year } : {}),
    },
    compatibilityTokens,
    weakModifiers,
    requestedRole: inferSoldRole(split.sold, split.host),
    distinctiveTokens,
    distinctiveContext,
    normalizedTokens: allTokens,
    hasStrongIdentity: hasStrongIdentity(identityAnchors),
  };
}

export function queryIntentFromCore(core: QueryCore): QueryIntent {
  return {
    rawQuery: core.rawQuery,
    normalizedQuery: core.normalizedQuery,
    requestedRole: core.requestedRole,
    productClass: core.productClass,
    brand: core.brand,
    modelTokens: core.modelTokens,
    variantTokens: [core.attributes.color, core.attributes.material].filter(
      (item): item is string => Boolean(item),
    ),
    importantAttributes: core.attributes,
    normalizedTokens: core.normalizedTokens,
    distinctiveTokens: core.distinctiveTokens,
    distinctiveContext: core.distinctiveContext,
    identityNumbers: core.identityNumbers,
    identityAnchors: core.identityAnchors,
    hasStrongIdentity: core.hasStrongIdentity,
    productCore: core.productCoreLabels,
    compatibilityTarget: core.hostText,
    soldText: core.soldText,
    hostText: core.hostText,
    productClassConfidence: core.productClassConfidence,
    weakModifiers: core.weakModifiers,
  };
}

export function productCoreCoverage(
  core: QueryCore,
  candidateText: string,
): ConceptCompatibility {
  if (core.productClass === "UNKNOWN" || core.productClassConfidence === "NONE") {
    return "UNKNOWN";
  }

  if (candidateCoversConcept(core.productClass, candidateText)) {
    return "MATCH";
  }

  const candidateClass = classifyProductConcept(candidateText).id;
  return compareProductConcepts(core.productClass, candidateClass) === "CONFLICT"
    ? "CONFLICT"
    : "UNKNOWN";
}

function isAccessoryLikeRole(role: ProductRole): boolean {
  return role === "ACCESSORY" || role === "REPLACEMENT_PART";
}

export function roleCompatibility(
  queryRole: ProductRole,
  candidateRole: ProductRole,
  hostCompatibleWithQuery = false,
): ConceptCompatibility {
  const queryAccessory = isAccessoryLikeRole(queryRole);
  const candidateAccessory = isAccessoryLikeRole(candidateRole);

  if (queryAccessory) {
    if (candidateAccessory) {
      return "MATCH";
    }

    if (candidateRole === "MAIN") {
      return "CONFLICT";
    }

    return "UNKNOWN";
  }

  if (candidateRole === "MAIN" || candidateRole === "UNKNOWN") {
    return "MATCH";
  }

  if (candidateAccessory) {
    return hostCompatibleWithQuery ? "MATCH" : "CONFLICT";
  }

  return "UNKNOWN";
}
