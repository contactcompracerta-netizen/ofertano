import { criarSlug } from "@/services/blog/format";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function criarSlugEditorial(
  value: string,
): string {
  return criarSlug(value.trim());
}

export function slugEditorialValido(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    SLUG_PATTERN.test(value) &&
    value.length >= 8 &&
    value.length <= 120
  );
}

export function garantirSlugEditorial(
  rawSlug: unknown,
  title: string,
): string {
  const fromRaw =
    typeof rawSlug === "string"
      ? criarSlugEditorial(rawSlug)
      : "";
  const slug =
    fromRaw || criarSlugEditorial(title);

  if (!slugEditorialValido(slug)) {
    throw new Error(
      "Não foi possível gerar um slug amigável para a pauta.",
    );
  }

  return slug;
}
