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
     * LISTING-FIRST: em MERCADO_LIVRE, `externalId` e sempre o
     * ITEM_ID concreto do anuncio. `catalogProductId` e METADADO
     * estrutural e nunca substitui o listingItemId.
     */
    listingItemId?: string | null;

    catalogProductId?: string | null;

    sellerId?: string | null;

    /*
     * Proveniencia estrutural do candidato em MERCADO_LIVRE.
     *
     * `CATALOG` nunca pode virar oferta: e enriquecimento/matching auxiliar.
     * `LISTING` e o unico caminho autorizado, porque so ele carrega
     * seller/preco reais do anuncio comprado.
     */
    origin?: "LISTING" | "CATALOG" | null;

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

    signal?: AbortSignal;
  };
  
  export type MarketplaceSearchOutcome =
    | "SEARCH_COMPLETED"
    | "EMPTY_VALID"
    | "BLOCKED"
    | "LISTING_SOURCE_BLOCKED"
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
     *
     * LISTING_SOURCE_BLOCKED = fail-closed do modo LISTING_FIRST:
     * as fontes de ANUNCIO foram bloqueadas e o catalogo nao pode virar
     * oferta. Zero oferta nova e o resultado correto.
     */
    searchOutcome?: MarketplaceSearchOutcome;

    /*
     * Modo de aquisicao. Mercado Livre sempre responde LISTING_FIRST:
     * so anuncio concreto (ITEM_ID) pode gerar oferta.
     */
    discoveryMode?: "LISTING_FIRST";
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