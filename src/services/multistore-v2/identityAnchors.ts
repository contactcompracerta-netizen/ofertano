import type { IdentityAnchor, IdentityAnchorKind, ProductFingerprint } from "./types";
import {
  extractModelTokens,
  isAccessoryHead,
  isAttributeWord,
  classGroupOf,
  tokenize,
  normalizeMultistoreText,
  isCapacityOrQuantityUnit,
  isSizeHint,
} from "./normalizeCandidate";

const QUANTITATIVE_COMPACT =
  /^(\d+(?:\.\d+)?)(l|ml|kg|g|w|v|mm|cm|pol|gb|tb|mb|mah|cores|gavetas?|pecas?|unidades?|gramas?|litros?)$/;

export function compactIdentity(value: string): string {
  return normalizeMultistoreText(value).replace(/[\s.-]+/g, "");
}

export function humanizeAnchor(value: string): string {
  return value
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .trim();
}

function isQuantitativeIdentity(value: string): boolean {
  return QUANTITATIVE_COMPACT.test(value);
}

function prepareSkuText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, (match) => match.replace(/\./g, ""))
    .replace(/[^a-z0-9.-]+/g, " ")
    .trim();
}

function isDistinctiveLetterToken(token: string): boolean {
  if (!/^[a-z]{2,}$/.test(token)) {
    return false;
  }

  return !classGroupOf(token) && !isAttributeWord(token) && !isAccessoryHead(token);
}

export function extractIdentityAnchors(text: string): IdentityAnchor[] {
  const anchors: IdentityAnchor[] = [];
  const seen = new Set<string>();

  const push = (value: string, kind: IdentityAnchorKind) => {
    const compact = compactIdentity(value);
    if (!compact || compact.length < 3 || seen.has(compact)) {
      return;
    }

    if (isQuantitativeIdentity(compact) || /^\d+$/.test(compact)) {
      return;
    }

    if (!/[a-z]/.test(compact) || !/\d/.test(compact)) {
      return;
    }

    seen.add(compact);
    anchors.push({
      value: compact,
      kind,
      required: true,
    });
  };

  const skuText = prepareSkuText(text);
  const hyphenated =
    skuText.match(/\b[a-z]{1,10}\d{0,8}[a-z0-9]*(?:-[a-z0-9]{1,10})+\b/g) ?? [];
  for (const token of hyphenated) {
    push(
      token.replace(/-/g, ""),
      token.split("-").length > 2 ? "SKU" : "LETTER_NUMBER",
    );
  }

  for (const token of skuText.split(/[\s.-]+/).filter(Boolean)) {
    if (/^(?=.*[a-z])(?=.*\d)[a-z0-9]{3,}$/.test(token)) {
      push(token, "ALPHANUMERIC");
    }
  }

  const tokens = tokenize(text);
  for (const token of extractModelTokens(tokens)) {
    push(
      token,
      /^(?=.*[a-z])(?=.*\d)[a-z0-9]+$/.test(token) ? "MODEL" : "LETTER_NUMBER",
    );
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const current = tokens[index]!;
    const next = tokens[index + 1]!;
    const nextDigits = next.replace(/\./g, "");
    if (!/^\d{2,}$/.test(nextDigits)) {
      continue;
    }

    if (isCapacityOrQuantityUnit(tokens[index + 2]) || isSizeHint(current)) {
      continue;
    }

    if (/^(19|20)\d{2}$/.test(nextDigits)) {
      continue;
    }

    if (isDistinctiveLetterToken(current)) {
      push(`${current}${nextDigits}`, "BOUND_NUMBER");
      continue;
    }

    if (/^[a-z]$/.test(current)) {
      push(`${current}${nextDigits}`, "LETTER_NUMBER");
    }
  }

  return anchors.filter(
    (anchor) =>
      !anchors.some(
        (other) =>
          other.value !== anchor.value && other.value.includes(anchor.value),
      ),
  );
}

export function hasStrongIdentity(anchors: IdentityAnchor[]): boolean {
  return anchors.some((anchor) => anchor.required);
}

export function candidateExpressesAnchor(
  anchor: IdentityAnchor,
  candidateText: string,
  fingerprint: Pick<
    ProductFingerprint,
    "model" | "manufacturerSku" | "variantCodes" | "identityAnchors"
  >,
): boolean {
  const compactAnchor = compactIdentity(anchor.value);
  const compactText = compactIdentity(candidateText);
  if (compactText.includes(compactAnchor)) {
    return true;
  }

  const fields = [
    fingerprint.model.value,
    fingerprint.manufacturerSku.value,
    ...(fingerprint.variantCodes.value ?? []),
    ...(fingerprint.identityAnchors ?? []),
  ].filter((item): item is string => Boolean(item));

  return fields.some((field) => compactIdentity(field).includes(compactAnchor));
}
