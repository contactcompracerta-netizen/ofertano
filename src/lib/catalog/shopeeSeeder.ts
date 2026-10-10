import {
  buscarOfertasShopeePorPalavraChave,
  type ShopeeAffiliateOffer,
} from "@/services/importers/shopee/api";
import type { ProductImport } from "@/services/importers/core/types";
import { toSafeExternalUrl } from "@/services/architecture/v1/security/safeUrl";

export const SHOPEE_CATALOG_KEYWORDS: readonly string[] = Object.freeze([
  "smartphone",
  "iphone",
  "samsung galaxy",
  "xiaomi redmi",
  "motorola",
  "notebook",
  "monitor",
  "smart tv",
  "fone bluetooth",
  "caixa de som",
  "mouse sem fio",
  "teclado",
  "ssd",
  "air fryer",
  "cafeteira",
  "liquidificador",
  "aspirador de po",
  "ventilador",
  "ar condicionado",
  "geladeira",
  "microondas",
  "maquina de lavar",
  "colchao",
  "tenis masculino",
  "tenis feminino",
  "ferramentas",
  "furadeira",
  "parafusadeira",
  "camera seguranca",
  "roteador wifi",
]);

export type ShopeeSeedCandidate = {
  externalId: string;
  shopId: string;
  keyword: string;
  product: ProductImport;
};

export type ShopeeSeedCollection = {
  candidates: ShopeeSeedCandidate[];
  scanned: number;
  invalid: number;
  duplicateExternalIds: number;
  keywordsQueried: string[];
};

function numberOrNull(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(",", "."))
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function safeHttps(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const result = toSafeExternalUrl(value.trim());
  return result.ok && result.url?.startsWith("https://") ? result.url : null;
}

export function toShopeeProductImport(
  offer: ShopeeAffiliateOffer,
): ProductImport | null {
  const externalId = String(offer.itemId ?? "").trim();
  const title = String(offer.productName ?? "").trim();
  const price = positiveNumber(offer.price);
  const productUrl = safeHttps(offer.productLink);
  const affiliateLink = safeHttps(offer.offerLink);
  const image = safeHttps(offer.imageUrl);

  if (!externalId || !title || price === null || !productUrl || !affiliateLink || !image) {
    return null;
  }

  const rating = numberOrNull(offer.ratingStar);
  const sales = numberOrNull(offer.sales);
  const discount = numberOrNull(offer.priceDiscountRate);
  const shopName = String(offer.shopName ?? "").trim() || null;
  const categoryIds = Array.isArray(offer.productCatIds)
    ? offer.productCatIds.map((id) => String(id)).filter(Boolean)
    : [];

  return {
    marketplace: "Shopee",
    externalId,
    url: productUrl,
    affiliateLink,
    title,
    description: null,
    brand: null,
    category: categoryIds.length > 0
      ? `Shopee:${categoryIds.join("/")}`
      : "Shopee",
    image,
    images: [image],
    price,
    oldPrice: null,
    discount:
      discount !== null && discount > 0 && discount < 100
        ? Math.round(discount)
        : null,
    installments: null,
    rating,
    reviews: null,
    sales,
    stock: null,
    seller: shopName,
    attributes: {
      ...(shopName ? { LOJA: shopName } : {}),
      SHOP_ID: String(offer.shopId ?? ""),
      ...(categoryIds.length > 0 ? { CATEGORY_IDS: categoryIds.join(",") } : {}),
    },
  };
}

export function dedupeShopeeSeedCandidates(
  rows: readonly ShopeeSeedCandidate[],
): { rows: ShopeeSeedCandidate[]; duplicates: number } {
  const seen = new Set<string>();
  const deduped: ShopeeSeedCandidate[] = [];
  let duplicates = 0;

  for (const row of rows) {
    if (seen.has(row.externalId)) {
      duplicates += 1;
      continue;
    }
    seen.add(row.externalId);
    deduped.push(row);
  }

  return { rows: deduped, duplicates };
}

export async function collectShopeeCatalogCandidates(options: {
  limit: number;
  keywordOffset?: number;
  keywordCount?: number;
}): Promise<ShopeeSeedCollection> {
  const limit = Math.min(Math.max(Math.trunc(options.limit), 1), 1500);
  const keywordOffset = Math.max(Math.trunc(options.keywordOffset ?? 0), 0);
  const keywordCount = Math.min(Math.max(Math.trunc(options.keywordCount ?? 12), 1), 30);

  const ordered = Array.from(
    { length: SHOPEE_CATALOG_KEYWORDS.length },
    (_, index) =>
      SHOPEE_CATALOG_KEYWORDS[
        (keywordOffset + index) % SHOPEE_CATALOG_KEYWORDS.length
      ],
  ).slice(0, keywordCount);

  const collected: ShopeeSeedCandidate[] = [];
  let scanned = 0;
  let invalid = 0;

  for (const keyword of ordered) {
    if (collected.length >= limit) break;

    const offers = await buscarOfertasShopeePorPalavraChave(
      keyword,
      Math.min(50, Math.max(limit - collected.length, 1)),
    );
    scanned += offers.length;

    for (const offer of offers) {
      const product = toShopeeProductImport(offer);
      if (!product) {
        invalid += 1;
        continue;
      }
      collected.push({
        externalId: product.externalId,
        shopId: String(offer.shopId ?? ""),
        keyword,
        product,
      });
    }
  }

  const deduped = dedupeShopeeSeedCandidates(collected);
  return {
    candidates: deduped.rows.slice(0, limit),
    scanned,
    invalid,
    duplicateExternalIds: deduped.duplicates,
    keywordsQueried: ordered,
  };
}
