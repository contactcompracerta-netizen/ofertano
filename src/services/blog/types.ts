export const BLOG_THEMES = [
  "emerald",
  "blue",
  "amber",
  "violet",
  "rose",
  "cyan",
] as const;

export type BlogTheme =
  (typeof BLOG_THEMES)[number];

export const BLOG_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "PUBLISHED",
  "ARCHIVED",
] as const;

export type BlogStatus =
  (typeof BLOG_STATUSES)[number];

export type BlogPostSection = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export type BlogPost = {
  id?: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  author?: string;
  publishedAt: string;
  publishedLabel: string;
  updatedAt?: string;
  readingTime: string;
  theme: BlogTheme;
  coverImage?: string | null;
  featured?: boolean;
  status?: BlogStatus;
  seoTitle?: string | null;
  seoDescription?: string | null;
  socialCaption?: string | null;
  scheduledAt?: string | null;
  sections: BlogPostSection[];
};

export type BlogAdminPost = {
  id: string;
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
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

