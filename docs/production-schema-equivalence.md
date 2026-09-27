# Exact production schema equivalence

Production has deliberate physical legacy objects outside the runtime Prisma
model. A direct comparison to `prisma/schema.prisma` is not a complete database
contract. This certification uses a separate, explicitly pinned production
overlay and catalog fingerprints. It does not modify the runtime schema/client
or the local fresh-bootstrap equivalence.

## Classification and provenance

The full preserved diff contains two removed tables, six removed columns, one
removed index, and three internal FK removals belonging to the two tables. See
[evidence inventory](evidence/production-equivalence/diff-inventory.json).
The source commit is `0171d81464d32748ee0575be218431c2d32a2043`. The old real dump
SHA256 is `97b37997e2a5e2d7b2eb0dc354dc2372d329f8b3e0999a91275f1870ec439c41`.

| Object | Classification | Evidence and decision |
| --- | --- | --- |
| `public.notifications` | UNMANAGED_LEGACY_TABLE | No corresponding Prisma model/mapping. Existing physical object explicitly retained by the mission; exact shape comes from the real dump and a fresh read-only catalog snapshot. Original creation migration was not recovered; no claim of Prisma ownership or reconstructed DDL provenance is made. |
| `public.price_alerts` | UNMANAGED_LEGACY_TABLE | Distinct from `public."PriceAlert"`. Historical frontend usage is documented by commit `b166eef`, whose API tests prohibit direct legacy writes. No creation migration recovered. Exact retained physical shape is pinned. |
| `PriceAlert.armed` | LEGACY_RETAINED_PHYSICAL_EXTENSION | Legacy SQL and former model at `d780c0b:prisma/sql/create_price_alert.sql`; runtime reverted by `aab810d`; later migration explicitly retains compatible legacy columns. |
| `PriceAlert.lastEvaluatedAt` | LEGACY_RETAINED_PHYSICAL_EXTENSION | Same provenance; no current runtime field access. |
| `PriceAlert.lastEvaluatedHadExact` | LEGACY_RETAINED_PHYSICAL_EXTENSION | Same provenance; no current runtime field access. |
| `PriceAlert.lastEvaluatedPrice` | LEGACY_RETAINED_PHYSICAL_EXTENSION | Same provenance; no current runtime field access. |
| `PriceAlert.lastTriggeredAt` | LEGACY_RETAINED_PHYSICAL_EXTENSION | Same provenance; no current runtime field access. |
| `PriceAlert.lastTriggeredPrice` | LEGACY_RETAINED_PHYSICAL_EXTENSION | Same provenance; no current runtime field access. |
| `SocialPost_dayKey_key` | UNVERSIONED_DRIFT_RETROACTIVE_BOOTSTRAP_ARTIFACT | Non-unique btree `(dayKey)`, recreated by the retroactive bootstrap after the three-slot migration had already run. Reconciled by a new forward migration. |

Retention is explicit in `20260905120000_price_alerts/migration.sql`, lines 10–11:
“a migration preserva todas as colunas legadas compativeis e nao apaga nada.”
The six fields were defined by historical SQL, not an extant canonical migration.
Repository-wide searches (including hidden non-secret source and Git history),
the runtime model, `src/services/priceAlerts/{repository,apiStore}.ts`, current
API/monitor code, and generated Prisma fields show no current reads or explicit
writes to them, including direct Supabase access. Matches of the unrelated local
variable `armed` in cutover tests are not PriceAlert field accesses.
Production aggregate observation: **0 PriceAlert rows; 0 non-null rows in each
of the six fields**. Min/max is not useful for an empty table.

The stale index was exactly:

```sql
CREATE INDEX "SocialPost_dayKey_key" ON public."SocialPost" USING btree ("dayKey");
```

It was valid/ready, non-primary, non-unique, with no predicate or expression.
The valid, ready canonical index is UNIQUE `(dayKey, slot)`. Production had
14 days with multiple posts. The stale index does not enforce one post per day.
The bootstrap's ledger completion is `2026-09-27T13:32:57.681Z`; the three-slot
migration completed `2026-09-08T00:49:14.495Z`. The bootstrap SQL explains that
its dayKey index exists solely as a prerequisite for that historical DROP.
Preview and a fresh bootstrap lack this leftover index.

The new `20260927180000_social_post_index_reconciliation` migration requires the
complete canonical index first, locks the table with a five-second lock timeout,
checks the exact stale definition and catalog flags, and drops only that index.
An absent stale index is a no-op only after the canonical guard passes. No rows,
columns, tables, historical migration bytes, or old ledger rows are changed.

## Exact contract and auditor

`production-equivalence-contract.json` pins column order, types/UDTs, defaults,
nullability, identity/generated properties, constraints, indexes, RLS, policies,
triggers, trigger function body and sequence absence for the audited objects.
Cluster-local opclass OIDs are excluded; PostgreSQL index definitions resolve
opclasses by name. Index column positions and flags remain pinned.
The two external FKs are separate exact entries. `production-equivalence.mjs`
also pins the contract hash and runtime schema hash. No observation automatically
updates the contract. Changes require a reviewed contract update.

Prisma does not cover every catalog object (for example policies, checks and
trigger bodies). Catalog fingerprints enforce those independently before the
diff. The overlay also represents previously established `Favorite`,
`PriceAlertEvent`, and `PriceAlertType.TARGET_PRICE` prerequisites. New or missing
Prisma-visible tables/fields/indexes outside the audited tables fail the full diff.

The auditor uses a repeatable-read read-only transaction and exports its snapshot
for real `pg_dump --schema-only`. It restores the dump into a freshly named,
mission-owned database on **127.0.0.1:55433**; 55432 and remote clone targets are
rejected. The source is never reconstructed from local migrations. It validates
fingerprints before dropping exactly `notifications_user_id_fkey` and
`price_alerts_user_id_fkey` on the clone, compares the complete shape afterward,
and requires the internal `price_alerts_product_id_fkey` fingerprint unchanged.
Owned clones are cleaned up in `finally`. Evidence is mode 600 in a new mode 700
directory outside the repo. No database rows are copied.

```sh
node scripts/migration-history/verify-production-schema-equivalence.mjs \
  --env-file /secure/path/production.env \
  --out-dir /secure/forensics/new-unique-run-directory \
  --pg-dump /absolute/path/to/TLS-enabled/pg_dump \
  --psql /absolute/path/to/psql
```

Use a pg_dump version compatible with the server. This run compiled PostgreSQL
17.6 with OpenSSL in `/tmp`; its `libpq` directory was supplied through
`LD_LIBRARY_PATH`. These binaries are local prerequisites, not repository files.

Success is reported as:

```text
PRODUCTION_EQUIVALENCE_DIFF=ZERO_WITH_EXACT_VERSIONED_LEGACY_OVERLAY
PRODUCTION_DIRECT_PRISMA_DIFF=P4002_EXPECTED_CROSS_SCHEMA_INTROSPECTION_LIMIT
```

The P4002 classification is retained prior evidence, explicitly marked not rerun.
It is not mislabeled as a direct Prisma zero diff.

## Verification

```sh
node --test scripts/migration-history/production-equivalence.test.mjs
npm run test:migration-history
node scripts/migration-history/production-equivalence.integration.mjs
node scripts/migration-history/production-overlay-mutations.integration.mjs \
  /secure/path/real-production-schema.sql /absolute/path/to/psql
```

The integration gates prove eight reconciliation cases on PostgreSQL, category A
fresh bootstrap with local diff zero, and seven real Prisma overlay mutations
(all exit 2). Unit mutations cover missing/extra legacy tables, types, defaults,
retained columns, external/internal FKs, indexes, RLS/policies, identity/order,
checks, triggers and trigger function changes, clone tripwires and safe output.
Historical ledger tests use an explicitly synthetic already-applied row to keep
their historical pending sets meaningful; it is not production deploy evidence.

Preview and production runtime smoke tests use the current Prisma Client with
an explicit `SET TRANSACTION READ ONLY`; only counts and query success are
reported. Preview's first smoke detected that adapter connection options did not
make the Prisma transaction read-only; it stopped before data queries. The smoke
was rerun with explicit transaction mode. Production's first smoke exceeded
Prisma's default interactive timeout (P2028); the read-only postcheck was rerun
with a 30-second timeout. Neither retry reapplied the migration or changed data.

Raw dumps, full catalog snapshots, before/after ledgers, intermediate failures and
final reports remain under `/home/evaldo/Projetos/ofertano-forensics/schema-equivalence/`.
The previous `certification-report.md` remains intact. The versioned summary
contains only classifications, hashes, counts and gate results.

Phase P is not started. `BACKFILL_EXECUTED=NO`, `BACKFILL_ALLOWED=NO`.
