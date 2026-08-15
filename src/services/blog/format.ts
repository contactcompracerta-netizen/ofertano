import {
  BLOG_STATUSES,
  BLOG_THEMES,
  type BlogAdminPost,
  type BlogPost,
  type BlogPostSection,
  type BlogStatus,
  type BlogTheme,
} from "./types";

type DatabaseBlogPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  readingTime: string;
  theme: string;
  coverImage: string | null;
  sections: unknown;
  status: string;
  featured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  socialCaption: string | null;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function criarSlug(
  value: string,
): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function isBlogTheme(
  value: unknown,
): value is BlogTheme {
  return (
    typeof value === "string" &&
    BLOG_THEMES.includes(
      value as BlogTheme,
    )
  );
}

export function isBlogStatus(
  value: unknown,
): value is BlogStatus {
  return (
    typeof value === "string" &&
    BLOG_STATUSES.includes(
      value as BlogStatus,
    )
  );
}

export function normalizarSecoes(
  value: unknown,
): BlogPostSection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((section) => {
      if (
        !section ||
        typeof section !== "object"
      ) {
        return null;
      }

      const record = section as Record<
        string,
        unknown
      >;

      const title =
        typeof record.title === "string"
          ? record.title.trim()
          : "";

      const paragraphs = Array.isArray(
        record.paragraphs,
      )
        ? record.paragraphs
            .filter(
              (paragraph): paragraph is string =>
                typeof paragraph === "string",
            )
            .map((paragraph) =>
              paragraph.trim(),
            )
            .filter(Boolean)
        : [];

      const bullets = Array.isArray(
        record.bullets,
      )
        ? record.bullets
            .filter(
              (bullet): bullet is string =>
                typeof bullet === "string",
            )
            .map((bullet) => bullet.trim())
            .filter(Boolean)
        : [];

      if (!title || paragraphs.length === 0) {
        return null;
      }

      return {
        title,
        paragraphs,
        ...(bullets.length > 0
          ? { bullets }
          : {}),
      };
    })
    .filter(
      (section): section is BlogPostSection =>
        section !== null,
    );
}

export function formatarDataBlog(
  value: Date | string,
): string {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function mapearPostPublico(
  post: DatabaseBlogPost,
): BlogPost {
  const publicationDate =
    post.publishedAt ??
    post.scheduledAt ??
    post.createdAt;

  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    category: post.category,
    author: post.author,
    publishedAt:
      publicationDate.toISOString(),
    publishedLabel:
      formatarDataBlog(publicationDate),
    updatedAt: post.updatedAt.toISOString(),
    readingTime: post.readingTime,
    theme: isBlogTheme(post.theme)
      ? post.theme
      : "emerald",
    coverImage: post.coverImage,
    featured: post.featured,
    status: isBlogStatus(post.status)
      ? post.status
      : "DRAFT",
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    socialCaption: post.socialCaption,
    scheduledAt:
      post.scheduledAt?.toISOString() ?? null,
    sections: normalizarSecoes(
      post.sections,
    ),
  };
}

export function mapearPostAdmin(
  post: DatabaseBlogPost,
): BlogAdminPost {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    category: post.category,
    author: post.author,
    readingTime: post.readingTime,
    theme: isBlogTheme(post.theme)
      ? post.theme
      : "emerald",
    coverImage: post.coverImage,
    sections: normalizarSecoes(
      post.sections,
    ),
    status: isBlogStatus(post.status)
      ? post.status
      : "DRAFT",
    featured: post.featured,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    socialCaption: post.socialCaption,
    scheduledAt:
      post.scheduledAt?.toISOString() ?? null,
    publishedAt:
      post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

