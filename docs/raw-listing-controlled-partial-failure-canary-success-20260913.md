# Sucesso do Canary Real Controlado de Falha Parcial

**Projeto:** Ofertano
**Branch:** `feature/search-e2e-final-20260910`
**Checkpoint:** `a875545`
**Data:** 2026-09-13

## Cenário

O canary usou tres listings reais de `MERCADO_LIVRE`, em execucao
estritamente sequencial:

```text
TARGET_A=MLB7184373436
TARGET_B=MLB4935612308
TARGET_C=MLB6996698648
```

O runtime oficial foi o singleton em
[`src/lib/prisma.ts`](../src/lib/prisma.ts). A falha de B foi sintetica,
controlada e injetada antes da persistencia raw. C nao recebeu chamada.

## Baseline e gates

```text
RAW_LISTING_COUNT_BEFORE=0
TARGET_A_RAW_BEFORE=0
TARGET_B_RAW_BEFORE=0
TARGET_C_RAW_BEFORE=0
READINESS_BEFORE=READY
CONTROLLED_MULTI_PRECHECK=READY
BOUNDED_BATCH_PRECHECK=READY
PARTIAL_FAILURE_PRECHECK=READY
METRICS_RESET_BEFORE=PASS
```

## Execucao

### A: sucesso real

```text
TARGET_A_WRITE_STATUS=CREATED
RAW_COUNT_AFTER_A=1
TARGET_A_COUNT_AFTER_A=1
TARGET_B_COUNT_AFTER_A=0
TARGET_C_COUNT_AFTER_A=0
TARGET_A_RAW_ID=cmtztdp890000zmdh8ebg0wv0
```

### B: falha sintetica antes da persistencia

```text
TARGET_B_WRITE_STATUS=ERROR
TARGET_B_ERROR=RAW_LISTING_CONTROLLED_CANARY_FAILURE
TARGET_B_PERSISTED=NO
TARGET_B_RAW_ID=NONE
SYNTHETIC=YES
STAGE=BEFORE_RAW_PERSIST
```

A excecao foi absorvida por `persistRawListingIfEnabled()` como `ERROR`.
Nenhum upsert real de B ocorreu.

### C: parada após a primeira falha

```text
TARGET_C_WRITE_STATUS=NOT_RUN
TARGET_C_EXECUTED=NO
TARGET_C_RAW_ID=NONE
```

Estado após a falha:

```text
RAW_COUNT_AFTER_B_FAILURE=1
TARGET_A_COUNT_AFTER_B_FAILURE=1
TARGET_B_COUNT_AFTER_B_FAILURE=0
TARGET_C_COUNT_AFTER_B_FAILURE=0
FAILURE_POLICY_VALID=YES
CONTINUED_EXECUTION_ALLOWED=NO
CLEANUP_TARGETS=[A]
```

## Métricas

```text
CANARY_COUNTER_AFTER_B=2
ATTEMPTED_AFTER_B=2
WRITE_SUCCESS_AFTER_B=1
WRITE_FAILED_AFTER_B=1

SKIPPED_DISABLED=0
SKIPPED_DRY_RUN=0
SKIPPED_MARKETPLACE=0
SKIPPED_EXTERNAL_ID=0
SKIPPED_LIMIT=0
SKIPPED_INVALID_EXTERNAL_ID=0
```

A tentativa de B consumiu uma unidade do counter e uma tentativa, mas falhou
antes de criar registro. C não foi chamado.

## Cleanup e estado final

```text
RAW_COUNT_BEFORE_DELETE=1
TARGET_A_BEFORE_DELETE=1
TARGET_B_BEFORE_DELETE=0
TARGET_C_BEFORE_DELETE=0
TARGET_A_DELETED=1
TARGET_B_DELETED=0
TARGET_C_DELETED=0

RAW_LISTING_COUNT_FINAL=0
TARGET_A_RAW_FINAL=0
TARGET_B_RAW_FINAL=0
TARGET_C_RAW_FINAL=0
BASELINE_RESTORED=YES
DATABASE_RESIDUAL_TEST_DATA=NO
FLAG_LEFT_ENABLED=NO
KILL_SWITCH_CONFIRMED=YES
```

## Validacoes

```text
TARGETED=PASS
INGESTION=PASS
FULL_TEST_RUN1=PASS
FULL_TEST_RUN2=PASS
PRISMA_VALIDATE=PASS
PRISMA_GENERATE=PASS
ENCODING=PASS
BUILD=PASS
DIFF_CHECK=PASS
```

## Limitacoes

Esta prova ainda nao cobre:

- retry após erro;
- retry idempotente;
- timeout ou timeout recovery;
- classificacao de erro transitorio ou permanente;
- retry budget e backoff;
- concorrencia;
- multiplos marketplaces;
- operacao continua.
