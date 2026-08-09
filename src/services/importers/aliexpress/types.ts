export type PaginaAliExpress = {
    html: string;
    requestedUrl: string;
    finalUrl: string;
    affiliateLink: string | null;
  };
  
  export type AliExpressOffer = {
    externalId: string;
  
    sourceUrl: string;
  
    affiliateLink: string | null;
  
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
  };