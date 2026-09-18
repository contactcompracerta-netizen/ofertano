# Migration history reconciliation

This branch restores the repository's canonical migration chain without changing Production. The baseline SQL files, their seven manifest checksums, `initial-schema.sql`, `schema.prisma`, and application behavior are unchanged.

## Recovered RLS history

Production recorded both RLS migrations, but main `452e9525aa2075d0e98fa44e67494933536aec03` omitted them. Their original commit `518f294348d83811f9cf91bee5ddbae4337304f3` belongs to `feature/search-e2e-final-20260910` and is not an ancestor of that main. Both files are restored directly from raw Git blobs, with no formatting or added newline:

| Migration | Git and Production SHA256 |
| --- | --- |
| 20260915194500_rls_security_hardening | 8aa4a426944155c3bac3acf95d30b3d3d0242da2be3a50c1448de0fad75e03a4 |
| 20260915203000_fix_rls_product_public_read | cdb15a3dbaba80c57d15d53edde4a5539fe654c860dac9a70fcd24c28f77b0c3 |

Manifest v3 keeps exactly seven baseline migrations. Its four forward migrations are RLS hardening, RLS fix, Commerce Foundation, and Commerce Canary Control Plane, in that chronological order. RLS is not marked as baseline.

## Known historical checksum exceptions

The R2F forensic artifacts are the source of these complete checksums:

| Migration | Unchanged repository SHA256 | Observed Production checksum |
| --- | --- | --- |
| 20260824120000_analytics_intelligence | d3f5730289acf1090f48dfd24446850c60733db919aa35d5911ed9c557cf0d6b | 135d793bbeb9dd11a73dd1eeb5493a10dd4859c637af8821728dfdaf13288311 |
| 20260828220000_admin_push_subscription | cdc619b7a8b5539ef19814d8fd0a42e0fee4818890acb364f97e2964c319a358 | e513a3ead01f6687b95f382818300d4b203a4fb9e6590c4c49e16e94a43e7dd1 |

The applied bytes for these two checksums were not found in the 433 reachable commits examined by R2F. We cannot determine whether their differences are comments/whitespace or executable SQL. Do not fabricate applied SQL, edit historical baseline files, change Production ledger checksums, or use Production `migrate resolve` to hide this history.

`scripts/migration-history/production-ledger-compatibility.json` records only these two exceptions, with policy `KNOWN_WARNING_ONLY_NO_LEDGER_MUTATION`. The pure verifier requires their exact forensic Production checksums and unchanged repository pins. It accepts no third mismatch, unknown DB-only name, duplicate row, unfinished/rolled-back row, missing RLS, RLS checksum change, or unexpected pending set. It does not connect to any database and never rewrites a ledger.

For a JSON snapshot with `version: 1` and a `ledger` array, supply pending explicitly:

```sh
node scripts/migration-history/verify-ledger-compatibility.mjs \
  --snapshot scripts/migration-history/production-ledger.fixture.json \
  --allowed-pending 20260917120000_commerce_intelligence_foundation,20260918100000_commerce_canary_control_plane
npm run test:migration-history
```

After both Commerce migrations are applied, the only other supported gate is `--allowed-pending none`. The verifier still requires the two known historical checksums; an external ledger rewrite to the repository checksums is not silently accepted. The fixture uses synthetic timestamps and contains no connection strings or secrets.

## Why Production migrate status may remain non-zero

Restoring RLS eliminates the two missing directories. It cannot recover or repair the lost applied bytes of Analytics/Admin Push. A nonzero status or a quiet deploy is not a sufficient safety gate. The separately authorized future Production verification must compare a read-only snapshot against the exact allowlist, require zero unknown divergence and unfinished/rolled-back migrations, exact RLS ledger/checksums, exact Commerce pending names/order, all Commerce/Shadow/Canary/Raw/catalog/import/public persistence flags OFF, and no canary token.

The snapshot gate emits its own two known-divergence warnings. These are audit findings, not claims that Prisma itself issued a warning. Any newly observed checksum/name/state divergence is a hard blocker.

## Local Supabase compatibility

The bootstrap/scaffold rejects Production environment, remote hosts, `localhost`, ports other than 55433, nonallowlisted databases, URL query/fragment transport overrides, and a socket/database/role identity mismatch before DDL. Only exact `127.0.0.1:55433` and named disposable databases are allowed. Port 55432 must never be used.

The local scaffold runs after pinned baseline DDL and resolving only the seven local baseline rows, before genuine Prisma deployment of all four forwards. It creates only:

- `anon` and `authenticated`: NOLOGIN, no superuser/createdb/createrole/replication/bypassrls, and no role memberships. Existing unsafe roles are rejected rather than altered.
- `auth` schema and a stable, invoker `auth.uid()` returning `NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid`. Missing/empty identity returns null; malformed UUID fails. Search path is `pg_catalog`; access is limited to the two local roles. Existing incompatible auth objects are rejected.
- `Favorite` and `PriceAlertEvent`, absent from the pinned fresh DDL but required by the historical RLS SQL. The local SQL is sourced from Git blob `c38acb4275f6a4336c3745e3d6a484ff85117986` (Favorite) and the exact PriceAlertEvent suffix of `dec41069809cbf22fff39baae1bbca54275f3603`. It uses the existing canonical PriceAlertType and does not recreate legacy PriceAlert or its old column/indexes. This is a local prerequisite file, not a Production migration.

No service role is introduced. Baseline DDL is not regenerated. The runtime Prisma schema/client are not expanded: a temporary verification-only schema explicitly represents the two legacy tables, their relations/indexes, and `Favorite_userId_idx`. The temporary schema is removed after `migrate diff`; no generated drop SQL is applied or ignored. RLS flags/policy metadata, effective grants, secure roles/auth function and default privileges are checked separately. Fingerprints compare enums, columns, indexes, constraints/FKs, RLS, policies, grants and default privileges between fresh and forward.

The local bootstrap requires repository checksums throughout. The Production exception allowlist does not weaken local bootstrap classification. Completed databases with schema/security divergence fail; partial and unknown databases are refused. `--check` does not create compatibility objects.

## Local validation and the Prisma 7.9.0 warning blocker

```sh
npm run test:migration-history:local
```

This requires disposable fixtures in `127.0.0.1:55433`: `ofertano_50ag4b_history_fresh`, `ofertano_50ag4b_history_forward`, and `ofertano_50ag4b_history_rehearsal`. Fresh/forward fixtures produce eleven rows: seven resolved baseline rows with zero applied steps and four genuinely deployed forwards with one step each. Existing fixture data is never reset by the test.

For the rehearsal, the test applies RLS genuinely using an isolated nine-file inventory, then explicitly changes only the two known checksums in the LOCAL disposable ledger. It compares all baseline/RLS rows before/after, counts legacy tables, and requires exactly two Commerce migrations applied and ten empty Commerce tables. No Production connection is possible through this helper.

The installed Prisma 7.9.0 exited zero and applied only the two pending Commerce migrations. Baseline/RLS rows and legacy counts were unchanged. **It emitted no modified-migration/checksum warning.** This differs from the mission's required warning expectation and is a hard blocker for declaring R2G ready for R2H. Do not synthesize a Prisma warning or treat silent `migrate deploy` as verification of historical checksums. Evidence is in `docs/evidence/50ag4b-r2g/local-validation.json`; the compatibility verifier, not Prisma deploy output, detects the two mismatches.

No Production migration, environment change, code deployment, staged deployment, alias operation, merge to main, or R2H/R3 execution is authorized by these local proofs.
