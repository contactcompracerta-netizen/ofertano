# CATALOG ARCHITECTURE V1 — ADR

Status: **Aprovado (aditivo, deploy OFF/shadow) — VIVO EM PRODUÇÃO**
Worktree: `catalog-architecture-v1` (branch `feat/catalog-architecture-v1-20260924`)
Base: `e324aae` (produção) → final `3b54a33` (fast-forward normal, sem force-push)
Produção: `origin/main` em `3b54a33`; migration aditiva aplicada (`prisma migrate deploy`); site 200.

## Decisão

Adotar a **Catalog Architecture V1** como arquitetura oficial do catálogo do
Ofertano, permitindo a operação de **2 → 100 marketplaces** sem reescrever o
núcleo. A V1 chega em produção **OFF/shadow**: nenhum comportamento legado muda
até que as flags de runtime sejam ligadas explicitamente.

Tudo é **aditivo**:

- Migration somente aditiva (colunas nullable + tabelas novas); zero DELETE/DROP.
- Tipos legados ganham campos opcionais (`catalogHash/offerHash/payloadVersion`).
- O núcleo legado (Fase 3) permanece intacto e é a referência de regressão.

## Problema

Cada marketplace novo hoje exige tocar no núcleo (enum Prisma, matching,
publicação). A Fase 3 provou a modelagem multiloja, mas o núcleo depende de
nomes de marketplace (ex.: `MERCADO_LIVRE`). Para escalar de 2 para dezenas de
marketplaces, o núcleo precisa conhecer:

1. apenas `marketplaceId` (string canônica estável) e capacidades do conector;
2. um contrato normalizado único (listing/offers/identity) — `NormalizedListingV1`;
3. hashes duplos para decidir o caminho de processamento sem trabalho desnecessário;
4. idempotência por `(marketplaceId, externalListingId)`;
5. política de publicação central e agnóstica (invariante multiloja de 2+).

## Conceitos-chave

| Conceito | Definição |
| --- | --- |
| `marketplaceId` | Identidade canônica interna (lowercase_snake). Nunca muda entre versões. Ex.: `mercado_livre`, `shopee`, `market_a`. |
| `MarketplaceConnector` | Contrato universal de conector com capacidades declaradas (`gtin`, `variants`, `incrementalUpdates`, ...). Toda fonte nova = criar conector, mapear para `NormalizedListingV1`, testar. |
| `NormalizedListingV1` | Contrato interno de listing normalizada (identidade, catálogo, variante, comércio, metadados). Semântica de ausência: `null` = vazio reportado; `UNKNOWN` = não coletado. |
| `catalogHash` | Hash SHA-256 canônico da parcela **estrutural** (título, brand, model, GTIN, MPN, variantes, specs). Mudou => COLLECTION PATH. |
| `offerHash` | Hash SHA-256 canônico da parcela **comercial** (price, pixPrice, stock, availability, installments, promotion). Mudou => FAST OFFER PATH. |
| `catalogHash == offerHash == iguais` | NOOP idempotente — sem matching, sem gravação de histórico, sem requisição desnecessária. |
| `ImportRun` / `ImportBatch` | Execução de importação com subdivisões operacionais e contadores — preparação para 1M listings sem requisição monolítica. |
| `Freshness` | FRESH / AGING / STALE / EXPIRED. STALE e EXPIRED **nunca** disputam melhor oferta. |
| `PublicationEligibility` | Gate central de publicação: `eligible + reasonCodes + evidence`. Nunca um boolean mudo. Manual liberado; auto exige 2+ marketplaces distintos. |
| `OperationalOutcome` | POLICY BLOCK ≠ SYSTEM FAILURE (observabilidade). |

## Manifesto do modelo

1. **O núcleo é agnóstico de marketplace.** Nenhuma regra central usa nome
   exibido, domínio, URL ou vendedor. Adicionar o marketplace nº 50 não altera
   matching, publicação, busca ou price history.
2. **Identidade > nomes.** A identidade de produto vem de GTIN/EAN/MPN/hash de
   identidade — nunca de `sellerName` ou título de vitrine.
3. **Idempotência de fonte.** Uma listing não vira outra quando muda preço,
   título, imagem ou vendedor. Chave única: `(marketplaceId, externalListingId)`
   (o schema legado `@@unique([marketplace, externalId])` já garante isso).
4. **Raw preservado.** Todo dado aceito é reprocessável: re-parse do
   `rawPayload` com a `payloadVersion` registrada.
5. **Hash duplo decide o trabalho.** Noop idempotente, fast offer e caminho
   estrutural são decisões determinísticas por hash — não por heurística.
6. **Publicação central e explicável.** Um produto aparece publicamente apenas
   com ofertas válidas em **2+ marketplaces distintos**, sob a mesma regra usada
   por "publicado" e "visível".
7. **Shadow por padrão.** Nada desta arquitetura altera produção até env vars
   `*_ENABLED=true` serem explicitamente definidas.

## Mapeamento de nomes atuais → V1

| Legado (hoje) | Architecture V1 |
| --- | --- |
| Enum Prisma `Marketplace` (9 valores) | `marketplaceId` string canônico (`marketplaceRegistry.ts`) |
| `RawMarketplaceListing` | `RawListingRecordV1` (contrato) |
| `@@unique([marketplace, externalId])` | `UNIQUE(marketplaceId, externalListingId)` invariante (FASE F) |
| `fingerprint` | `catalogHash` (estrutural) + `offerHash` (comercial) — determinísticos |
| `normalizeMarketplaceListingTitle` | normalização mantida no contrato `NormalizedListingV1` |
| `isUsablePublicOffer` + `countDistinctPublicMarketplaces` | base do `PublicationEligibility` (reutilizadas, FASE O) |
| `historicoPrecisaNovaEntrada` | decidir gravação de `PriceHistory` (reutilizado, FASE M) |
| `NON_RETRYABLE_ENVELOPE_PREFIX` | classificação POLICY BLOCK vs SYSTEM FAILURE (reutilizado, FASE N) |
| `ImportQueue` (item-level) | `ImportRun`/`ImportBatch` (level run/batch, aditivo) |

## Invariantes

1. `UNIQUE(marketplaceId, externalListingId)` — identidade de listing estável.
2. `catalogHash` é função pura das parcelas estruturais; `offerHash` das comerciais.
3. Um produto só é publicamente visível com 2+ marketplaces **distintos**.
4. STALE/EXPIRED nunca disputam melhor oferta.
5. Snapshot incompleto (run anterior FAILED/PARTIAL) nunca reconcilia ausências.
6. Reprocessamento é idempotente: payload idêntico => NOOP.
7. POLICY BLOCK e SYSTEM FAILURE são métricas separadas.
8. Nenhuma migration destrutiva; nenhum force-push; enum legado não é removido.

## Escopo explícito NÃO incluído nesta missão

- OpenSearch / busca vetorial
- Kubernetes / microsserviços
- IA / ML de matching
- Remoção do enum Prisma legado (transição documentada em
  `MARKETPLACE_ENUM_TRANSITION.md`)

## Gate de aceitação (FASE 4)

`CATALOG_ARCHITECTURE_V1_STATUS=PASS` cobre: `CATALOG_ARCHITECTURE_DOC`,
`UNIVERSAL_CONNECTOR_CONTRACT`, `NORMALIZED_LISTING_V1`,
`MARKETPLACE_HARDCODE_CORE=NO`, `SOURCE_LISTING_IDEMPOTENCY`, `CATALOG_HASH`,
`OFFER_HASH`, `FAST_OFFER_PATH`, `RAW_REPROCESSABLE`,
`PRICE_HISTORY_NO_DUPLICATE`, `PUBLICATION_GATE_CENTRAL`,
`POLICY_BLOCKED_METRIC_SEPARATED`, `MULTI_MARKETPLACE_CONTRACT_TESTS`,
`FAKE_CONNECTOR_A/B`, `LEGACY_CATALOG_REGRESSION`, `PUBLIC_MULTISTORE_INVARIANT`,
com `AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0`, `FORCE_PUSH_USED=NO`,
`DESTRUCTIVE_MIGRATION=NO` e testes/build/tsc/prisma-validate PASS.