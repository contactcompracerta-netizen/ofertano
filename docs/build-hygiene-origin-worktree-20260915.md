# Build Hygiene — Linked Worktree `origin/`

Data: 2026-09-15
Status: corrigido e validado

## Origem do problema

A pasta `origin/` do projeto Ofertano é um **linked git worktree** criado por acidente
durante investigações anteriores. Ela não faz parte do código-fonte da aplicação, não é
referenciada por nenhum script/config e ficou responsável pela **falha do `npm run build`**.

## `origin/main` é um linked git worktree

- `origin/main/.git` → arquivo ponteiro `gitdir: /home/evaldo/Projetos/ofertano/.git/worktrees/main`
- Registrado em `git worktree list`
- **Branch:** `release/search-stability-precheck-20260914`
- **Commit:** `fd02029` ("Integra contexto Raw Listing ao fluxo Multi Loja")
- **Data aproximada de criação:** 2026-09-14 21:43
- Conteúdo: **checkout completo do projeto** (src/, prisma/, scripts/, docs/, public/,
  ~387 arquivos `.ts/.tsx/.mts`, 16 MB, sem node_modules)
- **Não é referenciado pelos scripts/configs da aplicação** (package.json, next.config.ts,
  nenhum script de build/CI)

## Por que afetava o build

O `tsconfig.json` usava `include: ["**/*.ts", "**/*.tsx", "**/*.mts"]` com
`exclude: ["node_modules", "scripts"]`. O padrão `scripts` cobre apenas o diretório da
raiz, então o tsc arrastava **386 arquivos** de dentro de `origin/main/**` para o programa
do type-check.

Erro detectado (único, reproduzido em `npm run build`):

```
./origin/main/scripts/ml-affiliate-poc.mts:549:27
Type error: Argument of type '"networksidle"' is not assignable to parameter of type
'"load" | "domcontentloaded" | "networkidle" | undefined'.
```

- **Valor inválido:** `waitForLoadState('networksidle', { timeout: 2000 })`
  (sintaxe de Puppeteer, API incorreta para Playwright)
- **Playwright aceita:** `load`, `domcontentloaded`, `networkidle`
- **Atenção:** o arquivo real da raiz (`scripts/ml-affiliate-poc.mts`) é byte-idêntico e
  **já estava corretamente excluído** do type-check pelo `exclude: ["scripts"]`. A falha
  existia apenas por causa da cópia dentro do worktree.

## Solução adotada (não destrutiva, nada apagado)

| Arquivo | Mudança |
|---|---|
| `tsconfig.json` | `exclude` += `"origin"` |
| `.gitignore` | += `origin/` |
| `eslint.config.mjs` | `globalIgnores` += `"origin/**"` |
| `scripts/check-encoding.mjs` | `SKIP_DIRS` += `"origin"` |

## Validação

- `npm run build` → **PASS**
  - `check-encoding: ok (449 arquivos textuais, 0 mojibake)`
  - `✓ Compiled successfully`
  - `✓ Generating static pages (22/22)`
- Testes → **34/34 PASS** (incl. `queryRelevance.regression.test.ts`, ~2m20s de CPU)
- `npx prisma validate` → **PASS**

## `origin/main` NÃO foi removido

O worktree **possui trabalho staged não commitado** (`docs/*.md`). Removê-lo agora
perderia esse conteúdo. `origin/` permanece intacta no disco.

## Futura remoção

Deve ser tratada em **missão separada**, com aprovação explícita:

1. resolver/stagear os arquivos staged dentro do worktree (`git worktree` recusará
   remoção com working tree sujo);
2. `git worktree remove origin/main` (registro limpo em `.git/worktrees/`);
3. opcionalmente remover o diretório vazio `origin/`.