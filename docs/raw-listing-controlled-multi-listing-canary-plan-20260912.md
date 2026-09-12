# Plano: Controlled Multi-Listing Canary de RawMarketplaceListing

**Projeto:** Ofertano
**Branch:** `feature/search-e2e-final-20260910`
**Commit de readiness:** `baf3cde`
**Data do plano:** 2026-09-12

## Contexto

O 49K comprovou um canary real de um listing, com um write, criação de uma
linha e cleanup seguro. O 49M comprovou idempotência real do mesmo listing:
`CREATED` na primeira execução, `UPDATED` na segunda, o mesmo ID persistido e
nenhuma duplicata. O 49O adicionou o gate separado e fail-closed
`evaluateRawListingControlledMultiListingCanaryPrecheck()` para preparar um
lote pequeno sem ativar writes reais.

Este documento prepara a próxima missão. Ele não executa o canary, não altera o
banco e não autoriza rollout geral.

## Objetivo da próxima missão

Executar futuramente exatamente dois listings reais, uma vez cada, no mesmo
marketplace, usando `maxWrites=2`. O objetivo será confirmar que dois targets
distintos podem ser escritos em um lote limitado, observável e com rollback
explícito.

O primeiro lote deliberadamente usa dois targets, e não três, para reduzir a
superfície de risco.

```text
TARGET_COUNT=2
MAX_WRITES=2
MARKETPLACE=MERCADO_LIVRE
```

## Gate e segurança

O gate usado pela futura missão deve permanecer separado dos gates anteriores:

- single-canary: exige `maxWrites=1`;
- idempotency-canary: exige `maxWrites=2` para um único external ID;
- controlled multi-listing: aceita somente 2 ou 3 external IDs, um marketplace,
  IDs válidos e únicos, e `maxWrites` exatamente igual ao número de targets.

Para este plano, o precheck foi executado somente em modo read-only:

```text
RAW_LISTING_DUAL_WRITE_ENABLED=false
RAW_LISTING_CANARY_MARKETPLACES=MERCADO_LIVRE
RAW_LISTING_CANARY_EXTERNAL_IDS=MLB7184373436,MLB4935612308
RAW_LISTING_CANARY_MAX_WRITES=2

CONTROLLED_MULTI_PRECHECK=READY
```

As condições de segurança exigidas são:

```text
baselineKnown=true
rollbackDefined=true
abortCriteriaDefined=true
readOnly=true
```

O runtime oficial da futura execução deverá continuar sendo o singleton em
[`src/lib/prisma.ts`](../src/lib/prisma.ts). Não criar `PrismaClient` ou
`PrismaPg` ad hoc.

## Targets reais selecionados

### TARGET_A

```text
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB7184373436
PRODUCT_ID=48fabfff-c918-4265-b26a-6573006620f6
TITLE=Aspirador De Pó E Água Wap Gtw 12 1400w 12l Inox
SOURCE_URL=https://produto.mercadolivre.com.br/MLB-7184373436
PRICE=578.1
LEGACY_OFFER_FOUND=YES
PRODUCT_FOUND=YES
SOURCE_URL_VALID=YES
SOURCE_URL_EXTERNAL_ID_MATCH=YES
RAW_ALREADY_EXISTS=NO
```

Este é o listing já validado no 49K e no 49M.

### TARGET_B

```text
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB4935612308
PRODUCT_ID=2a0f839e-b1f0-4c33-892e-507b9d150182
TITLE=Chave Fenda 1/8x4 Nove54
SOURCE_URL=https://produto.mercadolivre.com.br/MLB-4935612308
PRICE=10.64
LEGACY_OFFER_FOUND=YES
PRODUCT_FOUND=YES
SOURCE_URL_VALID=YES
SOURCE_URL_EXTERNAL_ID_MATCH=YES
RAW_ALREADY_EXISTS=NO
```

O TARGET_B usa URL direta de item (`produto.mercadolivre.com.br/MLB-...`),
não uma catalog URL `/p/`, e possui produto distinto do TARGET_A.

```text
TARGETS_UNIQUE=YES
PRODUCTS_DISTINCT=YES
```

## Baseline observado

A seleção e o precheck foram feitos somente por leitura:

```text
RAW_LISTING_TOTAL=0
TARGET_A_RAW_COUNT=0
TARGET_B_RAW_COUNT=0
DATABASE_CHANGED=NO
```

## Execução futura planejada

A futura missão deverá criar um único counter compartilhado:

```text
const counter = { current: 0 };
```

As duas chamadas deverão usar o mesmo listing-specific repository, a mesma
allowlist, o mesmo counter e `maxWrites=2`. A ordem planejada é:

1. Escrever TARGET_A uma vez.
2. Validar `CREATED`, total igual a 1 e TARGET_A igual a 1.
3. Escrever TARGET_B uma vez.
4. Validar `CREATED`, total igual a 2, TARGET_A igual a 1 e TARGET_B igual a
   1.
5. Validar os campos persistidos de cada target contra os dados reais do
   `MarketplaceOffer` e do `Product`.

O resultado esperado é:

```text
ANTES:
RAW_TOTAL=0
TARGET_A=0
TARGET_B=0

WRITE A:
status=CREATED
RAW_TOTAL=1
TARGET_A=1
TARGET_B=0

WRITE B:
status=CREATED
RAW_TOTAL=2
TARGET_A=1
TARGET_B=1

COUNTER=2
```

Métricas esperadas:

```text
attempted=2
writeSuccess=2
writeFailed=0
skippedDisabled=0
skippedDryRun=0
skippedMarketplace=0
skippedExternalId=0
skippedLimit=0
skippedInvalidExternalId=0
```

Nenhuma terceira chamada poderá ser feita.

## Critérios de abort imediato

A futura execução deverá abortar sem prosseguir se ocorrer qualquer condição
abaixo:

- baseline diferente de zero;
- target legado ausente;
- produto ausente;
- source URL inválida ou divergente do external ID;
- precheck diferente de `READY`;
- primeiro write diferente de `CREATED`;
- contagem após o primeiro write diferente de `RAW_TOTAL=1`,
  `TARGET_A=1`, `TARGET_B=0`;
- segundo write diferente de `CREATED`;
- contagem após o segundo write diferente de `RAW_TOTAL=2`,
  `TARGET_A=1`, `TARGET_B=1`;
- qualquer target com contagem diferente de 1;
- métricas divergentes;
- tentativa de terceiro write;
- kill switch persistindo habilitado;
- worktree deixando de estar no estado esperado.

## Rollback e cleanup futuro

O cleanup deverá ser protegido por contagens exatas antes de apagar:

```text
RAW_TOTAL=2
TARGET_A_COUNT=1
TARGET_B_COUNT=1
```

Somente as duas chaves explicitamente autorizadas poderão ser removidas:

```text
TARGET_A_DELETED=1
TARGET_B_DELETED=1
```

O estado final esperado será:

```text
RAW_TOTAL=0
TARGET_A=0
TARGET_B=0
BASELINE_RESTORED=YES
DATABASE_RESIDUAL_TEST_DATA=NO
```

Esta missão preparatória não executou cleanup porque nenhum write foi feito.

## Limitações

Este plano não prova ainda:

- execução real do lote;
- concorrência;
- vários marketplaces;
- alta carga;
- retry após erro de banco;
- recovery após timeout;
- operação contínua;
- rollout global.

Também não autoriza batch aberto, backfill, cron ou rollout geral.

## Próxima ação

Executar uma missão separada de **controlled real two-listing canary**, após
revisão deste plano. A execução deverá parar depois dos dois writes e do
cleanup protegido; não deverá fazer push, merge ou deploy.
