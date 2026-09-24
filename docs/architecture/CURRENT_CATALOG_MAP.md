# CURRENT CATALOG MAP — Auditoria da Fase A (FASE 4)

Mapa canônico do catálogo atual do Ofertano, usado como base da
Catalog Architecture V1. **Este documento é a fonte de verdade da auditoria**
e reflete o código no worktree `catalog-architecture-v1`.

## 1. Enum Prisma `Marketplace` (9 valores) — `prisma/schema.prisma`

| Enum legado | marketplaceId canônico (V1) | displayName | publicEligible |
| --- | --- | --- | --- |
| `MERCADO_LIVRE` | `mercado_livre` | Mercado Livre | true |
| `AMAZON` | `amazon` | Amazon | true |
| `SHOPEE` | `shopee` | Shopee | true |
| `MAGAZINE_LUIZA` | `magazine_luiza` | Magazine Luiza | true |
| `CASAS_BAHIA` | `casas_bahia` | Casas Bahia | true |
| `KABUM` | `kabum` | Kabum | true |
| `TERABYTE` | `terabyte` | Terabyte | true |
| `ALIEXPRESS` | `aliexpress` | AliExpress | true |
| `CARREFOUR` | `carrefour` | Carrefour | true |

O mapeamento oficial está em `src/services/architecture/v1/marketplaceRegistry.ts`
(único ponto com nomes; o núcleo nunca os lê).

## 2. Achados da auditoria

- **O schema persiste 9 marketplaces** (enum Prisma), mas o helper legado
  `MarketplaceListingMarket` em `src/services/catalog-listings/index.ts` cobre
  **apenas 5** (`MERCADO_LIVRE`, `AMAZON`, `SHOPEE`, `MAGAZINE_LUIZA`,
  `ALIEXPRESS`). Casas Bahia / Kabum / Terabyte / Carrefour já existem no enum
  do banco e no registry V1, mas o caminho legado de catalog-listings ainda não
  os tipa — a V1 resolve isso com `marketplaceId` string dinâmico (FASE E/X).
- Fase 1–3 estabeleceram:
  - invariante multiloja: 2+ marketplaces **distintos** para visibilidade pública
    (`src/services/publicVisibility/multiStoreVisibility.ts`);
  - identidade EXACT para match (`src/services/identity/exactMatcher.ts`);
  - `@@unique([marketplace, externalId])` em `RawMarketplaceListing` (idempotência
    de chave já satisfaz a FASE F da V1);
  - `historicoPrecisaNovaEntrada` (price history sem duplicatas — FASE M);
  - `NON_RETRYABLE_ENVELOPE_PREFIX`/taxonomia da fila (FASE N).

## 3. Ativos V1 por fase

| FASE | Aceitação | Onde fica |
| --- | --- | --- |
| A | CURRENT_CATALOG_MAP | este documento |
| B | CATALOG_ARCHITECTURE_DOC | `docs/architecture/CATALOG_ARCHITECTURE_V1.md` |
| C | UNIVERSAL_CONNECTOR_CONTRACT | `src/services/architecture/v1/types/connector.ts` |
| D | NORMALIZED_LISTING_V1 | `src/services/architecture/v1/types/normalizedListingV1.ts` |
| E | MARKETPLACE_HARDCODE_CORE=NO | `marketplaceRegistry.ts` + `extensibility.test.ts` |
| F | SOURCE_LISTING_IDEMPOTENCY | `@@unique` + `ingestion/rawRepository.ts` + contrato de chave |
| G | CATALOG_HASH / OFFER_HASH | `src/services/architecture/v1/hashing.ts` + `hashing.test.ts` |
| H | FAST_OFFER_PATH | `ingestion/pipeline.ts` + `pipeline.test.ts` |
| I | RAW_REPROCESSABLE | `ingestion/reprocess.ts` + `reprocess.test.ts` |
| J/K | IMPORT RUN | `ingestion/importRun.ts` + `importRun.test.ts` |
| L | FRESHNESS | `freshness.ts` + `freshness.test.ts` |
| M | PRICE_HISTORY_NO_DUPLICATE | `priceHistoryNoDuplicate.test.ts` (+ reúso de `historicoPrecisaNovaEntrada`) |
| N | POLICY_BLOCKED_METRIC_SEPARATED | `observability/outcomeClassifier.ts` + teste |
| O | PUBLICATION_GATE_CENTRAL | `publication/publicationEligibility.ts` + teste |
| P/Q | MULTI_MARKETPLACE_CONTRACT_TESTS / FAKE_CONNECTOR_A-B | `fake/fakeConnectors.ts` + `multiMarketplaceContract.test.ts` |
| V | BENCHMARK | `scripts/benchmark/architecture-v1-benchmark.ts` |
| W | METRICS por marketplaceId | `observability/metrics.ts` |
| X | MARKETPLACE_ENUM_TRANSITION | `docs/architecture/MARKETPLACE_ENUM_TRANSITION.md` + `ADDING_A_MARKETPLACE.md` |
| Y | Deploy/verificação | `CATALOG_ARCHITECTURE_V1_STATUS=PASS` |

## 4. Invariante público (FASE 3 preservada)

Produto visível publicamente ⇔ ofertas válidas em ≥ 2 marketplaces distintos.
Verificado em produção antes do deploy: `AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0`.