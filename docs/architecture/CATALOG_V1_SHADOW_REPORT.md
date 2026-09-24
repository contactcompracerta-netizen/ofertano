# CATALOG V1 — SHADOW REAL + DUAL-WRITE CONTROLADO + PROVA DE PARIDADE

> Status inicial da FASE 5. Este arquivo é atualizado pelo canário
> (`scripts/canary-shadow-replay.ts --write-report`). Nenhuma escrita pública
> é autorizada por esta missão; o legado permanece autoritativo.

## Readiness

```
CATALOG_V1_CUTOVER_READY=NO
```

- Motivo inicial: fase ainda não executada — nenhuma escrita real protetora
  exercitada (o canário de produção ainda não rodou).
- Mesmo com `READY=YES` futuro, o cutover NÃO é executado por esta missão.

## Escopo da shadow (FASE 5)

- **Observa**: fluxo REAL do `saveProduct` (hook inerte no fim, próximo a
  `persistRawListingContextIfEnabled`) e linhas REAIS de
  `RawMarketplaceListing` (replay/canário).
- **Escreve somente**: `RawMarketplaceListing` (hashes determinísticos V1 e/ou
  `rawPayload` aninhado com o payload legado), `ImportRun`/`ImportBatch`
  (contadores do replaY). Nada de Product, MarketplaceOffer ou publicação.
- **Identidade de marketplace**: sempre via registry V1
  (`marketplaceRegistry`), nunca por nome/URL.
- **Precondições fail-closed**: `ARCHITECTURE_V1_SHADOW_ENABLED`,
  `_MARKETPLACE_IDS` (allowlist), `_MAX_WRITES` (orçamento),
  `_PERSIST_RAW`, `_PERSIST_HASHES`; `_DRY_RUN` default true.

## Invariantes (bloqueiam readiness)

- `PUBLICATION_UNEXPLAINED_MISMATCH` = 0.
- `V1_MORE_PERMISSIVE_THAN_LEGACY` = 0.
- Pelo menos 1 escrita real exercitada.
- Sem cutover: os gates de publicação do fluxo legado continuam sendo a
  única via de publicação.

## Canário progressivo (1 marketplace por vez)

| Estágio | MAX_WRITES | Estado |
| --- | --- | --- |
| 1 | 1 | pendente |
| 2 | 5 | pendente |
| 3 | 25 | pendente |
| 4 | 100 | pendente |

## Próximos passos operacionais

1. Deploy das mudanças (push normal → fast-forward de `main` → `prisma migrate
   deploy` → deploy Vercel).
2. Configurar env do projeto (Vercel) com FASE 5 OFF por default.
3. Canário: habilitar `_ENABLED=1`, allowlist com 1 marketplace,
   `_MAX_WRITES=1`, `_DRY_RUN=1` primeiro (medir sem escrever); depois
   `_DRY_RUN=0` + `_PERSIST_HASHES=1` (escrita real limitada).
4. Rodar `npx tsx scripts/canary-shadow-replay.ts --marketplace <id>
   --max-writes 1 [--persist-hashes] [--no-dry-run] [--write-report]`.
5. Reavaliar readiness e evoluir MAX_WRITES 1 -> 5 -> 25 -> 100.