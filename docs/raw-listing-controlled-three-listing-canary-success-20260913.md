# Sucesso do Canary Real Controlado com Tres Listings

**Projeto:** Ofertano
**Branch:** `feature/search-e2e-final-20260910`
**Checkpoint:** `5e32d68`
**Data:** 2026-09-13

## Objetivo e escopo

Esta documentacao registra a primeira prova real controlada com tres
`RawMarketplaceListing` distintos, executados estritamente em sequencia.
Nenhum quarto write foi executado.

O runtime oficial foi o singleton de
[`src/lib/prisma.ts`](../src/lib/prisma.ts). A execucao usou
`MERCADO_LIVRE`, `maxWrites=3`, um counter compartilhado, concorrencia 1 e
`stopAfterFirstFailure=true`.

## Targets

```text
TARGET_A
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB7184373436
PRODUCT_ID=48fabfff-c918-4265-b26a-6573006620f6
SOURCE_URL=https://produto.mercadolivre.com.br/MLB-7184373436

TARGET_B
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB4935612308
PRODUCT_ID=2a0f839e-b1f0-4c33-892e-507b9d150182
SOURCE_URL=https://produto.mercadolivre.com.br/MLB-4935612308

TARGET_C
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB6996698648
PRODUCT_ID=9079fdb3-0457-47dc-bf1d-3bacdb1e93af
TITLE=Chave Fenda 1/8 X8
SOURCE_URL=https://produto.mercadolivre.com.br/MLB-6996698648
PRICE=12.24
```

Os tres listings tinham oferta legada, produto correspondente, URL direta
valida e nenhum registro raw no baseline.

## Gates e baseline

```text
RAW_LISTING_COUNT_BEFORE=0
TARGET_A_RAW_BEFORE=0
TARGET_B_RAW_BEFORE=0
TARGET_C_RAW_BEFORE=0
READINESS_BEFORE=READY
CONTROLLED_MULTI_PRECHECK=READY
BOUNDED_BATCH_PRECHECK=READY
METRICS_RESET_BEFORE=PASS
```

A configuracao foi process-local:

```text
RAW_LISTING_DUAL_WRITE_ENABLED=false
RAW_LISTING_CANARY_MARKETPLACES=MERCADO_LIVRE
RAW_LISTING_CANARY_EXTERNAL_IDS=MLB7184373436,MLB4935612308,MLB6996698648
RAW_LISTING_CANARY_MAX_WRITES=3
```

## Prova central

```text
TARGET_A_WRITE_STATUS=CREATED
TARGET_B_WRITE_STATUS=CREATED
TARGET_C_WRITE_STATUS=CREATED

RAW_COUNT_AFTER_A=1
RAW_COUNT_AFTER_B=2
RAW_COUNT_AFTER_C=3

TARGET_A_COUNT_AFTER_C=1
TARGET_B_COUNT_AFTER_C=1
TARGET_C_COUNT_AFTER_C=1
ALL_RAW_IDS_DISTINCT=YES
```

IDs persistidos:

```text
TARGET_A_RAW_ID=cmtzmjj990000ridhen44aw1i
TARGET_B_RAW_ID=cmtzmjjf30001ridhyrlny03g
TARGET_C_RAW_ID=cmtzmjjlj0002ridhwp5ohtgh
```

Cada registro manteve marketplace, external ID, produto canonico e source URL
correspondentes a sua origem real.

## Counter e metricas

```text
CANARY_COUNTER_AFTER_C=3
ATTEMPTED_AFTER_C=3
WRITE_SUCCESS_AFTER_C=3
WRITE_FAILED_AFTER_C=0

SKIPPED_DISABLED=0
SKIPPED_DRY_RUN=0
SKIPPED_MARKETPLACE=0
SKIPPED_EXTERNAL_ID=0
SKIPPED_LIMIT=0
SKIPPED_INVALID_EXTERNAL_ID=0
```

## Cleanup e baseline final

O cleanup foi autorizado somente apos contagens exatas:

```text
RAW_COUNT_BEFORE_DELETE=3
TARGET_A_BEFORE_DELETE=1
TARGET_B_BEFORE_DELETE=1
TARGET_C_BEFORE_DELETE=1

TARGET_A_DELETED=1
TARGET_B_DELETED=1
TARGET_C_DELETED=1
```

Estado final:

```text
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
TARGETED_TEST_STATUS=PASS
INGESTION_TEST_STATUS=PASS
FULL_TEST_RUN1=PASS
FULL_TEST_RUN2=PASS
PRISMA_VALIDATE_STATUS=PASS
PRISMA_GENERATE_STATUS=PASS
ENCODING_STATUS=PASS
BUILD_STATUS=PASS
DIFF_CHECK_STATUS=PASS
```

## Limites da evidencia

O sucesso com tres listings **nao autoriza aumentar o batch**. Ainda falta
provar:

- stop-after-first-failure em uma execucao com falha;
- cleanup apos falha parcial;
- retry controlado;
- recovery apos timeout;
- concorrencia;
- multiplos marketplaces;
- operacao continua.

A camada `evaluateRawListingBoundedBatchFailurePolicy()` criada depois desta
prova e read-only e deterministica. Ela prepara a validacao desses caminhos,
mas nao executa failure injection real, writes ou cleanup de banco.
