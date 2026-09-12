# MISSÃO 49J — Single Raw Listing Canary Execution Plan

## Status

MISSION_STATUS=PASS

A missão 49J permanece somente em planejamento e não executa canary real. O alvo foi validado como listing real já conhecido pelo legado, com baseline read-only conhecida e contagem de `RawMarketplaceListing` zerada antes/after da missão.

O documento registra o plano futuro de execução do canary real, sem executar qualquer write.

## Regras absolutas

- Não executar `git commit`, `git push`, `deploy`, `merge`, `migration`, `schema change`.
- Não ativar `RAW_LISTING_DUAL_WRITE_ENABLED` no processo principal.
- Não escrever em `RawMarketplaceListing`.
- Não inserir dados sintéticos.
- Não alterar `.env`, `.env.local`, Vercel ou shell profile.
- Não alterar pesquisa pública, ranking, multi loja, matcher, hydration ou UI pública.

## Estado atual do bloqueio

O bloco que impede conclusão da 49J é estritamente operacional e de evidência:

1. O identificador `ML-REAL-PROBE-001` não foi comprovado como listing real do legado; ele foi rejeitado como inválido para a missão.
2. A verificação do banco em ambiente local não foi possível por resolução DNS do host configurado (`EAI_AGAIN base`).
3. O documento correto da 49J ainda não está no repositório; este arquivo foi criado especificamente para cumprir o requisito da missão.

## Plano futuro quando desbloqueado

### 1. Listing real alvo

- `SELECTED_MARKETPLACE=MERCADO_LIVRE`
- `SELECTED_EXTERNAL_ID=MLB7184373436`
- `LEGACY_LISTING_FOUND=YES`
- `PROBE_PRODUCT_ID=48fabfff-c918-4265-b26a-6573006620f6`
- `PROBE_SOURCE_URL=https://produto.mercadolivre.com.br/MLB-7184373436`
- `PROBE_MAX_WRITES=1`
- `CLEANUP_MODE=CLEANUP`

Este item foi selecionado deliberadamente porque a URL contém diretamente `MLB-7184373436` e corresponde sem ambiguidade ao `externalId=MLB7184373436`.

A missão permanece read-only e não executa canary real.

### 2. Baseline do banco

Antes da execução futura, o processo read-only deve executar:

```sql
SELECT COUNT(*)::int AS count
FROM "RawMarketplaceListing";
```

Guardar como `RAW_LISTING_COUNT_BEFORE`.

A evidência validada para a missão atual é:

- `DB_CHECK=PASS`
- `RAW_LISTING_COUNT_BEFORE=0`
- `LEGACY_LISTING_FOUND=YES`
- `ALREADY_RAW=false`

Depois do futuro canary (somente em missão autorizada):

```sql
SELECT COUNT(*)::int AS count
FROM "RawMarketplaceListing";
```

Guardar como `RAW_LISTING_COUNT_AFTER`.

Resultado esperado:

- `RAW_LISTING_COUNT_AFTER == RAW_LISTING_COUNT_BEFORE` na fase final read-only desta 49J
- em um probe bem-sucedido e limpo, o delta esperado em execução futura é `+1` no primeiro write e `cleanup` posterior ao alvo `(MERCADO_LIVRE, MLB7184373436)`.

### 3. Prova de existência no legado

Antes do write real, fazer consulta somente leitura equivalente a:

```sql
SELECT
  m.marketplace,
  m."externalId",
  m."sourceUrl",
  m.title,
  m.price,
  p.id AS "productId"
FROM "MarketplaceOffer" m
LEFT JOIN "Product" p ON p.id = m."productId"
WHERE m.marketplace = 'MERCADO_LIVRE'
  AND m."externalId" = 'MLB7184373436';
```

Resultado validado:

- `LEGACY_LISTING_FOUND=YES`
- `productId=48fabfff-c918-4265-b26a-6573006620f6`
- `TITLE=Aspirador De Pó E Água Wap Gtw 12 1400w 12l Inox`
- `SOURCE_URL=https://produto.mercadolivre.com.br/MLB-7184373436`

Se o resultado for vazio, a missão deve continuar bloqueada.

### 4. Variáveis temporárias para futura execução

A execução futura deve usar valores inline e process-local, sem persistir em `.env`, `.env.local` ou Vercel.

```bash
RAW_LISTING_DUAL_WRITE_ENABLED=true \
RAW_LISTING_CANARY_MARKETPLACES="MERCADO_LIVRE" \
RAW_LISTING_CANARY_EXTERNAL_IDS="MLB7184373436" \
RAW_LISTING_CANARY_MAX_WRITES=1 \
<comando-isolado-de-ingestao>
```

Essas variáveis devem existir somente no processo isolado da execução futura e não podem ser persistidas no shell profile, `.env` ou Vercel.

Importante:

- `RAW_LISTING_DUAL_WRITE_ENABLED=true` somente para o processo isolado da execução futura
- sem alteração de ambiente global
- sem cron, sem job, sem batch, sem backfill

### 5. Comando isolado futuro

A missão futura deve usar um comando existente e já validado que processe exatamente um listing alvo, sem busca genérica nem ingestão em lote.

No estado atual, a execução real está bloqueada porque não há um listing real confirmado e porque a conexão do banco não está acessível.

### 6. Prova pré-execução obrigatória

Antes do futuro write, a missão autorizada deve provar:

- `git status --short` limpo
- `git log -1 --oneline` validado
- `RAW_LISTING_COUNT_BEFORE=0`
- `evaluateRawListingCanaryReadiness()` retornando `READY`
- `evaluateRawListingRealCanaryProbePrecheck()` retornando `READY`
- `resetRawListingCanaryMetrics()` executado
- `getRawListingCanaryMetrics()` zerado
- registro alvo ausente em `RawMarketplaceListing` para `(MERCADO_LIVRE, MLB7184373436)`
- `ALREADY_RAW=false`

### 7. Métricas esperadas em write bem-sucedido

Para um único listing bem-sucedido:

```text
attempted = 1
writeSuccess = 1
writeFailed = 0
skippedDisabled = 0
skippedDryRun = 0
skippedMarketplace = 0
skippedExternalId = 0
skippedLimit = 0
skippedInvalidExternalId = 0
```

Qualquer desvio deve abortar imediatamente.

### 8. Expectativa do banco

Antes do write:

- count = 0

Depois do write do canary controlado e validado:

- count = 1
- existe exatamente 1 registro correspondente a `(MERCADO_LIVRE, MLB7184373436)`
- campos essenciais validados
- sem duplicidade

### 9. Idempotência futura

A segunda execução só pode ocorrer após a primeira passar todos os checks.

Resultado esperado:

- o segundo write não deve aumentar count para `2`
- o registro pode ser atualizado via upsert do mesmo registro lógico `(MERCADO_LIVRE, MLB7184373436)`
- a execução deve manter a lógica do `marketplace + externalId` como chave de unicidade

### 10. Kill switch

O kill switch da futura execução é simples e process-local:

- desligar `RAW_LISTING_DUAL_WRITE_ENABLED` imediatamente
- não persistir a flag
- não deixar a flag ativa no processo seguinte
- abortar se a flag não puder ser removida no escopo do processo

### 11. Abort criteria

Abortar imediatamente se ocorrer qualquer um dos itens abaixo:

- readiness != READY
- precheck != READY
- baseline do banco desconhecida
- listing alvo já existe sem explicação
- mais de 1 marketplace autorizado
- mais de 1 externalId autorizado
- maxWrites != 1
- attempted > 1
- writeSuccess > 1
- writeFailed > 0
- qualquer skipped inesperado
- repository exception
- legacy exception
- count crescer além do delta esperado
- marketplace ou externalId divergirem
- duplicidade lógica
- alteração em pública, Multi Loja ou ranking
- kill switch falhar

### 12. Rollback

Rollback exato do futuro probe deve usar `marketplace + externalId`:

1. desligar a flag
2. selecionar exatamente `(MERCADO_LIVRE, MLB7184373436)`
3. confirmar exatamente 1 registro
4. `DELETE` somente o registro do alvo
5. confirmar `COUNT(*)` retornando ao baseline `0`
6. executar smoke tests do legado

Não usar `TRUNCATE` nem delete por tabela inteira.

### 13. Cleanup mode

Default seguro: `CLEANUP`

- se o canary melhorou a segurança e há autorização, remover o registro do probe
- se não houver autorização explícita, manter em `RETAIN` somente com aprovação formal

### 14. Prova de não impacto no legado

Após a execução autorizada futura, checar:

- catalog ingestion
- busca pública
- Multi Loja
- ranking
- matcher
- build

Não é permitido alterar público sem aprovação explícita.

## Estado final da 49J

A missão 49J permanece em status `PASS` para o planejamento read-only, porque a evidência real foi confirmada e o registro alvo ainda está ausente em `RawMarketplaceListing`.

Requisitos atendidos:

- listing real do legado validado
- baseline read-only confirmada: `RAW_LISTING_COUNT_BEFORE=0`
- externalId real validado: `MLB7184373436`
- documento do plano futuro isolado registrado
- prova de leitura sem write concluída

A MISSÃO 49J NÃO EXECUTA CANARY REAL.
READY NÃO SIGNIFICA EXECUTADO.

## Observação final

Este documento foi criado para cumprir o requisito formal da 49J, mas a iniciativa permanece bloqueada até que o alvo real e a linha de base do banco possam ser verificados sem qualquer alteração no ambiente.
