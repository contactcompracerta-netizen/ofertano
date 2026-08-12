import type {
    MarketplaceName,
    ProductImport,
  } from "@/services/importers/core/types";
  
  export type DiscoveryMarketplace =
    | "MERCADO_LIVRE"
    | "AMAZON"
    | "SHOPEE"
    | "MAGAZINE_LUIZA"
    | "ALIEXPRESS";
  
  export type DiscoveryStatus =
    | "FOUND"
    | "NOT_FOUND"
    | "UNAVAILABLE"
    | "ERROR";
  
  export type DiscoveryCandidate = {
    marketplace: DiscoveryMarketplace;
  
    marketplaceName: MarketplaceName;
  
    externalId: string;
  
    sourceUrl: string;
  
    affiliateLink?: string | null;
  
    title: string;
  
    image: string | null;
  
    price: number | null;
  
    oldPrice: number | null;
  
    category?: string | null;
  
    brand?: string | null;
  
    seller?: string | null;
  
    status: DiscoveryStatus;
  
    error?: string | null;
  };
  
  export type DiscoveryQuery = {
    query: string;
  
    normalizedQuery: string;
  
    limit: number;
  
    targetProductId?: string | null;
  };
  
  export type MarketplaceDiscoveryResult = {
    marketplace: DiscoveryMarketplace;
  
    query: string;
  
    success: boolean;
  
    candidates: DiscoveryCandidate[];
  
    scanned: number;
  
    error?: string | null;
  };
  
  export type ProductDiscoveryResult = {
    query: string;
  
    normalizedQuery: string;
  
    startedAt: Date;
  
    completedAt: Date;
  
    results: MarketplaceDiscoveryResult[];
  
    candidates: DiscoveryCandidate[];
  
    found: number;
  
    errors: number;
  };
  
  export type MarketplaceSearcher = (
    request: DiscoveryQuery,
  ) => Promise<MarketplaceDiscoveryResult>;
  
  export type DiscoveryAdapter = {
    marketplace: DiscoveryMarketplace;
  
    marketplaceName: MarketplaceName;
  
    enabled: boolean;
  
    searcher: MarketplaceSearcher | null;
  };
  
  export type ImportedDiscoveryCandidate = {
    candidate: DiscoveryCandidate;
  
    product: ProductImport;
  };