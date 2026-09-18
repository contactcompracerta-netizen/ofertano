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
| B MIGRATED| todas as migrations baseline + forward aplicadas, checksums batem | NO-OP seguro |
| C PARTIAL | migrations parciais, checksums divergentes ou rollback | ABORTA |
| D UNKNOWN | schema não reconhecido ou alvo não descartável | RECUSA |

## Guardas de segurança

- Host **precisa** ser `127.0.0.1` e porta **precisa** ser `55433` (nunca `55432`).
- O nome do banco precisa estar na allowlist descartável
  (`ofertano_4e_*`, `ofertano_bootstrap_probe_n1[abc]`) ou em
  `BOOTSTRAP_ALLOWED_DATABASES` (lista separada por vírgula).
- `manifest.json` fixa `baselineSourceSHA`, `baselineSchemaSHA256`, `currentSchemaSHA256`, `baselineDDLHash` e o checksum de
  cada migration. Qualquer divergência bloqueia a execução.
- A conexão é verificada no nível de socket (`remoteAddress`/`remotePort`).
- Um advisory lock (`ofertano-versioned-fresh-bootstrap-v1`) serializa execuções.

## Arquivos

- `manifest.json` — pinos de integridade (schema, DDL e migrations).
- `initial-schema.sql` — DDL canônico gerado por `prisma migrate diff --from-empty`
  mais o invariante histórico `SocialPost.hashtags NOT NULL`.
- `fresh-bootstrap.mjs` — CLI de classificação e bootstrap.

## Evolução do contrato v2

Não regenerar `initial-schema.sql` ao adicionar migrations forward. Os sete checksums em `baselineMigrations` e o DDL legado permanecem fixos. Adicionar o checksum da nova migration em `forwardMigrations` e atualizar somente `currentSchemaSHA256` para o schema atual. O inventário completo precisa corresponder ao repositório.

Fresh aplica o DDL legado, resolve somente baseline e executa forward com `prisma migrate deploy`. Um banco existente baseline-only deve usar `prisma migrate deploy` diretamente. B requer a ledger completa e schema equivalente; C/D são recusados. Unexpected errors retornam código não zero.

Ver detalhes em [commerce-intelligence-foundation](../../docs/commerce-intelligence-foundation.md).

## Manifest v3: recovered RLS and local compatibility

The seven baseline files/checksums and `initial-schema.sql` remain unchanged. Four real forward migrations now run in order: RLS hardening, RLS Product policy fix, Commerce Foundation, and Commerce Canary Control Plane.

Before local forward deployment, the guarded scaffold creates only the two NOLOGIN public roles, `auth.uid()`, and the two required legacy tables omitted from the pinned DDL. It rejects remote/Production/55432 targets and unsafe existing auth objects. Completed checks include legacy-aware relational diff plus RLS/grants/default privilege metadata; no runtime model is changed.

`npm run test:migration-history` runs pure fail-closed tests. `npm run test:migration-history:local` exercises fresh/forward/idempotence and the local Production-like checksum rehearsal. See [migration-history-reconciliation](../../docs/migration-history-reconciliation.md) for exact hashes and the independent authoritative ledger gate and observed Prisma 7.9.0 warning telemetry. Production checksum exceptions are not accepted by the local bootstrap.
