# Plano: Controlled Retry Canary de RawMarketplaceListing

**Projeto:** Ofertano
**Branch:** `feature/search-e2e-final-20260910`
**Checkpoint da policy:** `a875545`
**Data:** 2026-09-13

## Escopo

Este documento prepara um futuro retry canary, mas nao executa retry, timeout,
write ou acesso de escrita ao banco. O timeout ficara para uma missao
posterior e nao sera combinado com o retry canary.

## Auditoria do comportamento atual

`persistRawListingIfEnabled()` atualmente nao possui retry automatico. Ela faz
uma unica tentativa por chamada, incrementa `attempted`, consome o counter
antes da consulta ao repository quando `maxWrites` esta configurado e absorve
falhas do repository como `status=ERROR`, incrementando `writeFailed`.
`writeSuccess` somente e incrementado apos a persistencia e o vinculo bem
sucedidos.

Nao ha timeout de producao no caminho auditado, nem `Promise.race`,
`AbortController`, backoff ou classificacao automatica de erros. A mensagem da
excecao e retornada, sem classificar sua causa.

## Policy conservadora

A nova policy read-only
`evaluateRawListingRetryPolicy()` classifica explicitamente:

```text
SYNTHETIC_CONTROLLED
TRANSIENT
PERMANENT
TIMEOUT
UNKNOWN
```

Somente `TRANSIENT` e `TIMEOUT` podem autorizar retry. A policy exige:

```text
retryBudgetDefined=true
maxRetries=1
retryCount<=1
timeoutDefined=true
0 < timeoutMs <= 15000
backoffDefined=true
backoffStrategy=fixed
1 <= backoffMs <= 5000
idempotencyCheckRequired=true
retryUpsertSafe=true
stopOnSuccess=true
stopOnPermanentFailure=true
stopWhenRetryBudgetExhausted=true
stopAfterFinalRetryFailure=true
```

Nao ha espera real nem loop de retry nesta missao. O plano puro
`planRawListingRetry()` somente calcula se o retry seria permitido, a proxima
tentativa, o atraso configurado e a necessidade de revalidar a identidade
`marketplace + externalId`.

## Resultado conceitual

Para erro `TRANSIENT` ou `TIMEOUT`, `retryCount=0` e configuracao valida:

```text
RETRY_ALLOWED=YES
MAX_RETRIES=1
NEXT_ATTEMPT=2
RECHECK_IDENTITY=YES
```

Para `SYNTHETIC_CONTROLLED`, `PERMANENT` ou `UNKNOWN`, o retry e recusado.
Com `retryCount=1`, o budget esta esgotado e nenhum retry adicional e
permitido.

## Plano futuro

Uma futura missao podera usar um target real e uma primeira tentativa
sintetica classificada como `TRANSIENT`, sem criar row. A policy devera
autorizar exatamente um retry, usando a mesma identidade de marketplace e
external ID. A segunda tentativa podera resultar em `CREATED`; depois, a
contagem devera ser exatamente 1 e o cleanup devera usar a chave explicita.

As metricas futuras deverao seguir a semantica real auditada: a primeira
tentativa incrementara `attempted` e, se falhar antes da persistencia,
`writeFailed`; o retry bem-sucedido incrementara `attempted` e
`writeSuccess`. Nenhum valor de runtime e executado ou afirmado por esta
missao.

## Timeout separado

Timeout nao sera executado junto do retry canary. Um futuro timeout canary
devera retornar erro controlado, reavaliar a policy e respeitar o limite de
15.000 ms, sem introduzir `Promise.race` ou controle de timeout no fluxo de
producao nesta etapa.

## Limitacoes

Ainda nao foram provados retry real, retry idempotente, timeout recovery,
classificacao de erro real de rede ou banco, concorrencia, multiplos
marketplaces ou operacao continua.
