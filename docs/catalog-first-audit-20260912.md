# Catalog-First Audit — Ofertano

## 1. Executive Summary

O Ofertano já possui uma base sólida de identidade, agrupamento e publicação pública, mas a arquitetura atual ainda é híbrida e fortemente orientada a live acquisition. A resposta pública é gerada por `searchCatalogOrDiscover()` no caminho do usuário, com decisão principal em `searchMultistoreV2()` e fallback legado em `searchCatalog()` + `descobrirProdutos()`.

O projeto não possui um índice de busca persistente em PostgreSQL (nenhum `tsvector`, `GIN`, `pg_trgm`, `full-text` no schema, nem `SearchDocument`/`ProductSearchDocument`), e a busca pública continua dependendo de múltiplas consultas para marketplaces externos e de pós-processamento em memória. Em outras palavras, a busca ainda constrói parte do catálogo em tempo de resposta.

A base que pode servir a Catalog-First já existe em partes:

- `Product` e `MarketplaceOffer` têm identidade e persistência suficientes para um produto canônico e ofertas por loja;
- `saveProduct()` aplica validação de identidade e `matchStatus`/`matchScore`;
- `multistore-v2` já implementa clustering, canonicalização, publicação, exclusão de acessórios/peças, e busca por identidade;
- há rotinas de cron para catalog regression e import/populate em background, mas ainda não existe um pipeline catalog-first completo e consistente.

A recomendação principal é tratar o presente como um sistema híbrido com forte base de identidade, porém ainda sem catálogo local de busca. A migração futura deve preservar o legacy path até que o local search e o write path catalog-first estejam estáveis.

## 2. Current Architecture

Arquitetura atual observada no código:

- `src/app/page.tsx` consulta `searchCatalogOrDiscover()` quando há `?q=`;
- `src/services/search/searchCatalogOrDiscover.ts` decide por catálogo local (`searchCatalog`) e/ou discovery live (`descobrirProdutos`/`searchMultistoreV2`);
- `src/services/multistore-v2/search.ts` monta query intent, busca em marketplaces, normaliza, reordena por relevância, clusteriza candidates, canonicaliza e produz `ComparableProductResult` ou `SingleMarketplaceSearchResult`;
- `src/services/multistore-v2/persist.ts` persiste produtos canônicos e ofertas em Prisma;
- `src/services/database/saveProduct.ts` grava `Product` e `MarketplaceOffer` com checagem de identidade e `matchStatus`.

Fluxo atual, em termos práticos:

- `Home`/public search quer catalogar via busca do usuário;
- o sistema tenta resposta em catálogo local já persistido;
- se não encontra ou não é publicamente multiloja, dispara discovery em tempo real;
- o resultado pode ser persistido após resposta (ergo, ainda o tempo de resposta participa do processo de formação do catálogo).

## 3. Public Search Flow

### 3.1 Home

- `src/app/page.tsx`:
  - sem `?q=`: carregam produtos já publicados em `prisma.product` com `offers` válidas;
  - com `?q=`: chama `searchCatalogOrDiscover(busca, 5)`.

### 3.2 Search orchestration

- `src/services/search/searchCatalogOrDiscover.ts`
  - `normalizeQuery()` limita ao comprimento e normaliza espaços;
  - `searchCatalog()` filtra `Product` do banco usando `catalogFilter(query)`;
  - `rankDiscoveryCandidates()` reordena candidatos provenientes de discovery;
  - `importExactOffers()` faz importação de candidatos descobertos;
  - `searchCatalogOrDiscover()` escolhe um caminho em ordem:
    1. V2 multistore se `MULTISTORE_ENGINE` não for `legacy`;
    2. fallback legado: catálogo local + discovery live + persistência pública.

### 3.3 V2 multistore

- `src/services/multistore-v2/search.ts`:
  - cria deadline global (`createSearchDeadline` em `timeBudget.ts`);
  - chama `acquireMarketplaces()` para buscar em vários adapters em paralelo;
  - normaliza e reordena candidatos por relevância;
- clusteriza e canonicaliza;
  - executa `huntMissingStoreOffers()` para ampliar cobertura quando necessário;
  - seleciona resultados públicos (`searchVisible` / `publishable`);
  - produz `ComparableProductResult` + `SingleMarketplaceSearchResult`;
  - persiste opcionalmente com `persistCanonicalProducts()`.

### 3.4 Resultado final ao front-end

- `src/components/OffersSection.tsx` e `ProductCard` recebem `PublicProductView` ou resultados derivados.
- `src/services/publicVisibility/multiStoreVisibility.ts` exige `countDistinctPublicMarketplaces(...) >= 2` para visibilidade pública.
- Em outras palavras, a UI pública não mostra “comparação real” com uma só loja.

## 4. Critical Path

Caminho crítico atual constatado:

1. Usuário faz busca em home/search;
2. `searchCatalogOrDiscover` normaliza query;
3. `searchMultistoreV2` cria deadline e dispara acquisition em paralelo para marketplaces (`acquireMarketplaces`);
4. `scoreQueryRelevance` e `compareFingerprints` filtram candidatos;
5. `clusterCandidates` + `canonicalizeCluster` montam `CanonicalProduct`;
6. `isSearchVisible` / `isClusterPublishable` controlam a publicação para UI;
7. `persistCanonicalProducts` pode persistir `Product` + `MarketplaceOffer` durante ou após a resposta;
8. front-end renderiza `ProductCard`/`OffersSection`.

Responsabilidades por etapa:

| Etapa | Arquivo | Função | Responsabilidade | Acesso a rede | Acesso a DB |
| --- | --- | --- | --- | --- | --- |
| Query | `src/app/page.tsx` | `HomePage` | recebe e extrai `?q=` | Não | Não |
| Orquestração | `src/services/search/searchCatalogOrDiscover.ts` | `searchCatalogOrDiscover` | decide catálogo vs discovery | Não diretamente | Sim, via Prisma |
| Busca em marketplace | `src/services/multistore-v2/search.ts` | `acquireMarketplaces` | busca em vários adapters | Sim | Não |
| Relevância | `src/services/multistore-v2/queryRelevance.ts` | `scoreQueryRelevance` | filtra e classifica candidates | Não | Não |
| Clustering | `src/services/multistore-v2/cluster.ts` | `clusterCandidates` | agrupa anúncios equivalentes | Não | Não |
| Canonicalização | `src/services/multistore-v2/canonicalize.ts` | `canonicalizeCluster` | monta `CanonicalProduct` | Não | Não |
| Persistência | `src/services/multistore-v2/persist.ts` | `persistCanonicalProducts` | grava `Product` + `MarketplaceOffer` | Não | Sim |
| UI | `src/components/OffersSection.tsx` | `OffersSection` | renderiza resultados públicos | Não | Não |

## 5. Marketplace Acquisition

### 5.1 Adapters ativos

`src/services/discovery/core/registry.ts` registra:

- `MERCADO_LIVRE`
- `AMAZON`
- `SHOPEE`
- `MAGAZINE_LUIZA`
- `ALIEXPRESS`

Os adapters ativos são `buscarMercadoLivre`, `buscarAmazon`, `buscarShopee`, `buscarMagazineLuiza`, `buscarAliExpress`.

### 5.2 Uso real durante busca pública

- `searchMultistoreV2()` usa `listDiscoveryAdaptersAtivos()` e `acquireMarketplaces()`;
- `acquireMarketplaces()` percorre todos os adapters ativos em paralelo com `Promise.allSettled` sobre a lista de runs e `Promise.race` com deadline;
- `runWithConcurrency()` limita concorrência em `HUNT_CONCURRENCY = 2` para as fases de hunt.

### 5.3 Fallback, retry, timeout, cooldown

- Há `AbortController`/`composeAbortSignal` e `withTimeout` em `src/services/multistore-v2/timeBudget.ts` e `src/services/multistore-v2/search.ts`.
- Há timeouts por mercado com `hardBudgetMs` e `marketplaceBudgetMs`.
- Há fallbacks por query variant (`buildSearchPlan`, `buildAliExpressCompactFallbackQuery`).
- Há estratégia de `hunt` para completar lojas ausentes, mas sempre sob reserva temporal.
- `searchCompletionBarrier.ts` filtra buscas bloqueadas por 403/429/robots, e há classificação de `BLOCKED`/`EMPTY`/`ERROR`.

### 5.4 Padrões de execução

- Aquisição inicial: simultânea por marketplace;
- Hunt: concorrência controlada; não linearmente indiscriminada;
- Import exact offers: `Promise.allSettled` em `searchCatalogOrDiscover.ts` (`importExactOffers`).

## 6. Deadlines and Timeouts

Não existe literal `GLOBAL_DEADLINE_MS` no código. O valor atual relevante é o `DEFAULT_SEARCH_BUDGET` em `src/services/multistore-v2/timeBudget.ts`:

- `globalMs: 20_000`
- `marketplaceMs: 10_000`
- `fetchMs: 6_000`
- `persistReserveMs: 2_000`
- `hangGraceMs: 300`
- `huntReserveMs: 5_000`
- `relevanceReserveMs: 2_500`

`createSearchDeadline()` cria um `AbortController` que dispara em `budget.globalMs` e calcula `deadlineAt = startedAt + budget.globalMs`.

Aplicação real:

- `searchMultistoreV2()` usa `createSearchDeadline(budget)`;
- `acquireMarketplaces()` respeita `acquisitionEndAt = deadline.deadlineAt - responseReserveMs - persistReserveMs`;
- `withTimeout()` e `composeAbortSignal()` fragmentam o tempo por fase e por marketplace.

O que fica fora do limite global:

- a operação `saveProduct` e outras writes podem ser iniciadas apenas se `persistReady` for verdadeiro e houver tempo remanescente;
- writes que já iniciaram continuam até concluir, mas o código evita abrir novas gravações quando o deadline está quase no fim.

## 7. Product Model

### 7.1 Modelo atual

`prisma/schema.prisma` tem `Product` com identidade canônica:

- `canonicalName`, `canonicalKey`, `modelNumber`, `ean`, `gtin`, `mpn`, `brand`, `color`, `voltage`, `size`
- `publicationStatus`, `lastSearchedAt`, `sourceQuery`, `autoCreated`
- `offers`, `priceHistory`, `searchRequests`, `priceAlerts`, `socialPosts`

### 7.2 PK, unique, indexes, relationships

- PK: `id`
- Unique: `mlId`, `slug`, `canonicalKey`
- Índices: `active, updatedAt`, `category, active`, `brand, modelNumber`, `publicationStatus, updatedAt`
- Relações: `Product` -> `MarketplaceOffer` (1:N), `PriceHistory` (1:N), `PriceAlert`, `SearchRequest`.

### 7.3 Resposta ao questionamento

O Product atual já pode representar um produto canônico independente de uma busca? Sim, em parte. Ele já tem campos de identidade e links para ofertas. Porém, para um catálogo grande e robusto, faltam:

- tabela explícita de aliases / normalized titles;
- controle explícito de `family`, `concept`, `productClass` sem depender só de strings;
- `catalogVersion` / `sourceRank` / `lastCatalogRefresh`;
- `identityConfidence` e `status` de canonical integrity;
- melhor separação entre `Product` principal e `ProductVariant` / `ProductFamily`.

## 8. MarketplaceOffer Model

`MarketplaceOffer` em Prisma possui:

- `marketplace`, `externalId`, `sourceUrl`, `affiliateLink`
- `title`, `image`, `seller`, `price`, `oldPrice`, `stock`, `status`, `available`
- `matchStatus` (`EXACT`, `HIGH`, `REVIEW`, `REJECTED`)
- `matchScore`, `discoverySource`, `active`, `isBest`, `reviewReason`
- timestamps e `priceHistory`

### 8.1 Unique constraints

- `@@unique([productId, marketplace])`
- `@@unique([marketplace, externalId])`

Resposta precisa:

1. Esse constraint `@@unique([productId, marketplace])` permite múltiplos anúncios da mesma marketplace ligados ao mesmo Product? Não. Ele permite apenas um registro de marketplace por Product. Isso é correto para um “oferta principal por loja” do produto canônico, mas insuficiente para comparador grande com vários sellers/listings por loja.
2. O que acontece se Amazon/Shopee/ML tiverem múltiplos sellers/listings para o mesmo produto? Hoje o schema com `productId + marketplace` compacto tende a perder o pluralismo do marketplace, salvo pela mudança de `externalId` e ativação de um único registro por loja.
3. Esse constraint é adequado para um comparador grande? Parcialmente; funciona para a visão “uma oferta por loja por produto”, mas não para casos com vários sellers/variants por marketplace.
4. Evolução recomendada: estudar uma modelagem de `OfferListing` e `OfferVariant` por marketplace, com `productId`, `marketplace`, `sellerId`, `listingId`, `status`, `price`, `stock`, `affiliateLink`, `isPrimary`, `sourceKind`.

`@@unique([marketplace, externalId])` é a chave de deduplicação de anúncio real dentro de uma loja e serve para impedir duplicação de listing ao longo do tempo.

## 9. Identity / Matcher

### 9.1 Hierarquia real usada

Arquivos relevantes:

- `src/services/multistore-v2/queryIntent.ts`
- `src/services/multistore-v2/queryCore.ts`
- `src/services/multistore-v2/queryRelevance.ts`
- `src/services/multistore-v2/identityAnchors.ts`
- `src/services/multistore-v2/fingerprint.ts`
- `src/services/multistore-v2/pairMatcher.ts`
- `src/services/identity/resolver.ts`
- `src/services/identity/exactMatcher.ts`

A hierarquia usada no matcher atual é:

- `brand`
- `modelNumber` / `model`
- `manufacturerSku`
- `variantCodes`
- `capacity`, `size`, `color`, `voltage`, `quantity`
- `identityAnchors`
- `productClass` / concept / sold item nucleus
- text similarity and token overlap
- `compareFingerprints()` e `scoreQueryRelevance()`

### 9.2 Relações de identidade

- `SAME`: quando fingerprints e atributos convergem; regra “hard conflict” e `brandCompatible` etc.
- `DIFFERENT`: quando há conflito de marca, modelo, classe ou atributos críticos.
- `UNKNOWN`: quando a evidência é parcial.

### 9.3 Reutilização em background

O matcher é reutilizável em ingestão em background porque `scoreQueryRelevance`, `compareFingerprints`, `canonicalizeCluster`, `buildQueryIntent` são independentes de HTTP response. Porém o código atual ainda usa a query do usuário diretamente em certos pontos de ranking e de decisão de publicação, então parte da lógica continua read-path.

### 9.4 Quais partes são independentes de query

- `extractSanitizedIdentity()`, `buildFingerprint()`, `compareFingerprints()`, `canonicalizeCluster()`
- Product concept classification and attribute extraction
- `identityAnchors` and product role classification

### 9.5 Quais partes continuam no read path

- `scoreQueryRelevance()` com query-specific filters
- `buildQueryIntent(query)` e `buildQueryCore()`
- fase de hunt usando query-derived seeds
- `searchVisible` / `publishable` checks

## 10. Product Roles

Campos e classificações relevantes:

- `ProductRole = MAIN | ACCESSORY | REPLACEMENT_PART | UNKNOWN`
- `productConcepts.ts` e `normalizeCandidate.ts` classificam `ACCESSORY` e `REPLACEMENT_PART` com listas de cabeças como `case`, `capa`, `suporte`, `filtro`, etc.
- `src/services/identity/resolver.ts` também classifica itens como `ACCESSORY` / `REPLACEMENT_PART` / `PRIMARY`.

Conclusão: o sistema já tenta impedir `acessório = produto principal` e `peça de reposição = produto principal`, usando `hard conflicts` e `roleCompatibility`. Isso é crucial para Catalog-First e não deve ser enfraquecido.

## 11. Publication Barrier

A regra real de publicação é centralizada em `src/services/multistore-v2/publicationBarrier.ts` e `src/services/publicVisibility/multiStoreVisibility.ts`.

Regra observada:

- `countDistinctMarketplaces(offers) >= 2` para publicação pública;
- se `countDistinctMarketplaces` é 1, só é permitido se `coverageStatus === "COMPLETE"`.
- `hasPublicMultiStore` em `multiStoreVisibility.ts` exige ao menos dois marketplaces distintos em ofertas válidas.

Invariantes que não podem ser enfraquecidos:

- `cross-brand` hard conflict;
- strong model conflict;
- critical attribute conflict;
- accessory ≠ MAIN;
- replacement part ≠ MAIN;
- `UNKNOWN` não pode virar `SAME` sem evidência;
- `DIFFERENT` não pode virar `SAME`.

## 12. Singles

`SingleMarketplaceSearchResult` e `SINGLE_MARKETPLACE` são gerados em `src/services/multistore-v2/search.ts`.

Regra importante:

- 1 marketplace != comparação;
- `buildSingleMarketplaceResults()` cria single-marketplace ítens quando não há cluster comparável suficiente;
- `toSingleViews()` converte para `PublicProductView` de tipo `SINGLE_MARKETPLACE`.

A arquitetura futura deve aceitar que:

- `SINGLE_MARKETPLACE` pode existir no catálogo;
- não deve ser mostrado como comparação multi-loja;
- pode posteriormente evoluir para `COMPARABLE` quando receber mais ofertas.

## 13. Persistence

### 13.1 Quando Product é criado/atualizado

Em `saveProduct()`:

- `Product` é criado quando `upsertProduct` encontra um `Product` existente ou cria novo;
- `Product` é atualizado ao longo do upsert no `saveProduct` flow usando `canonicalName`, `canonicalKey`, `brand`, `modelNumber`, etc.

### 13.2 Quando MarketplaceOffer é criado/atualizado

- `saveProduct` chama upsert de `marketplaceOffer` por `marketplace+externalId` e `productId+marketplace`.
- `aplicarGuardaRejeicaoIdentidade()` preserva `REJECTED` mesmo quando uma nova proposta chega.

### 13.3 Duplicate avoidance

- `Product` deduplicado por `canonicalKey` e por `marketplace+externalId` em `MarketplaceOffer`.
- `resolveExistingProductId()` usa `findExistingProductIdFromOffers()` via `prisma.marketplaceOffer.findUnique({ marketplace_externalId })`.

### 13.4 Writes durante pesquisa pública

`searchCatalogOrDiscover()` e `searchMultistoreV2()` podem disparar writes via `persistCanonicalProducts()` no read path. A implementação tenta respeitar deadlines e não iniciar new writes quando o budget está no fim. Portanto a busca pública ainda participa de escrita no caminho crítico.

## 14. Existing Catalog Infrastructure

Há sinais de infraestrutura catalog-like parcial/embrionária:

- `src/app/api/cron/catalog-populate/route.ts` existe e chama `populateMercadoLivre(5)`;
- `src/app/api/cron/catalog-regression-monitor/route.ts` existe e executa `runCatalogRegressionCheck()`;
- `src/scripts/catalogRegressionMonitor.ts` e testes correlatos;
- `src/services/automation/populateMercadoLivre.ts` parece ingestão populacional/cron.

Conclusão: o projeto já tem catalog population e regression monitoring, mas ainda não é uma arquitetura catalog-first end-to-end. É um arcabouço embrionário de catálogo e observabilidade, não uma base de busca local completa.

## 15. Existing Search Infrastructure

### 15.1 Search index

`SEARCH_INDEX_CURRENTLY_EXISTS=NO` no schema atual.

Evidência direta:

- `prisma/schema.prisma` contém `Product` e `MarketplaceOffer`, mas não `SearchDocument`, `ProductSearchDocument`, `tsvector`, `GIN`, `GiST`.
- Não há `CREATE EXTENSION pg_trgm` ou `to_tsvector` em migrations/SQL.
- Código busca em memória e faz relevância via JavaScript, não via índice de banco.

### 15.2 Autocomplete

`AUTOCOMPLETE_EXISTS=NO` no código usando app-level search suggestions.

Há `autoComplete="off"` em inputs de busca em `src/components/Header.tsx` e `src/components/Hero.tsx`, mas não há serviço de suggestions/history. Isso é comportamento do browser e não da aplicação.

## 16. PostgreSQL Capabilities

Sem alterar banco, teoricamente o PostgreSQL do stack atual suporta:

- `pg_trgm`: sim, com `CREATE EXTENSION pg_trgm`; útil para similaridade aproximada;
- Full Text Search: sim, com `tsvector`, `tsquery`, `GIN`;
- GIN/GiST: sim, aptos para search vectors, ranges, JSONB/array queries;
- prefix/autocomplete: parcialmente via `text_pattern_ops`, `pg_trgm`, `ILIKE` + trigram e índice text search;
- filtros/ordenação por preço: sim;
- `marketplace count`: sim via agregations/joins.

Portanto, iniciar sem Algolia/Elastic/OpenSearch é razoável, desde que o catálogo seja canonizado e a busca local seja controlada por query normalization e clustering robustos.

## 17. Front-End Compatibility

O front-end atual já representa bem a estrutura:

- `Product` + `N` `MarketplaceOffer` é natural e já aparece em `ProductCard`, `OffersSection`, `/produto/[id]`, `/ofertas`, `/categorias`.
- Há comparação com preço mínimo, lojas, ofertas, affiliate button e checkout links.
- `Compare em X lojas` pode existir naturalmente quando existe `offers` com vários marketplaces.

O principal ajuste de arquitetura futura não é no front-end, mas na consistência da forma como a UI recebe dados públicos e comparáveis vs single-store.

## 18. Favorites / History / Alerts

- `PriceAlert`: `prisma/schema.prisma` model `PriceAlert` com dedupe por usuário/product.
- `PriceHistory`: armazenado com `productId`/`offerId`/`marketplace`.
- Favorites: há API e front-end para favoritos (`src/app/api/favorites`, `src/services/favorites`).

Um Product canônico estável melhora diretamente:

- favoritos são mais estáveis entre versões;
- histórico de preço fica ligado ao produto canônico em vez de anúncios únicos;
- alertas ficam menos frágeis;
- `lowest price` e `best offer` ficam menos ambíguos.

## 19. SEO Implications

Catalog-First pode fortalecer SEO de produto, sitemap e structured data, desde que `Product` canônico e `MarketplaceOffer` continuem ligados de forma consistente. A arquitetura atual já tem vários pontos de SEO (`src/lib/seo/product.ts`, `buildProductMetadata`, `buildProductStructuredData`), e o `Product` canônico pode ser uma base robusta para `AggregateOffer`/`Offer` sem depender de busca live.

## 20. Performance Bottlenecks

### Top 10 observados

1. `src/services/multistore-v2/search.ts` — `acquireMarketplaces` — external search across marketplace adapters — impact: high latency and timeout farming; helps: local catalog search reduces external waits.
2. `src/services/multistore-v2/search.ts` — `huntMissingStoreOffers` — multiple search attempts with concurrency control — impact: additional cross-network latency; helps: catalog-first reduces hunting need.
3. `src/services/multistore-v2/queryRelevance.ts` — heavy token and fingerprint scoring — impact: CPU/algorithmic cost; helps: local search index can pre-rank.
4. `src/services/multistore-v2/cluster.ts` and `canonicalizeCluster` — clustering and canonicalization in read path — impact: memory and CPU; helps: catalog-first does this in write path, not on every user query.
5. `src/services/multistore-v2/persist.ts` — `persistCanonicalProducts` — writes during live search path — impact: blocking and secondary writes; helps: move to background ingestion.
6. `src/services/discovery/index.ts` and marketplace-specific discovery modules — network + scraping + HTML parsing — impact: fragile and rate-limited; helps: lower reliance on live scraping.
7. `src/services/database/saveProduct.ts` — long transaction and identity validation — impact: DB time on hot path; helps: decouple ingestion from query response.
8. `src/services/multistore-v2/affiliateEligibility.ts` — affiliate resolution on ML offers — impact: extra per-offer checks; helps: cache result or do asynchronously.
9. `src/services/search/searchCatalogOrDiscover.ts` — `importExactOffers` via `Promise.allSettled` — impact: additional external network during fallback; helps: use catalog-first to avoid import triggers in most searches.
10. `src/app/page.tsx` / `OffersSection` — public Home loads and sorts multiple products — impact: moderate but not dominant; helps: fewer live fetches and better DB-read patterns.

## 21. Proposed Catalog-First Architecture

### WRITE PATH

Marketplace Adapters
↓
Raw Offer Acquisition
↓
Normalization
↓
Identity
↓
Product Matching
↓
Canonical Product
↓
MarketplaceOffer
↓
Search Index

### READ PATH

User Query
↓
Query Normalization
↓
Local Search Index
↓
Canonical Products
↓
MarketplaceOffers
↓
Ranking
↓
UI

Objetivo: a pesquisa normal não deve esperar marketplace externo.

## 22. Write Path

A arquitetura futura deve manter um write path separado e robusto:

- adapters por marketplace (`MercadoLivreAdapter`, `AmazonAdapter`, etc.);
- normalized schema comum;
- identity matching and canonical product assignment;
- persistence of `Product` and `MarketplaceOffer`;
- indexing/search document generation from stable canonical product metadata.

O repositório atual já contém os blocos principais, mas em versões mais acopladas. O objetivo futuro é separá-los por responsabilidade e por tempo de execução.

## 23. Read Path

A read path do futuro deve tentar:

- query normalization;
- cheap search in local catalog/index;
- fetch canonical product and offers from DB;
- rank by price, freshness, relevance and marketplace count;
- render without discovery fallback under normal conditions.

A busca de transição ainda pode usar discovery em fallback explícito, mas nunca deve ser a regra normal.

## 24. ProductSearchDocument

Para um documento de busca lógico, campos como `productId`, `normalizedTitle`, `brand`, `model`, `gtin`, `ean`, `mpn`, `category`, `aliases`, `searchText`, `lowestPrice`, `offerCount`, `marketplaceCount`, `popularity`, `updatedAt` são válidos.

Avaliação por campo:

- `productId`: exists / required
- `normalizedTitle`: derivable / could be precomputed
- `brand`, `model`, `gtin`, `ean`, `mpn`: exists or derivable
- `searchText`: new or derived; should be materialized for ranking performance
- `lowestPrice`, `offerCount`, `marketplaceCount`: derivable but expensive; use materialized view or denormalized columns
- `popularity`: new field required or aggregated from views/alerts

Recomendação:

- começar com índices no próprio `Product` e em `MarketplaceOffer`;
- em seguida, materialized view ou search document dedicado quando volume crescer.

## 25. Marketplace Ingestion

Os adapters ideais seriam:

- `MercadoLivreAdapter`
- `AmazonAdapter`
- `ShopeeAdapter`
- `MagazineLuizaAdapter`
- `AliExpressAdapter`

Cada um deve produzir uma estrutura normalizada comum, com `title`, `brand`, `price`, `url`, `image`, `seller`, `attributes`, `externalId`, `status`, `lastSeen`, `affiliateLink`.

O repositório já tem parte dessa infraestrutura em `services/discovery` e `services/importers`, mas ainda é fortemente acoplado à busca e não está separado em adapters de ingestão canônica.

## 26. Freshness Strategy

Estratégia de freshness recomendada:

- HOT: preços/estoque sensíveis, itens populares ou com alertas/favoritos;
- WARM: itens recentemente pesquisados ou com ofertas recentes;
- COLD: restante do catálogo.

Recomendação de atualização para product/offers:

- `price`, `stock`, `availability`, `removed offer`, `seller`, `affiliate link` devem ser atualizados por categoria de importância.
- `affiliateLink` precisa ser preservado e validado sem perder o link real da loja.

## 27. Progressive Catalog Growth

O catálogo não precisa começar importando toda a internet. A abordagem segura é priorizar:

- produtos hoje na página pública;
- buscas do usuário;
- produtos com favorito/alerta;
- categorias populares;
- oportunidades de baixa preço;
- importação incremental por cron.

## 28. Cache / Index Miss Strategy

Comportamento futuro recomendado:

- query → local catalog search;
- se encontrar: responder imediatamente;
- se não encontrar: responder de forma adequada e disparar pesquisa background de descoberta como fallback não bloqueante.

Durante a transição, discovery live síncrono ainda pode existir por feature flag ou por uma pequena janela de compatibilidade, mas não deve ser o default para buscas normais.

## 29. Incremental Migration

Plano incremental sugerido para este repositório:

### FASE A — observability
- Objetivo: medir latência, taxa de zero result, single marketplace rate, errors por marketplace.
- Arquivos prováveis: `src/services/search`, `src/services/multistore-v2`, `src/services/analytics`.
- Alteração de banco: baixa.
- Risco: baixo.
- Validação: logs e dashboards.
- Rollback: desativar coleta.

### FASE B — catalog ingestion
- Objetivo: separar write path de busca.
- Arquivos: `saveProduct`, `persist.ts`, cron routes.
- Alteração de banco: média.
- Risco: médio.
- Validação: importações recentes e consistência dos products.
- Rollback: manter legacy read path.

### FASE C — search document
- Objetivo: criar materialized search document / compact search index.
- Arquivos: Prisma schema + app search layer.
- Alteração de banco: média.
- Risco: médio.
- Validação: query correctness and catalog hit rate.
- Rollback: desabilitar feature flag.

### FASE D — local search shadow
- Objetivo: comparar resultados locais com resultados old live path.
- Arquivos: `searchCatalogOrDiscover` + logs.
- Alteração de banco: baixa.
- Risco: médio.
- Validação: shadow comparison and relevance regression metrics.

### FASE E — hybrid
- Objetivo: catalog local + live fallback opcional.
- Arquivos: `searchCatalogOrDiscover`.
- Alteração de banco: baixa.
- Risco: médio.

### FASE F — local-first
- Objetivo: leitura majoritariamente local;
- Risco: alto se identidade/canonicalização estiver incompleta;
- Validação: coverage, zero results, wrong grouping, rollback.

## 30. Rollback Strategy

A futura implementação deve preservar o legacy/live path durante a transição. Nenhuma etapa pode eliminar a busca atual de imediato.

Recomendação:

- manter `MULTISTORE_ENGINE=legacy` como toggle de rollback;
- manter fallback de discovery live por feature flag;
- separar search path por `catalog-first` vs `legacy` e comparar métricas.

## 31. Observability and Metrics

Métricas recomendadas:

- P50, P95, P99 latency
- zero result rate
- single marketplace rate
- comparable rate
- marketplace count
- matcher rejection rate
- wrong grouping incidents
- catalog hit rate
- fallback rate
- freshness
- errors por marketplace

O projeto já tem alguma base de analytics e search logging, e `src/services/analytics` / `SearchAnalytics` são bons pontos de entrada para observabilidade.

## 32. Performance Targets

Sem evidência de produção em ambiente real, as metas seguintes são apenas metas de planejamento:

- P50 < 200 ms (servidor + DB)
- P95 < 500 ms (servidor + DB)
- tempo percebido total: incluir latência de servidor + banco + render

Não é possível afirmar que essas metas já são atingíveis sem medir o ambiente real e sem uma base de busca local estável.

## 33. Risk Matrix

| Risco | Severidade | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- | --- |
| wrong product grouping | Alta | Média | Alto | hard conflicts + identity + canonical review |
| cross-brand | Alta | Baixa | Alto | brand compatibility gate |
| wrong model | Alta | Média | Alto | strong model conflicts |
| wrong voltage | Alta | Média | Alto | critical attribute enforcement |
| accessory grouped as MAIN | Alta | Média | Alto | role classification hard blocks |
| replacement part grouped as MAIN | Alta | Média | Alto | replacement role check |
| stale price | Média | Alta | Médio | freshness strategy |
| stale stock | Média | Alta | Médio | HOT/WARM/COLD refresh |
| removed offer | Média | Alta | Médio | tombstone/lastSeen and cleanup |
| affiliate link lost | Alta | Média | Alto | preserve raw and validate only |
| duplicate Product | Alta | Média | Alto | unique canonicalKey + offer dedupe |
| duplicate MarketplaceOffer | Alta | Média | Alto | `marketplace + externalId` unique |
| single shown as comparison | Alta | Média | Alto | `SINGLE_MARKETPLACE` strict separation |
| catalog growth | Média | Alta | Médio | progressive ingestion |
| cron timeout | Média | Média | Médio | budget-aware cron and retry |
| crawler blocking | Alta | Média | Alto | adapter isolation + fallback |
| 429 / 403 | Alta | Alta | Alto | backoff + signal + dedupe |
| search relevance regression | Alta | Média | Alto | shadow comparisons |
| index stale | Média | Média | Médio | freshness + invalidation |
| bad migration | Alta | Baixa | Alto | feature flag + rollback |
| rollback failure | Alta | Baixa | Alto | keep legacy path active |

## 34. Invariants to Preserve

A implementação futura deve preservar explícita e rigorosamente:

- cross-brand hard conflict
- strong model conflict
- critical attribute conflict
- accessory ≠ MAIN
- replacement part ≠ MAIN
- `UNKNOWN` não pode virar `SAME` sem evidência
- `DIFFERENT` não pode virar `SAME`
- single marketplace não pode virar comparação falsa
- publicação pública continua protegida
- affiliate links devem ser preservados
- nenhuma fake store
- nenhuma fake offer

## 35. Probable Files for Future Changes

Arquivos prováveis para a evolução Catalog-First:

- `src/services/multistore-v2/search.ts`
- `src/services/multistore-v2/persist.ts`
- `src/services/multistore-v2/queryRelevance.ts`
- `src/services/multistore-v2/pairMatcher.ts`
- `src/services/multistore-v2/canonicalize.ts`
- `src/services/multistore-v2/publicationBarrier.ts`
- `src/services/database/saveProduct.ts`
- `src/services/search/searchCatalogOrDiscover.ts`
- `prisma/schema.prisma`
- `src/services/discovery/core/registry.ts`

## 36. Database Changes That May Eventually Be Needed

Mudanças prováveis em schema futuro:

- `ProductSearchDocument` table or materialized view;
- `normalizedTitle`, `canonicalAlias`, `searchText`, `catalogStatus` fields;
- `ProductFamily` / `ProductVariant` separation;
- `MarketplaceOffer` expansion for multi-seller listing support;
- indexes on `canonicalKey`, `brand`, `modelNumber`, `searchText`, `updatedAt`, `price`;
- `OfferFreshness` or `OfferSnapshot` table for price/stock history and freshness windows.

## 37. Recommended Mission Sequence

1. Mission — Catalog foundation
2. Mission — Offer ingestion and normalization
3. Mission — Search document and local index
4. Mission — Catalog search shadow
5. Mission — Background discovery fallback
6. Mission — Grouping and canonical remediation
7. Mission — Compare em X lojas and product page consistency
8. Mission — Autocomplete and suggestions
9. Mission — Freshness and monitoring
10. Mission — Production cutover

## 38. Final Recommendation

O projeto já tem os blocos essenciais para um Catalog-First realista: modelo de produto, oferta, identidade, clustering, publicação, cron e analytics. O que falta não é “a ideia”, mas um hardening do write path e da base local de busca. O código atual ainda é um sistema híbrido e read-path heavy, com live discovery e write during query. A etapa mais valiosa para o próximo avanço é separar a ingestão/canonicalização do read path e criar um search document estável antes de tentar migrar totalmente a busca pública para catálogo local.

## 39. Evidence Summary

Arquivos centrais consultados:

- `src/services/search/searchCatalogOrDiscover.ts`
- `src/services/multistore-v2/search.ts`
- `src/services/multistore-v2/persist.ts`
- `src/services/multistore-v2/timeBudget.ts`
- `src/services/publicVisibility/multiStoreVisibility.ts`
- `src/services/multistore-v2/publicationBarrier.ts`
- `src/services/database/saveProduct.ts`
- `prisma/schema.prisma`
- `src/app/page.tsx`
- `src/components/OffersSection.tsx`
- `src/app/api/cron/catalog-populate/route.ts`
- `src/app/api/cron/catalog-regression-monitor/route.ts`

Todos estes arquivos mostram que a busca atual ainda depende de live discovery e de reprocessamento imediato, apesar da base canônica e da infraestrutura de identidade já estarem muito avançadas.
