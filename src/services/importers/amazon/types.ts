export type AmazonImage = {
  url: string;
};

export type AmazonOffer = {
  asin: string;

  affiliateLink: string;
  productUrl: string;

  title: string;
  brand?: string;

  price: number;
  oldPrice?: number;

  rating?: number;
  reviews?: number;

  image: string;
  images: string[];

  description?: string;
  category?: string;
  seller?: string;

  stock: number | null;

  attributes: Record<string, string>;
};