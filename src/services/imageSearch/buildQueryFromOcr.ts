import { buildSearchPlan } from "@/services/multistore-v2/queryPlan";
import { buildQueryCore } from "@/services/multistore-v2/queryCore";
import {
  canonicalClassToken,
  isGenericDescriptor,
  isWeakModifier,
  normalizeConceptText,
} from "@/services/multistore-v2/productConcepts";
import { humanizeAnchor } from "@/services/multistore-v2/identityAnchors";

import {
  cleanOcrText,
  extractDigitCodes,
  pickBestGtin,
} from "./cleanOcrText";
import {
  IMAGE_SEARCH_MAX_QUERY_LENGTH,
  IMAGE_SEARCH_PUBLIC_PATH,
  IMAGE_SEARCH_QUERY_PARAM,
  type ImageSearchConfidence,
  type ImageSearchQueryResult,
  type ImageSearchSignals,
} from "./types";

const BRAND_DISPLAY: Record<string, string> = {
  ihome: "iHome",
  jbl: "JBL",
  samsung: "Samsung",
  xiaomi: "Xiaomi",
  motorola: "Motorola",
  philips: "Philips",
  logitech: "Logitech",
  sony: "Sony",
  lg: "LG",
  dell: "Dell",
  lenovo: "Lenovo",
  acer: "Acer",
  positivo: "Positivo",
  multilaser: "Multilaser",
  electrolux: "Electrolux",
  brastemp: "Brastemp",
  consul: "Consul",
  mondial: "Mondial",
  arno: "Arno",
  oster: "Oster",
  bosch: "Bosch",
  midea: "Midea",
  gree: "Gree",
  tramontina: "Tramontina",
  cadence: "Cadence",
  britania: "Britania",
  novatech: "NovaTech",
};

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function compact(value: string): string {
  return fold(value);
}

function originalCasing(source: string, normalized: string): string {
  return recoverCasing(source, normalized) ?? BRAND_DISPLAY[compact(normalized)] ?? humanizeAnchor(normalized);
}

function recoverCasing(source: string, normalized: string): string | null {
  const wanted = compact(normalized);
  if (!wanted) {
    return null;
  }

  const tokens = source.split(/\s+/).filter(Boolean);
  const exact = tokens.find((token) => compact(token) === wanted);
  if (exact) {
    return exact;
  }

  for (let start = 0; start < tokens.length; start += 1) {
    let joined = "";

    for (let end = start; end < tokens.length; end += 1) {
      joined += tokens[end];
      const compacted = compact(joined);

      if (compacted === wanted) {
        return tokens.slice(start, end + 1).join(" ");
      }

      if (compacted.length > wanted.length) {
        break;
      }
    }
  }

  return null;
}

function titleBrand(brand: string | null, source: string): string | null {
  if (!brand) {
    return null;
  }

  return BRAND_DISPLAY[compact(brand)] ?? originalCasing(source, brand);
}

function uniqueKeepOrder(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
    if (!trimmed) {
      continue;
    }

    const key = compact(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(trimmed);
  }

  return output;
}

function clipQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, IMAGE_SEARCH_MAX_QUERY_LENGTH);
}

function usefulAttributes(attributes: Record<string, string>): string[] {
  return [attributes.capacity, attributes.size]
    .filter((value): value is string => Boolean(value && value.trim()));
}

function isFluffToken(token: string): boolean {
  const normalized = normalizeConceptText(token);
  return isGenericDescriptor(normalized) || isWeakModifier(normalized);
}

function modelFromCore(
  source: string,
  modelTokens: string[],
  identityAnchors: Array<{ value: string }>,
  distinctiveTokens: string[],
): string | null {
  const family = distinctiveTokens
    .map((token) => originalCasing(source, token))
    .filter(
      (token) =>
        /[a-z]/i.test(token) && token.length >= 3 && !isFluffToken(token),
    );

  const recoveredAnchors = identityAnchors
    .map((anchor) => recoverCasing(source, humanizeAnchor(anchor.value)) ?? recoverCasing(source, anchor.value))
    .filter((value): value is string => Boolean(value && compact(value).length >= 3))
    .sort((left, right) => compact(right).length - compact(left).length);

  const strongestAnchor =
    recoveredAnchors[0] ??
    identityAnchors
      .map((anchor) => originalCasing(source, humanizeAnchor(anchor.value)))
      .filter((value) => compact(value).length >= 4)
      .sort((left, right) => compact(right).length - compact(left).length)[0];

  if (strongestAnchor) {
    const extraFamily = family.filter(
      (token) => !compact(strongestAnchor).includes(compact(token)),
    );
    return uniqueKeepOrder([...extraFamily.slice(0, 1), strongestAnchor]).join(" ") || null;
  }

  const models = modelTokens
    .map((token) => originalCasing(source, token))
    .filter((value) => compact(value).length >= 3 && !isFluffToken(value));

  return uniqueKeepOrder([...family.slice(0, 1), ...models.slice(0, 2)]).join(" ") || null;
}

function confidenceOf(input: {
  brand: string | null;
  model: string | null;
  gtin: string | null;
  category: string | null;
  classConfidence: ImageSearchConfidence;
  hasStrongIdentity: boolean;
  leftoverTokens: number;
}): ImageSearchConfidence {
  if ((input.brand && input.model) || input.hasStrongIdentity || input.gtin) {
    return "HIGH";
  }

  if (input.brand && input.category) {
    return "MEDIUM";
  }

  if (input.category && input.classConfidence === "HIGH") {
    return "MEDIUM";
  }

  if (input.category || input.brand || input.leftoverTokens >= 2) {
    return "LOW";
  }

  return "NONE";
}

function reasonOf(confidence: ImageSearchConfidence, signals: ImageSearchSignals): string {
  if (confidence === "HIGH" && signals.model) {
    return "Encontramos marca e modelo na imagem.";
  }

  if (confidence === "HIGH" && signals.gtin) {
    return "Encontramos um código de barras válido.";
  }

  if (confidence === "MEDIUM") {
    return "Identificamos parte do produto. Confira antes de pesquisar.";
  }

  if (confidence === "LOW") {
    return "A leitura ficou incompleta. Corrija a busca se precisar.";
  }

  return "Não identificamos o produto com segurança. Digite o que deseja pesquisar.";
}

export function buildPublicSearchHandoffUrl(query: string): string {
  const clipped = clipQuery(query);
  const params = new URLSearchParams();
  params.set(IMAGE_SEARCH_QUERY_PARAM, clipped);
  return `${IMAGE_SEARCH_PUBLIC_PATH}?${params.toString()}`;
}

export function buildQueryFromOcr(
  rawOcrText: string,
  detectedCodes: string[] = [],
): ImageSearchQueryResult {
  const packagingText = cleanOcrText(rawOcrText);
  const digitCodes = uniqueKeepOrder([
    ...detectedCodes.filter((code) => /^\d{8,14}$/.test(code)),
    ...extractDigitCodes(packagingText),
    ...extractDigitCodes(rawOcrText),
  ]);
  const gtin = pickBestGtin(digitCodes);

  const coreSource = [packagingText, gtin].filter(Boolean).join(" ").trim();
  const core = buildQueryCore(coreSource);
  const category =
    core.productClass !== "UNKNOWN"
      ? core.productCoreLabels[0] || canonicalClassToken(core.productClass) || null
      : null;
  const brand = titleBrand(core.brand, packagingText || rawOcrText);
  const model = modelFromCore(
    packagingText || rawOcrText,
    core.modelTokens,
    core.identityAnchors,
    core.distinctiveContext.filter((token) => token !== core.brand),
  );

  const alphanumericCodes = uniqueKeepOrder([
    ...core.identityAnchors.map((anchor) => originalCasing(rawOcrText, humanizeAnchor(anchor.value))),
    ...core.modelTokens.map((token) => originalCasing(rawOcrText, token)),
    ...digitCodes,
    gtin,
  ]);

  const queryParts = uniqueKeepOrder([
    category && !(model && brand) ? category : null,
    brand,
    model,
    ...usefulAttributes(core.attributes),
    !model && gtin ? gtin : null,
  ]);

  let query = clipQuery(queryParts.join(" "));

  if (!query && packagingText) {
    query = clipQuery(
      packagingText
        .split(" ")
        .slice(0, 8)
        .join(" "),
    );
  }

  if (!query && gtin) {
    query = gtin;
  }

  const leftoverTokens = query
    .split(/\s+/)
    .filter((token) => token.length >= 2).length;

  const signals: ImageSearchSignals = {
    category,
    brand,
    model,
    codes: alphanumericCodes,
    gtin,
    packagingText: packagingText || null,
  };

  const confidence = query
    ? confidenceOf({
        brand,
        model,
        gtin,
        category,
        classConfidence: core.productClassConfidence,
        hasStrongIdentity: core.hasStrongIdentity,
        leftoverTokens,
      })
    : "NONE";

  return {
    query,
    displayQuery: query,
    confidence,
    needsUserCorrection: confidence === "LOW" || confidence === "NONE",
    reason: reasonOf(confidence, signals),
    signals,
  };
}

export function queryReachesExistingPlan(query: string): string[] {
  return buildSearchPlan(clipQuery(query));
}
