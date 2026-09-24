# CATALOG V1 — CANÁRIO AUTORITATIVO (CUTOVER PROGRESSIVO, FASE 7)

> Gerado pelo replay autoritativo (`cat-authoritative-replay`).
> O cutover é SOURCE-SCOPED (por marketplaceId) e PROGRESSIVO (MAX_WRITES 1 -> 5 -> 25 -> 100, concurrency=1).
> Cutover GLOBAL é PROIBIDO (`CATALOG_V1_GLOBAL_CUTOVER=NO`).

## Estado final

```
FASE_7_STATUS=PASS (estágios 1, 5 e 25 commitam; estágio 100 idempotente = NOOP 11/11)
AUTHORITATIVE_READY=YES (CATALOG_V1_AUTHORITATIVE_READY)
```

- Marketplace: `mercado_livre` (MERCADO_LIVRE)
- Writer mode: `V1_PRIMARY_WITH_LEGACY_FALLBACK`
- Legacy fallback habilitado: `true` (ARCHITECTURE_V1_LEGACY_FALLBACK_ENABLED=ON)
- Publicação autoActive: `AUTO_ACTIVE_LT2=0` (gate multiloja preservado — 1 marketplace nunca ativa)

## Configuração da execução

| Campo | Valor |
| --- | --- |
| Marketplace | `mercado_livre` |
| Writer mode | `V1_PRIMARY_WITH_LEGACY_FALLBACK` |
| MAX_WRITES (progressão) | 1 -> 5 -> 25 -> 100 |
| Flags enabled | `true` |
| Legacy fallback habilitado | `true` |
| ImportRun final | cmug688ga00005zdh7gfgu5mv (estágio 100) |
| Base SHA | `257173d97b1fdb854fbe418ab093f86d4535044d` |
| Final SHA | `f935738cb2f1870e0d1f77687d8dd8d1d348db75` |

## Canários executados (viés real, sem fabricação)

| Estágio | MAX_WRITES | Processadas | V1 committed | NOOP (idempotente) | BUDGET_SKIPPED | Legacy fallback | Breaker | Paridade (match/diff) | FASE_7_STATUS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CANARY_1 | 1 | 11 | 1 | 1 | 9 | 0 | 0 | 1/0 | PASS |
| CANARY_5 | 5 | 11 | 5 | 2 | 4 | 0 | 0 | 5/0 | PASS |
| CANARY_25 | 25 | 11 | 4 | 7 | 0 | 0 | 0 | 4/0 | PASS |
| CANARY_100 | 100 | 11 | 0 | 11 | 0 | 0 | 0 | 0/0 | PARTIAL* |

\* CANARY_100 não escreve nada porque **todas as 11 rows já foram commitadas e têm
hashes persistidos** — retry da MESMA listing => NOOP (prova de idempotência FASE E).
`NO_AUTHORITATIVE_WRITES` é o reason code esperado para um retry 100% idempotente.

## Deltas de banco (antes -> depois do cutover autoritativo)

| Tabela | Baseline | Final | Delta | Observação |
| --- | --- | --- | --- | --- |
| Product | 12 | 22 | +10 | 10 produtos criados via saveProduct canônico (STRUCTURAL) |
| MarketplaceOffer | 17 | 27 | +10 | 1 oferta por produto V1 |
| PriceHistory | 17 | 27 | +10 | 1 entrada por produto; retry (100) => 0 entradas novas (FASE R) |
| ImportRun | 19 | 23 | +4 | 1 por canário, todos COMPLETED |
| ImportBatch | 19 | 23 | +4 | 1 por canário, COMPLETED |
| importQueue | 22 | 22 | 0 | sem duplicação de fila |
| RawMarketplaceListing | 11 | 11 | 0 | **zero duplicatas**; 11/11 com hashes persistidos |

## Idempotência e single-write ownership (FASE D/E)

- **FASE D**: em todos os canários, `legacy_fallback_total = 0` (V1 commitou => legado nunca
  escreveu) e `v1_authoritative_failure_total = 0` (sem falha pré-commit elegível => sem fallback).
- **FASE E**: CANARY_100 processou 11 rows com `legacyFallback=0`, `realWrites=0` e
  `duplicatePrevented=11` — o retry da MESMA listing vira NOOP pelos hashes persistidos
  (persistidos SÓ APÓS commit bem-sucedido).
- **FASE S**: RawMarketplaceListing preservado (11 rows, sem duplicação); raw -> replay ->
  mesmo resultado.

## Paridade de publicação (FASE O — single-store oculto)

| Classe | Valor |
| --- | --- |
| Total comparado | 10 (1+5+4 dos estágios que commitam) |
| PARITY_MATCH | 10 |
| PARITY_DIFFERENCE | 0 |

- Todos os 10 produtos autoCreated do canário ficaram `active=false`,
  `publicationStatus=DRAFT` (gate `PUBLIC_MULTISTORE_MIN_MARKETPLACES=2` preservado).
- Violação de publicação teria travado o breaker (`PUBLICATION_VIOLATION`); não ocorreu.

## Métricas FASE Q (por marketplaceId — aggregation dos 4 canários)

| Contador | Total |
| --- | --- |
| v1_authoritative_attempt_total | 10 |
| v1_authoritative_success_total | 10 |
| v1_authoritative_failure_total | 0 |
| legacy_fallback_total | 0 |
| legacy_fallback_success_total | 0 |
| authoritative_parity_match_total | 10 |
| authoritative_parity_difference_total | 0 |
| cutover_breaker_total | 0 |
| cutover_write_budget_skipped_total | 13 (9+4, fail-closed) |

## Breaker (FASE P)

- Tripped: **não** (0 trips nos 4 canários).
- Rollback config-only não foi necessário; `applyConfigOnlyRollback` permanece disponível
  e flags do marketplace voltariam a LEGACY_ONLY (nenhum dado alterado).

## Evidências (gates executados na branch FASE 7)

- `TSC_PASS`: `npx tsc --noEmit` exit 0
- `ARCHITECTURE_V1_TESTS_PASS`: `npm run test:architecture-v1` exit 0 (16 suites)
- `CUTOVER_TESTS_PASS`: `npm run test:cutover` exit 0 (8 suites: flags, policy, classifier,
  idempotency, ownership, writer, commits, runner)
- `MAIN_TESTS_PASS`: `npm test` exit 0
- `MIGRATION_HISTORY_PASS`: `npm run test:migration-history` fail 0 (138 testes)
- `PRISMA_VALIDATE_PASS`: `npx prisma validate` exit 0
- `BUILD_PASS`: `npm run build` (check:encoding + prisma generate + next build) exit 0
- `ESLINT_CUTOVER_PASS`: eslint módulo cutover + canário: 0 errors (warnings de preexistente não-blocking)
- `AUTO_ACTIVE_LT2`: 0 (gate multiloja preservado — 1 marketplace nunca ativa)
- `PUBLIC_MULTISTORE_MIN_MARKETPLACES`: 2 (inalterado)
- `CUTOVER_GLOBAL_PROHIBITED`: true (CATALOG_V1_GLOBAL_CUTOVER=NO)
- `PRODUCTION_SHA`: f935738cb2f1870e0d1f77687d8dd8d1d348db75 (deploy production READY 24/09 23:38 UTC-3)
- `VERCEL_DEPLOY_TARGET`: production (flags OFF fail-closed — nenhuma env de cutover no Vercel)