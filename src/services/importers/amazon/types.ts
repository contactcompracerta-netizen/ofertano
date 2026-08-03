export type AmazonImage = {
    url: string;
  };
  
  export type AmazonOffer = {
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
  
    affiliateLink: string;
  
    asin: string;
  };