export const SOCIAL_POST_TYPES = [
  "DUEL_PRICE",
  "FOUND_DEAL",
  "PRICE_COMPARISON",
  "SAVING_TIP",
  "ENGAGEMENT_QUESTION",
  "SHOPPING_CURIOSITY",
] as const;

export type SocialPostType = (typeof SOCIAL_POST_TYPES)[number];

export const SOCIAL_POST_SLOTS = [
  "MORNING",
  "AFTERNOON",
  "EVENING",
] as const;

export type SocialPostSlot = (typeof SOCIAL_POST_SLOTS)[number];

export type SocialTemplate = "DUEL" | "FOUND_DEAL" | "ENGAGEMENT";

export type SocialOfferData = {
  id: string;
  marketplace: string;
  label: string;
  price: number;
  oldPrice: number | null;
};

export type SocialProductData = {
  id: string;
  name: string;
  shortName: string;
  image: string | null;
  category: string | null;
};

export type SocialPostData = {
  template: SocialTemplate;
  eyebrow: string;
  headline: string;
  subheadline: string;
  cta: string;
  product: SocialProductData | null;
  offers: SocialOfferData[];
  bestOfferId: string | null;
  comparisonPrice: number | null;
  comparisonLabel: string | null;
  savings: number | null;
  question: string | null;
};

export type SocialHistoryEntry = {
  type: SocialPostType;
  productId: string | null;
  fingerprint: string;
  createdAt: Date;
};

export type ReliableProduct = {
  id: string;
  name: string;
  image: string | null;
  category: string | null;
  offers: SocialOfferData[];
};

export type GeneratedSocialContent = {
  type: SocialPostType;
  productId: string | null;
  caption: string;
  hashtags: string[];
  data: SocialPostData;
  fingerprint: string;
};
