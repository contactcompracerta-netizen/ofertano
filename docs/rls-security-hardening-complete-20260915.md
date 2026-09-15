# RLS Security Hardening — Relatório Final (FASE 11)

Data: 2026-09-15
Escopo: banco de dados catálogo do Ofertano (Prisma → Supabase Postgres `ujskptfrbbaslvqrqzxa`).
Status: concluído e validado.

## 1. Contexto / arquitetura

O app usa dois projetos Supabase distintos:

| Uso | Projeto | Acesso |
|---|---|---|
| Banco/catálogo (Prisma) | `ujskptfrbbaslvqrqzxa` | `DATABASE_URL`/`DIRECT_URL` (porta 5432/6543) |
| Auth/frontend | `bbmyltmxkveneolvgtgn` | `NEXT_PUBLIC_SUPABASE_URL` + publishable key |

O banco de catálogo é mantido por migrations Prisma e consumido pelo backend com a role
`postgres` (bypassa RLS). Auth vive em outro projeto, sem credenciais de Postgres deste
ambiente — **RLS do projeto auth não é auditável/corrigível daqui**.

## 2. Estado inicial (exposição confirmada)

- RLS **desligado** em 19 tabelas gerenciadas; grants `ALL` de `anon`/`authenticated` em
  todas as tabelas para SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER.
- Default privileges de `postgres` (e `supabase_admin`) concediam tudo a `anon`/`authenticated`.
- Prova de leitura: `anon` lia Product (8), MarketplaceConnection (1, contém tokens),
  AdminPushSubscription (1), ImportQueue (10), entre outras.
- Exceções já seguras e **intocadas**: `notifications` e `price_alerts` (RLS on, policies de ownership).

## 3. Mudanças aplicadas

Migration `20260915194500_rls_security_hardening` (aplicada) + correção
`20260915203000_fix_rls_product_public_read` (aplicada) — em produção via `prisma migrate deploy`.

### Policies criadas
- `Product` (SELECT → anon, authenticated): produto público = `active`, `publicationStatus`
  fora de `DRAFT`/`ARCHIVED`, `price>0`, imagem presente, e **≥2 marketplaces distintos**
  entre ofertas válidas (multi-loja, equivalente ao `hasPublicMultiStore` do app).
- `BlogPost` (SELECT → anon, authenticated): `status='PUBLISHED'` e `publishedAt<=now()`
  (mesmo filtro de `src/services/blog/public.ts`).
- `MarketplaceOffer` (SELECT → anon, authenticated): ofertas "usáveis"
  (`active`, `available`, `matchStatus='EXACT'`, `status` fora de `UNAVAILABLE`/`ERROR`, `price>0`).
  Necessária porque o predicado de `Product` faz subconsulta nela (executada sob RLS).
- `Favorite` (SELECT/INSERT/DELETE → authenticated): `auth.uid()::text = "userId"`. Sem UPDATE.
- `PriceAlert` (SELECT/INSERT/UPDATE/DELETE → authenticated): `auth.uid()::text = "userId"`.

### Grants / defaults
- `REVOKE ALL` de `anon`/`authenticated` nas 19 tabelas gerenciadas.
- Re-grant: `SELECT` em `Product`/`BlogPost`/`MarketplaceOffer` p/ `anon` + `authenticated`;
  CRUD em `Favorite`/`PriceAlert` p/ `authenticated`.
- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON
  TABLES/SEQUENCES/FUNCTIONS/TYPES FROM anon, authenticated`.
- Índice novo `Favorite_userId_idx`.

### Backends inalterados
`postgres` (dono das tabelas) e `service_role` (bypassrls) continuam com acesso total;
`MarketplaceOffer` segue no `supabase_realtime`.

## 4. Validação

- Suíte RLS `prisma/rls-security-tests.sql` (como `postgres`, com `SET ROLE anon`/`authenticated`
  e JWT de usuários sintéticos): **todas as asserts PASS** (1a–6d). Contagens esperadas
  batem: 4 produtos públicos (Cabo, Samsung A57, Moto G17, Samsung A07 — "Fone Dapon" está
  inativo), 6 posts publicados, 18 ofertas usáveis. Provas: anon lê público e nada interno;
  anon não escreve; ownership de Favorite/PriceAlert (A não vê/grava/apaga/dá update nos
  dados de B); backend cria/atualiza/remove produto normalmente; 9 migrations registradas.
- Suite unitária `npm test`: **34/34 arquivos passam** (o arquivo mais pesado,
  `queryRelevance.regression.test.ts`, leva ~2m20s de CPU — a chain completa não termina
  nos 3 min padrão, mas não há falha).
- `npx prisma validate`: OK.

## 5. Build (`npm run build`) — falha pré-existente, NÃO relacionada ao RLS

`next build` falha no type-check por erro de tipo no arquivo `origin/main/scripts/ml-affiliate-poc.mts`
(`waitForLoadState('networksidle')` — API Playwright antiga). A causa raiz é uma pasta
**`origin/` órfã e não versionada** (worktree de referência do branch `main`, 16 MB, com
`.git` próprio), incluída no type-check porque o `exclude` do tsconfig cobre apenas `scripts`
na raiz. Decisão registrada: **não modificar** (config nem arquivos); a falha fica documentada
como limitação externa. Mesmo após remover a pasta, a correção do `.mts` (`networkidle`)
é trivial se for desejado.

## 6. Riscos residuais / recomendações

1. **Projeto auth (`bbmyltmxkveneolvgtgn`)**: sem acesso Postgres deste ambiente — auditar
   RLS de `auth.users`/`user_favorites` por fora se necessário.
2. **`user_favorites` vs. `Favorite`**: `src/services/favorites/account.ts` acessa
   `user_favorites`, que **não existe** neste banco; `Favorite` existe e está vazia
   (apenas a migration RLS a referencia). REQUER REVISÃO — não criar tabela sem definição clara.
3. **INSERT/UPDATE via REST autenticado** em `Favorite`/`PriceAlert` continua possível e
   contorna validações das APIs canônicas (decisão aceita; polícies só garantem propriedade).
4. **`/produto/[id]`** usa critério `active=true OR publicationStatus='DRAFT'`; a policy de
   `Product` segue as superfícies canônicas (casa/busca) e pode deixar de expor alguns
   itens singulares — sem impacto nas páginas públicas atuais.
5. Grants `USAGE` de enum types para `anon`/`authenticated` permanecem (sem dado sensível).

## 7. Arquivos

- `prisma/migrations/20260915194500_rls_security_hardening/migration.sql` (aplicada)
- `prisma/migrations/20260915203000_fix_rls_product_public_read/migration.sql` (aplicada)
- `prisma/rls-security-tests.sql` (suíte RLS, aplicável como `postgres`)
- `docs/rls-audit-backup-pregrant-20260915193612.txt` (state pré-mudança, 451 linhas)
- `docs/rls-security-hardening-complete-20260915.md` (este relatório)

Nota: há alterações pré-existentes não relacionadas em `src/services/multistore-v2/*`
(não tocadas) e a pasta `origin/` órfã não versionada.

## 8. Commit sugerido

```
chore(security): habilita RLS e aplica menor privilégio no catálogo Supabase

- RLS on em 19 tabelas gerenciadas; policies públicas (Product/BlogPost/MarketplaceOffer)
  e de ownership (Favorite x3, PriceAlert x4)
- REVOKE de grants anon/authenticated + default privileges; SELECT público mínimo
- Correção do predicado multi-loja de Product (EXISTS sem GROUP BY)
- Suite de testes RLS (prisma/rls-security-tests.sql) 100% pass
```