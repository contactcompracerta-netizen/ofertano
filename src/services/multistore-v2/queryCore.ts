import type { IdentityAnchor, ProductRole, QueryIntent } from "./types";
import {
  canonicalClassToken,
  candidateCoversConcept,
  classifyProductConcept,
  extractSoldItemNucleus,
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
  extractBundleQuantity,
  extractQuantity,
  extractSize,
  extractStructuredNumericAttributes,
  extractVoltage,
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
import { isApparelDescriptiveToken } from "./productConcepts";

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
  soldNucleus: string;
  soldHeadToken: string | null;
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
  const words = wordsOf(text).map((word) => normalizeMultistoreText(word).toLowerCase());

  for (const word of words) {
    if (productClass === "apparel" && isApparelDescriptiveToken(word)) {
      continue;
    }

    if (!KNOWN_BRANDS.has(word)) {
      continue;
    }

    if (isAutomotiveConcept(productClass) && isVehicleBrandToken(word)) {
      continue;
    }

    return word;
  }

  const genericWords = new Set([
    "sofa",
    "sofá",
    "console",
    "playstation",
    "ps4",
    "ps5",
    "terno",
    "ternos",
    "paleto",
    "paletó",
    "calca",
    "calça",
    "social",
    "conjunto",
    "moto",
    "pressao",
    "pressão",
    "cozinha",
    "panela",
    "panelas",
    "armario",
    "armário",
    "mesa",
    "cabeceira",
    "cadeira",
    "criado",
    "moveis",
    "móveis",
    "jogo",
    "jogos",
    "controles",
    "portas",
    "gavetas",
    "livro",
    "produto",
    "recondicionado",
    "seminovo",
    "refurbished",
    "novo",
    "novas",
    "usado",
    "com",
    "mais",
    "inclui",
    "kit",
    "slim",
    "pro",
    "plus",
    "max",
    "retratil",
    "retrátil",
    "lugares",
    "linho",
    "cru",
    "inox",
    "preto",
    "branco",
    "cinza",
    "azul",
    "verde",
    "amarelo",
    "rosa",
    "bege",
    "madeira",
    "tecido",
    "algodao",
    "algodão",
    "veludo",
    "couro",
    "plastico",
    "plástico",
    "metal",
    "manga",
    "curta",
    "longa",
    "polo",
    "masculina",
    "masculino",
    "feminina",
    "feminino",
    "camisa",
    "camiseta",
    "blusa",
    "vestido",
  ]);

  const materialWords = new Set([
    "linho",
    "cru",
    "inox",
    "preto",
    "branco",
    "cinza",
    "azul",
    "verde",
    "amarelo",
    "rosa",
    "bege",
    "madeira",
    "tecido",
    "algodao",
    "algodão",
    "veludo",
    "couro",
    "plastico",
    "plástico",
    "metal",
  ]);

  const suffixIndex = words.findIndex((token) => materialWords.has(token));
  const modelLikePattern = /^(?=.*[a-z])(?=.*\d)[a-z0-9]+$/;
  const modelTokens = new Set(
    extractModelTokens(tokenize(text)).map((token) => normalizeMultistoreText(token).toLowerCase()),
  );

  const isModelLikeContext = (token: string, prev?: string, next?: string): boolean => {
    if (modelTokens.has(token)) {
      return true;
    }

    if (next && (modelLikePattern.test(next) || /^(19|20)\d{2}$/.test(next))) {
      return true;
    }

    if (prev && (modelLikePattern.test(prev) || /^(19|20)\d{2}$/.test(prev))) {
      return true;
    }

    return false;
  };

  if (suffixIndex >= 0) {
    for (let index = suffixIndex - 1; index >= 0; index--) {
      const token = words[index];
      const next = words[index + 1];
      const prev = words[index - 1];
      if (token.length >= 4 && /[a-z]/.test(token) && !genericWords.has(token)) {
        if (isModelLikeContext(token, prev, next)) {
          continue;
        }
        return token;
      }
    }
  }

  for (let index = words.length - 1; index >= 0; index--) {
    const token = words[index];
    const next = words[index + 1];
    const prev = words[index - 1];
    if (token.length >= 4 && /[a-z]/.test(token) && !genericWords.has(token)) {
      if (isModelLikeContext(token, prev, next)) {
        continue;
      }
      return token;
    }
  }

  return null;
}

export function buildQueryCore(query: string): QueryCore {
  const rawQuery = query.replace(/\s+/g, " ").trim();
  const split = splitSoldAndHost(rawQuery);
  const soldSource = split.sold || rawQuery;
  const nucleus = extractSoldItemNucleus(soldSource);
  const classified = classifyProductConcept(soldSource);
  const soldTokens = tokenize(split.sold);
  const allTokens = tokenize(rawQuery);
  const brandCandidate = extractKnownBrand(rawQuery, classified.id);
  const soldNucleusTokens = new Set(
    wordsOf(nucleus.normalizedText).map((token) => normalizeMultistoreText(token).toLowerCase()),
  );
  const brand =
    brandCandidate &&
    !soldNucleusTokens.has(normalizeMultistoreText(brandCandidate).toLowerCase())
      ? brandCandidate
      : null;
  const brandTokens = brand
    ? brand.split(" ").filter((token) => token.length >= 3)
    : [];
  const capacity = extractCapacity(soldTokens);
  const quantity =
    extractQuantity(soldTokens) ??
    (() => {
      const bundleQuantity = extractBundleQuantity(rawQuery);
      return bundleQuantity ? `${bundleQuantity}unidades` : null;
    })();
  const color = extractColor(soldTokens);
  const age = extractAge(tokenize(rawQuery));
  const year = extractQueryYear(rawQuery);
  const material = extractMaterial(soldTokens);
  const size = extractSize(soldTokens);
  const numericAttributes = extractStructuredNumericAttributes(soldTokens);
  const voltage = extractVoltage(rawQuery);
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

          if (classified.id === "apparel" && isApparelDescriptiveToken(token)) {
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
    soldNucleus: nucleus.normalizedText,
    soldHeadToken: nucleus.headToken,
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
      ...numericAttributes,
      ...(capacity ? { capacity } : {}),
      ...(quantity ? { quantity } : {}),
      ...(color ? { color } : {}),
      ...(material ? { material } : {}),
      ...(size ? { size } : {}),
      ...(age ? { age } : {}),
      ...(year ? { year } : {}),
      ...(voltage ? { voltage } : {}),
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
