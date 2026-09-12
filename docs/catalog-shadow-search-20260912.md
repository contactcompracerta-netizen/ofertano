# Catalog Shadow Search

## Objetivo

Executar a busca local em modo shadow durante a pesquisa pública atual para medir cobertura, qualidade e latência do catálogo local sem alterar o resultado mostrado ao usuário.

## Arquitetura

- O fluxo público continua decidido por `searchCatalogOrDiscover`.
- A execução local do catálogo fica isolada em `runCatalogShadowSearch()`.
- O shadow é disparado em paralelo como `void runCatalogShadowSearch(search)` e nunca bloqueia a busca pública.
- O shadow não persiste nada, não publica nada e não altera a decisão do público.

## Flags e timeout

- Flag: `CATALOG_SHADOW_SEARCH_ENABLED`
- Timeout: `CATALOG_SHADOW_TIMEOUT_MS`
- Padrão: desligado por padrão; quando ativado, usa `1200ms` como limite conservador e cota máxima de `5000ms`.

## Isolamento

- `runCatalogShadowSearch()` usa `Promise.race()` para evitar que a busca local interfira no critical path.
- Falhas de Prisma, timeout, relevância e outros erros são capturadas e registradas em `console.warn` e em trace do sistema.
- O retorno do shadow nunca substitui o resultado público.

## Métricas

A estrutura de resultado expõe:

1. `status` (`HIT`, `MISS`, `ERROR`)
2. `elapsedMs`
3. `hitCount`
4. `comparableCount`
5. `singleCount`
6. `topMarketplaceCount`
7. `topProductId`

Esses campos permitem calcular no futuro:

- hit rate do catálogo
- taxa de comparáveis
- taxa de singles
- taxa de miss
- taxa de erro
- P95 de latência
- concordância do topo da lista

## Comparação pública

`compareCatalogShadowToPublic()` faz comparação conservadora e devolve `MATCH`, `PARTIAL`, `DIFFERENT` ou `UNKNOWN`.

Este valor é observacional. Não altera a ordem de publicação, o matcher público ou qualquer regra de publicação.

## Garantias do escopo

- sem alteração de resultado público
- sem banco de escrita
- sem external marketplace calls no shadow
- sem mudança na busca atual
- sem mudança de schema, migration, env e deploy

## Como testar

1. desative a flag e execute o shadow; ele deve não executar
2. ative a flag e execute um hit real com repositório local; deve retornar `HIT`
3. use uma query sem correspondência; deve retornar `MISS`
4. simule erro de banco; deve retornar `ERROR`
5. simule timeout; deve retornar `ERROR`
6. compare o resultado do shadow com o público usando `compareCatalogShadowToPublic()`

## Critérios para próxima fase

Antes da ativação local-first, a fase futura deve confirmar:

- catalog error rate < 1%
- catalog hit rate >= 30%
- top-result agreement >= 80%
- P95 do shadow <= 1500ms

Esses valores são conservadores para avaliação inicial e não representam ativação automática nesta missão.
