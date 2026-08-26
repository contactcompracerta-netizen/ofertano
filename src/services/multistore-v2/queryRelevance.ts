import type {
  NormalizedCandidate,
  QueryIntent,
  QueryRelevanceEvidence,
  RelevanceEvidenceState,
  ScoredCandidate,
} from "./types";
import { buildFingerprint } from "./fingerprint";
import { detectHostSplit, normalizeMultistoreText } from "./normalizeCandidate";
import { candidateExpressesAnchor } from "./identityAnchors";
import { buildQueryCore, productCoreCoverage, roleCompatibility } from "./queryCore";
import {
  classifyProductConcept,
  compareProductConcepts,
  isVehicleBrandToken,
  isWeakModifier,
  lexicalTokenAppears,
} from "./productConcepts";

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

  /*
   * Codigos de modelo/identidade podem aparecer compactos
   * (520bt vs 520 bt). Tokens lexicais alfabetizados nunca
   * usam substring arbitraria — isso aceitaria terno em interno.
   */
  if (!/\d/.test(token)) {
    return false;
  }

  const compactText = normalizeMultistoreText(text).replace(/\s+/g, "");
  const compactToken = normalizeMultistoreText(token).replace(/\s+/g, "");
  return compactToken.length >= 3 && compactText.includes(compactToken);
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
): ScoredCandidate {
  const fingerprint = buildFingerprint(candidate);
  const candidateTokens = new Set(candidate.tokens);
  const candidateText = candidate.normalizedText;
  const core = buildQueryCore(intent.rawQuery);
  const soldText =
    detectHostSplit(candidate.normalizedText).sold || candidate.rawText;
  const candidateClass = classifyProductConcept(soldText);
  const classCompatibility = compareProductConcepts(
    core.productClass,
    candidateClass.id,
  );
  const coreCoverage = productCoreCoverage(core, soldText);
  const coreCoverageState: RelevanceEvidenceState =
    coreCoverage === "MATCH" || coreCoverage === "CONFLICT"
      ? coreCoverage
      : core.productClass !== "UNKNOWN" && core.productClassConfidence !== "NONE"
        ? "MISSING"
        : "UNKNOWN";
  const roleState = roleCompatibility(
    intent.requestedRole,
    fingerprint.role.value ?? "UNKNOWN",
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

  if (
    core.productClass !== "UNKNOWN" &&
    coreCoverage !== "MATCH"
  ) {
    hardConflicts.push(`productCore:${core.productClass}!=ausente`);
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
        (model) => model === token || model.includes(token) || token.includes(model),
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
          !candidateExpressesAnchor(anchor, candidateText, fingerprint),
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

  const modelPresent =
    intent.modelTokens.length > 0 && missingModels.length === 0;
  const queryRelevance = Math.min(1, twoSided);
  let status: ScoredCandidate["status"] = "RELEVANT";
  let reason = "Candidato representa o produto pedido.";

  if (hardConflicts.length > 0) {
    status = "REJECTED";
    reason = `Conflito comprovado: ${hardConflicts.join(", ")}.`;
  } else if (
    !modelPresent &&
    intent.distinctiveTokens.length > 0 &&
    missingDistinctive.length === intent.distinctiveTokens.length &&
    coreCoverage !== "MATCH"
  ) {
    status = "REJECTED";
    reason = `Nenhum termo distintivo da consulta aparece no candidato: ${missingDistinctive.join(", ")}.`;
  } else if (
    queryCoverage < 0.18 &&
    twoSided < 0.12 &&
    !modelPresent &&
    coreCoverage !== "MATCH"
  ) {
    status = "REJECTED";
    reason = "Cobertura lexical insuficiente para a consulta.";
  }

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
  };
}
