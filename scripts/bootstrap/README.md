# Bootstrap versionado de banco FRESH

Este diretório contém a solução oficial para o problema `FRESH_DB_MIGRATION_BOOTSTRAP=FAIL`:
a cadeia histórica de migrations **não roda** em um banco PostgreSQL vazio porque
`20260905120000_price_alerts` depende de objetos legados (`PriceAlert`, `PriceAlertType`)
que não existem no schema atual.

## Comandos

```bash
npm run db:bootstrap:fresh        # aplica o bootstrap (somente bancos descartáveis locais)
npm run db:bootstrap:fresh:check  # apenas classifica (read-only, não altera nada)
```

O bootstrap **não** é ligado a `build`, `postinstall` ou runtime. Ele é sempre explícito.

## Contrato de classificação (fail-closed)

| Categoria | Estado do banco | Ação |
|-----------|-----------------|------|
| A FRESH   | sem objetos e sem `_prisma_migrations` | aplica DDL canônico + resolve ×7 + deploy + valida |
| B MIGRATED| as 7 migrations canônicas aplicadas, checksums batem | NO-OP seguro |
| C PARTIAL | migrations parciais, checksums divergentes ou rollback | ABORTA |
| D UNKNOWN | schema não reconhecido ou alvo não descartável | RECUSA |

## Guardas de segurança

- Host **precisa** ser `127.0.0.1` e porta **precisa** ser `55433` (nunca `55432`).
- O nome do banco precisa estar na allowlist descartável
  (`ofertano_4e_*`, `ofertano_bootstrap_probe_n1[abc]`) ou em
  `BOOTSTRAP_ALLOWED_DATABASES` (lista separada por vírgula).
- `manifest.json` fixa `sourceSHA`, `schemaSHA256`, `ddlSHA256` e o checksum de
  cada migration. Qualquer divergência bloqueia a execução.
- A conexão é verificada no nível de socket (`remoteAddress`/`remotePort`).
- Um advisory lock (`ofertano-versioned-fresh-bootstrap-v1`) serializa execuções.

## Arquivos

- `manifest.json` — pinos de integridade (schema, DDL e migrations).
- `initial-schema.sql` — DDL canônico gerado por `prisma migrate diff --from-empty`
  mais o invariante histórico `SocialPost.hashtags NOT NULL`.
- `fresh-bootstrap.mjs` — CLI de classificação e bootstrap.

## Regerar os artefatos

Se `prisma/schema.prisma` ou as migrations históricas mudarem intencionalmente,
regenere o DDL e o manifest, e abra um PR revisando o diff:

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > /tmp/canonical.sql
# acrescente o invariante de SocialPost.hashtags e atualize scripts/bootstrap/initial-schema.sql
node scripts/bootstrap/fresh-bootstrap.mjs --check
```
