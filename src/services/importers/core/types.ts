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
   * LISTING-FIRST (Mercado Livre): `externalId` é SEMPRE o listingItemId
   * (ITEM_ID concreto do anúncio). `catalogProductId` é metadado
   * estrutural e NUNCA substitui o externalId.
   */
  catalogProductId?: string | null;

  /*
   * URL original/canônica do produto.
   *
   * Para MERCADO_LIVRE precisa representar a listing concreta
   * comprovada. URL `/p/MLB...` é rota de catálogo e é recusada.
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