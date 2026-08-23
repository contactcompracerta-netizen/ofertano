import type {
  EditorialCta,
  InternalLinkSuggestion,
  NormalizedEditorialInput,
  SanitizedEditorialProduct,
} from "./types";

export const CAMINHOS_INTERNOS_FIXOS = [
  "/ofertas",
  "/categorias",
  "/blog",
  "/favoritos",
  "/sobre",
  "/contato",
] as const;

export function hrefInternoPermitido(
  href: string,
): boolean {
  const normalized = href.trim();

  if (
    CAMINHOS_INTERNOS_FIXOS.includes(
      normalized as (typeof CAMINHOS_INTERNOS_FIXOS)[number],
    )
  ) {
    return true;
  }

  if (normalized.startsWith("/?q=")) {
    return true;
  }

  if (normalized.startsWith("/produto/")) {
    const id = normalized
      .slice("/produto/".length)
      .replace(/\/+$/, "")
      .split("?")[0];
    return Boolean(id);
  }

  if (normalized.startsWith("/blog/")) {
    const slug = normalized
      .slice("/blog/".length)
      .replace(/\/+$/, "")
      .split("?")[0];
    return Boolean(slug);
  }

  return false;
}

export function sugerirLinksInternos(input: {
  slug: string;
  category: string;
  products: SanitizedEditorialProduct[];
}): InternalLinkSuggestion[] {
  const links: InternalLinkSuggestion[] = [
    {
      href: "/ofertas",
      label: "Ver ofertas do Ofertano",
      reason:
        "Leva o leitor à comparação de preços depois de entender o critério de escolha.",
    },
    {
      href: "/categorias",
      label: "Explorar categorias",
      reason:
        "Ajuda quem quer continuar navegando por tipo de produto.",
    },
    {
      href: "/blog",
      label: "Ler outros guias",
      reason:
        "Mantém o tráfego orgânico dentro do conteúdo editorial.",
    },
  ];

  const categoryQuery = input.category.trim();

  if (categoryQuery) {
    links.push({
      href: `/?q=${encodeURIComponent(categoryQuery)}`,
      label: `Buscar ${categoryQuery}`,
      reason:
        "A home já pesquisa produtos pela categoria informada.",
    });
  }

  for (const product of input.products) {
    links.push({
      href: product.internalUrl,
      label: product.title,
      reason:
        "Página interna do produto enviado pelo caller, sem inventar comparação.",
    });
  }

  const unique = new Map<string, InternalLinkSuggestion>();

  for (const link of links) {
    if (
      hrefInternoPermitido(link.href) &&
      !unique.has(link.href)
    ) {
      unique.set(link.href, link);
    }
  }

  return Array.from(unique.values());
}

export function ctaPadraoEditorial(
  input: NormalizedEditorialInput,
): EditorialCta {
  if (input.products.length === 1) {
    const product = input.products[0]!;

    return {
      label: `Comparar ${product.title} no Ofertano`,
      href: product.internalUrl,
      reason:
        "Há um produto real informado; o CTA aponta para a página interna dele.",
    };
  }

  if (input.products.length > 1) {
    return {
      label: "Comparar esses produtos no Ofertano",
      href: "/ofertas",
      reason:
        "Há mais de um produto informado; o leitor deve ver as ofertas reunidas.",
    };
  }

  return {
    label: "Comparar ofertas no Ofertano",
    href: "/ofertas",
    reason:
      "Sem produtos específicos, o CTA leva à listagem de ofertas.",
  };
}

export function filtrarLinksInternos(
  value: unknown,
  fallback: InternalLinkSuggestion[],
): InternalLinkSuggestion[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const links: InternalLinkSuggestion[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const href =
      typeof record.href === "string"
        ? record.href.trim()
        : "";
    const label =
      typeof record.label === "string"
        ? record.label.trim()
        : "";
    const reason =
      typeof record.reason === "string"
        ? record.reason.trim()
        : "Link interno do Ofertano.";

    if (
      !href ||
      !label ||
      !hrefInternoPermitido(href) ||
      seen.has(href)
    ) {
      continue;
    }

    seen.add(href);
    links.push({ href, label, reason });
  }

  return links.length > 0 ? links : fallback;
}
