import type {
  EditorialCoverSpec,
  SanitizedEditorialProduct,
} from "./types";

export function criarEspecificacaoDeCapa(input: {
  title: string;
  excerpt: string;
  products: SanitizedEditorialProduct[];
}): EditorialCoverSpec {
  const principal = input.products[0];
  const headline = input.title
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
  const subtitle = input.excerpt
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

  const spec: EditorialCoverSpec = {
    headline,
    subtitle: subtitle || undefined,
    recommendedFormat: "1200x630",
    altText: principal
      ? `Capa do guia Ofertano sobre ${headline}, com destaque para ${principal.title}.`
      : `Capa do guia Ofertano: ${headline}.`,
  };

  if (principal) {
    spec.productId = principal.id;
    spec.productTitle = principal.title;
  }

  return spec;
}

export function normalizarEspecificacaoDeCapa(
  value: unknown,
  fallback: EditorialCoverSpec,
  products: SanitizedEditorialProduct[],
): EditorialCoverSpec {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const headline =
    typeof record.headline === "string" &&
    record.headline.trim()
      ? record.headline.trim().slice(0, 70)
      : fallback.headline;
  const subtitle =
    typeof record.subtitle === "string" &&
    record.subtitle.trim()
      ? record.subtitle.trim().slice(0, 90)
      : fallback.subtitle;
  const recommendedFormat =
    record.recommendedFormat === "1080x1080" ||
    record.recommendedFormat === "1080x1350" ||
    record.recommendedFormat === "1200x630"
      ? record.recommendedFormat
      : fallback.recommendedFormat;
  const altText =
    typeof record.altText === "string" &&
    record.altText.trim()
      ? record.altText.trim()
      : fallback.altText;

  const allowedIds = new Set(
    products.map((product) => product.id),
  );
  const requestedId =
    typeof record.productId === "string"
      ? record.productId.trim()
      : "";
  const matched = products.find(
    (product) => product.id === requestedId,
  );

  const spec: EditorialCoverSpec = {
    headline,
    subtitle,
    recommendedFormat,
    altText,
  };

  if (matched && allowedIds.has(matched.id)) {
    spec.productId = matched.id;
    spec.productTitle = matched.title;
  } else if (fallback.productId) {
    spec.productId = fallback.productId;
    spec.productTitle = fallback.productTitle;
  }

  return spec;
}
