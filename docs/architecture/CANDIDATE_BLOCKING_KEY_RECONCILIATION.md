# FASE 8.3C — RECONCILIAÇÃO DO CandidateBlockingKey

> `FASE_8_3C_STATUS=PARCIAL`
> Partes A e B concluídas. Partes C–H **não** concluídas (ver §5).
> O repositório está no estado conhecido e íntegro: `test:migration-history`
> em **140 pass / 0 fail**.

---

## 1. PARTE A — FORENSE (concluída, somente leitura)

Lido de `_prisma_migrations`:

| Campo | Valor |
|---|---|
| `migration_name` | `20260926220000_candidate_blocking_keys` |
| `checksum` | `84d0b473c49d9fbc5b3fada515a62367c44cf2df32a600219a3efbff9b292a10` |
| `started_at` | 2026-09-26T18:41:28.732Z |
| `finished_at` | 2026-09-26T18:41:29.311Z |
| `applied_steps_count` | 1 |
| `rolled_back_at` | `null` |

Estado real: tabela existe, **428 linhas**, 3 enums, 5 índices.

## 2. PARTE B — BYTES EXATOS (concluída)

O arquivo não estava no git (foi removido antes de qualquer `git add`) e
**não** havia blob pendente correspondente. Reconstruí o conteúdo e **conferi
o sha256 contra o checksum registrado no banco**:

```
sha256(migration.sql) = 84d0b473c49d9fbc5b3fada515a62367c44cf2df32a600219a3efbff9b292a10
checksum em _prisma_migrations = 84d0b473c49d9fbc5b3fada515a62367c44cf2df32a600219a3efbff9b292a10
=> IDÊNTICO, byte a byte
```

O arquivo restaurado corresponde ao que foi aplicado — não é SQL aproximado.

## 3. PARTE C — POR QUE NÃO CONCLUÍ

Tentei a atualização consciente do contrato (o que a missão pede e é legítimo):

- `verify-ledger-compatibility.mjs`: novo export `blockingKeyMigration`
  (aplicada, logo **fora** de qualquer `pendingAllowlistSet`);
- `manifest.json`: `forwardMigrations` + `currentSchemaSHA256`;
- `forensic-pins.json`: `repositoryMigrationChecksums` + `schemaChecksum`;
- fixture do ledger de produção.

Progressão real: **69 → 51 → 3 → 1 falhas**. O resto do contrato passou:
`CANONICAL_INVENTORY_CHANGED`, `FORENSIC_PINS_CHANGED` e
`REPOSITORY_SCHEMA_CONTRACT_CHANGED` foram resolvidos corretamente.

A última falha restante é um teste que **provavelmente** depende de a
`pending` ser calculada a partir de um conjunto cujo tamanho/ordem mudou, e
que espera `REQUIRED_APPLIED_MIGRATION_MISSING` mas recebe
`UNEXPECTED_PENDING_SET` — ou seja, a ordem de duas asserções do gate mudou
de precedência com a entrada nova.

**Revertí tudo.** Um gate de segurança em 139/140 é pior que o gate em
140/140 sem a migration: a falha residual é exatamente do tipo que esse
contrato existe para pegar, e eu não a entendi o bastante para alterá-lo com
segurança. Deixei o contrato intacto.

## 4. O QUE ISSO DEIXA (e o que não deixa)

| | Estado |
|---|---|
| Banco de produção | `CandidateBlockingKey` existe, 428 linhas, migration registrada |
| Repositório | **não** declara a migration |
| `test:migration-history` | 140/140 |
| Deploy de `f950d50` | **ERROR** (produção segue em `e963acd`) |

**Divergência deliberada e perigosa:** um `migrate deploy` em banco NOVO não
criará a tabela, porque o repositório não a declara. O backfill está marcado
como BLOQUEADO no topo do arquivo. Isso **precisa** ser fechado antes de
qualquer uso do índice.

## 5. PARTES D–H: NÃO FEITAS

- **D** (2 cenários de migração): a migration não está no repo, então o
  cenário 1 (banco novo) não é testável ainda. O cenário 2 (produção) foi
  lido na Parte A.
- **E** (deploy ERROR): não investiguei. `vercel ls` não retornou nesta
  sessão. **Não assumi causa.**
- **F** (FASE P): o bug do harness está identificado e documentado, mas a
  auditoria não foi reexecutada.
- **G** (blind rediscovery final): não reexecutado.
- **H** (benchmark positivo): não executado.

## 6. SEQUÊNCIA CORRETA PARA FECHAR

1. Ler o teste que falha e entender a mudança de precedência entre
   `REQUIRED_APPLIED_MIGRATION_MISSING` e `UNEXPECTED_PENDING_SET`.
2. Aplicar as quatro mudanças de contrato jávalence (revisadas aqui).
3. `test:migration-history` → 140/140 **com** a migration presente.
4. Só então `migrate deploy` em banco novo (CENÁRIO 1) e `migrate status`
   em produção (CENÁRIO 2).
5. Investigar o deploy ERROR antes de promover de novo.
