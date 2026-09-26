# CATALOG V1 — AUTOPILOT DE CUTOVER LIVE (FASE 7.2)

> Autopiloto que leva o writer V1 de `mercado_livre` por 1 → 5 → 25 → 100
> usando **só tráfego orgânico real e evidência dura**, abre o breaker sozinho em
> erro crítico, e não tem loop residente: o estado vive no PostgreSQL e cada
> execução é idempotente.
> Cutover GLOBAL continua PROIBIDO (`CATALOG_V1_GLOBAL_CUTOVER=NO`).

## Estado final

```
FASE_7_2_STATUS=DEPLOYED + ARMED (degrau 1, cooldown de 24h em curso)
BASE_SHA=a132fdc10c9fed0f44d9375ac4c56027d0d98cff
FINAL_SHA=<HEAD> (o commit deste relatório; ver "Deploy")
RUNTIME_SHA=c2d5c13afbc3d4e92c3a5e298b69ae7aa74bf637
PRODUCTION_SHA=c2d5c13afbc3d4e92c3a5e298b69ae7aa74bf637
AUTOPILOT_ENABLED=ON (Production; só mercado_livre)
CURRENT_STAGE=WAITING_1
CURRENT_MAX_WRITES=1
CURRENT_USED_WRITES=1
BUDGET_EXHAU_MODE=SAFE (1 permissão, 2 eventos pós-esgotamento, usedWrites congelado em 1)
LEGACY_FALLBACK_ENABLED=YES
CATALOG_V1_GLOBAL_CUTOVER=NO
AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0

AUTOPILOT_STATE_MACHINE=PASS
AUTOPILOT_CONCURRENCY=PASS
AUTOPILOT_IDEMPOTENT=PASS
BUDGET_EXHAUSTION_SAFE=PASS
AUTO_PROMOTION_1_TO_5/5_TO_25/25_TO_100=READY
AUTO_BREAKER=PASS
ROLLBACK_NO_DEPLOY=PASS
PUBLICATION_GATE_PRESERVED=PASS
```

`AUTO_PROMOTION_1_TO_5/5_TO_25/25_TO_100=READY` é o **veredito de teste**: a
escada está implementada e provada contra o banco, com as quatro promoções
contadas exatamente. **Não** significa que a escada já terminou em produção — ver
a seção "A escada em produção leva ~9 dias, por projeto".

> **Sobre `FINAL_SHA` e `PRODUCTION_SHA`.** `RUNTIME_SHA`/`PRODUCTION_SHA` são o
> SHA do **código de runtime**, e é o que importa: `c2d5c13` é o último commit que
> muda uma linha de comportamento. O commit que acrescenta este relatório é
> **docs-only** (um arquivo em `docs/architecture/`, zero linhas de runtime), e
> o bundle servido é idêntico. `FINAL_SHA` fica como `<HEAD>` de propósito: um
> arquivo não pode conter o SHA do commit que o contém, e escrever um SHA
> literal ali seria mentir na primeira edição e ficar errado em todas as
> seguintes.

## O que o autopilot é

Uma máquina de estados **persistente** no plano de controle do cutover, que um
cron serverless avalia uma vez ao dia. Ela não é um daemon: não há `setInterval`,
não há loop, não há memória de processo. O estado inteiro (`CatalogCutoverAutopilot`)
e todo o log de decisões (`CatalogCutoverAutopilotRun`) estão no PostgreSQL, e
`recordAutopilotRun` usa `executionId` único com `ON CONFLICT DO NOTHING` — dois
gatilhos do Vercel no mesmo segundo não duplicam nada.

```
                     ┌──────────────────────────┐
  OPERADOR           │                          ▼
    pause ───────► PAUSED ──resume──► WAITING_1 ──cooldown+evidência──► VALIDATING_1
    trip   ───────► TRIPPED ◄──violação crítica──┘         │ gates verdes
                     │                                     ▼
     close+resume ───┘                            PROMOTE → WAITING_5
                                                          │ … 25 … 100
                                                          ▼
                                                     COMPLETED
```

`TRIPPED` e `PAUSED` são **terminais para promoção**: nenhum gate verde os
destrava. O único caminho de volta de `TRIPPED` é o operador, e ele exige
**dois** atos: fechar o breaker global **e** `resume`. Fechar sozinho deixa
`TRIPPED` — porque o trip registra a causa, e a causa não se resolve sozinha.

## Duas chaves independentes (bug encontrado pelos testes)

A primeira versão tinha **uma** chave, e ela estava errada:

- `AUTOPILOT_ENABLED` (env) é o **interruptor de deploy**, avaliado a cada
  execução e **nunca persistido**;
- a coluna `enabled` é o **interruptor do operador**, durável, e só muda em
  `applyOperatorAction`.

O defeito: `ensureAutopilot` nascia com `enabled` vindo da env. Como o
protocolo de deploy manda começar com `AUTOPILOT_ENABLED=OFF`, o primeiro cron
gravava `enabled = false` na linha — e **vigiada para sempre**. Ligar a env
depois não faria nada: a linha continuava desligada. O autopilot teria morrido
na primeira execução, e o relatório honesto seria "não funcionou" com a causa
nunca visível.

Isso é a armadilha clássica de usar env como chave de estado: a env é o que o
deploy controla, e é justamente o que se pode reverter. Hoje a env é lida por
execução (`disabled = !row.enabled || !options.enabled`), a linha nasce
`enabled @default(true)`, e `runAutopilotCycle` **nunca** repassa o valor da env
ao `ensureAutopilot`. A armadilha está coberta por P10a–P10c.

## Orçamento esgotado é seguro (regra crítica)

Prova em produção, com tráfego real, sem fabricação:

| # | `externalId` (orgânico) | o que aconteceu | `usedWrites` |
| --- | --- | --- | --- |
| 1 | `MLB7681144154` | `PERMIT_GRANTED` 06:10:15.234 → **V1 autoritativo** (`V1_COMMITTED` .355, `PARITY_MATCH` 17.386) | 0 → **1** |
| 2 | `MLB7458060038` | orçamento **esgotado** → negado, processado pelo legado | **1** (congelado) |
| 3 | `MLB7246170244` | idem | **1** (congelado) |

Três ofertas no burst de 06:10 UTC, **uma** permissão, `usedWrites` congelado em
1 nas duas seguintes, zero double-write, zero duplicata, zero erro. (As 18
ofertas de 23–24/09 são **pré**-ARM de 2026-09-26 03:18:33 e não entram na
contabilidade.) O `PERMIT_DENIED` gravado no caminho de negativa
`BUDGET_EXHAUSTED` e o `pendingWriteTrace` no `V1_COMMITTED` são o que permitem
ver isso depois — e ainda não existem para estes eventos, porque foram
deployados depois do burst (ver **Ressalva 5**, abaixo).

`BUDGET_EXHAUSTION_SAFE=PASS` reproduz o mesmo cenário com `maxWrites=1`
injetado: evento 1 V1-autoritativo, evento 2 negado e **ainda assim processado
corretamente**, `usedWrites` permanece 1, nenhuma escrita excede o teto.

## Gates de promoção

Uma promoção só acontece com **todas** estas condições true, medidas do ledger
real dentro da janela do degrau (`maxWrites = <estágio>` na CTE):

| Gate | Exigência | Origem |
| --- | --- | --- |
| `usedWrites` | ≥ 1 | `Math.max(métrica, rollout)` |
| `V1_COMMITTED` | ≥ 1 | ledger |
| listagens distintas | ≥ `{1:1, 5:2, 25:3, 100:5}` | metadados de commit |
| commits de evidência | ≥ `min(estágio, 5)` | ledger |
| `doubleWrite` | = 0 | ledger |
| `unexpectedDuplicate` | = 0 | ledger |
| `unexpectedParityDifference` | = 0 | ledger |
| `publicationViolation` | = 0 | reconciliador oficial, dry-run |
| `AUTO_ACTIVE_LT2` | = 0 | idem |
| breaker | CLOSED | `CatalogCutoverRollout` |
| `systemCriticalErrors` | = 0 | execuções `V1_FAILED` sem commit e sem fallback |
| `globalBudgetViolation` | = 0 | `budgetOverrunStage + budgetTripsStage` |
| tempo | ≥ 24h de observação **e** cooldown cumprido | `stageStartedAt`, `cooldownUntil` |

Tempo **nunca** promove sozinho: H1 segura a promoção com cooldown ativo mesmo
com evidência perfeita, e H2 prova que tempo sem evidência não promove nada.
O piso de listagens *distintas* é o que impede a mesma oferta de contar 5 vezes.

## Concorrência: uma única promoção

Dois mecanismos independentes, porque um só não basta:

1. `pg_try_advisory_lock(hashtext('fase72-autopilot:<id>'))` no início do ciclo
   — serializa execuções do mesmo marketplace;
2. `WHERE "version" = $2 AND "state" = $3 AND "stage" = $4` no UPDATE — o
   compare-and-swap que vale **mesmo sem o lock**.

A prova de que o lock não é o que salva é a PARTE 4: a mesma corrida disparada
**sem** advisory lock, só com o CAS, e o resultado continua sendo exatamente uma
promoção. `executionId` único garante que nem o log duplica.

E o degrau alvo é **função pura do estado persistido** (`nextStage`), não um
contador nem um `min(stage+4, 100)`. Saindo do estágio 1 o alvo é *sempre* 5 — o
teste I3 e a PARTE 8b cobrem isso. A promoção 1 → 100 é estruturalmente
impossível, não só improvável.

## Breaker automático

Abre **imediatamente**, sem esperar degrau, cooldown ou novo ciclo, quando:

`doubleWrite > 0` · `publicationViolation > 0` ·
`unexpectedParityDifference > 0` · corrupção de identidade · orçamento
excedido · erro crítico do V1 (`V1_FAILED` sem commit e sem fallback) ·
duplicata real.

`tripGlobalBreaker` grava `reason`, `executionId`, timestamp, estágio e um
snapshot das métricas no ledger. O breaker é **global**: uma única linha no
banco devolve **todas** as instâncias serverless a `LEGACY_ONLY`, sem novo
deploy e sem tocar no catálogo. E **nunca** fecha sozinho — nem quando os gates
ficam verdes (P6b).

`tripReason` e `trippedAt` são o registro forense da **última** viagem e não são
apagados por nada, nem por `resume`. O que decide o comportamento é o `state`.

### O que **não** abre breaker

`POLICY_NOT_READY` · `MULTISTORE_NOT_READY` · `IDENTITY_REVIEW` ·
`IDENTITY_REJECT` esperado · `INVALID_DATA` determinístico.

Esses são o funil funcionando, não o sistema quebrado. `policyBlocked` alto
**não** tripou e **não** bloqueou promoção (J1), e orçamento esgotado **não**
tripou (F1) — porque esgotar o canário é o comportamento previsto, não uma
falha. Abrir breaker por um `POLICY_NOT_READY` seria transformar uma política de
negócio em incidente técnico.

## Probes: observacionais, nunca gate

Seis rotas com status **esperado explícito por rota** (`/`, `/sitemap.xml`,
`/robots.txt`, `/ofertas`, `/categorias`, `/?q=autopilot`), todas 200 em
produção. `/sitemap` e `/busca` **não** são rotas deste projeto (o sitemap é
`/sitemap.xml`, a busca é `/?q=` na home), e um probe ingênuo trataria esses 404
como "site fora" e poderia virar decisão destrutiva por causa de uma rota que
nunca existiu.

Probes **não entram** em `decideAutopilot`: a assinatura da função não as
recebe, e o teste K1 cobra isso. Elas são registradas no log de execução como
observação. Um 500 externo isolado não abre breaker nem bloqueia promoção,
porque as evidências que promovem são medidas **dentro** do sistema.

A lista mora em `cutover/autopilot.ts` (`AUTOPILOT_PROBES`), e nem a rota nem o
operador podem declarar a sua própria (P0e) — duas listas divergentes seriam
duas fontes de verdade sobre a saúde do site.

## Cron diário: restrição do plano, não preferência

```
"crons": [{ "path": "/api/cron/cutover-autopilot", "schedule": "17 12 * * *" }]
```

A primeira tentativa foi horária (`17 * * * *`) e o **próprio deploy recusou**:

```
Error: Hobby accounts are limited to daily cron jobs
```

O plano Vercel deste projeto é Hobby, que só aceita cron diário. Fica documentado
em vez de escondido. 12:17 UTC é deliberado: o tráfego orgânico do Mercado Livre
chega num burst diário em ~06:10 UTC, então 12:17 observa o dia **inteiro** antes
de decidir. E o cooldown é de 24h, então mais frequência não promoveria nada mais
cedo — o que limita a progressão é **evidência, não o relógio**. Quem quiser
acelerar a observação é o operador, com `autopilot-run --dry-run`, que é
idempotente e não muta nada.

## Segurança do operador

- `FASE71_EXPECTED_CONTROL_HOST`: a ferramenta **recusa** qualquer host que não
  seja o esperado, para não ser apontada por engano para um banco de
  desenvolvimento;
- `status`, `autopilot-status` e `history` são sempre read-only;
- `arm`, `trip`, `close`, `pause`, `resume`, `autopilot-run` exigem `--yes`;
- `marketplaceId` é sempre explícito na linha de comando — a ferramenta não tem
  nenhuma regra por nome de marketplace, só repassa o que o operador digita;
- preview/dev nunca promove: `allowMutations = enabled && isProduction()`;
- `CRON_SECRET` protege a rota: chamada sem `Authorization` → **401** (provado);
- nenhum comando imprime `DATABASE_URL`, `DIRECT_URL`, token ou credencial.

## Publicação nunca muda

Nenhuma rotina de rollout toca `PublicationEligibility`. O invariante vale em
todos os estágios e foi medido em produção pelo reconciliador oficial:

```
PUBLIC_MULTISTORE_MIN_MARKETPLACES=2 (inalterado)
AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0
single-store oculto: exige 2 marketplaces distintos utilizáveis
```

O `publicationAudit` é `reconcileCatalog` em `dryRun: true` — que por
construção tem `written = 0`. A rota HTTP **não tem capacidade** de ativar,
desativar ou republicar produto: ela apenas *conta* as violações, e esse número
é gate de promoção. `PUBLICATION_GATE_PRESERVED=PASS`.

Dívida conhecida e **não tocada**:

```
LEGACY_MANUAL_SINGLESTORE_DEBT=1
```

Um produto (`c9531ba9-…`), `autoCreated=false`, `publicationStatus=LIVE_PARTIAL`,
1 marketplace público. Está fora do escopo do invariante (que é sobre produtos
auto-criados) e não é publicamente visível. **Reportado, não alterado** — o
deploy do autopilot não tocou nem podia tocar a dívida do outro.

## Três bugs reais que os testes de banco encontraram

Não são detalhes de estilo; são o tipo de coisa que só aparece quando o estado
está em disco e dois processos olham para ele.

**1. `WAITING_n → VALIDATING_n` nunca era persistido.** A transição não toca o
orçamento, então o código a tratava como "só um passo intermediário" e não a
persistia. A máquina voltava a `WAITING_1` para sempre e a progressão nunca
sairia do primeiro degrau. O conserto persiste **toda** mudança de estado por
CAS, não só a promoção. A prova viva: hoje em produção o autopilot está em
`WAITING_1` com `version = 0`, e o próximo ciclo tem de gravá-la.

**2. O CAS derivava o `stage` do nome do estado.** Em `PAUSED` e `TRIPPED` o nome
não contém o estágio, então o `WHERE` comparava contra `null` e nenhuma
transição passava — o operador não conseguia nem pausar nem retomar. Foi
introduzido um `expectedStage` explícito.

**3. A métrica por estágio mentia sobre o próprio teto.**
`CatalogCutoverStageMetric.maxWrites` recebia o teto do rollout **depois** do
rearm, e o rearm acontece antes da gravação. Ao promover 1 → 5, a linha do
estágio 1 gravava teto 5; ao promover 5 → 25, a do estágio 5 gravava teto 25.
Não era falha de decisão — a CTE filtra por `maxWrites = <estágio>` e os gates
promoviam certo. Era falha de **fidelidade do registro**, e uma tabela de
métricas que mente sobre o próprio teto é pior do que uma tabela vazia, porque
é consultada para decidir e parece confiável. A guarda P8d cobra
`maxWrites == stage` e `usedWrites ∈ 0..stage`, e foi verificada **contra o
bug**: com a correção revertida ela falha em "estágio 1 não pode carregar o teto
de outro estágio". Guarda que nunca falhou não é guarda.

E um quarto, encontrado na revisão do ciclo: o `autopilot-run` da ferramenta de
operador usava um **stub** de auditoria (`{scanned: 0, violations: 0}`). Um
`autopilot-run --yes` não só permitia — **promovia** um degrau com o gate de
publicação nunca sequer consultado. Verde porque ninguém olhou é a pior forma
de verde, e era invisível numa revisão de rotina porque o cron nunca teve o
problema. Agora o operador chama o mesmo `reconcileCatalog` com o mesmo
repositório real, e P0d proíbe o stub no código dele.

## Testes

| Suíte | Verificações | Critérios |
| --- | --- | --- |
| `autopilot.test.ts` (puro) | 25 | `AUTOPILOT_STATE_MACHINE=PASS` |
| `autopilot.concurrency.test.ts` (Postgres real) | 36 | `AUTOPILOT_CONCURRENCY`, `AUTOPILOT_IDEMPOTENT`, `BUDGET_EXHAUSTION_SAFE`, `AUTO_PROMOTION_1_TO_5/5_TO_25/25_TO_100`, `AUTO_BREAKER`, `ROLLBACK_NO_DEPLOY`, `PUBLICATION_GATE_PRESERVED` |

As seis verificações obrigatórias da missão, e onde cada uma está provada:

| Requisito | Prova |
| --- | --- |
| transições da máquina de estados | `autopilot.test.ts` A1–A6, I1–I3, Z1 |
| erro crítico → TRIPPED | `autopilot.test.ts` D1; banco P6a, P6a2, P6b–P6d |
| PAUSED bloqueia promoção | `autopilot.test.ts` E2; banco P5a–P5c |
| orçamento esgotado sem overflow | banco P1a–P1d |
| execução repetida idempotente | banco P2a–P2c, P9b |
| dois controllers → uma promoção | banco P3a–P3c (com lock) e P4a–P4b (sem lock) |

O teste puro (`npm run test:cutover`, sem banco) roda 25 verificações e é
discriminante: cooldown segurando promoção com evidência perfeita (H1), tempo
sem evidência (H2), alvo sempre 5 saindo de 1 (I3), estado/estágio incoerente
fail-safe (E4), e a decisão como função pura (Z1).

O teste de banco exige o Postgres de missão e **não** faz parte de
`npm test`:

```bash
DATABASE_URL=DIRECT_URL=postgresql://postgres@127.0.0.1:55471/ofertano_fase71_global_control \
  npx tsx src/services/architecture/v1/cutover/autopilot.concurrency.test.ts
```

### Gates adicionais na árvore final

- `AUTOPILOT_STATE_MACHINE=PASS` (25) · `AUTOPILOT_CONCURRENCY=PASS` ·
  `AUTOPILOT_IDEMPOTENT=PASS` · `BUDGET_EXHAUSTION_SAFE=PASS` ·
  `AUTO_PROMOTION_1_TO_5/5_TO_25/25_TO_100=READY` · `AUTO_BREAKER=PASS` ·
  `ROLLBACK_NO_DEPLOY=PASS` · `PUBLICATION_GATE_PRESERVED=PASS`
- `GLOBAL_BUDGET_CONCURRENCY_TEST=PASS` · `LIVE_CUTOVER_E2E_TEST=PASS`
- `npm run test:cutover` exit 0 · `npm run test:cutover:global-control` exit 0
- `MIGRATION_HISTORY_PASS`: 140/140 (138 da FASE 7.1 + 2 do estado pre-apply)
- `TSC_PASS`: `npx tsc --noEmit` exit 0
- `BUILD_PASS`: `npm run build` exit 0, com `ƒ /api/cron/cutover-autopilot`
- `ESLINT`: byte-idêntico ao baseline da FASE 7.1 (104 problemas: 27 errors,
  77 warnings, todos pré-existentes). Nenhum achado nos arquivos novos.

## Migrations

| Migration | Checksum | Estado em produção |
| --- | --- | --- |
| `20260926120000_catalog_cutover_autopilot` | `832f4399…c0510778` | APLICADA |

Aditiva: 2 enums e 3 tabelas (`CatalogCutoverAutopilot`,
`CatalogCutoverAutopilotRun`, `CatalogCutoverStageMetric`). Nenhum `DROP`,
`TRUNCATE`, `DELETE`, `RENAME` ou `CASCADE`. Nenhuma migration já aplicada foi
modificada.

`verify-ledger-compatibility.mjs` ganhou **exatamente um** conjunto novo e
legítimo, `autopilotPending` (tudo aplicado, só a migration do autopilot
pendente) — sem ele o gate trataria o estado pre-apply como violação, o que
transformaria um resultado correto em alarme falso.

Gate forense rodado sobre o ledger **real** de produção (15 linhas):

```json
{"verdict":"PASS_WITH_KNOWN_HISTORICAL_DIVERGENCES","pending":[],"ledgerMutation":false}
```

`pending: []` — a migration do autopilot está no ledger de produção e bate com o
checksum do repositório.

## Deploy

| Campo | Valor |
| --- | --- |
| Branch | `main` |
| Push | `a132fdc..HEAD`, 6 commits, todos fast-forward, **sem force** |
| `RUNTIME_SHA` (última mudança de runtime) | `c2d5c13afbc3d4e92c3a5e298b69ae7aa74bf637` |
| `githubCommitSha` em produção | `c2d5c13…` (build Git READY; o commit do relatório é docs-only e não muda o bundle) |
| `githubCommitRef` | `main` |
| Estado | READY / production, alias `ofertano.vercel.app` (deploy da CLI `ofertano-msng4twtb`) |
| `AUTOPILOT_ENABLED` | `OFF` → confirmado → `ON` (Production) |
| `AUTOPILOT_MARKETPLACES` | `mercado_livre` (Production) |
| `CATALOG_V1_GLOBAL_CUTOVER` | não definido ⇒ `NO` |

### Sequência de liberação (a ordem importa)

1. Deploy com `AUTOPILOT_ENABLED=OFF` e `AUTOPILOT_MARKETPLACES=mercado_livre`
   (segredos só de Production).
2. Confirmar **os três** critérios da fase OFF antes de qualquer coisa:
   - `githubCommitSha` de produção = SHA local = `origin/main` ⇒ `c2d5c13…`;
   - os 6 probes ⇒ 200;
   - `AUTO_ACTIVE_LT2` ⇒ 0 (reconciliador oficial, dry-run, em produção).
3. Só então `AUTOPILOT_ENABLED=ON`, e **novo deploy** (env var só entra em
   deployment novo).

O passo 3 sem o passo 2 seria colocar no ar um interruptor que decide
promoção automática de writer **antes** de provar que a fase OFF não mexe em
nada. Por isso a fase OFF é um estado **verificado**, não um `setTimeout`.

A fase OFF foi verificada de três maneiras, e nenhuma delas é "esperei o cron":
o `AUTOPILOT_ENABLED` não é persistido (é a correção do bug das duas chaves),
então a fase OFF real seria a primeira execução do cron. Ela foi exercitada pelo
**mesmo código** que o cron usa, via `autopilot-run --dry-run` do operador, com
o reconciliador real e os 6 probes reais contra produção:

```json
{
  "state": "WAITING_1", "stage": 1,
  "decision": "WAIT", "reason": "autopilot-desabilitado",
  "promoted": false, "tripped": false, "budgetReconciled": false,
  "autoActiveWithLt2PublicMarketplaces": 0,
  "probes": [6 × 200]
}
```

E o plano de controle ficou **intacto** depois disso: rollout em `maxWrites=1`,
`usedWrites=1`, `breakerState=CLOSED`, ledger com as mesmas 4 linhas
(`ARM`, `PARMIT_GRANTED`, `V1_COMMITTED`, `PARITY_MATCH`), `version` do autopilot
em `0` (nenhuma transição gravada).

## Estado por estágio em produção

Métricas do degrau 1, derivadas do ledger real e persistidas em
`CatalogCutoverStageMetric` e no `evidence` de cada execução:

```
usedWrites=1            v1Committed=1         uniqueExternalListings=1
doubleWrites=0          duplicates=0          parityMatches=1
unexpectedParityDifferences=0                 publicationViolations=0
systemCriticalErrors=0  globalBudgetViolations=0                 policyBlocked=0
breakerTrips=0          autoActiveLt2=0       breakerState=CLOSED
```

Todos os gates do degrau 1 estão verdes. A promoção depende agora de **tempo**:
o `cooldownUntil` é `2026-09-27 03:18:33 UTC` (o `stageStartedAt` do ARM é
`2026-09-26 03:18:33 UTC`, + 24h).

## A escada em produção leva ~9 dias, por projeto

Isto precisa ficar explícito, porque é a diferença entre "funciona" e "já
terminou".

O cron é **diário** (restrição do plano Hobby), o cooldown é de **24h por
degrau** e a promoção é em **dois passos** (`WAITING_n → VALIDATING_n →
PROMOTE`, para que a inspeção nunca seja a mesma leitura que decide). Com tudo
alinhado:

```
2026-09-26 12:17Z  cooldown ativo                     → WAIT
2026-09-27 12:17Z  cooldown cumprido                   → VALIDATING_1
2026-09-28 12:17Z  gates verdes                       → PROMOVE → WAITING_5
2026-09-29 12:17Z                                    → VALIDATING_5
2026-09-30 12:17Z                                    → PROMOTE → WAITING_25
2026-10-01 12:17Z                                    → VALIDATING_25
2026-10-02 12:17Z                                    → PROMOVE → WAITING_100
2026-10-03 12:17Z                                    → VALIDATING_100
2026-10-04 12:17Z                                    → COMPLETED
```

E isso é o **melhor caso**: cada degrau tem um piso de evidência que precisa
crescer (degrau 5 exige 2 listagens distintas, 25 exige 3, 100 exige 5) e a
progressão só existe enquanto houver tráfego orgânico. 25 é **teto**, não meta —
com tráfego baixo o autopilot espera, que é exatamente o comportamento correto.

Aconteça o que acontecer, a cada ciclo o log `CatalogCutoverAutopilotRun` é
append-only e cada linha carrega o snapshot completo de `evidence.gates` — então
a escada é auditável degrau por degrau, sem depender deste relatório.

## Ressalvas honestas

1. **A escada não terminou em produção dentro da sessão.** Ver a seção "A
   escada em produção leva ~9 dias, por projeto", acima.
   `AUTO_PROMOTION_1_TO_5/5_TO_25/25_TO_100=READY` é veredito de teste, não de
   produção. Nenhuma promoção foi **fabricada** para fechar o relatório, e
   nenhum tráfego foi fabricado para consumir orçamento.
2. **A fase OFF não foi observada por um cron real.** A env
   `AUTOPILOT_ENABLED` não pode ser lida de volta (`vercel env pull` redige
   segredos) e o `CRON_SECRET` não é recuperável, então não dá para disparar a
   rota autenticada à mão. A fase OFF foi verificada pelo mesmo código do cron,
   via `autopilot-run --dry-run`, mais a proteção 401 e os três critérios de
   deploy. A primeira execução real do cron é a de 12:17 UTC.
3. **`20260925120000` foi aplicada em produção sem autorização na FASE 7.1**
   (só `DATABASE_URL` exportado; o `prisma.config.ts` lê `DIRECT_URL`). É
   puramente aditiva e o checksum bate com o repositório, mas a repetimos aqui
   porque é a mesma armadilha que quase seria cometida de novo. Todo comando
   que toca produção agora exporta **os dois** e trava o host-alvo.
4. **Não é possível provar a exaustão de orçamento em produção para um degrau
   acima do 1 sem armar esse degrau**, e armar um degrau para provar algo seria
   justamente fabricar evidência. Está provado em produção para o degrau 1 (2
   escritas pós-esgotamento, `usedWrites` congelado) e no banco pela PARTE 1.
5. **O que o ledger não conta neste degrau.** `uniqueProducts=0`,
   `uniqueSellers=0`, `pathUnknown=1` e `budgetSkipped=0` — e não é falha. A
   escrita que consumiu o slot é **anterior** ao `pendingWriteTrace` e ao
   metadata enriquecido, e as 2 escritas pós-esgotamento são **anteriores** ao
   `PERMIT_DENIED` no caminho `BUDGET_EXHAUSTED`: os dois instrumentais foram
   deployados depois do burst. O autopilot reportou `UNKNOWN` e `0` em vez de
   inventar `STRUCTURAL` ou um esvaziamento que não aconteceu — a mesma
   disciplina que o resto da FASE V exige. A partir do próximo degrau esses
   campos passam a ser preenchidos, e é por isso que os pisos de evidência de
   5/25/100 (2, 3 e 5 listagens distintas) só começam a valer de verdade de
   degrau em degrau.
6. **Três projetos Vercel** acusam ERROR neste push
   (`commerce-canary-control-plane`, `catalog-v1-release`,
   `oferta**no**-wt-cutover`). Já estavam em ERROR antes do push e não são
   produção. O build de production do mesmo SHA é READY nas duas vias — a
   integração Git (`catalog-auto-persistence-hardening-75sv5iyev`, com
   `githubCommitSha=c2d5c13…`) e o deploy da CLI
   (`ofertano-msng4twtb`, que carrega o alias `ofertano.vercel.app`) — e é ele
   que serve o site.
7. **O stash recuperado (`cce8438`) segue preservado** em
   `refs/heads/recovery/fase71-stash` até a FASE 7.2 estar absorvida no upstream.
