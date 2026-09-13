# Controlled Real Two-Listing Canary: Success

**Projeto:** Ofertano
**Branch:** `feature/search-e2e-final-20260910`
**Checkpoint:** `1c569fc`
**Data:** 2026-09-12

## Contexto e arquitetura

`RawMarketplaceListing` é a representação bruta de uma oferta de marketplace.
Sua identidade é o par `(marketplace, externalId)`, com vínculo opcional ao
produto canônico. O caminho de persistência usa o repositório Raw Listing e a
restrição de unicidade da identidade para evitar colisões e duplicatas.

O runtime oficial usado nas provas foi o singleton em
[`src/lib/prisma.ts`](../src/lib/prisma.ts). Não foi criado `PrismaClient` ou
`PrismaPg` ad hoc.

Esta prova é a sequência das missões anteriores:

- **49K:** provou um canary real de um listing, com criação e cleanup;
- **49M:** provou idempotência real no mesmo listing, com `CREATED` seguido de
  `UPDATED` e o mesmo ID;
- **49O:** criou o gate read-only, separado e fail-closed para um lote de 2 ou
  3 listings;
- **49P:** selecionou os targets reais e documentou o plano, sem writes.

A **49Q** executou o primeiro canary real controlado com exatamente dois
listings distintos no mesmo marketplace.

## Objetivo e gate

O objetivo era provar que dois listings distintos poderiam ser persistidos uma
vez cada, com limite explícito de dois writes, sem colisão, sem duplicata e
com cleanup protegido.

Configuração process-local:

```text
RAW_LISTING_DUAL_WRITE_ENABLED=false
RAW_LISTING_CANARY_MARKETPLACES=MERCADO_LIVRE
RAW_LISTING_CANARY_EXTERNAL_IDS=MLB7184373436,MLB4935612308
RAW_LISTING_CANARY_MAX_WRITES=2
```

Resultado dos gates:

```text
READINESS_BEFORE=READY
CONTROLLED_MULTI_PRECHECK=READY
METRICS_RESET_BEFORE=PASS
```

Foi usado um único counter compartilhado entre as duas chamadas. Nenhum
terceiro write foi executado.

## Targets reais

### TARGET_A

```text
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB7184373436
PRODUCT_ID=48fabfff-c918-4265-b26a-6573006620f6
TITLE=Aspirador De Pó E Água Wap Gtw 12 1400w 12l Inox
SOURCE_URL=https://produto.mercadolivre.com.br/MLB-7184373436
```

### TARGET_B

```text
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB4935612308
PRODUCT_ID=2a0f839e-b1f0-4c33-892e-507b9d150182
TITLE=Chave Fenda 1/8x4 Nove54
SOURCE_URL=https://produto.mercadolivre.com.br/MLB-4935612308
```

Ambos foram encontrados no `MarketplaceOffer`, tiveram o produto esperado,
source URL direta válida e correspondência entre URL e external ID.

## Baseline

```text
RAW_LISTING_COUNT_BEFORE=0
TARGET_A_RAW_BEFORE=0
TARGET_B_RAW_BEFORE=0
```

## Prova central

### Write A

```text
TARGET_A_WRITE_STATUS=CREATED
RAW_COUNT_AFTER_A=1
TARGET_A_COUNT_AFTER_A=1
TARGET_B_COUNT_AFTER_A=0
TARGET_A_RAW_ID=cmtz3nrf800000zdhaw0kf2pv
```

### Write B

```text
TARGET_B_WRITE_STATUS=CREATED
RAW_COUNT_AFTER_B=2
TARGET_A_COUNT_AFTER_B=1
TARGET_B_COUNT_AFTER_B=1
TARGET_B_RAW_ID=cmtz3nrny00010zdhbfwdux0a
DISTINCT_RAW_IDS=YES
```

Os dois IDs são distintos e cada chave possui exatamente uma linha. Isso
comprova que dois listings distintos foram persistidos no mesmo canary
controlado sem colisão ou duplicação.

## Delta de banco

| Etapa | RAW_TOTAL | TARGET_A | TARGET_B |
| --- | ---: | ---: | ---: |
| Antes | 0 | 0 | 0 |
| Após Write A | 1 | 1 | 0 |
| Após Write B | 2 | 1 | 1 |
| Após cleanup | 0 | 0 | 0 |

## Counter e métricas

```text
CANARY_COUNTER_AFTER_B=2
ATTEMPTED_AFTER_B=2
WRITE_SUCCESS_AFTER_B=2
WRITE_FAILED_AFTER_B=0

SKIPPED_DISABLED=0
SKIPPED_DRY_RUN=0
SKIPPED_MARKETPLACE=0
SKIPPED_EXTERNAL_ID=0
SKIPPED_LIMIT=0
SKIPPED_INVALID_EXTERNAL_ID=0
```

## Validação dos dados

```text
TARGET_A_DATA_VALID=YES
TARGET_B_DATA_VALID=YES
```

Os registros persistidos mantiveram marketplace, external ID, vínculo ao
produto e source URL correspondentes aos dados reais usados como origem.

## Cleanup e estado final

O cleanup foi protegido por contagens exatas:

```text
RAW_COUNT_BEFORE_DELETE=2
TARGET_A_BEFORE_DELETE=1
TARGET_B_BEFORE_DELETE=1
TARGET_A_DELETED=1
TARGET_B_DELETED=1
```

Estado final:

```text
RAW_LISTING_COUNT_FINAL=0
TARGET_A_RAW_FINAL=0
TARGET_B_RAW_FINAL=0
BASELINE_RESTORED=YES
DATABASE_RESIDUAL_TEST_DATA=NO
FLAG_LEFT_ENABLED=NO
KILL_SWITCH_CONFIRMED=YES
```

## Testes finais

Todas as validações pós-cleanup passaram:

```text
catalog-listings=PASS
catalog-ingestion=PASS
full test run 1=PASS
full test run 2=PASS
Prisma validate=PASS
Prisma generate=PASS
encoding=PASS
build=PASS
diff-check=PASS
```

## Limitações

Esta prova ainda **não autoriza rollout geral**. Ainda não foram provados:

- três listings em execução real;
- múltiplos marketplaces;
- concorrência;
- writes paralelos;
- alta carga;
- retry após erro;
- recuperação após timeout;
- operação contínua;
- backfill;
- cron;
- rollout global.

## Próxima fase recomendada

`CONTROLLED THREE-LISTING CANARY READINESS`

Como alternativa, pode ser avaliada uma fase de
`BOUNDED BATCH EXECUTION SAFETY`. Nenhuma dessas fases foi executada nesta
missão.
