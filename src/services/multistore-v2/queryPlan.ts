import { buildQueryCore, queryIntentFromCore, type QueryCore } from "./queryCore";
import {
  canonicalClassToken,
  conceptLexicalTokens,
  conceptSynonymPhrases,
  isVehicleBrandToken,
  isWeakModifier,
  matchesConceptLexeme,
  normalizeConceptText,
} from "./productConcepts";
import { compactIdentity, humanizeAnchor } from "./identityAnchors";
import { normalizeMultistoreText } from "./normalizeCandidate";
import { sanitizeCommerceQuery } from "./querySanitizer";
import {
  extractSanitizedIdentity,
  type SanitizedIdentity,
} from "./sanitizedIdentity";
import { buildCommerceSearchPlan } from "./searchPlan";

const MAX_COMPACT_DESCRIPTOR_TOKENS = 6;

function uniqueQueries(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (value ?? "").replace(/\s+/g, " ").trim())
        .filter((value) => value.length >= 2),
    ),
  );
}

function productCoreSignals(core: QueryCore): string[] {
  return uniqueQueries([
    ...core.productCoreLabels.map((label) => normalizeConceptText(label)),
    canonicalClassToken(core.productClass),
    ...conceptSynonymPhrases(core.productClass)
      .map((item) => normalizeConceptText(item))
      .filter((item) => item.split(" ").length >= 2),
  ]);
}

function variantHasProductCore(variant: string, core: QueryCore): boolean {
  const normalized = normalizeConceptText(variant);
  if (!normalized) {
    return false;
  }

  return productCoreSignals(core).some(
    (signal) => signal.length >= 3 && normalized.includes(signal),
  );
}

function variantHasStrongSoldIdentity(variant: string, core: QueryCore): boolean {
  const compactVariant = compactIdentity(variant);
  const compactSold = compactIdentity(core.soldText);
  return core.identityAnchors.some((anchor) => {
    if (anchor.value.length < 5 || !compactSold.includes(anchor.value)) {
      return false;
    }

    return (
      compactVariant.includes(anchor.value) ||
      normalizeConceptText(variant).includes(normalizeConceptText(humanizeAnchor(anchor.value)))
    );
  });
}

function isIsolatedAttributeVariant(variant: string, core: QueryCore): boolean {
  const tokens = normalizeConceptText(variant)
    .split(" ")
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => {
    if (isWeakModifier(token) || isVehicleBrandToken(token)) {
      return true;
    }

    if (core.brand && token === core.brand) {
      return true;
    }

    if (/^(19|20)\d{2}$/.test(token)) {
      return true;
    }

    if (/^\d+(?:\.\d+)?$/.test(token)) {
      return true;
    }

    if (
      token === core.attributes.color ||
      token === core.attributes.material ||
      token === core.attributes.size
    ) {
      return true;
    }

    return false;
  });
}

function keepPlanVariant(variant: string, core: QueryCore, original: string): boolean {
  if (variant.replace(/\s+/g, " ").trim() === original) {
    return true;
  }

  if (core.productClass === "apparel" && /(^|\s)apparel(\s|$)/.test(normalizeConceptText(variant))) {
    return false;
  }

  if (variantHasProductCore(variant, core)) {
    return true;
  }

  if (variantHasStrongSoldIdentity(variant, core)) {
    return true;
  }

  if (core.productClass === "UNKNOWN" || core.productClassConfidence === "NONE") {
    return !isIsolatedAttributeVariant(variant, core) || variant.split(/\s+/).length >= 3;
  }

  return false;
}

function normalizedCompactTokens(value: string | null | undefined): string[] {
  return normalizeMultistoreText(value ?? "")
    .split(" ")
    .filter(Boolean);
}

function addCompactUnit(
  parts: string[],
  seen: Set<string>,
  value: string | null | undefined,
  atomic: boolean,
): void {
  const tokens = normalizedCompactTokens(value);
  if (tokens.length === 0 || tokens.every((token) => seen.has(token))) {
    return;
  }

  if (atomic) {
    parts.push(tokens.join(" "));
    tokens.forEach((token) => seen.add(token));
    return;
  }

  const fresh = tokens.filter((token) => !seen.has(token));
  if (fresh.length === 0) {
    return;
  }

  parts.push(fresh.join(" "));
  fresh.forEach((token) => seen.add(token));
}

function structuredIdentityUnits(core: QueryCore): string[] {
  return Object.entries(core.attributes)
    .filter(([, value]) => Boolean(value))
    .filter(([key]) => key !== "capacity" && key !== "voltage")
    .map(([key, value]) => {
      if (key === "quantity") {
        return value;
      }

      return `${key} ${value}`;
    });
}

function primaryModelUnit(query: string, modelCode: string | undefined): string | null {
  const codeTokens = normalizedCompactTokens(modelCode);
  if (codeTokens.length === 0) {
    return null;
  }

  const queryTokens = normalizedCompactTokens(query);
  for (let index = 0; index <= queryTokens.length - codeTokens.length; index += 1) {
    const matchesCode = codeTokens.every(
      (token, offset) => queryTokens[index + offset] === token,
    );
    if (!matchesCode) {
      continue;
    }

    const next = queryTokens[index + codeTokens.length];
    if (!next || isWeakModifier(next) || /^\d/.test(next)) {
      return codeTokens.join(" ");
    }

    return [...codeTokens, next].join(" ");
  }

  return codeTokens.join(" ");
}

function compactApparelDescriptorTokens(query: string, core: QueryCore): string[] {
  const apparelTerms = new Set([
    ...conceptLexicalTokens(core.productClass),
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
    "calca",
  ]);
  const apparelNounHeads = new Set([
    "camisa",
    "camiseta",
    "blusa",
    "vestido",
    "calca",
  ]);
  const source = core.soldNucleus || query;
  const sourceTokens = normalizedCompactTokens(source).map((token) => {
    const singular = token.endsWith("s") ? token.slice(0, -1) : token;
    return apparelTerms.has(singular) ? singular : token;
  });
  const hasNounHead = sourceTokens.some((token) => apparelNounHeads.has(token));
  const descriptors: string[] = [];
  const seen = new Set<string>();
  let productHead: string | null = null;

  for (const rawToken of normalizedCompactTokens(source)) {
    const singular = rawToken.endsWith("s") ? rawToken.slice(0, -1) : rawToken;
    const token = apparelTerms.has(singular) ? singular : rawToken;
    const isApparelTerm = apparelTerms.has(token) || Array.from(apparelTerms).some(
      (term) => matchesConceptLexeme(rawToken, term),
    );
    if (!isApparelTerm || isWeakModifier(rawToken) || seen.has(token)) {
      continue;
    }

    const isProductHead = apparelNounHeads.has(token) || (!hasNounHead && token === "polo");
    if (isProductHead) {
      if (productHead && productHead !== token) {
        continue;
      }
      productHead = token;
    }

    seen.add(token);
    descriptors.push(token);
  }

  return descriptors;
}

function compactDescriptorTokens(query: string, core: QueryCore): string[] {
  if (core.productClass === "apparel") {
    return compactApparelDescriptorTokens(query, core);
  }

  const words = normalizeConceptText(query)
    .split(" ")
    .filter((token) => token.length > 0);

  const compactWords: string[] = [];
  const seen = new Set<string>();
  for (const token of words) {
    const normalized = normalizeMultistoreText(token);
    if (!normalized || seen.has(normalized) || isWeakModifier(normalized)) {
      continue;
    }

    if (normalized === "apparel") {
      continue;
    }

    seen.add(normalized);
    compactWords.push(normalized);
  }

  return compactWords;
}

export function buildAliExpressCompactFallbackQuery(
  query: string,
  queryCore: QueryCore,
  identity: Pick<SanitizedIdentity, "strongIdentity">,
): string | null {
  const core = queryCore;
  const words = normalizedCompactTokens(query);

  if (words.length === 0) {
    return null;
  }

  const strong = identity.strongIdentity;
  const parts: string[] = [];
  const seen = new Set<string>();

  // Strong identity is added first and never participates in descriptor truncation.
  addCompactUnit(parts, seen, strong.brand, true);
  const [primaryModelCode, ...remainingModelCodes] = strong.modelCodes;
  addCompactUnit(parts, seen, primaryModelUnit(query, primaryModelCode), true);
  for (const modelCode of remainingModelCodes) {
    addCompactUnit(parts, seen, modelCode, true);
  }
  addCompactUnit(parts, seen, strong.modelName, false);
  const hasNominalStrongIdentity = Boolean(
    strong.brand ||
    strong.modelCodes.length > 0 ||
    strong.modelName ||
    strong.storage ||
    strong.capacity ||
    strong.voltage ||
    strong.bundleQuantity,
  );
  if (core.productClass !== "apparel" || hasNominalStrongIdentity) {
    addCompactUnit(parts, seen, strong.modelLine, false);
  }
  addCompactUnit(parts, seen, strong.storage, true);
  addCompactUnit(parts, seen, strong.capacity, true);
  addCompactUnit(parts, seen, strong.voltage, true);
  if (strong.bundleQuantity) {
    addCompactUnit(parts, seen, `kit ${strong.bundleQuantity}`, true);
  }
  addCompactUnit(parts, seen, strong.condition, true);
  addCompactUnit(parts, seen, core.hostText, false);
  for (const attribute of structuredIdentityUnits(core)) {
    addCompactUnit(parts, seen, attribute, true);
  }

  let descriptorsAdded = 0;
  for (const descriptor of compactDescriptorTokens(query, core)) {
    if (descriptorsAdded >= MAX_COMPACT_DESCRIPTOR_TOKENS) {
      break;
    }

    const before = parts.length;
    addCompactUnit(parts, seen, descriptor, false);
    if (parts.length > before) {
      descriptorsAdded += normalizedCompactTokens(parts.at(-1)).length;
    }
  }

  return parts.join(" ").trim() || null;
}

export function buildSearchPlan(
  query: string,
  queryCore?: QueryCore,
  identity?: ReturnType<typeof extractSanitizedIdentity>,
): string[] {
  if (identity) {
    return buildCommerceSearchPlan(identity).map((variant) => variant.originalText);
  }

  if (!queryCore) {
    return buildCommerceSearchPlan(extractSanitizedIdentity(query)).map(
      (variant) => variant.originalText,
    );
  }

  const sanitized = sanitizeCommerceQuery(query);
  const effectiveQuery = sanitized.sanitizedQuery || query;
  const core = queryCore ?? buildQueryCore(effectiveQuery);
  const original = core.rawQuery;
  const classLabel = canonicalClassToken(core.productClass);
  const attributes = [
    core.attributes.quantity,
    core.attributes.capacity,
    core.attributes.voltage,
    core.attributes.color,
    core.attributes.material,
    core.attributes.size,
  ]
    .filter(Boolean)
    .join(" ");

  const productCore = core.productCoreLabels[0] || classLabel;
  const resolvedProductCore =
    core.productClass === "apparel" && productCore === "apparel"
      ? core.distinctiveTokens.find((token) =>
          /^(camisa|camiseta|polo|manga|blusa|vestido|calca|masculina|masculino)$/.test(
            normalizeConceptText(token),
          ),
        ) || productCore
      : productCore;
  const effectiveProductCore =
    resolvedProductCore === "apparel" ? productCore : resolvedProductCore;
  const coreWithHost = [effectiveProductCore, core.hostText].filter(Boolean).join(" ");
  const coreWithAttributes = [effectiveProductCore, attributes].filter(Boolean).join(" ");
  const brandWithCore = [core.brand, effectiveProductCore].filter(Boolean).join(" ");
  const soldIdentityAnchors = core.identityAnchors.filter((anchor) =>
    compactIdentity(core.soldText).includes(anchor.value),
  );
  const strongIdentityQueries = [
    ...core.identityAnchors
      .filter((anchor) => anchor.value.length >= 5)
      .flatMap((anchor) => [
        [effectiveProductCore, humanizeAnchor(anchor.value)].filter(Boolean).join(" "),
        [core.brand, effectiveProductCore, humanizeAnchor(anchor.value)].filter(Boolean).join(" "),
      ]),
    ...soldIdentityAnchors
      .filter((anchor) => anchor.value.length >= 5)
      .flatMap((anchor) => [humanizeAnchor(anchor.value), anchor.value]),
  ];
  const strongModel = [
    core.brand,
    effectiveProductCore,
    ...core.modelTokens,
    core.attributes.voltage,
  ]
    .filter(Boolean)
    .join(" ");
  const brandModelVoltage = [core.brand, ...core.modelTokens, core.attributes.voltage]
    .filter(Boolean)
    .join(" ");
  const extraPhraseCores = uniqueQueries(
    conceptSynonymPhrases(core.productClass)
      .map((item) => normalizeConceptText(item))
      .filter(
        (item) =>
          item.split(" ").length >= 2 &&
          item !== normalizeConceptText(productCore),
      ),
  ).slice(0, 2);
  const phraseSynonyms = extraPhraseCores.flatMap((synonym) => [
    synonym,
    [synonym, core.hostText].filter(Boolean).join(" "),
    [core.brand, synonym].filter(Boolean).join(" "),
  ]);

  const distinctiveQuery = core.distinctiveTokens.slice(0, 4).join(" ");
  const plan = uniqueQueries([
    original,
    coreWithHost,
    coreWithAttributes,
    brandWithCore,
    strongModel,
    brandModelVoltage,
    effectiveProductCore,
    distinctiveQuery,
    ...phraseSynonyms,
    ...strongIdentityQueries,
  ]);

  return plan.filter((item) => keepPlanVariant(item, core, original));
}

export function buildMarketplaceQueryVariants(query: string): string[] {
  return buildSearchPlan(query).slice(0, 6);
}

export { queryIntentFromCore };
