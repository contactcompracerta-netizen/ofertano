# Raw Listing Canary Observability

## Objetivo

Adicionar observabilidade mínima e segura ao fluxo de `RawMarketplaceListing` sem ativar a gravação real ou alterar o comportamento público.

A missão 49G observe o caminho canary, mas não muda a decisão de negócio nem a fonte de verdade do legado. O legado continua sendo a única execução produtiva válida.

## Semântica de segurança

- `RAW_LISTING_DUAL_WRITE_ENABLED` permanece `false` por padrão.
- a observabilidade é process-local e in-memory
- não há endpoint HTTP público
- não há persistência em banco
- não há cron, job ou infraestrutura externa
- as métricas nunca autorizam ou bloqueiam writes por si só
- a decisão de canary continua sendo controlada apenas pela lógica de negócio existente

## Métricas disponíveis

O snapshot expõe contadores principais e agrupamento por marketplace:

- attempted
- skippedDisabled
- skippedDryRun
- skippedMarketplace
- skippedExternalId
- skippedLimit
- skippedInvalidExternalId
- writeSuccess
- writeFailed
- byMarketplace

Exemplo conceitual:

```ts
{
  attempted: 10,
  skippedDisabled: 4,
  skippedDryRun: 1,
  skippedMarketplace: 1,
  skippedExternalId: 1,
  skippedLimit: 1,
  skippedInvalidExternalId: 0,
  writeSuccess: 1,
  writeFailed: 1,
  byMarketplace: {
    amazon: {
      attempted: 3,
      writeSuccess: 1,
      skippedMarketplace: 2,
    },
  },
}
```

## Reset

A API interna oferece:

- `getRawListingCanaryMetrics()`
- `resetRawListingCanaryMetrics()`

O snapshot é uma cópia segura. Alterar o objeto retornado não altera o estado interno.

## Eventos de log

Eventos registrados em processo, sem payload sensível:

- `RAW_LISTING_CANARY_ATTEMPTED`
- `RAW_LISTING_CANARY_SKIPPED_DISABLED`
- `RAW_LISTING_CANARY_SKIPPED_DRY_RUN`
- `RAW_LISTING_CANARY_SKIPPED_MARKETPLACE`
- `RAW_LISTING_CANARY_SKIPPED_EXTERNAL_ID`
- `RAW_LISTING_CANARY_SKIPPED_LIMIT`
- `RAW_LISTING_CANARY_SKIPPED_INVALID_EXTERNAL_ID`
- `RAW_LISTING_CANARY_WRITE_SUCCESS`
- `RAW_LISTING_CANARY_WRITE_FAILED`

Os logs só incluem o marketplace normalizado para evitar exposição de dados confidenciais.

## Dados que NÃO são registrados

- URLs completas
- titles do produto
- payload bruto
- tokens de sessão
- cookies
- headers de autorização
- secrets
- external IDs agregados do catálogo
- connection strings

## Semântica dos contadores

Cada tentativa válida de execução deve produzir exatamente um resultado terminal principal:

- `SKIPPED_DISABLED`
- `SKIPPED_DRY_RUN`
- `SKIPPED_MARKETPLACE`
- `SKIPPED_EXTERNAL_ID`
- `SKIPPED_LIMIT`
- `SKIPPED_INVALID_EXTERNAL_ID`
- `WRITE_SUCCESS`
- `WRITE_FAILED`

A soma dos resultados terminais deve ser compatível com o número de tentativas e o contador `attempted`.

Se o fluxo atual impedir essa relação exata em algum caso, a criação da métrica deve permanecer segura e o legado não deve quebrar.

## Escopo e limites

- escopo por processo
- não representa agregação distribuída entre múltiplas instâncias
- não substitui observabilidade de infraestrutura
- não ativa canary real
- não altera public search, Multistore, ranking, matcher ou APIs públicas

## Fail-open do legado

Se alguma parte da observabilidade falhar, o legado continua a funcionar sem exceções que afetem o fluxo público. A observabilidade não entra no caminho decisório do canary.

## Kill switch

O `kill switch` permanece o mesmo da missão 49F:

- `RAW_LISTING_DUAL_WRITE_ENABLED=false` por padrão
- `canary` configurado de forma explícita e restritiva
- vetos por marketplace, externalId e limite continuam valendo
- qualquer configuração inválida continua bloqueando writes

## Critérios mínimos antes de qualquer ativação real

Sem ativar nada nesta missão, um futuro canary deve respeitar:

- `writeFailed = 0`
- nenhuma exceção afetando legacy
- nenhum dado duplicado
- nenhum crescimento inesperado
- limite dentro do canary configurado
- kill switch validado
- banco consistente
- nenhuma alteração pública

## Observação final

A missão 49G não autoriza ativação em produção. Esta mudança é apenas de observabilidade interna para permitir análise antes de qualquer expansão controlada do canary.
