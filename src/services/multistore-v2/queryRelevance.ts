import type { QueryIntent, ScoredCandidate } from "./types";
import type { NormalizedCandidate } from "./types";
import { buildFingerprint } from "./fingerprint";
import { classesAreIncompatible } from "./normalizeCandidate";

function tokenWeight(token: string, intent: QueryIntent): number {
  if (intent.modelTokens.includes(token) || intent.identityNumbers.includes(token)) {
    return 6;
  }

  if (intent.distinctiveTokens.includes(token)) {
    return 5;
  }

  if (intent.productClass !== "UNKNOWN" && token === intent.productClass) {
    return 1.2;
  }

  return 2;
}

function candidateHasToken(token: string, tokens: Set<string>, text: string): boolean {
  if (tokens.has(token)) {
    return true;
  }

  if (text.includes(token)) {
    return true;
  }

  const compactText = text.replace(/\s+/g, "");
  const compactToken = token.replace(/\s+/g, "");
  return compactText.includes(compactToken);
}

export function scoreQueryRelevance(
  intent: QueryIntent,
  candidate: NormalizedCandidate,
): ScoredCandidate {
  const fingerprint = buildFingerprint(candidate);
  const candidateTokens = new Set(candidate.tokens);
  const candidateText = candidate.normalizedText;
  const matchedTerms = intent.normalizedTokens.filter((token) =>
    candidateHasToken(token, candidateTokens, candidateText),
  );
  const missingTerms = intent.distinctiveTokens.filter(
    (token) => !candidateHasToken(token, candidateTokens, candidateText),
  );
  const extraTerms = candidate.tokens.filter((token) => {
    if (intent.normalizedTokens.includes(token)) {
      return false;
    }

    return fingerprint.distinctiveTokens.includes(token) || Boolean(fingerprint.productClass.value && token === fingerprint.productClass.value);
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

  const hardConflicts: string[] = [];
  const queryRole = intent.requestedRole;
  const candidateRole = fingerprint.role.value;

  if (
    queryRole === "MAIN" &&
    (candidateRole === "ACCESSORY" || candidateRole === "REPLACEMENT_PART")
  ) {
    hardConflicts.push(`role:${queryRole}!=${candidateRole}`);
  }

  if (
    (queryRole === "ACCESSORY" || queryRole === "REPLACEMENT_PART") &&
    candidateRole === "MAIN"
  ) {
    hardConflicts.push(`role:${queryRole}!=${candidateRole}`);
  }

  if (
    intent.productClass !== "UNKNOWN" &&
    fingerprint.productClass.value &&
    classesAreIncompatible(intent.productClass, fingerprint.productClass.value)
  ) {
    hardConflicts.push(
      `productClass:${intent.productClass}!=${fingerprint.productClass.value}`,
    );
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

  if (
    intent.identityNumbers.length > 0 &&
    fingerprint.identityNumbers.length > 0 &&
    intent.identityNumbers.every((number) => !fingerprint.identityNumbers.includes(number))
  ) {
    hardConflicts.push(
      `identityNumber:${intent.identityNumbers.join(",")}!=${fingerprint.identityNumbers.join(",")}`,
    );
  }

  if (
    intent.importantAttributes.capacity &&
    fingerprint.capacity.value &&
    intent.importantAttributes.capacity !== fingerprint.capacity.value
  ) {
    hardConflicts.push(
      `capacity:${intent.importantAttributes.capacity}!=${fingerprint.capacity.value}`,
    );
  }

  if (
    intent.importantAttributes.quantity &&
    fingerprint.quantity.value &&
    intent.importantAttributes.quantity !== fingerprint.quantity.value
  ) {
    hardConflicts.push(
      `quantity:${intent.importantAttributes.quantity}!=${fingerprint.quantity.value}`,
    );
  }

  if (
    intent.importantAttributes.color &&
    fingerprint.color.value &&
    intent.importantAttributes.color !== fingerprint.color.value
  ) {
    hardConflicts.push(
      `color:${intent.importantAttributes.color}!=${fingerprint.color.value}`,
    );
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

  const missingModels = intent.modelTokens.filter(
    (token) => !candidateHasToken(token, candidateTokens, candidateText),
  );
  const modelPresent =
    intent.modelTokens.length > 0 && missingModels.length === 0;

  const queryRelevance = Math.min(1, twoSided);
  let status: ScoredCandidate["status"] = "RELEVANT";
  let reason = "Candidato responde a pesquisa.";

  if (hardConflicts.length > 0) {
    status = "REJECTED";
    reason = `Conflito comprovado: ${hardConflicts.join(", ")}.`;
  } else if (
    !modelPresent &&
    intent.distinctiveTokens.length > 0 &&
    missingTerms.length === intent.distinctiveTokens.length
  ) {
    status = "REJECTED";
    reason = `Nenhum termo distintivo da consulta aparece no candidato: ${missingTerms.join(", ")}.`;
  } else if (queryCoverage < 0.18 && twoSided < 0.12 && !modelPresent) {
    status = "REJECTED";
    reason = "Cobertura lexical insuficiente para a consulta.";
  }

  return {
    id: candidate.id,
    normalized: candidate,
    fingerprint,
    queryRelevance,
    matchedTerms,
    missingTerms,
    extraTerms,
    hardConflicts,
    status,
    reason,
  };
}
