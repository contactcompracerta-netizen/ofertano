import {
  criarSlug,
  isBlogStatus,
  isBlogTheme,
  normalizarSecoes,
} from "./format";
import type {
  BlogPostSection,
  BlogStatus,
  BlogTheme,
} from "./types";

export type BlogPostInput = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  readingTime: string;
  theme: BlogTheme;
  coverImage: string | null;
  sections: BlogPostSection[];
  status: BlogStatus;
  featured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  socialCaption: string | null;
  scheduledAt: Date | null;
  publishedAt: Date | null;
};

function optionalString(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized || null;
}

function parseDate(
  value: unknown,
): Date | null {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

export function validarBlogPostInput(
  value: unknown,
): BlogPostInput {
  if (
    !value ||
    typeof value !== "object"
  ) {
    throw new Error(
      "Os dados do artigo são inválidos.",
    );
  }

  const body = value as Record<
    string,
    unknown
  >;

  const title = optionalString(body.title);
  const excerpt = optionalString(body.excerpt);
  const category = optionalString(body.category);
  const sections = normalizarSecoes(
    body.sections,
  );

  if (!title || title.length < 5) {
    throw new Error(
      "Informe um título com pelo menos 5 caracteres.",
    );
  }

  if (!excerpt || excerpt.length < 20) {
    throw new Error(
      "Informe um resumo com pelo menos 20 caracteres.",
    );
  }

  if (!category) {
    throw new Error(
      "Informe a categoria do artigo.",
    );
  }

  if (sections.length === 0) {
    throw new Error(
      "Adicione pelo menos uma seção com título e parágrafo.",
    );
  }

  const rawSlug =
    optionalString(body.slug) ?? title;
  const slug = criarSlug(rawSlug);

  if (!slug) {
    throw new Error(
      "Não foi possível gerar o endereço do artigo.",
    );
  }

  const status = isBlogStatus(body.status)
    ? body.status
    : "DRAFT";

  const theme = isBlogTheme(body.theme)
    ? body.theme
    : "emerald";

  let scheduledAt = parseDate(
    body.scheduledAt,
  );
  let publishedAt = parseDate(
    body.publishedAt,
  );
  let finalStatus = status;

  if (finalStatus === "SCHEDULED") {
    if (!scheduledAt) {
      throw new Error(
        "Escolha a data e o horário do agendamento.",
      );
    }

    if (scheduledAt.getTime() <= Date.now()) {
      finalStatus = "PUBLISHED";
      publishedAt = scheduledAt;
      scheduledAt = null;
    } else {
      publishedAt = null;
    }
  }

  if (finalStatus === "PUBLISHED") {
    publishedAt =
      publishedAt ?? new Date();
    scheduledAt = null;
  }

  if (
    finalStatus === "DRAFT" ||
    finalStatus === "ARCHIVED"
  ) {
    scheduledAt = null;
  }

  return {
    slug,
    title,
    excerpt,
    category,
    author:
      optionalString(body.author) ??
      "Ofertano",
    readingTime:
      optionalString(body.readingTime) ??
      "5 min de leitura",
    theme,
    coverImage:
      optionalString(body.coverImage),
    sections,
    status: finalStatus,
    featured: body.featured === true,
    seoTitle: optionalString(body.seoTitle),
    seoDescription: optionalString(
      body.seoDescription,
    ),
    socialCaption: optionalString(
      body.socialCaption,
    ),
    scheduledAt,
    publishedAt,
  };
}
