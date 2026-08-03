import prisma from "@/lib/prisma";
import { mercadoLivreFetch } from "@/lib/mercadolivre";

type HighlightType =
  | "PRODUCT"
  | "ITEM"
  | "USER_PRODUCT";

type HighlightEntry = {
  id?: string;
  position?: number;
  type?: HighlightType;
};

type HighlightsResponse = {
  content?: HighlightEntry[];
};

type CatalogPicture = {
  url?: string;
  secure_url?: string;
};

type CatalogProduct = {
  id?: string;
  name?: string;
  family_name?: string;
  pictures?: CatalogPicture[];
};

type CatalogOffer = {
  item_id?: string;
  price?: number;
  original_price?: number | null;
  status?: string;
  category_id?: string;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
};

type CatalogItemsResponse = {
  results?: CatalogOffer[];
};

type CategoryResponse = {
  id?: string;
  name?: string;
};

type OpportunityCandidate = {
  externalId: string;
  sourceUrl: string;
  title: string;
  image: string | null;
  categoryId: string;
  categoryName: string;
  price: number;
  oldPrice: number;
  discount: number;
};

export type DiscoveryResult = {
  categoryId: string;
  categoryName: string;
  requested: number;
  scanned: number;
  eligible: number;
  added: number;
  ignored: number;
};

function limitQuantity(value: number): number {
  if (!Number.isInteger(value)) {
    return 5;
  }

  return Math.min(Math.max(value, 1), 10);
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];

  for (
    let index = result.length - 1;
    index > 0;
    index -= 1
  ) {
    const randomIndex = Math.floor(
      Math.random() * (index + 1)
    );

    [result[index], result[randomIndex]] = [
      result[randomIndex],
      result[index],
    ];
  }

  return result;
}

function chooseDiscountedOffer(
  offers: CatalogOffer[]
): CatalogOffer | null {
  const validOffers = offers.filter((offer) => {
    const price = offer.price;
    const oldPrice = offer.original_price;

    return (
      typeof offer.item_id === "string" &&
      typeof price === "number" &&
      price > 0 &&
      typeof oldPrice === "number" &&
      oldPrice > price &&
      offer.status !== "inactive" &&
      offer.status !== "closed"
    );
  });

  if (validOffers.length === 0) {
    return null;
  }

  return validOffers.sort((first, second) => {
    const firstDiscount =
      ((first.original_price! - first.price!) /
        first.original_price!) *
      100;

    const secondDiscount =
      ((second.original_price! - second.price!) /
        second.original_price!) *
      100;

    return secondDiscount - firstDiscount;
  })[0];
}

function getProductImage(
  catalog: CatalogProduct,
  offer: CatalogOffer
): string | null {
  const picture = catalog.pictures?.find(
    (item) => item.secure_url || item.url
  );

  return (
    picture?.secure_url ||
    picture?.url ||
    offer.secure_thumbnail ||
    offer.thumbnail ||
    null
  );
}

async function resolveCandidate(
  highlight: HighlightEntry,
  categoryId: string,
  categoryName: string
): Promise<OpportunityCandidate | null> {
  if (
    highlight.type !== "PRODUCT" ||
    typeof highlight.id !== "string"
  ) {
    return null;
  }

  try {
    const [catalog, catalogItems] =
      await Promise.all([
        mercadoLivreFetch(
          `/products/${highlight.id}`
        ) as Promise<CatalogProduct>,

        mercadoLivreFetch(
          `/products/${highlight.id}/items`
        ) as Promise<CatalogItemsResponse>,
      ]);

    const offer = chooseDiscountedOffer(
      catalogItems.results ?? []
    );

    if (!offer) {
      return null;
    }

    const price = offer.price!;
    const oldPrice = offer.original_price!;

    const discount = Math.round(
      ((oldPrice - price) / oldPrice) * 100
    );

    if (discount <= 0) {
      return null;
    }

    const title =
      catalog.name?.trim() ||
      catalog.family_name?.trim();

    if (!title) {
      return null;
    }

    const sourceUrl =
      offer.permalink?.trim() ||
      `https://www.mercadolivre.com.br/p/${highlight.id}`;

    return {
      externalId: highlight.id,
      sourceUrl,
      title,
      image: getProductImage(
        catalog,
        offer
      ),
      categoryId:
        offer.category_id || categoryId,
      categoryName,
      price,
      oldPrice,
      discount,
    };
  } catch (error) {
    console.error(
      `Falha ao analisar oportunidade ${highlight.id}:`,
      error
    );

    return null;
  }
}

export async function discoverMercadoLivreOpportunities(
  rawCategoryId: string,
  rawQuantity: number
): Promise<DiscoveryResult> {
  const categoryId =
    rawCategoryId.trim().toUpperCase();

  const quantity =
    limitQuantity(rawQuantity);

  const [highlights, category] =
    await Promise.all([
      mercadoLivreFetch(
        `/highlights/MLB/category/${categoryId}`
      ) as Promise<HighlightsResponse>,

      mercadoLivreFetch(
        `/categories/${categoryId}`
      ) as Promise<CategoryResponse>,
    ]);

  const categoryName =
    category.name?.trim() || categoryId;

  const validHighlights =
    (highlights.content ?? []).filter(
      (entry) =>
        entry.type === "PRODUCT" &&
        typeof entry.id === "string"
    );

  const externalIds = validHighlights.map(
    (entry) => entry.id!
  );

  const existingOpportunities =
    externalIds.length > 0
      ? await prisma.productOpportunity.findMany({
          where: {
            externalId: {
              in: externalIds,
            },
          },
          select: {
            externalId: true,
          },
        })
      : [];

  const existingIds = new Set(
    existingOpportunities.map(
      (opportunity) =>
        opportunity.externalId
    )
  );

  const productHighlights = shuffle(
    validHighlights.filter(
      (entry) =>
        !existingIds.has(entry.id!)
    )
  );

  const opportunities: OpportunityCandidate[] =
    [];

  let scanned = 0;

  for (
    let index = 0;
    index < productHighlights.length &&
    opportunities.length < quantity;
    index += 4
  ) {
    const batch =
      productHighlights.slice(
        index,
        index + 4
      );

    scanned += batch.length;

    const results = await Promise.all(
      batch.map((highlight) =>
        resolveCandidate(
          highlight,
          categoryId,
          categoryName
        )
      )
    );

    for (const result of results) {
      if (
        result &&
        opportunities.length < quantity
      ) {
        opportunities.push(result);
      }
    }
  }

  const creation =
    opportunities.length > 0
      ? await prisma.productOpportunity.createMany({
          data: opportunities.map(
            (opportunity) => ({
              externalId:
                opportunity.externalId,
              sourceType: "PRODUCT",
              sourceUrl:
                opportunity.sourceUrl,
              title: opportunity.title,
              image: opportunity.image,
              categoryId:
                opportunity.categoryId,
              categoryName:
                opportunity.categoryName,
              price: opportunity.price,
              oldPrice:
                opportunity.oldPrice,
              discount:
                opportunity.discount,
              affiliateLink: null,
              status: "WAITING_AFFILIATE",
            })
          ),
          skipDuplicates: true,
        })
      : {
          count: 0,
        };

  return {
    categoryId,
    categoryName,
    requested: quantity,
    scanned,
    eligible: opportunities.length,
    added: creation.count,
    ignored:
      opportunities.length -
      creation.count,
  };
}