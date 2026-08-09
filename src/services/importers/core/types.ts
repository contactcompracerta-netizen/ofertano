export type MarketplaceName =
  | "Mercado Livre"
  | "Amazon"
  | "Shopee"
  | "Magazine Luiza"
  | "AliExpress";

export interface ProductImport {
  marketplace: MarketplaceName;

  externalId: string;

  /*
   * URL original/canônica do produto.
   */
  url: string;

  /*
   * Link individual de afiliado.
   */
  affiliateLink?: string | null;

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

  sales: number | null;

  stock: number | null;

  seller: string | null;

  attributes: Record<string, string>;
}