# CATALOG V1 — CONTROLE DE CUTOVER LIVE (FASE 7.1)

> Orçamento global de escrita + breaker global, decididos em PostgreSQL e
> compartilhados entre instâncias serverless, e a ativação controlada do writer
> V1 no tráfego real de `mercado_livre`.
> Cutover GLOBAL é PROIBIDO (`CATALOG_V1_GLOBAL_PROHIBITED=true`).

## Estado final

```
FASE_7_1_STATUS=DEPLOYED + CANARY_1_ARMED (primeira escrita real pendente)
OPEN_CODE_HANDOFF_RECOVERED=YES
EXISTING_WORKTREE_REUSED=YES
GLOBAL_WRITE_BUDGET_READY=YES
GLOBAL_BREAKER_READY=YES
GLOBAL_BUDGET_CONCURRENCY_TEST=PASS
LIVE_CUTOVER_E2E_TEST=PASS
LEGACY_FALLBACK_SECOND_PERMIT_FIXED=YES
GLOBAL_PERMITS_PER_EVENT=1
DOUBLE_WRITE_PATH=0
MERCADO_LIVRE_WRITER_MODE=V1_PRIMARY_WITH_LEGACY_FALLBACK (canário 1: maxWrites=1)
LIVE_FLAGS_BEFORE_CANARY=OFF
MIGRATION_APPLIED_TO_PRODUCTION=YES
```

## Recuperação do trabalho

O trabalho da FASE 7.1 foi recuperado de um stash interrompido
(`cce8438`, preservado em `refs/heads/recovery/fase71-stash`) e executado no
worktree existente `/tmp/opencode/fase71`, branch
`feat/catalog-v1-live-cutover-control-20260925`, base `6e3fd01`.
Três módulos foram reescritos a partir do contrato recuperado de
`saveProduct.ts`: `globalControl.ts`, `live.ts` e `liveParity.ts`.

## A última garantia: o fallback não abre uma segunda autorização

`legacyWrite` chamava `saveProduct` **sem** internalizar o gate live. Com o
rollout ARMADO e orçamento disponível, esse `saveProduct` reentrava em
`beginLiveCutoverWrite` e consumia um **segundo** permiso global para o **mesmo**
evento: o teto passaria a contar uma escrita a mais do que a que existe, e o
caminho de fallback voltaria a chamar a máquina de cutover que ele substitui.

Correção mínima (1 linha + comentário em `cutover/commits.ts`):
`__internalSkipLiveCutoverGate: true` em `legacyWrite` — exatamente o mecanismo
que `commitV1Structural` já usava e pela mesma razão: quem chama **já é o dono**
da autorização daquele evento (o canário com o próprio orçamento, ou o gate
live que já adquiriu o permiso e cujo marcador de commit é gravado pelo mesmo
cliente da transação).

O bypass pula **somente** o gate live. Validação, identity guards,
PublicationEligibility, `PUBLIC_MULTISTORE_MIN_MARKETPLACES`,
DRAFT/active=false, PriceHistory e idempotência continuam decididos dentro da
transação canônica do `saveProduct`. Nenhum request público alcança a flag: ela
só é ligada em `cutover/commits.ts` (nos dois commits internos), e nenhuma rota
sob `src/app` a conhece.

### Provas (o teste é discriminante: sem a correção ele falha)

| Prova | Onde | Resultado |
| --- | --- | --- |
| V1 autoritativo => exatamente 1 permissão, 0 fallback | `live.test.ts` K1 | PASS |
| `maxWrites=1` + falha transitória pré-commit + fallback => `usedWrites` **permanece 1** | `live.test.ts` K2 | PASS |
| falha pós-commit => zero fallback | `live.test.ts` K3 | PASS |
| IDENTITY_REJECT / POLICY_NOT_READY / MULTISTORE_NOT_READY / INVALID_DATA => zero fallback | `live.test.ts` K4 | PASS |
| commit interno (V1 ou fallback) nunca adquire permissão | `live.test.ts` K5 | PASS |
| `PUBLIC_MULTISTORE_MIN_MARKETPLACES=2` e DRAFT/active=false preservados | `live.test.ts` L | PASS |
| flag só em `cutover/commits.ts`; `src/app` não a conhece | `live.test.ts` H | PASS |
| 1 listagem pública = 1 slot; `commitV1Structural` e `legacyWrite` = **zero** slots com rollout armado e orçamento zerado | `live.e2e.test.ts` E10 | PASS |
| `maxWrites=1` + falha pré-commit + fallback => `usedWrites=1`, 1 Product, 1 Offer, 0 double-write | `live.e2e.test.ts` E11 | PASS |
| falha pós-commit real (gatilho `DEFERRABLE INITIALLY DEFERRED` rejeita o COMMIT) => zero fallback, zero escrita, zero marcador, `AMBIGUOUS_COMMIT` + breaker aberto | `live.e2e.test.ts` E12 | PASS |

Discriminação comprovada: removendo a linha, `live.test.ts` H falha
("a flag é ligada em exatamente dois lugares ... encontrado 1") e o e2e E10c
falha com `usedWrites: actual 1, expected 0` — exatamente o segundo permiso.

## Orçamento global e breaker global

O teto e o breaker vivem em `CatalogCutoverRollout` / `CatalogCutoverEvent`
(PostgreSQL), nunca em memória de processo: toda aquisição é
`UPDATE ... WHERE usedWrites < maxWrites RETURNING`, com o marcador gravado
pelo mesmo cliente de transação do catálogo.

`GLOBAL_BUDGET_CONCURRENCY_TEST=PASS`:
MAX=1 com 50 concorrentes => 1 concessão; MAX=5 com 20 concorrentes => 5; 4
instâncias × 20 => 5; concessões duráveis; esgotamento do orçamento não é
violação; breaker global fecha **todas** as instâncias; `CHECK` do banco
rejeita 3>2; marcador de replay é idempotente.

`LIVE_CUTOVER_E2E_TEST=PASS` (E1–E12) contra Postgres real, com o `saveProduct`
de verdade dentro do funil real: sem rollout => LEGACY_ONLY; armado => 1 slot e
1 marcador na mesma transação; replay => zero duplicata; bypass => zero I/O de
controle; orçamento esgotado => segue pelo legado; breaker global => fail-closed
de todas as instâncias **sem novo deploy**; falha pré-commit => fallback assume
(1 write); falha pós-commit => nunca fallback; multiloja => 1 marketplace DRAFT,
2 marketplaces público; agnosticismo de marketplace.

## Migrations

| Migration | Checksum | Estado em produção |
| --- | --- | --- |
| `20260925120000_catalog_cutover_global_control` | `43693f7c…33b412c` | APLICADA |
| `20260925130000_catalog_cutover_global_control_timestamptz` | `fbc14944…42e4422f3` | APLICADA |

Ambas aditivas. A segunda só faz `ALTER COLUMN ... TYPE TIMESTAMPTZ(3)` nas 8
colunas de tempo das DUAS tabelas de controle — que estavam vazias em produção,
logo a conversão é uma reinterpretação de zero linhas. Nenhum `DROP`,
`TRUNCATE`, `DELETE`, `RENAME` ou `CASCADE` (verificado no DDL real, sem
comentários).

Gate forense rodado sobre o ledger REAL de produção (14 linhas):

```json
{"verdict":"PASS_WITH_KNOWN_HISTORICAL_DIVERGENCES","pending":[],"ledgerMutation":false}
```

## Deploy

| Campo | Valor |
| --- | --- |
| Branch | `feat/catalog-v1-live-cutover-control-20260925` (base `6e3fd01`) |
| Push | `6e3fd01..33751cf` (código) e `..065a506` (relatório + ferramenta de operador) em `main` — ambos fast-forward, sem force |
| Deploy do canário | `githubCommitSha=33751cff9434fbb2b7cd42879b1439420f244a5c` (código do gate live) |
| Deploy em serving | `githubCommitSha=065a5060036d9430f0b428b48759f238197d95ca` (idêntico ao HEAD; acrescenta só o relatório e a ferramenta de operador, sem mudança de runtime) |
| `githubCommitRef` | `main` (integração Git do Vercel) |
| Estado | READY / production (alias `ofertano.vercel.app` → `oferta**no**-dhu5s6cny`) |
| LIVE flags | nenhuma env de cutover no projeto de produção (32 env vars auditadas) |

O gate live **não tem env flag**: sem linha de rollout ele é fail-closed para
`LEGACY_ONLY`. `LIVE_FLAGS_BEFORE_CANARY=OFF` é o estado tanto das env vars
(nenhuma) quanto do plano de controle (`CatalogCutoverRollout` = 0 linhas).

## Canário 1 (tráfego real, sem fabricação)

```
rolloutId=2b1f723a-c4df-4753-8796-72771c4c6fd6
marketplaceId=mercado_livre
mode=V1_PRIMARY_WITH_LEGACY_FALLBACK
maxWrites=1  usedWrites=0  breakerState=CLOSED
```

O canário 1 está **ARMADO e aguardando a próxima escrita real** de
`mercado_livre`. Em ~25 min de polling nenhum tráfego real de ML ocorreu
(produção grava ~1×/dia: última escrita em 2026-09-25 06:10 UTC; a fila de
importação não tem item `PENDING`). Nenhum tráfego foi fabricado para consumir
o slot.

Verificação do canário (read-only):

```bash
npx tsx scripts/live-cutover-control.ts status
```

Escalonamento do próximo estágio (mesma ferramenta, `arm` com `--max-writes` e
`--reset-budget`): 1 → 5 → 25 → 100.

Rollback sem novo deploy (breaker global, fail-closed para `LEGACY_ONLY`):

```bash
npx tsx scripts/live-cutover-control.ts trip --marketplace-id mercado_livre --reason V1_ERRORS_ABOVE_LIMIT --yes
```

## Evidências (gates na árvore final)

- `MAIN_TESTS_PASS`: `npm test` exit 0
- `ARCHITECTURE_V1_TESTS_PASS`: `npm run test:architecture-v1` exit 0
- `CUTOVER_TESTS_PASS`: `npm run test:cutover` exit 0 (9 suites, inclui `live.test.ts` K/L)
- `MIGRATION_HISTORY_PASS`: `npm run test:migration-history` fail 0 (138 testes)
- `TSC_PASS`: `npx tsc --noEmit` exit 0
- `PRISMA_VALIDATE_PASS`: `npx prisma validate` exit 0
- `PRISMA_GENERATE_PASS`: `npx prisma generate` exit 0
- `BUILD_PASS`: `npm run build` (check:encoding + prisma generate + next build) exit 0
- `ESLINT_PASS`: 0 errors nos arquivos tocados
- `DIFF_CHECK_PASS`: `git diff --check` limpo
- `GLOBAL_BUDGET_CONCURRENCY_TEST=PASS`
- `LIVE_CUTOVER_E2E_TEST=PASS` (E1–E12)
- `AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0` (reconciliador oficial do repo,
  dry-run em produção: `scanned=3, violations=0, written=0`)
- `PUBLIC_MULTISTORE_MIN_MARKETPLACES=2` (inalterado)
- `CUTOVER_GLOBAL_PROHIBITED=true`

## Ressalvas honestas

1. **MIGRATION_APPLIED_TO_PRODUCTION=YES, e a primeira foi ACIDENTAL.** A
   `20260925120000` foi aplicada em produção sem autorização, porque só
   `DATABASE_URL` estava exportado e o `prisma.config.ts` lê `DIRECT_URL`. Foi
   contida; é puramente aditiva (`CREATE TABLE`/`CREATE INDEX`) e o checksum do
   ledger de produção é byte-idêntico ao do repositório. A partir daí todo
   comando que toca produção exporta **os dois** e trava o host-alvo.
2. Uma varredura mais ampla que o invariante encontrou 1 produto
   (`Kit Starlink MINI Internet Via Satélite`) com `active=true` e 1 único
   marketplace utilizável. Ele é `autoCreated=false` e
   `publicationStatus=LIVE_PARTIAL`, ou seja, está **fora** do escopo de
   `AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES` (que é sobre produtos
   auto-criados) e não é publicamente visível: a visibilidade exige 2
   marketplaces distintos utilizáveis (`hasPublicMultiStore`). Reportado, não
   alterado.
3. O canário 1 ainda não consumiu o slot porque não houve tráfego real de
   `mercado_livre` no período de observação. O consumo é por tráfego orgânico.
4. Projetos Vercel de worktree (`commerce-canary-control-plane`,
   `catalog-v1-release`, `catalog-v1-real-shadow-20260924`,
   `oferta**no**-wt-cutover`) acusaram ERROR neste push. Já estavam em ERROR
   antes do push e não são produção. O build de PREVIEW do próprio push também
   falhou em 0 ms (duplo disparo main+branch), mas o build de PRODUCTION foi
   READY e é o que serve `ofertano.vercel.app`.
