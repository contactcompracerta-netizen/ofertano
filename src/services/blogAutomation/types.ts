import type {
  BlogPostSection,
  BlogTheme,
} from "@/services/blog/types";

export const EDITORIAL_OBJECTIVES = [
  "melhores",
  "comparativo",
  "guia_compra",
  "custo_beneficio",
  "como_escolher",
  "faq",
  "diferencas",
  "lista",
  "economia",
  "tendencia",
] as const;

export type EditorialObjective =
  (typeof EDITORIAL_OBJECTIVES)[number];

export const EDITORIAL_TRIGGER_SOURCES = [
  "manual",
  "cron",
  "editorial_queue",
  "opportunity_discovery",
  "trending_products",
  "category",
] as const;

export type EditorialTriggerSource =
  (typeof EDITORIAL_TRIGGER_SOURCES)[number];

export type EditorialProductInput = {
  id: string;
  title?: string;
  name?: string;
  category?: string;
  image?: string;
  lowestPrice?: number;
  stores?: string[];
  internalUrl?: string;
};

export type SanitizedEditorialProduct = {
  id: string;
  title: string;
  category?: string;
  image?: string;
  lowestPrice?: number;
  stores?: string[];
  internalUrl: string;
};

export type GenerateEditorialPackageInput = {
  topic: string;
  category?: string;
  products?: EditorialProductInput[];
  objective?: EditorialObjective | string;
  extraContext?: string;
  year?: number;
  source?: EditorialTriggerSource;
};

export type NormalizedEditorialInput = {
  topic: string;
  category: string;
  objective: EditorialObjective;
  extraContext: string;
  year: number;
  source: EditorialTriggerSource;
  products: SanitizedEditorialProduct[];
};

export type EditorialFaqItem = {
  question: string;
  answer: string;
};

export type EditorialCta = {
  label: string;
  href: string;
  reason: string;
};

export type EditorialCoverSpec = {
  headline: string;
  subtitle?: string;
  productId?: string;
  productTitle?: string;
  recommendedFormat: "1200x630" | "1080x1080" | "1080x1350";
  altText: string;
};

export type InternalLinkSuggestion = {
  href: string;
  label: string;
  reason: string;
};

export type FacebookContent = {
  hook: string;
  mainBenefit: string;
  summary: string;
  cta: string;
  articleLinkPlaceholder: string;
  caption: string;
};

export type InstagramContent = {
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  linkStrategy: "bio" | "story" | "not_in_caption";
  linkNote: string;
};

export type EditorialSeo = {
  searchIntent: string;
  title: string;
  description: string;
  slug: string;
  headings: Array<{
    level: "h2" | "h3";
    text: string;
  }>;
  relatedTerms: string[];
  faq: EditorialFaqItem[];
  internalLinks: InternalLinkSuggestion[];
  cta: EditorialCta;
};

export type DuplicateVerdict =
  | "OK"
  | "POSSIBLE_DUPLICATE"
  | "DUPLICATE";

export type DuplicateMatch = {
  id?: string;
  slug: string;
  title: string;
  reason: string;
  score: number;
};

export type DuplicateCheckResult = {
  verdict: DuplicateVerdict;
  matches: DuplicateMatch[];
};

export type EditorialProviderKind =
  | "ai"
  | "deterministic"
  | "injected";

export type EditorialPackage = {
  blog: {
    title: string;
    slug: string;
    excerpt: string;
    category: string;
    readingTime: string;
    theme: BlogTheme;
    sections: BlogPostSection[];
    faq: EditorialFaqItem[];
    cta: EditorialCta;
    cover: EditorialCoverSpec;
  };
  seo: EditorialSeo;
  social: {
    facebook: FacebookContent;
    instagram: InstagramContent;
  };
  metadata: {
    objective: EditorialObjective;
    relatedProducts: SanitizedEditorialProduct[];
    duplicateCheck: DuplicateCheckResult;
    generatedAt: string;
    provider: EditorialProviderKind;
    source: EditorialTriggerSource;
    warnings: string[];
  };
};

export type EditorialPostRecord = {
  id?: string;
  slug: string;
  title: string;
  createdAt?: Date | string;
  publishedAt?: Date | string | null;
  status?: string;
};

export type EditorialPostCatalog = {
  listarPautasRecentes(
    limit?: number,
  ): Promise<EditorialPostRecord[]>;
};
