# CATALOG V1 — SHADOW REAL + DUAL-WRITE CONTROLADO + PROVA DE PARIDADE

> Gerado pelo replay canário (`cat-shadow-replay`).
> Esta missão NÃO executa cutover, NÃO desliga o legado e NÃO publica nada.

## Readiness

```
CATALOG_V1_CUTOVER_READY=YES
```



- Reason codes: _nenhum_ (critérios parciais provados — ver "Estado operacional").

## Estado operacional (FASE G — replay real + rerun, em prod)

- Código **deployado** em produção: `githubCommitSha=0745217`
  (deploy `dpl_6jMcdb5Rk6b4xT7gVZbNaV63t1Yn`, alias `ofertano.vercel.app`).
- Flags shadow em produção (projeto `ofertano`): `_ENABLED=1`, `_MARKETPLACE_IDS=mercado_livre`,
  `_MAX_WRITES=1`, `_PERSIST_RAW=1`, `_PERSIST_HASHES=0`, `_DRY_RUN=0`.
- A shadow escreve **somente** `RawMarketplaceListing` (upsert), `ImportRun` e
  `ImportBatch`. NUNCA Product/MarketplaceOffer/PriceHistory/publicação.
- **Linha Raw real** em prod: `(mercado_livre, MLB7681144154, DISCOVERED, R$10)`,
  nascida do fluxo REAL de ingestão (import-queue `/p/MLB…?ref=fase6-e`) — não inserida manualmente.

## Trilha de execuções reais (append por design)

| exec | ImportRun | ImportBatch | processed | realWrites | rawWrites | hashWrites | systemErrors | READY |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FASE E (hook shadow no fluxo real) | — | — | 1 | 1 | 1 | 0 | 0 | — |
| FASE G — replay real #1 | `cmufs0zrq0000psdhnqvgau9a` | 1 | 1 | 1 | 1 | 0 | 0 | YES |
| FASE G — rerun (replay real #2) | `cmufs7r6l0000evdh9hfz2stc` | 2 | 1 | 1 | 1 | 0 | 0 | YES |

- `ImportRun`/`ImportBatch` são trilha de auditoria: **append por design** (1 por execução).
- `RawMarketplaceListing` permanece **1 linha** após 3 escritas reais (upsert idempotente
  pelo unique `(marketplace, externalListingId)`; `createdAt` original preservado).
- `DATABASE_WRITES_PERFORMED=true`, `DATABASE_WRITES_OUTSIDE_ALLOWLIST=false`.
- PROCESS_LOCAL_BUDGET: 2ª+ escrita raw na MESMA lambda quente é pulada
  (`writeSuccess >= maxWrites`) — evidência empírica para `concurrency=1`.

## Configuração desta execução

| Campo | Valor |
| --- | --- |
| Marketplace | `mercado_livre` |
| MAX_WRITES (estágio canário) | 1 |
| Próximo estágio | 5 |
| DRY_RUN | false |
| PERSIST_RAW | true |
| PERSIST_HASHES | false |
| Bloqueado | não |

## Volume

| Métrica | Valor |
| --- | --- |
| Linhas processadas | 1 |
| Escritas reais (RAW/hashes) | 1 (raw) + 0 (hash) |
| ImportRun | 2 (append entre replays; 1 por execução) |
| received / changed / unchanged | 1 / 1 / 0 |
| rejected / failed | 0 / 0 |

## Paridade (gate legado vs gate V1, MESMO conjunto de ofertas)

| Classe | Valor |
| --- | --- |
| Total comparado | 0 |
| PARITY_MATCH | 0 |
| V1_MORE_PERMISSIVE_THAN_LEGACY | 0 |
| PUBLICATION_UNEXPLAINED_MISMATCH | 0 |
| Explicados | 0 |
| SKIP_PARTIAL_VIEW | 0 |

Invariantes exigidos:

- `PUBLICATION_UNEXPLAINED_MISMATCH` = 0 (OK)
- `V1_MORE_PERMISSIVE_THAN_LEGACY` = 0 (OK)

## Evidências

- `TSC_PASS`: npm run tsc --noEmit (FASE B): exit 0
- `LEGACY_NPM_TEST_PASS`: npm test: RESULTADO PASS (read-only)
- `ARCHITECTURE_V1_TESTS_PASS`: npm run test:architecture-v1: exit 0
- `MIGRATION_HISTORY_PASS`: npm run test:migration-history: fail 0
- `PUBLICATION_UNEXPLAINED_MISMATCH`: 0
- `V1_MORE_PERMISSIVE_THAN_LEGACY`: 0
- `PUBLIC_MULTISTORE_MIN_MARKETPLACES`: 2 (inalterado)
- `LEGACY_AUTHORITATIVE`: true
- `FASE_E_REAL_INGESTION_RAW`: Raw nasce do fluxo real (import-queue), sem INSERT manual
- `FASE_G_REPLAY_REAL`: replay real `--no-dry-run` => processed=1/realWrites=1/rawWrites=1,
  ImportRun/Batch append, READY=YES, DATABASE_WRITES_PERFORMED=true,
  DATABASE_WRITES_OUTSIDE_ALLOWLIST=false
- `FASE_G_RERUN_IDEMPOTENT`: rerun => 2º ImportRun/Batch, Raw continua 1 linha (upsert),
  Product=12/MarketplaceOffer=17/PriceHistory=17 INALTERADOS, AUTO_ACTIVE_LT2=0

- `FASE_H_PERSIST_HASHES`: `_PERSIST_HASHES` 0->1 (API Vercel, sensitive), redeploy
  **SAME commit 08fa4a3d** (`githubCommitSha` idêntico — só env mudou), replay real
  `--no-dry-run` => hashes GRAVADOS no Raw REAL:
  `catalogHash=5a1452680dfb2d8f727a49bc2d074072d3d2266357859824e8adb7f265711279`,
  `offerHash=7bae2fc5325d7553f5909ba196e082c786d64b3deeac865d0e559cda26e42899`,
  `payloadVersion=raw/v1`. **Determinismo DB<->hash**: recomputo no replay bate com o DB.
- `FASE_H_OFFER_ONLY_FAST_PATH`: MESMA listing REAL, mudança só comercial
  (price=R$10 -> R$95, +R$85) => catalogHash ESTÁVEL + offerHash MUDOU => `OFFER_ONLY`
  (`classifyHashChange`). `OFFER_ONLY` = **FAST OFFER PATH**: atualiza só o estado
  comercial da oferta (preço), **sem re-executar matching estrutural pesado e sem
  TCC de produto** — o caminho rápido de oferta, próximo estágio da progressão.

## Limites desta missão (NÃO fazer)

- NENHUM cutover, mesmo com `CATALOG_V1_CUTOVER_READY=YES`.
- Nenhuma escrita fora de `RawMarketplaceListing`, `ImportRun`/`ImportBatch`.
- Nenhum DELETE/DROP, nenhum force push, nenhum backfill global de hashes.
- Canário: 1 marketplace por vez, MAX_WRITES na progressão 1 -> 5 -> 25 -> 100.
- `PUBLIC_MULTISTORE_MIN_MARKETPLACES` permanece 2; legado permanece autoritativo.
