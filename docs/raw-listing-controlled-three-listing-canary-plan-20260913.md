# Plano: Controlled Three-Listing Canary de RawMarketplaceListing

**Projeto:** Ofertano
**Branch:** `feature/search-e2e-final-20260910`
**Checkpoint do código:** `5aa11c7`
**Data do plano:** 2026-09-13

## Contexto e objetivo

`RawMarketplaceListing` representa a oferta bruta de um marketplace. Sua
identidade operacional e o par `(marketplace, externalId)`, protegido pela
unicidade no banco e pelo caminho de persistencia existente.

O 49K provou o fluxo real de um listing. O 49M provou idempotencia real com
`CREATED -> UPDATED` e o mesmo ID. O 49O criou o gate read-only de controlled
multi-listing. O 49P selecionou os primeiros targets e documentou o plano. A
49Q executou dois writes reais controlados e a 49R documentou esse resultado.

Este documento prepara, mas nao autoriza, um canary real com tres listings.
Nenhum write foi executado para criar este plano.

O runtime oficial para qualquer execucao futura continua sendo o singleton em
[`src/lib/prisma.ts`](../src/lib/prisma.ts). Nao criar `PrismaClient` ou
`PrismaPg` ad hoc.

## Gates de seguranca

O gate `evaluateRawListingControlledMultiListingCanaryPrecheck()` permanece
separado dos gates single-canary e idempotency-canary:

- single-canary continua restrito a `maxWrites=1`;
- idempotency-canary continua restrito a um target e `maxWrites=2`;
- controlled multi-listing aceita dois ou tres targets distintos, um
  marketplace e `maxWrites` igual ao numero de targets.

O novo
`evaluateRawListingBoundedBatchExecutionPrecheck()` adiciona uma camada
independente para a execucao bounded batch. Para este plano, ele exige:

```text
RAW_LISTING_DUAL_WRITE_ENABLED=false
MARKETPLACE_COUNT=1
TARGET_COUNT=3
MAX_WRITES=3
EXECUTION_MODE=sequential
CONCURRENCY=1
PARALLEL_WRITES=0
STOP_AFTER_FIRST_FAILURE=true
CLEANUP_REQUIRED=true
CLEANUP_SCOPE_EXPLICIT=true
ROLLBACK_REQUIRED=true
ABORT_CRITERIA_DEFINED=true
BASELINE_KNOWN=true
EXPECTED_INITIAL_RAW_COUNT=0
READ_ONLY=true
```

O gate e fail-closed: rejeita concorrencia, paralelismo, IDs invalidos ou
duplicados, marketplace ausente ou invalido, limites divergentes, baseline
desconhecido, rollback, cleanup ou abort criteria ausentes. O precheck nao
acessa o banco, nao altera `process.env`, nao altera metricas e nao executa
writes.

## Targets reais selecionados

### TARGET_A

```text
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB7184373436
PRODUCT_ID=48fabfff-c918-4265-b26a-6573006620f6
TITLE=Aspirador De Pó E Água Wap Gtw 12 1400w 12l Inox
SOURCE_URL=https://produto.mercadolivre.com.br/MLB-7184373436
PRICE=578.1
LEGACY_FOUND=YES
PRODUCT_FOUND=YES
SOURCE_URL_VALID=YES
SOURCE_URL_EXTERNAL_ID_MATCH=YES
RAW_EXISTS=NO
```

### TARGET_B

```text
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB4935612308
PRODUCT_ID=2a0f839e-b1f0-4c33-892e-507b9d150182
TITLE=Chave Fenda 1/8x4 Nove54
SOURCE_URL=https://produto.mercadolivre.com.br/MLB-4935612308
PRICE=10.64
LEGACY_FOUND=YES
PRODUCT_FOUND=YES
SOURCE_URL_VALID=YES
SOURCE_URL_EXTERNAL_ID_MATCH=YES
RAW_EXISTS=NO
```

### TARGET_C

```text
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB6996698648
PRODUCT_ID=9079fdb3-0457-47dc-bf1d-3bacdb1e93af
TITLE=Chave Fenda 1/8 X8
SOURCE_URL=https://produto.mercadolivre.com.br/MLB-6996698648
PRICE=12.24
LEGACY_FOUND=YES
PRODUCT_FOUND=YES
SOURCE_URL_VALID=YES
SOURCE_URL_EXTERNAL_ID_MATCH=YES
RAW_EXISTS=NO
```

O TARGET_C foi selecionado por leitura de `MarketplaceOffer` com produto
relacionado. Sua URL e uma URL direta de item, nao uma URL `/p/`, e o ID da
URL corresponde ao external ID. Os tres external IDs sao unicos e os tres
produtos sao distintos.

## Baseline e readiness observados

As consultas foram somente de leitura e usaram o runtime oficial:

```text
RAW_LISTING_COUNT_BEFORE_PLAN=0
TARGET_A_RAW_BEFORE_PLAN=0
TARGET_B_RAW_BEFORE_PLAN=0
TARGET_C_RAW_BEFORE_PLAN=0
DATABASE_CHANGED=NO
```

Com a mesma allowlist, um counter compartilhado planejado e `maxWrites=3`,
ambos os prechecks retornaram `READY`:

```text
CONTROLLED_MULTI_THREE_TARGET_PRECHECK=READY
BOUNDED_BATCH_THREE_TARGET_PRECHECK=READY
```

O plano futuro deve usar:

```text
const counter = { current: 0 };
```

As chamadas devem ser sequenciais, com concorrencia 1, sem writes paralelos e
com parada imediata na primeira falha.

## Execucao futura esperada

Nenhuma etapa abaixo foi executada nesta missao. Ela descreve somente o
resultado esperado de uma futura autorizacao:

```text
ANTES:
RAW=0
A=0
B=0
C=0

WRITE A:
RAW=1
A=1
B=0
C=0

WRITE B:
RAW=2
A=1
B=1
C=0

WRITE C:
RAW=3
A=1
B=1
C=1

COUNTER=3
ATTEMPTED=3
WRITE_SUCCESS=3
WRITE_FAILED=0
SKIPS=0
```

O counter deve ser compartilhado pelas tres chamadas. Nenhuma quarta chamada
ou write adicional deve ser realizado.

## Abort criteria

A futura execucao deve parar imediatamente:

- se A falhar, sem executar B nem C;
- se B falhar, sem executar C;
- se C falhar, encerrando a execucao imediatamente;
- se o baseline inicial nao for exatamente zero;
- se qualquer precheck deixar de retornar `READY`;
- se houver tentativa de concorrencia ou paralelismo;
- se qualquer contagem intermediaria divergir do plano;
- se metricas, kill switch, cleanup ou rollback divergirem do contrato.

Nunca continuar apos a primeira falha.

## Cleanup futuro

Antes do cleanup futuro, a verificacao protegida devera confirmar:

```text
RAW=3
A=1
B=1
C=1
```

Somente as tres chaves explicitamente autorizadas poderao ser removidas:

```text
A_DELETED=1
B_DELETED=1
C_DELETED=1
```

O estado final esperado e:

```text
RAW=0
A=0
B=0
C=0
BASELINE_RESTORED=YES
DATABASE_RESIDUAL_TEST_DATA=NO
FLAG_LEFT_ENABLED=NO
KILL_SWITCH_CONFIRMED=YES
```

## Limitacoes

Mesmo um futuro canary real de tres listings nao provara:

- concorrencia ou paralelismo;
- varios marketplaces;
- alta carga;
- retry complexo apos erro;
- recovery apos timeout;
- operacao continua;
- backfill geral;
- cron;
- rollout global.

Este plano nao autoriza batch aberto, backfill, cron, rollout ou qualquer write
real de tres listings.

## Proxima etapa recomendada

Revisar os resultados desta preparacao noturna e decidir explicitamente se deve
ser autorizada uma futura execucao de **real three-listing canary**. Esta
missao para antes de qualquer write.
