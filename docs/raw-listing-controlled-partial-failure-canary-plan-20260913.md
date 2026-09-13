# Plano: Controlled Real Partial-Failure Canary

**Projeto:** Ofertano
**Branch:** `feature/search-e2e-final-20260910`
**Checkpoint de readiness:** `26914d4`
**Data:** 2026-09-13

## Escopo

Este documento prepara uma futura prova controlada em que A e persistido com
sucesso, B falha de forma sintetica antes de qualquer persistencia raw e C nao
e executado. Esta missao nao executa o canary, nao injeta falha real e nao
altera o banco.

O runtime oficial da futura execucao sera o singleton em
[`src/lib/prisma.ts`](../src/lib/prisma.ts). O alvo de falha devera ser
envolvido somente por um harness temporario, sem alterar permanentemente o
repositorio de producao.

## Targets

```text
TARGET_A
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB7184373436
PRODUCT_ID=48fabfff-c918-4265-b26a-6573006620f6

TARGET_B
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB4935612308
PRODUCT_ID=2a0f839e-b1f0-4c33-892e-507b9d150182

TARGET_C
MARKETPLACE=MERCADO_LIVRE
EXTERNAL_ID=MLB6996698648
PRODUCT_ID=9079fdb3-0457-47dc-bf1d-3bacdb1e93af
```

## Readiness requerido

O precheck separado de partial failure devera retornar `READY` somente com:

```text
RAW_LISTING_DUAL_WRITE_ENABLED=false
MARKETPLACE_COUNT=1
TARGET_COUNT=3
EXTERNAL_IDS_VALID=YES
EXTERNAL_IDS_UNIQUE=YES
MAX_WRITES=3
EXECUTION_MODE=sequential
CONCURRENCY=1
PARALLEL_WRITES=0
STOP_AFTER_FIRST_FAILURE=true
BASELINE_KNOWN=true
ROLLBACK_DEFINED=true
ABORT_CRITERIA_DEFINED=true
CLEANUP_REQUIRED=true
CLEANUP_SCOPE_EXPLICIT=true
FAILURE_INJECTION_DEFINED=true
FAILURE_TARGET=MLB4935612308
FAILURE_STAGE=BEFORE_RAW_PERSIST
FAILURE_IS_SYNTHETIC=true
METRICS_HEALTHY=true
```

O precheck e puro, deterministico, read-only e fail-closed. Ele nao acessa o
banco, nao altera ambiente, metricas ou repositorios, e rejeita qualquer alvo
de falha fora do batch, qualquer stage diferente de
`BEFORE_RAW_PERSIST`, falha nao sintetica, concorrencia, baseline desconhecido
ou cleanup impreciso.

## Semantica real de falha

Na implementacao atual de `persistRawListingIfEnabled()`:

- `attempted` e incrementado no inicio de cada chamada;
- quando ha `maxWrites`, o counter e incrementado antes da consulta ao
  repositorio;
- falha em `findListingByMarketplaceExternalId`,
  `upsertRawMarketplaceListing` ou `linkListingToProduct` e absorvida;
- a chamada retorna `status=ERROR` com a mensagem da excecao;
- `writeFailed` e incrementado uma vez;
- `writeSuccess` nao e incrementado em falha.

Assim, numa futura tentativa A seguida de uma falha sintetica em B, o
counter esperado sera 2, `attempted=2`, `writeSuccess=1` e `writeFailed=1`.
Como a falha ocorre antes da persistencia de B, C nao devera ser chamado.

## Execucao futura

### Passo 1: A

Esperado:

```text
A=CREATED
RAW_TOTAL=1
A=1
B=0
C=0
```

### Passo 2: falha sintetica em B

O harness temporario devera rejeitar exatamente o external ID de B e lançar
um erro distinguivel, por exemplo `RAW_LISTING_CONTROLLED_CANARY_FAILURE`,
antes de delegar qualquer operacao de persistencia raw.

Esperado:

```text
B=status ERROR
RAW_TOTAL=1
A=1
B=0
C=0
```

### Passo 3: política de parada

A política de failure path deve validar `A SUCCESS`, `B FAILED`, `C NOT_RUN`
e produzir:

```text
PARTIAL_FAILURE_PLAN_VALID=YES
C_EXECUTION_ALLOWED=NO
CLEANUP_TARGETS=[A]
```

Nenhuma chamada para C deve ocorrer.

## Cleanup futuro

Antes do cleanup:

```text
A_COUNT=1
B_COUNT=0
C_COUNT=0
```

Somente A poderá ser removido por chave explícita:

```text
marketplace=MERCADO_LIVRE
externalId=MLB7184373436
expectedCount=1
```

Não usar wildcard, `deleteMany({})` ou remoção ampla. O estado final esperado
e:

```text
A_DELETED=1
B_DELETED=0
C_DELETED=0
RAW_TOTAL=0
A=0
B=0
C=0
BASELINE_RESTORED=YES
```

O planner somente declara alvos; nao executa cleanup.

## Criterios de abort

A futura execucao devera abortar se o baseline nao for zero, qualquer target
legado for invalido, algum gate nao estiver `READY`, A nao retornar `CREATED`,
B persistir inesperadamente, a falha nao ocorrer exatamente antes da
persistencia de B, C for executado, o plano de cleanup nao for `[A]` ou B/C
tiverem contagem diferente de zero.

## Limitacoes

Esta readiness nao prova falha real de banco, timeout recovery, retry
complexo, concorrencia, multiplos marketplaces ou operacao continua. Nenhum
canary partial-failure real esta autorizado por este documento.
