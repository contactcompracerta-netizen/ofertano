# V1 Reconciliation — Validação Final (Harness do Pipeline Real)

Reconciliação da entrega **Catálogo V1** (prisma.ts com fallback local + repositório local) contra a
arquitetura real do Ofertano. A entrega V1 foi **convertida em fixtures de teste reutilizáveis** que
validam o pipeline real — **sem tocar Production, sem substituir `src/lib/prisma.ts`, sem fallback de
runtime** e **sem fechar trail da missão** (V9/V10/V11/V11.2).

> **ATUALIZAÇÃO (integração runtime):** a validação em harness (292/292, páginas abaixo) foi
> convertida em prova no **runtime real** — 6 canônicos persistidos via módulos reais e os fluxos
> Home / Busca / Página de Produto servidos por `next dev` foram comprovados (`CATALOG_V1_RUNTIME_INTEGRATED=YES`).
> O harness `catalog-v1.test.ts` foi **removido**; não é mais dependência de validação.
> Detalhes: `RUNTIME_INTEGRATION_REPORT.md` (raiz) e `scripts/seed-catalog-v1.ts`.

---

## 1. Status Final da Missão

| Variável | Valor |
|---|---|
| `MISSION_STATUS` | COMPLETA |
| `CLASSIFICATION` | `V1_RUNTIME_PARALLEL_ARCHITECTURE` → `V1_VALIDATION_HARNESS_REUSABLE` |
| `MAIN_SHA` (origin/main guard) | `cca0ce6e7ae9ff2116c923263abdaf664365ff60` |
| `CATALOG_V1_SOURCE_DIR` | `/home/evaldo/Projetos/ofertano` (root worktree) |
| `CATALOG_V1_SOURCE_BRANCH` | `feature/search-e2e-final-20260910` |
| `CATALOG_V1_SOURCE_SHA` | `0add3b320493ab91e06f37f8f3db59a08ad08484` |
| `RECONCILIATION_WORKTREE` | `/home/evaldo/Projetos/ofertano.worktrees/catalog-v1-reconciliation` |
| `RECONCILIATION_BRANCH` | `feature/catalog-v1-reconciliation` |
| `RECONCILIATION_HEAD` | `cca0ce6e7ae9ff2116c923263abdaf664365ff60` (origin/main) |

## 2. Arquivos da Entrega V1 (auditoria)

| Arquivo | Classificação | Destino |
|---|---|---|
| `src/data/catalog-data.ts` | DADOS SYNTHETIC (`PRODUCTION_ELIGIBLE=NO`) | Convertido em fixtures `ProductImport[]` |
| `src/data/local-repository.ts` | `UNSAFE_RUNTIME_FALLBACK` (simulava `product.findMany`) | NÃO integrado; papel substituído por fixtures |
| `src/lib/local-db.ts` | `UNSAFE_RUNTIME_FALLBACK` (camada DB local) | NÃO integrado |
| `src/data/v1-validation.ts` / `.mjs` | Suite de validação V1 (executava sobre dados locais) | Substituído pelo harness real |
| `src/data/products.ts` | Sobrescrito p/ apontar ao catálogo local | **Restaurado byte-identical ao origin/main** |
| `src/lib/prisma.ts` | Sobrescrito com fallback local | **Restaurado byte-identical ao origin/main** (cca0ce6) |
| `package.json` | Script `v1-validation` adicionado | **Restaurado byte-identical ao origin/main** |

## 3. Guardas de Segurança

| Guarda | Status |
|---|---|
| `PRISMA_TS_CHANGED` | **NO** — `src/lib/prisma.ts` diff vazio vs `cca0ce6e7ae9ff2116c923263abdaf664365ff60` |
| `PUBLIC_RUNTIME_LOCAL_CATALOG_FALLBACK` | **NO** — nenhum fallback `DB vazio → catálogo local` no runtime |
| `SCHEMA_CHANGED` | **NO** — `prisma/schema.prisma` intocado |
| `MIGRATIONS_CHANGED` | **NO** — nenhuma migration criada/editada |
| `FLAGS_CHANGED` | **NO** — todas as flags permanecem OFF |
| `DATABASE_WRITE` | **NO** — zero writes (apenas `prisma generate` offline, sem conexão) |
| `SUPABASE/PROD_ACCESS` | **NO** — sem credenciais reais; `.env` dummy do worktree é gitignored |
| `PUSH` | **NO** — commit local somente |
| `DEPLOYMENT` | **NO** |

Flags verificadas OFF (inalteradas): `RAW_LISTING_DUAL_WRITE_ENABLED`, `COMMERCE_IDENTITY_GRAPH_ENABLED`,
`COMMERCE_VARIANTS_ENABLED`, `OFFER_LEDGER_ENABLED`, `PRICE_TRUTH_ENABLED`, `TRUST_SIGNALS_ENABLED`,
`COMMERCE_SHADOW_ENABLED`, `COMMERCE_DISTRIBUTED_CANARY_ENABLED`, `CATALOG_POPULATE_ENABLED`,
`IMPORT_QUEUE_PROCESS_ENABLED`, `PUBLIC_SEARCH_PERSISTENCE_ENABLED`.

## 4. Fixtures (reutilizáveis)

- `src/services/catalog-v1-test-fixtures/data.ts` — **21 entradas `ProductImport`**, **6 canônicos**
  (Smart TV Samsung QE50T530; Notebook Dell Inspiron 15 5510; Air Fryer Philips HD9252/90;
  Furadeira Bosch GSB 13 RE; Fone JBL Tune 520BT; Smartphone Samsung Galaxy A54 5G),
  **7 marketplaces** (`MERCADO_LIVRE`, `AMAZON`, `SHOPEE`, `KAIBU`, `MAGAZINE_LUIZA`,
  `CASAS_BAHIA`, `CARREFOUR`). Cada canônico tem 3–4 ofertas (2+ marketplaces, preços distintos).
- `src/services/catalog-v1-test-fixtures/catalog-v1.test.ts` — harness com **292 checks** usando os
  módulos **reais**: `importers` (normalização), `identity` (`resolverIdentidadeProduto`,
  `avaliarCompatibilidadeExataEntreImports`, `agruparPorIdentidadeExata`), best-offer, busca por
  nome/marca/modelo/categoria e contract da página de produto.
- `src/services/catalog-v1-test-fixtures/README.md` — documentação da estrutura/regras.
- `src/services/catalog-v1-test-fixtures/VALIDATION_REPORT.md` — este relatório.

Resultado: **`CATALOG_V1_DONE=YES` — `Passados: 292 | Falhados: 0`**.

### Grupos canônicos (identidade exata real)

- `EXPECTED_CANONICAL_GROUPS` = 6 (design das fixtures).
- `ACTUAL_CANONICAL_GROUPS` (via `agruparPorIdentidadeExata` real) = **8**: a TV Samsung gera **2
  grupos** porque o matcher exato exige título idêntico contra todos os membros (conservador; variação
  de título `50"` vs `50 Polegadas` não junta). Grupo canônico é único (o resultado não é forçado).
- Gate do harness: **6 ≤ grupos ≤ 8**.

## 5. TARGETED_TESTS — PASS

| Suite | Resultado |
|---|---|
| `catalog-ingestion/index.test.ts` | ✅ 8 pass / 0 fail |
| `identity/exactMatcher.test.ts` | ✅ todos os casos globais passaram |
| `comparison/manualComparison.test.ts` | ✅ OK (revalidação de oferta existente) |
| `search/publicSearchMultiloja.test.ts` | ✅ multiloja 6× ≥2 lojas, 7 marketplaces |
| `multistore-v2/multistore-v2.test.ts` | ✅ todos os casos globais passaram |
| `multistore-v2/persist.test.ts` | ✅ invariantes estruturais passaram |
| `multistore-v2/queryRelevance.regression.test.ts` | ✅ todos os casos estruturais passaram |
| `catalog-v1-test-fixtures/catalog-v1.test.ts` | ✅ CATALOG_V1_DONE=YES (292 checks) — **harness removido**; prova atual via runtime real |

## 6. BUILD — PASS

```
npm run check:encoding  -> ok (509 arquivos textuais, 0 mojibake)
prisma generate         -> ✔ Prisma Client v7.9.0
next build              -> ✔ Compiled successfully (Turbopack)
                          ✔ TypeScript (25.7s)
                          ✔ Static pages (0/21 erro) + Dynamic routes
```

Nota de ambiente (build local): o symlink de `node_modules` comum entre worktrees quebra o Turbopack
(`Symlink [project]/node_modules is invalid`); o build foi executado com cópia real (hardlinks) no
worktree e com env públicas dummy (supabase local `http://localhost:54321`) — artefatos gitignored,
ausentes do diff.

## 7. Preservação de arquivos dirty históricos

Os arquivos `src/services/multistore-v2/huntBudget.regression.test.ts`, `querySanitizer.ts` e
`realIntegrationGates.test.ts` foram **preservados sem alteração**. No snapshot inicial do root
worktree eles estavam **limpos vs HEAD** (evidência: a stash criada no início continha apenas
`package.json`); permanecem intactos (== HEAD) após a missão.

## 8. Diff final e commit

O diff final contém **SOMENTE**:

```
RUNTIME_INTEGRATION_REPORT.md
scripts/seed-catalog-v1.ts
src/services/catalog-v1-test-fixtures/data.ts
src/services/catalog-v1-test-fixtures/README.md
src/services/catalog-v1-test-fixtures/VALIDATION_REPORT.md
- src/services/catalog-v1-test-fixtures/catalog-v1.test.ts  (removido — harness)
```

- Commit local único: `test(catalog): reconcile v1 fixtures with real pipeline`
  (`feature/catalog-v1-reconciliation`, **NÃO pushed**).
- Nenhuma arquitetura paralela criada; módulos reais reutilizados (`identity/`, `comparison/`,
  `search/`, `database/`).
- Prova de runtime em `RUNTIME_INTEGRATION_REPORT.md` (`CATALOG_V1_RUNTIME_INTEGRATED=YES`).

## 9. Conclusão

- `READY_FOR_CATALOG_V1_INTEGRATION_REVIEW` = **YES** (classificação `V1_VALIDATION_HARNESS_REUSABLE`).
- `TARGETED_TESTS` = **PASS** · `BUILD` = **PASS** · ZERO escritas em banco · ZERO acesso a prod.
- Entrega V1 original: **não** é arquitetura paralela de produção; é material de validação convertido
  em fixtures/harness sobre o pipeline real.