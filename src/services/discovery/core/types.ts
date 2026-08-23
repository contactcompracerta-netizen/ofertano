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

    /*
     * Evidencia estruturada opcional da marketplace.
     * Nem todo adapter fornece atributos; quando ausente,
     * o motor global de identidade trabalha com titulo + marca.
     */
    attributes?: Record<string, string> | null;
  
    seller?: string | null;
  
    status: DiscoveryStatus;
  
    error?: string | null;
  };
  
  export type DiscoveryQuery = {
    query: string;
  
    normalizedQuery: string;
  
    limit: number;
  
    mode?: "DEFAULT" | "MULTILOJA";


  
    targetProductId?: string | null;
  };
  
  export type MarketplaceSearchOutcome =
    | "SEARCH_COMPLETED"
    | "EMPTY_VALID"
    | "BLOCKED"
    | "UNUSABLE"
    | "ERROR"
    | "NOT_RUN";

  export type MarketplaceDiscoveryResult = {
    marketplace: DiscoveryMarketplace;
  
    query: string;
  
    success: boolean;
  
    candidates: DiscoveryCandidate[];
  
    scanned: number;
  
    error?: string | null;

    degraded?: boolean;

    blockedSources?: string[];

    unusableSources?: string[];

    sourcesTried?: string[];

    /*
     * Estado estrutural da busca nesta loja.
     * SEARCH_COMPLETED e EMPTY_VALID contam como pesquisa real.
     * BLOCKED, UNUSABLE, ERROR e NOT_RUN nao contam.
     */
    searchOutcome?: MarketplaceSearchOutcome;
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