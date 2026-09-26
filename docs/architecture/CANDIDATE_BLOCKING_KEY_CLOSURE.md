# FECHAMENTO — CandidateBlockingKey

```
MIGRATION_REPOSITORY_RECONCILED=YES
MIGRATION_HISTORY_GATE=PASS (142/142)
FRESH_DB_REPRODUCIBILITY=FAIL   <-- STOP
EXISTING_DB_RECONCILIATION=PASS
BACKFILL_ALLOWED=NO
```

## PARTE 8 — FRESH DB: FALHA PRÉ-EXISTENTE (STOP)

Criei um PostgreSQL 17.6 descartável e rodei o fluxo oficial
`prisma migrate deploy`. Ele falha em:

```
Migration name: 20260905120000_price_alerts
ERROR: type "PriceAlertType" does not exist
```

**Causa:** `20260905120000_price_alerts` faz
`ALTER TYPE "PriceAlertType" ADD VALUE IF NOT EXISTS 'TARGET'`, mas
`CREATE TYPE "PriceAlertType"` não existe em **nenhuma** migration — o tipo
nasce em `scripts/bootstrap/initial-schema.sql`, que o `migrate deploy` não
executa.

**Não é da minha migration:** `grep -c 'PriceAlert'` em
`20260926220000_candidate_blocking_keys` = **0**.

Portanto o repositório, como está, **não reconstrói um banco do zero** —
defeito anterior a esta linha de trabalho. Corrigir exigiria alterar migration
passada ou o fluxo de bootstrap, ambos proibidos aqui. Uso
`migrate resolve`? Não: mascararia o defeito.

Cluster descartável removido ao final.

## PARTE 9 — DB EXISTENTE: PASS

Antes → `migrate deploy` (com `DATABASE_URL` e `DIRECT_URL` exportados
explicitamente, host confirmado `aws-0-sa-east-1.pooler.supabase.com:5432`)
→ depois:

| | before | after |
|---|---|---|
| rows | 428 | **428** |
| checksum | `84d0b473…` | `84d0b473…` |
| applied_steps_count | 1 | 1 |
| finished_at | 18:41:29.311Z | 18:41:29.311Z |
| rolled_back_at | null | null |
| índices | 5 | 5 |
| ledger total | 16 | 16 |

`migrate deploy` respondeu **"No pending migrations to apply"** (RC=0): não
reaplicou, não recriou tabela, não duplicou índice, não mutou ledger.

## Demais etapas

- **Parte 10** — `prisma validate` OK, `generate` OK. `migrate status`/`migrate
  diff` não executados.
- **Parte 11** (deploy ERROR) — não investigada; **não assumi causa**.
- **Partes 12–14** (FASE P, blind rediscovery, benchmark positivo) — não
  reexecutadas.

## Gates

```
check_encoding=0  prisma_validate=0  tsc=0
test:migration-history=0  test:architecture-v1=0
test:cutover=0  test:second-marketplace=0
build=0  git diff --check=0
```

## Decisão

`FRESH_DB_REPRODUCIBILITY=FAIL` é condição de parada pela regra da missão. Logo
`BACKFILL_ALLOWED=NO`, e o backfill **não** foi executado.
