# CATALOG_ARCHITECTURE_V1 — Shopee publica: agendamento do sync (FASE 9.36)

## O que mudou

Shopee saiu de SHADOW e passou a ser o **segundo marketplace publico** do
Catalog V1 (junto com Mercado Livre). As 3 ofertas Shopee certificadas estao
publicas, todas `EXACT`, todas com link de afiliado validado.

Para isso ser verdade no dia seguinte, o sync precisa rodar sozinho. Este
documento registra **como** ele e agendado e **por que** assim.

## Onde o sync roda

`GET /api/cron/marketplace-sync?marketplace=shopee&dry=false&limit=1000`

O agendamento vive em `vercel.json`, no bloco `crons`. Escolha deliberada:

- O projeto **ja** usa Vercel Cron para todos os jobs agendados dele
  (`price-monitor`, `catalog-populate`, `import-queue`,
  `catalog-regression-monitor`, `social-daily`, `cutover-autopilot`). O sync
  entrou no mesmo mecanismo, com o mesmo `CRON_SECRET`, pela mesma rota de
  codigo. Nao ha um segundo sistema de agendamento convivendo com o primeiro.
- Isso tambem satisfaz a exigencia de **nao perturbar**
  `.github/workflows/processar-fila-multiloja.yml`: um cron da Vercel e um
  sistema completamente separado de GitHub Actions. Eles nao disputam grupo de
  concorrencia, nao se cancelam e nao podem derrubar um ao outro — o arquivo
  existente nao foi tocado.

Existe tambem `.github/workflows/sincronizar-marketplace-publico.yml`, autorado
para cadence horaria e preservado no branch `fase9/shopee-public-workflow`. Ele
**nao esta publicado**: o token GitHub desta maquina tem escopo
`gist, read:org, repo` e o GitHub recusa criar `.github/workflows/*` sem o
escopo `workflow`. Publicar e uma acao so:

```
gh auth refresh -s workflow     # e depois: git push origin fase9/shopee-public-workflow
```

### Por que diario e nao horario

A conta nao reporta o plano pela API, e **os 6 crons ja existentes sao todos
diarios** — ou seja, execucao horaria nao e uma capacidade ja demonstrada nesta
conta. Declarar `"17 * * * *"` seria testar em producao, as cegas: se o plano
recusar, a falha apareceria no build. Optou-se por `23 8 * * *`, que segue o
padrao vigente do projeto. Se a conta suportar horario, e uma edicao de uma
linha em `vercel.json` (ou a publicacao do workflow acima).

## Por que `dry=false` esta explicito na URL

O endpoint tem `dry=true` como **default** (fail-closed): uma chamada sem o
parametro nao escreve nada. Um agendamento que grava precisa dizer que grava.
E o que esta escrito, nao quem pediu:

- O writer so grava oferta `EXACT` **unica** e sem hard conflict.
  `>= 2` EXACT no mesmo `CandidateBlockingKey` => `AMBIGUOUS_EXACT` => nao
  publica nenhuma.
- `REVIEW` e `REJECT` nunca sao publicados.
- Nenhum `Product` e criado pelo Shopee (attach-only).
- `Product.active` / `publicationStatus` / `isBest` **nao** sao escritos pelo
  sync. A publicacao passa por `sincronizarMelhorOfertaDoProduto`, o gate
  central, que exige >= 2 marketplaces publicos com **peso real** para produto
  auto-criado.
- Um item que falha nao derruba os demais; o restante da execucao segue e o
  relatorio sai com `success: false` e HTTP 200, para o proximo ciclo rodar e o
  operador ler o erro.
- Idempotencia medida: duas execucoes consecutivas => 3/3 `NOOP`, delta zero em
  Product, MarketplaceOffer, CandidateBlockingKey e `AUTO_ACTIVE_LT2`.

## Promocao e o que ela NAO toca

A promocao foi **por fonte**, e nao global:

| Variavel | Antes | Depois |
|---|---|---|
| `ARCHITECTURE_V1_SHADOW_ENABLED` | `true` | `true` (inalterada) |
| `ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS` | `shopee` | `` (vazio) |
| `CATALOG_V1_GLOBAL_CUTOVER` | — | **nao existe** |

A Shopee saiu da allowlist de shadow; a variavel e o interruptor continuam
existindo, e Mercado Livre nunca entrou na allowlist. `CATALOG_V1_GLOBAL_CUTOVER`
**nao foi criada** — nem antes, nem agora. O rollout segue por fonte, e o peso
de publicacao e lido da allowlist, nunca de um `if` por nome de marketplace.
