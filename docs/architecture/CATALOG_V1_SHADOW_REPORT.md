# CATALOG V1 — SHADOW REAL + DUAL-WRITE CONTROLADO + PROVA DE PARIDADE

> Gerado pelo replay canário (`cat-shadow-replay`).
> Esta missão NÃO executa cutover, NÃO desliga o legado e NÃO publica nada.

## Readiness

```
CATALOG_V1_CUTOVER_READY=NO
```



- Reason codes: `NO_REAL_SHADOW_WRITES`

## Estado operacional (canário observe-only em prod)

- Código FASE 5 **deployado** em produção (`ofertano.vercel.app`, deploy `git-main`,
  commit `84564b2`; git integration auto-deploy a partir de `main`).
- Flags FASE 5 **configuradas em produção** (projeto `ofertano`): `_ENABLED=1`,
  `_MARKETPLACE_IDS=mercado_livre` (1 marketplace), `_MAX_WRITES=1`,
  `_PERSIST_RAW=0`, `_PERSIST_HASHES=0`, `_DRY_RUN=1`.
- **Fail-closed garantido**: persist OFF + dry-run ON => o hook observa o fluxo
  real de `saveProduct`/`persistProduct` (multistore-v2) **em memória** para o
  marketplace da allowlist, com **zero escrita** no banco.
- `RawMarketplaceListing` está **vazia** em prod (dual-write legada
  `isRawListingDualWriteEnabled()` OFF) => o replay canário processa 0 linhas
  (evidência acima). A escrita real da shadow só se materializa quando houver
  tráfego real de save com `_DRY_RUN=0` + `_PERSIST_HASHES=1` dentro do orçamento.
- **Próxima etapa (quando o tráfego real produzir amostras)**: evoluir as flags
  para escrita limitada — `_DRY_RUN=0`, `_PERSIST_HASHES=1`, `_MAX_WRITES`
  1 -> 5 -> 25 -> 100 — e regenerar este relatório com
  `npx tsx scripts/canary-shadow-replay.ts --marketplace mercado_livre
  --max-writes <n> --persist-hashes --no-dry-run --write-report`.

## Configuração desta execução

| Campo | Valor |
| --- | --- |
| Marketplace | `mercado_livre` |
| MAX_WRITES (estágio canário) | 1 |
| Próximo estágio | 5 |
| DRY_RUN | true |
| PERSIST_RAW | false |
| PERSIST_HASHES | false |
| Bloqueado | não |

## Volume

| Métrica | Valor |
| --- | --- |
| Linhas processadas | 0 |
| Escritas reais (RAW/hashes) | 0 |
| ImportRun | _dry-run (sem run)_ |
| received / changed / unchanged | 0 / 0 / 0 |
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

## Limites desta missão (NÃO fazer)

- NENHUM cutover, mesmo com `CATALOG_V1_CUTOVER_READY=YES`.
- Nenhuma escrita fora de `RawMarketplaceListing`, `ImportRun`/`ImportBatch`.
- Nenhum DELETE/DROP, nenhum force push, nenhum backfill global de hashes.
- Canário: 1 marketplace por vez, MAX_WRITES na progressão 1 -> 5 -> 25 -> 100.
- `PUBLIC_MULTISTORE_MIN_MARKETPLACES` permanece 2; legado permanece autoritativo.
