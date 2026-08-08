export type MarketplaceName =
  | "Mercado Livre"
  | "Amazon"
  | "Shopee";

export interface ProductImport {
  marketplace: MarketplaceName;

  externalId: string;

  /*
   * URL original/canônica do produto.
   */
  url: string;

  /*
   * Link individual de afiliado.
   *
   * Opcional para manter compatibilidade
   * com os importadores já existentes.
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