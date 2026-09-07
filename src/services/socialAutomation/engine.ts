import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

import {
  buildEvergreenContent,
  buildPriceContent,
  fallbackPostTypeForSlot,
  hasComparablePrices,
  pricePostTypeForSlot,
  prioritizeUnusedProducts,
  variantIndexFor,
} from "./content";
import {
  getBrazilDateKey,
  marketplaceLabel,
  validHttpsImageUrl,
} from "./format";
import {
  SOCIAL_POST_SLOTS,
  type GeneratedSocialContent,
  type ReliableProduct,
  type SocialHistoryEntry,
  type SocialPostData,
  type SocialPostSlot,
  type SocialPostType,
} from "./types";

const PRODUCT_REPEAT_WINDOW_DAYS = 14;
const HISTORY_SIZE = 120;

type PersistedSocialPost = {
  id: string;
  dayKey: string;
  slot: SocialPostSlot;
  type: SocialPostType;
  status: "READY" | "PUBLISHED" | "ARCHIVED";
  productId: string | null;
  caption: string;
  hashtags: string[];
  data: SocialPostData;
  fingerprint: string;
  createdAt: Date;
  publishedAt: Date | null;
};

type PreparedSocialPost = {
  post: PersistedSocialPost;
  created: boolean;
};

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function historySince(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function toReliableProducts(
  products: Array<{
    id: string;
    name: string;
    image: string;
    category: string;
    offers: Array<{
      id: string;
      marketplace: string;
      price: number;
      oldPrice: number | null;
      image: string | null;
    }>;
  }>,
): ReliableProduct[] {
  return products
    .map((product) => {
      const offers = product.offers
        .filter((offer) => Number.isFinite(offer.price) && offer.price > 0)
        .sort((left, right) => left.price - right.price)
        .map((offer) => ({
          id: offer.id,
          marketplace: offer.marketplace,
          label: marketplaceLabel(offer.marketplace),
          price: offer.price,
          oldPrice:
            offer.oldPrice &&
            Number.isFinite(offer.oldPrice) &&
            offer.oldPrice > offer.price
              ? offer.oldPrice
              : null,
        }));

      const image =
        validHttpsImageUrl(product.image) ??
        validHttpsImageUrl(product.offers[0]?.image);

      return {
        id: product.id,
        name: product.name.trim(),
        image,
        category: product.category.trim() || null,
        offers,
      };
    })
    .filter(
      (product) =>
        product.name.length > 0 &&
        product.image !== null &&
        hasComparablePrices(product),
    );
}

async function socialHistory(): Promise<SocialHistoryEntry[]> {
  return prisma.socialPost.findMany({
    orderBy: { createdAt: "desc" },
    take: HISTORY_SIZE,
    select: {
      type: true,
      productId: true,
      fingerprint: true,
      createdAt: true,
    },
  });
}

async function eligibleProducts(
  history: SocialHistoryEntry[],
  now: Date,
): Promise<ReliableProduct[]> {
  const cutoff = historySince(PRODUCT_REPEAT_WINDOW_DAYS, now);

  const recentProductIds = history
    .filter((entry) => entry.productId && entry.createdAt >= cutoff)
    .map((entry) => entry.productId!);

  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(recentProductIds.length > 0
        ? { id: { notIn: recentProductIds } }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
    select: {
      id: true,
      name: true,
      image: true,
      category: true,
      offers: {
        where: {
          active: true,
          available: true,
          status: "ACTIVE",
          matchStatus: { in: ["EXACT", "HIGH"] },
          price: { gt: 0 },
        },
        orderBy: { price: "asc" },
        select: {
          id: true,
          marketplace: true,
          price: true,
          oldPrice: true,
          image: true,
        },
      },
    },
  });

  return toReliableProducts(products);
}

function selectContentForSlot(
  slot: SocialPostSlot,
  history: SocialHistoryEntry[],
  products: ReliableProduct[],
): GeneratedSocialContent {
  const product = products[0];

  if (product) {
    const type = pricePostTypeForSlot(slot);

    return buildPriceContent(
      type,
      product,
      variantIndexFor(type, history),
    );
  }

  const fallbackType = fallbackPostTypeForSlot(slot);

  return selectDistinctEvergreenContent(
    fallbackType,
    history,
  );
}

function selectDistinctEvergreenContent(
  type: Extract<
    SocialPostType,
    "SAVING_TIP" | "ENGAGEMENT_QUESTION" | "SHOPPING_CURIOSITY"
  >,
  history: SocialHistoryEntry[],
): GeneratedSocialContent {
  const usedFingerprints = new Set(
    history.map((entry) => entry.fingerprint),
  );

  const start = variantIndexFor(type, history);

  for (let offset = 0; offset < 125; offset += 1) {
    const candidate = buildEvergreenContent(type, start + offset);

    if (!usedFingerprints.has(candidate.fingerprint)) {
      return candidate;
    }
  }

  return buildEvergreenContent(type, start);
}

function serialize(post: {
  id: string;
  dayKey: string;
  slot: SocialPostSlot;
  type: SocialPostType;
  status: "READY" | "PUBLISHED" | "ARCHIVED";
  productId: string | null;
  caption: string;
  hashtags: string[];
  data: Prisma.JsonValue;
  fingerprint: string;
  createdAt: Date;
  publishedAt: Date | null;
}): PersistedSocialPost {
  return {
    ...post,
    data: post.data as unknown as SocialPostData,
  };
}

function sortBySlot(
  posts: PersistedSocialPost[],
): PersistedSocialPost[] {
  const order = new Map(
    SOCIAL_POST_SLOTS.map((slot, index) => [slot, index]),
  );

  return [...posts].sort(
    (left, right) =>
      (order.get(left.slot) ?? 99) -
      (order.get(right.slot) ?? 99),
  );
}

export async function getDailySocialPosts(
  now = new Date(),
): Promise<PersistedSocialPost[]> {
  const posts = await prisma.socialPost.findMany({
    where: {
      dayKey: getBrazilDateKey(now),
      status: { in: ["READY", "PUBLISHED"] },
    },
    select: {
      id: true,
      dayKey: true,
      slot: true,
      type: true,
      status: true,
      productId: true,
      caption: true,
      hashtags: true,
      data: true,
      fingerprint: true,
      createdAt: true,
      publishedAt: true,
    },
  });

  return sortBySlot(posts.map(serialize));
}

export async function getDailySocialPost(
  now = new Date(),
  slot: SocialPostSlot = "MORNING",
): Promise<PersistedSocialPost | null> {
  const post = await prisma.socialPost.findFirst({
    where: {
      dayKey: getBrazilDateKey(now),
      slot,
      status: { in: ["READY", "PUBLISHED"] },
    },
    select: {
      id: true,
      dayKey: true,
      slot: true,
      type: true,
      status: true,
      productId: true,
      caption: true,
      hashtags: true,
      data: true,
      fingerprint: true,
      createdAt: true,
      publishedAt: true,
    },
  });

  return post ? serialize(post) : null;
}

export async function getSocialPostById(
  id: string,
): Promise<PersistedSocialPost | null> {
  const post = await prisma.socialPost.findFirst({
    where: {
      id,
      status: { in: ["READY", "PUBLISHED"] },
    },
    select: {
      id: true,
      dayKey: true,
      slot: true,
      type: true,
      status: true,
      productId: true,
      caption: true,
      hashtags: true,
      data: true,
      fingerprint: true,
      createdAt: true,
      publishedAt: true,
    },
  });

  return post ? serialize(post) : null;
}

export async function prepareDailySocialPosts(
  now = new Date(),
): Promise<PreparedSocialPost[]> {
  const dayKey = getBrazilDateKey(now);
  const existingPosts = await getDailySocialPosts(now);

  const postsBySlot = new Map<SocialPostSlot, PersistedSocialPost>(
    existingPosts.map((post) => [post.slot, post]),
  );

  const createdBySlot = new Map<SocialPostSlot, boolean>();

  const history = await socialHistory();
  const products = await eligibleProducts(history, now);

  let workingHistory = [...history];

  const usedProductIds = new Set(
    existingPosts
      .map((post) => post.productId)
      .filter((productId): productId is string => Boolean(productId)),
  );

  for (const slot of SOCIAL_POST_SLOTS) {
    if (postsBySlot.has(slot)) {
      createdBySlot.set(slot, false);
      continue;
    }

    const prioritizedProducts = prioritizeUnusedProducts(
      products,
      usedProductIds,
    );

    const content = selectContentForSlot(
      slot,
      workingHistory,
      prioritizedProducts,
    );

    try {
      const created = await prisma.socialPost.create({
        data: {
          dayKey,
          slot,
          type: content.type,
          productId: content.productId,
          caption: content.caption,
          hashtags: content.hashtags,
          data: content.data as unknown as Prisma.InputJsonValue,
          fingerprint: content.fingerprint,
        },
        select: {
          id: true,
          dayKey: true,
          slot: true,
          type: true,
          status: true,
          productId: true,
          caption: true,
          hashtags: true,
          data: true,
          fingerprint: true,
          createdAt: true,
          publishedAt: true,
        },
      });

      const serialized = serialize(created);

      postsBySlot.set(slot, serialized);
      createdBySlot.set(slot, true);

      if (serialized.productId) {
        usedProductIds.add(serialized.productId);
      }

      workingHistory = [
        {
          type: serialized.type,
          productId: serialized.productId,
          fingerprint: serialized.fingerprint,
          createdAt: serialized.createdAt,
        },
        ...workingHistory,
      ].slice(0, HISTORY_SIZE);
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const concurrentPost = await getDailySocialPost(now, slot);

      if (!concurrentPost) {
        throw error;
      }

      postsBySlot.set(slot, concurrentPost);
      createdBySlot.set(slot, false);

      if (concurrentPost.productId) {
        usedProductIds.add(concurrentPost.productId);
      }

      workingHistory = [
        {
          type: concurrentPost.type,
          productId: concurrentPost.productId,
          fingerprint: concurrentPost.fingerprint,
          createdAt: concurrentPost.createdAt,
        },
        ...workingHistory,
      ].slice(0, HISTORY_SIZE);
    }
  }

  return SOCIAL_POST_SLOTS.map((slot) => {
    const post = postsBySlot.get(slot);

    if (!post) {
      throw new Error(
        `Social post do slot ${slot} não foi preparado para ${dayKey}.`,
      );
    }

    return {
      post,
      created: createdBySlot.get(slot) ?? false,
    };
  });
}

export async function prepareDailySocialPost(
  now = new Date(),
): Promise<PreparedSocialPost> {
  const posts = await prepareDailySocialPosts(now);

  const morning = posts.find(
    (result) => result.post.slot === "MORNING",
  );

  if (!morning) {
    throw new Error("Post social MORNING não foi preparado.");
  }

  return morning;
}

export type {
  PersistedSocialPost,
  PreparedSocialPost,
};