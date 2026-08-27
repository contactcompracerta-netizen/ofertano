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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function presentationCompact(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function presentationSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/*
 * Codigos alfanumericos aceitam espaco/hifen de apresentacao (520 BT,
 * 520-BT, A55 5G). Prefixo e sufixo exigem fronteira alfanumerica real:
 * 1520BT, X520BT, AB520BT, Tune520BT, A550, XA55 e A55B nao ocorrem
 * sozinhos. Join de linha (Tune520BT, GalaxyA55) so entra via ancora
 * companheira da consulta. suffixBoundary "digit" permanece nos joins
 * MODEL (tune520). O haystack e o titulo cru.
 */
export function alphanumericCodeOccurs(
  haystack: string,
  code: string,
  suffixBoundary: "digit" | "alnum" = "digit",
): boolean {
  const compactCode = presentationCompact(code);
  if (compactCode.length < 3 || !/\d/.test(compactCode)) {
    return false;
  }

  const searchText = presentationSearchText(haystack);
  if (!searchText) {
    return false;
  }

  const body = [...compactCode].map(escapeRegex).join("[\\s.-]*");
  const suffix = suffixBoundary === "alnum" ? "(?![a-z0-9])" : "(?![0-9])";
  const pattern = new RegExp(`(?:^|[^a-z0-9])${body}${suffix}`);
  return pattern.test(searchText);
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

type IdentityOccurrenceFingerprint = Pick<
  ProductFingerprint,
  "model" | "manufacturerSku" | "variantCodes" | "identityAnchors"
>;

function identityOccurrenceHaystacks(
  candidateText: string,
  fingerprint: IdentityOccurrenceFingerprint,
): string[] {
  return [
    candidateText,
    fingerprint.model.value,
    fingerprint.manufacturerSku.value,
    ...(fingerprint.variantCodes.value ?? []),
    ...(fingerprint.identityAnchors ?? []),
  ].filter((item): item is string => Boolean(item));
}

export function candidateExpressesAnchor(
  anchor: IdentityAnchor,
  candidateText: string,
  fingerprint: IdentityOccurrenceFingerprint,
): boolean {
  /*
   * MODEL e join palavra+numero (tune520). Letra depois ainda pode ser o
   * restante do SKU (Tune520BT). ALPHANUMERIC/SKU e o codigo completo:
   * 520BTX e A55B sao outro modelo, nao apresentacao.
   */
  const suffixBoundary = anchor.kind === "MODEL" ? "digit" : "alnum";
  return identityOccurrenceHaystacks(candidateText, fingerprint).some((haystack) =>
    alphanumericCodeOccurs(haystack, anchor.value, suffixBoundary),
  );
}

function splitLineAndTrailingDigits(
  value: string,
): { line: string; digits: string } | null {
  const match = /^([a-z]+)(\d+)$/.exec(value);
  if (!match) {
    return null;
  }

  return { line: match[1]!, digits: match[2]! };
}

function gluedLineAndCodeCoversAnchor(
  anchor: IdentityAnchor,
  queryAnchors: IdentityAnchor[],
  haystacks: string[],
): boolean {
  const codes = queryAnchors.filter((item) => item.kind === "ALPHANUMERIC");
  const lineAnchors = queryAnchors.filter(
    (item) => item.kind === "MODEL" || item.kind === "BOUND_NUMBER",
  );

  for (const lineAnchor of lineAnchors) {
    const split = splitLineAndTrailingDigits(lineAnchor.value);
    if (!split) {
      continue;
    }

    for (const code of codes) {
      if (code.value === lineAnchor.value || !code.value.includes(split.digits)) {
        continue;
      }

      if (anchor.value !== code.value && anchor.value !== lineAnchor.value) {
        continue;
      }

      const glued = `${split.line}${code.value}`;
      if (haystacks.some((haystack) => alphanumericCodeOccurs(haystack, glued, "alnum"))) {
        return true;
      }
    }
  }

  return false;
}

export function candidateSatisfiesIdentityAnchor(
  anchor: IdentityAnchor,
  queryAnchors: IdentityAnchor[],
  candidateText: string,
  fingerprint: IdentityOccurrenceFingerprint,
): boolean {
  if (candidateExpressesAnchor(anchor, candidateText, fingerprint)) {
    return true;
  }

  /*
   * Tune520BT e GalaxyA55 so cobrem o codigo quando a propria consulta
   * traz a ancora de linha (tune520, galaxy55). Prefixo colado sem essa
   * ancora companheira nao e apresentacao.
   */
  return gluedLineAndCodeCoversAnchor(
    anchor,
    queryAnchors,
    identityOccurrenceHaystacks(candidateText, fingerprint),
  );
}
