import { buildQueryCore, queryIntentFromCore, type QueryCore } from "./queryCore";
import {
  canonicalClassToken,
  conceptSynonymPhrases,
  isVehicleBrandToken,
  isWeakModifier,
  normalizeConceptText,
} from "./productConcepts";
import { compactIdentity, humanizeAnchor } from "./identityAnchors";

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

export function buildSearchPlan(query: string): string[] {
  const core = buildQueryCore(query);
  const original = core.rawQuery;
  const classLabel = canonicalClassToken(core.productClass);
  const attributes = [
    core.attributes.quantity,
    core.attributes.capacity,
    core.attributes.color,
    core.attributes.material,
    core.attributes.size,
  ]
    .filter(Boolean)
    .join(" ");

  const productCore = core.productCoreLabels[0] || classLabel;
  const coreWithHost = [productCore, core.hostText].filter(Boolean).join(" ");
  const coreWithAttributes = [productCore, attributes].filter(Boolean).join(" ");
  const brandWithCore = [core.brand, productCore].filter(Boolean).join(" ");
  const soldIdentityAnchors = core.identityAnchors.filter((anchor) =>
    compactIdentity(core.soldText).includes(anchor.value),
  );
  const strongIdentityQueries = [
    ...core.identityAnchors
      .filter((anchor) => anchor.value.length >= 5)
      .flatMap((anchor) => [
        [productCore, humanizeAnchor(anchor.value)].filter(Boolean).join(" "),
        [core.brand, productCore, humanizeAnchor(anchor.value)].filter(Boolean).join(" "),
      ]),
    ...soldIdentityAnchors
      .filter((anchor) => anchor.value.length >= 5)
      .flatMap((anchor) => [humanizeAnchor(anchor.value), anchor.value]),
  ];
  const strongModel = [core.brand, productCore, ...core.modelTokens]
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
    productCore,
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
