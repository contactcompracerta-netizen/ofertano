export type MarketplaceName =
  | "Mercado Livre"
  | "Amazon"
  | "Shopee";

export interface ProductImport {
  marketplace: MarketplaceName;
  externalId: string;
  url: string;
  title: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  image: string;
  images: string[];
  price: number;
  oldPrice: number | null;
  discount: number | null;
  installments: string | null;
  rating: number | null;
  reviews: number | null;
  stock: number | null;
  seller: string | null;
  attributes: Record<string, string>;
}
