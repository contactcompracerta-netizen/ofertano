import type {
  NormalizedCandidate,
  ProductFingerprint,
  QueryIntent,
  QueryRelevanceEvidence,
  RankTier,
  RelevanceEvidenceState,
  ScoredCandidate,
} from "./types";
import { buildFingerprint } from "./fingerprint";
import {
  detectHostSplit,
  extractAge,
  extractVoltage,
  extractYearCoverage,
  normalizeMultistoreText,
  tokenize,
} from "./normalizeCandidate";
import { alphanumericCodeOccurs, candidateSatisfiesIdentityAnchor } from "./identityAnchors";
import {
  buildQueryCore,
  productCoreCoverage,
  roleCompatibility,
  type QueryCore,
} from "./queryCore";
import {
  candidateCoversConcept,
  classifyProductConcept,
  compareProductConcepts,
  conceptFirstContentIndex,
  isVehicleBrandToken,
  isWeakModifier,
  lexicalTokenAppears,
} from "./productConcepts";
import { interpretMarketplaceCategory } from "./marketplaceCategory";
import { assignRankTier } from "./rank";

function tokenWeight(token: string, intent: QueryIntent): number {
  if (isWeakModifier(token)) {
    return 0.15;
  }

  if (intent.modelTokens.includes(token) || intent.identityNumbers.includes(token)) {
    return 6;
  }

  if (intent.identityAnchors.some((anchor) => anchor.value.includes(token))) {
    return 6;
  }

  if (intent.productCore.some((label) => label.split(" ").includes(token))) {
    return 5;
  }

  if (intent.distinctiveTokens.includes(token)) {
    return 4;
  }

  if (intent.productClass !== "UNKNOWN" && token === intent.productClass) {
    return 1.2;
  }

  return 2;
}

function conservativeTypoMatch(token: string, candidateTokens: Set<string>): boolean {
  if (!/^[a-z]+$/.test(token) || token.length < 5) {
    return false;
  }

  for (const candidate of candidateTokens) {
    if (!/^[a-z]+$/.test(candidate) || candidate.length < 5) {
      continue;
    }

    if (token[0] !== candidate[0]) {
      continue;
    }

    if (Math.abs(candidate.length - token.length) !== 1) {
      continue;
    }

    if (levenshteinAtMostOne(token, candidate)) {
      return true;
    }
  }

  return false;
}

function levenshteinAtMostOne(first: string, second: string): boolean {
  if (first === second) {
    return true;
  }

  if (Math.abs(first.length - second.length) > 1) {
    return false;
  }

  let seen = false;
  let left = 0;
  let right = 0;
  while (left < first.length && right < second.length) {
    if (first[left] === second[right]) {
      left += 1;
      right += 1;
      continue;
    }

    if (seen) {
      return false;
    }

    seen = true;
    if (first.length > second.length) {
      left += 1;
    } else if (second.length > first.length) {
      right += 1;
    } else {
      left += 1;
      right += 1;
    }
  }

  return true;
}

function candidateHasToken(token: string, tokens: Set<string>, text: string): boolean {
  if (!token) {
    return false;
  }

  if (tokens.has(token)) {
    return true;
  }

  if (lexicalTokenAppears(text, token)) {
    return true;
  }

  if (
    token.endsWith("s") &&
    token.length >= 5 &&
    candidateHasToken(token.slice(0, -1), tokens, text)
  ) {
    return true;
  }

  if (conservativeTypoMatch(token, tokens)) {
    return true;
  }

  /*
   * Codigos de modelo/identidade podem aparecer com separador de
   * apresentacao (520bt vs 520 bt). Tokens lexicais alfabetizados
   * nunca usam substring — isso aceitaria terno em interno.
   * Compacto colado com includes aceitaria 520BT2 e A550.
   */
  if (!/\d/.test(token)) {
    return false;
  }

  return alphanumericCodeOccurs(text, token);
}

function isAccessoryLikeRole(role: string | null | undefined): boolean {
  return role === "ACCESSORY" || role === "REPLACEMENT_PART";
}

function queryBindingContext(intent: QueryIntent): string[] {
  const identity = new Set([
    ...intent.modelTokens.map((item) => item.replace(/\s+/g, "")),
    ...intent.identityNumbers,
    ...intent.identityAnchors.map((anchor) => anchor.value),
  ]);

  return intent.distinctiveTokens.filter((token) => {
    const compact = token.replace(/\s+/g, "");
    if (identity.has(token) || identity.has(compact)) {
      return false;
    }

    if (/^(?=.*[a-z])(?=.*\d)[a-z0-9]+$/.test(compact)) {
      return false;
    }

    return token.length >= 3;
  });
}

function hostCompatibleWithQuery(
  intent: QueryIntent,
  core: QueryCore,
  fingerprint: ProductFingerprint,
): boolean {
  const host = fingerprint.hostItem.value;
  if (!host) {
    return false;
  }

  const hostTokens = new Set(tokenize(host));
  if (
    core.productClass !== "UNKNOWN" &&
    core.productClassConfidence !== "NONE"
  ) {
    if (!candidateCoversConcept(core.productClass, host)) {
      return false;
    }

    if (conceptFirstContentIndex(host, core.productClass) !== 0) {
      return false;
    }
  }

  if (intent.modelTokens.length > 0) {
    const modelHits = intent.modelTokens.filter((token) =>
      candidateHasToken(token, hostTokens, host),
    );
    if (modelHits.length === 0) {
      return false;
    }
  }

  const binding = queryBindingContext(intent);
  if (
    (core.productClass === "UNKNOWN" || core.productClassConfidence === "NONE") &&
    binding.length > 0 &&
    !binding.some((token) => candidateHasToken(token, hostTokens, host))
  ) {
    return false;
  }

  if (intent.identityAnchors.length > 0 && intent.modelTokens.length === 0) {
    const hostHits = intent.identityAnchors.filter((anchor) =>
      alphanumericCodeOccurs(host, anchor.value, "alnum"),
    );
    if (hostHits.length === 0) {
      return false;
    }
  }

  return true;
}

function emptyEvidence(
  extras: Partial<QueryRelevanceEvidence> = {},
): QueryRelevanceEvidence {
  return {
    accepted: false,
    productClassCompatibility: "UNKNOWN",
    productCoreCoverage: "UNKNOWN",
    brandCompatibility: "UNKNOWN",
    strongIdentityCompatibility: "UNKNOWN",
    attributeMatches: [],
    attributeMissing: [],
    attributeConflicts: [],
    compatibilityMatches: [],
    compatibilityConflicts: [],
    distinctiveTermsMatched: [],
    distinctiveTermsMissing: [],
    weakTokenContribution: 0,
    roleCompatibility: "UNKNOWN",
    ...extras,
  };
}

export function scoreQueryRelevance(
  intent: QueryIntent,
  candidate: NormalizedCandidate,
  queryCore?: QueryCore,
): ScoredCandidate {
  const fingerprint = buildFingerprint(candidate);
  const candidateTokens = new Set(candidate.tokens);
  const candidateText = candidate.rawText;
  const core = queryCore ?? buildQueryCore(intent.rawQuery);
  const soldText =
    detectHostSplit(candidate.normalizedText).sold || candidate.rawText;
  const candidateAccessory = isAccessoryLikeRole(fingerprint.role.value);
  const queryWantsMain =
    intent.requestedRole === "MAIN" || intent.requestedRole === "UNKNOWN";
  const hostOk =
    candidateAccessory && queryWantsMain
      ? hostCompatibleWithQuery(intent, core, fingerprint)
      : false;
  const classText =
    candidateAccessory && queryWantsMain && fingerprint.hostItem.value
      ? fingerprint.hostItem.value
      : soldText;
  const candidateClass = classifyProductConcept(classText);
  let classCompatibility = compareProductConcepts(
    core.productClass,
    candidateClass.id,
  );
  const coreText = classText;
  const coreCoverage = productCoreCoverage(core, coreText);
  const coreCoverageState: RelevanceEvidenceState =
    coreCoverage === "MATCH" || coreCoverage === "CONFLICT"
      ? coreCoverage
      : core.productClass !== "UNKNOWN" && core.productClassConfidence !== "NONE"
        ? "MISSING"
        : "UNKNOWN";
  const roleState = roleCompatibility(
    intent.requestedRole,
    fingerprint.role.value ?? "UNKNOWN",
    hostOk,
  );

  const matchedTerms = intent.normalizedTokens.filter((token) =>
    candidateHasToken(token, candidateTokens, candidateText),
  );
  const missingDistinctive = intent.distinctiveTokens.filter(
    (token) => !candidateHasToken(token, candidateTokens, candidateText),
  );
  const matchedDistinctive = intent.distinctiveTokens.filter(
    (token) => candidateHasToken(token, candidateTokens, candidateText),
  );
  const extraTerms = candidate.tokens.filter((token) => {
    if (intent.normalizedTokens.includes(token)) {
      return false;
    }

    return (
      fingerprint.distinctiveTokens.includes(token) ||
      Boolean(fingerprint.productClass.value && token === fingerprint.productClass.value)
    );
  });

  const queryWeight = intent.normalizedTokens.reduce(
    (total, token) => total + tokenWeight(token, intent),
    0,
  );
  const matchedWeight = matchedTerms.reduce(
    (total, token) => total + tokenWeight(token, intent),
    0,
  );
  const extraWeight = extraTerms.reduce(
    (total, token) => total + (fingerprint.distinctiveTokens.includes(token) ? 3 : 1.5),
    0,
  );
  const queryCoverage = queryWeight === 0 ? 0.5 : matchedWeight / queryWeight;
  const twoSided =
    queryWeight + extraWeight === 0
      ? 0
      : matchedWeight / (queryWeight + extraWeight);
  const weakTokenContribution = matchedTerms.filter(isWeakModifier).length;

  const hardConflicts: string[] = [];
  const attributeMatches: string[] = [];
  const attributeMissing: string[] = [];
  const attributeConflicts: string[] = [];
  const compatibilityMatches: string[] = [];
  const compatibilityConflicts: string[] = [];

  if (classCompatibility === "CONFLICT") {
    hardConflicts.push(
      `productClass:${intent.productClass}!=${candidateClass.id}`,
    );
  }

  const category = interpretMarketplaceCategory(candidate.raw.category);
  if (
    category.kind === "TEXT" &&
    category.conceptId !== "UNKNOWN" &&
    core.productClass !== "UNKNOWN" &&
    core.productClassConfidence !== "NONE"
  ) {
    const categoryCompatibility = compareProductConcepts(
      core.productClass,
      category.conceptId,
    );
    if (categoryCompatibility === "CONFLICT") {
      hardConflicts.push(`category:${core.productClass}!=${category.conceptId}`);
    } else if (
      categoryCompatibility === "MATCH" &&
      classCompatibility === "UNKNOWN"
    ) {
      classCompatibility = "MATCH";
    }
  }

  if (
    !candidateAccessory &&
    core.productClass !== "UNKNOWN" &&
    coreCoverage !== "MATCH"
  ) {
    hardConflicts.push(`productCore:${core.productClass}!=ausente`);
  }

  if (candidateAccessory && queryWantsMain && !hostOk) {
    hardConflicts.push(
      `host:${core.soldText || intent.rawQuery}!=ausente`,
    );
  }

  if (roleState === "CONFLICT") {
    hardConflicts.push(`role:${intent.requestedRole}!=${fingerprint.role.value}`);
  }

  if (
    intent.brand &&
    fingerprint.brand.value &&
    fingerprint.brand.confidence === "HIGH"
  ) {
    const queryBrand = intent.brand;
    const candidateBrand = fingerprint.brand.value;
    const sameBrand =
      queryBrand === candidateBrand ||
      queryBrand.split(/\s+/).includes(candidateBrand) ||
      candidateBrand.split(/\s+/).includes(queryBrand);
    if (!sameBrand) {
      hardConflicts.push(`brand:${queryBrand}!=${candidateBrand}`);
    }
  }

  const candidateModels = [
    fingerprint.model.value,
    ...(fingerprint.variantCodes.value ?? []),
  ].filter((item): item is string => Boolean(item));
  const missingModels = intent.modelTokens.filter(
    (token) => !candidateHasToken(token, candidateTokens, candidateText),
  );
  const queryCompact = normalizeMultistoreText(intent.rawQuery).replace(/\s+/g, "");
  const requestedModelCodes = intent.modelTokens.filter((token) =>
    queryCompact.includes(token.replace(/\s+/g, "")),
  );
  const missingRequestedModels = requestedModelCodes.filter(
    (token) => !candidateHasToken(token, candidateTokens, candidateText),
  );
  const modelAligned =
    intent.modelTokens.length === 0 ||
    candidateModels.length === 0 ||
    intent.modelTokens.some((token) =>
      candidateModels.some(
        (model) =>
          model === token ||
          alphanumericCodeOccurs(model, token) ||
          alphanumericCodeOccurs(token, model),
      ),
    ) ||
    (
      intent.identityNumbers.length > 0 &&
      fingerprint.identityNumbers.some((number) => intent.identityNumbers.includes(number))
    );

  if (intent.modelTokens.length > 0 && candidateModels.length > 0 && !modelAligned) {
    hardConflicts.push(`model:${intent.modelTokens.join(",")}!=${fingerprint.model.value}`);
  }

  if (requestedModelCodes.length > 0 && missingRequestedModels.length > 0) {
    hardConflicts.push(`model:${missingRequestedModels.join(",")}!=ausente`);
  }

  if (
    intent.identityNumbers.length > 0 &&
    fingerprint.identityNumbers.length > 0 &&
    intent.identityNumbers.every((number) => !fingerprint.identityNumbers.includes(number))
  ) {
    hardConflicts.push(
      `identityNumber:${intent.identityNumbers.join(",")}!=${fingerprint.identityNumbers.join(",")}`,
    );
  }

  const missingIdentityNumbers = intent.identityNumbers.filter(
    (number) => !candidateHasToken(number, candidateTokens, candidateText),
  );
  if (intent.identityNumbers.length > 0 && missingIdentityNumbers.length > 0) {
    const uncovered = missingIdentityNumbers.filter(
      (number) =>
        !intent.identityAnchors.some((anchor) => anchor.value.includes(number)),
    );
    if (uncovered.length > 0) {
      hardConflicts.push(`identityNumber:${uncovered.join(",")}!=ausente`);
    }
  }

  if (
    intent.importantAttributes.capacity &&
    fingerprint.capacity.value &&
    intent.importantAttributes.capacity !== fingerprint.capacity.value
  ) {
    attributeConflicts.push(
      `capacity:${intent.importantAttributes.capacity}!=${fingerprint.capacity.value}`,
    );
    hardConflicts.push(
      `capacity:${intent.importantAttributes.capacity}!=${fingerprint.capacity.value}`,
    );
  } else if (intent.importantAttributes.capacity && fingerprint.capacity.value) {
    attributeMatches.push("capacity");
  } else if (intent.importantAttributes.capacity) {
    attributeMissing.push("capacity");
  }

  if (
    intent.importantAttributes.quantity &&
    fingerprint.quantity.value &&
    intent.importantAttributes.quantity !== fingerprint.quantity.value
  ) {
    attributeConflicts.push(
      `quantity:${intent.importantAttributes.quantity}!=${fingerprint.quantity.value}`,
    );
    hardConflicts.push(
      `quantity:${intent.importantAttributes.quantity}!=${fingerprint.quantity.value}`,
    );
  } else if (intent.importantAttributes.quantity && fingerprint.quantity.value) {
    attributeMatches.push("quantity");
  } else if (intent.importantAttributes.quantity) {
    attributeMissing.push("quantity");
  }

  if (
    intent.importantAttributes.color &&
    fingerprint.color.value &&
    intent.importantAttributes.color !== fingerprint.color.value
  ) {
    attributeConflicts.push(
      `color:${intent.importantAttributes.color}!=${fingerprint.color.value}`,
    );
    hardConflicts.push(
      `color:${intent.importantAttributes.color}!=${fingerprint.color.value}`,
    );
  } else if (intent.importantAttributes.color && fingerprint.color.value) {
    attributeMatches.push("color");
  } else if (intent.importantAttributes.color) {
    attributeMissing.push("color");
  }

  if (
    intent.importantAttributes.size &&
    fingerprint.size.value &&
    intent.importantAttributes.size !== fingerprint.size.value
  ) {
    attributeConflicts.push(
      `size:${intent.importantAttributes.size}!=${fingerprint.size.value}`,
    );
    hardConflicts.push(
      `size:${intent.importantAttributes.size}!=${fingerprint.size.value}`,
    );
  } else if (intent.importantAttributes.size && fingerprint.size.value) {
    attributeMatches.push("size");
  } else if (intent.importantAttributes.size) {
    attributeMissing.push("size");
  }

  const queryVoltage = intent.importantAttributes.voltage;
  const candidateVoltage =
    fingerprint.importantAttributes.voltage ??
    extractVoltage(candidateText);
  if (queryVoltage && candidateVoltage && queryVoltage !== candidateVoltage) {
    if (queryVoltage !== "bivolt" && candidateVoltage !== "bivolt") {
      attributeConflicts.push(
        `voltage:${queryVoltage}!=${candidateVoltage}`,
      );
      hardConflicts.push(`voltage:${queryVoltage}!=${candidateVoltage}`);
    }
  } else if (queryVoltage && candidateVoltage) {
    attributeMatches.push("voltage");
  } else if (queryVoltage) {
    attributeMissing.push("voltage");
  }

  const queryAge = intent.importantAttributes.age;
  const candidateAge = extractAge(candidate.tokens);
  if (queryAge && candidateAge && queryAge !== candidateAge) {
    attributeConflicts.push(`age:${queryAge}!=${candidateAge}`);
    hardConflicts.push(`age:${queryAge}!=${candidateAge}`);
  } else if (queryAge && candidateAge) {
    attributeMatches.push("age");
  } else if (queryAge) {
    attributeMissing.push("age");
  }

  const queryYear = intent.importantAttributes.year;
  if (queryYear) {
    const year = Number(queryYear);
    const coverage = extractYearCoverage(candidateText);
    if (coverage.explicit && Number.isFinite(year) && !coverage.contains(year)) {
      attributeConflicts.push(`year:${queryYear}!=${coverage.summary}`);
      hardConflicts.push(`year:${queryYear}!=${coverage.summary}`);
    } else if (coverage.explicit) {
      attributeMatches.push("year");
    }
  }

  if (intent.brand) {
    const brandTokens = intent.brand.split(" ").filter((token) => token.length >= 3);
    const missingBrand = brandTokens.filter(
      (token) => !candidateHasToken(token, candidateTokens, candidateText),
    );
    if (
      brandTokens.length > 0 &&
      (missingBrand.length === brandTokens.length ||
        (brandTokens.length > 1 && missingBrand.length > 0))
    ) {
      hardConflicts.push(`brand:${intent.brand}!=ausente`);
    }
  }

  let strongIdentity: RelevanceEvidenceState = "UNKNOWN";
  if (intent.hasStrongIdentity) {
    const missingAnchors = intent.identityAnchors
      .filter((anchor) => anchor.required)
      .filter(
        (anchor) =>
          !candidateSatisfiesIdentityAnchor(
            anchor,
            intent.identityAnchors,
            candidateText,
            fingerprint,
          ),
      );
    if (missingAnchors.length > 0) {
      strongIdentity = "CONFLICT";
      hardConflicts.push(
        `identityAnchor:${missingAnchors.map((anchor) => anchor.value).join(",")}!=ausente`,
      );
    } else {
      strongIdentity = "MATCH";
    }
  }

  if (core.compatibilityTokens.length > 0) {
    const hostText = fingerprint.hostItem.value || candidateText;
    for (const token of core.compatibilityTokens) {
      if (candidateHasToken(token, candidateTokens, hostText)) {
        compatibilityMatches.push(token);
      }
    }

    const distinctiveHost = core.compatibilityTokens.filter(
      (token) =>
        token.length >= 4 &&
        !/^\d+(?:\.\d+)?$/.test(token) &&
        !isWeakModifier(token),
    );
    const hostSpecific = distinctiveHost.filter((token) => !isVehicleBrandToken(token));
    const requiredHost = hostSpecific.length > 0 ? hostSpecific : distinctiveHost;
    const hostHits = requiredHost.filter((token) =>
      compatibilityMatches.includes(token),
    );
    if (requiredHost.length > 0 && hostHits.length === 0) {
      hardConflicts.push(
        `compatibility:${requiredHost.join(",")}!=ausente`,
      );
    }
  }

  const modelPresent =
    intent.modelTokens.length > 0 && missingModels.length === 0;
  const binding = queryBindingContext(intent);
  const bindingPresent = binding.some((token) =>
    candidateHasToken(token, candidateTokens, candidateText),
  );
  const queryClassUnknown =
    core.productClass === "UNKNOWN" || core.productClassConfidence === "NONE";
  if (
    queryClassUnknown &&
    binding.length > 0 &&
    (intent.modelTokens.length > 0 || intent.hasStrongIdentity) &&
    !bindingPresent
  ) {
    hardConflicts.push(`identityContext:${binding.join(",")}!=ausente`);
  }

  const brandCompatibility: RelevanceEvidenceState = intent.brand
    ? hardConflicts.some((item) => item.startsWith("brand:"))
      ? "CONFLICT"
      : candidateHasToken(intent.brand, candidateTokens, candidateText)
        ? "MATCH"
        : "MISSING"
    : "UNKNOWN";

  const evidence = emptyEvidence({
    productClassCompatibility: classCompatibility,
    productCoreCoverage: coreCoverageState,
    brandCompatibility,
    strongIdentityCompatibility: strongIdentity,
    attributeMatches,
    attributeMissing,
    attributeConflicts,
    compatibilityMatches,
    compatibilityConflicts,
    distinctiveTermsMatched: matchedDistinctive,
    distinctiveTermsMissing: missingDistinctive,
    weakTokenContribution,
    roleCompatibility: roleState,
  });

  const modelPresentEnough =
    modelPresent && (!queryClassUnknown || binding.length === 0 || bindingPresent);
  const missingContext = (intent.distinctiveContext ?? []).filter(
    (token) => !candidateHasToken(token, candidateTokens, candidateText),
  );
  const competingCandidateContext = fingerprint.hostItem.value;
  const missingContextIsMaterial =
    missingContext.length * 2 >=
    Math.max(1, (intent.distinctiveContext ?? []).length);
  if (
    missingContext.length > 0 &&
    !modelPresentEnough &&
    (competingCandidateContext || missingContextIsMaterial)
  ) {
    hardConflicts.push(
      `distinctiveContext:${missingContext.join(",")}!=${
        competingCandidateContext ?? "ausente"
      }`,
    );
  }
  const contextPenalty =
    missingContext.length > 0 &&
    !modelPresentEnough &&
    !competingCandidateContext &&
    !missingContextIsMaterial
      ? Math.min(0.18, missingContext.length * 0.05)
      : 0;
  const discriminativeMissing =
    attributeMissing.includes("capacity") ||
    attributeMissing.includes("quantity") ||
    attributeMissing.includes("size") ||
    attributeMissing.includes("color") ||
    attributeMissing.includes("age");
  let queryRelevance = Math.min(1, twoSided);
  if (contextPenalty > 0) {
    queryRelevance = Math.max(0, queryRelevance - contextPenalty);
  }
  let status: ScoredCandidate["status"] = "RELEVANT";
  let reason = "Candidato representa o produto pedido.";

  if (hardConflicts.length > 0) {
    status = "REJECTED";
    reason = `Conflito comprovado: ${hardConflicts.join(", ")}.`;
  } else if (
    !modelPresentEnough &&
    intent.distinctiveTokens.length > 0 &&
    missingDistinctive.length === intent.distinctiveTokens.length &&
    coreCoverage !== "MATCH"
  ) {
    status = "REJECTED";
    reason = `Nenhum termo distintivo da consulta aparece no candidato: ${missingDistinctive.join(", ")}.`;
  } else if (
    queryCoverage < 0.18 &&
    twoSided < 0.12 &&
    !modelPresentEnough &&
    coreCoverage !== "MATCH"
  ) {
    status = "REJECTED";
    reason = "Cobertura lexical insuficiente para a consulta.";
  }

  if (status === "RELEVANT" && discriminativeMissing) {
    queryRelevance *= 0.82;
  }

  const classOk =
    classCompatibility === "MATCH" ||
    core.productClass === "UNKNOWN" ||
    core.productClassConfidence === "NONE";
  const coreOk =
    coreCoverage === "MATCH" ||
    core.productClass === "UNKNOWN" ||
    core.productClassConfidence === "NONE" ||
    (candidateAccessory && hostOk);
  const rankTier: RankTier = assignRankTier({
    status,
    role: fingerprint.role.value,
    strongIdentity:
      (intent.hasStrongIdentity && strongIdentity === "MATCH") ||
      (Boolean(intent.modelTokens.length) && modelPresentEnough),
    classOk,
    coreOk,
    discriminativeMissing,
  });

  evidence.accepted = status === "RELEVANT";

  return {
    id: candidate.id,
    normalized: candidate,
    fingerprint,
    queryRelevance,
    matchedTerms,
    missingTerms: missingDistinctive,
    extraTerms,
    hardConflicts,
    status,
    reason,
    evidence,
    rankTier,
  };
}
