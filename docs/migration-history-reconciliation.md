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

## Local validation and observed Prisma 7.9.0 behavior

```sh
npm run test:migration-history:local
```

This creates new disposable fixtures in `127.0.0.1:55433`: `ofertano_50ag4b_history_r2g2_fresh`, `ofertano_50ag4b_history_r2g2_forward`, and `ofertano_50ag4b_history_r2g2_rehearsal`, explicitly allowlisted for this process. Fresh/forward fixtures produce eleven rows: seven resolved baseline rows with zero applied steps and four genuinely deployed forwards with one step each. Existing fixture data is never reset by the test. For another run, supply a new `MIGRATION_HISTORY_RUN_ID` containing only lower-case letters, digits and underscores (maximum 24 characters).

For the rehearsal, the test applies RLS genuinely using an isolated nine-file inventory, then explicitly simulates all nine fixture checksums and applied-step counts in the LOCAL disposable ledger. Only the initial baseline has zero steps; the other eight historical rows have one. Finished/rolled-back booleans must match the fixture exactly. This is ledger metadata simulation, not proof that the lost historical SQL was executed. It compares all baseline/RLS rows before/after, counts legacy tables, and requires exactly two Commerce migrations applied and ten empty Commerce tables. No Production connection is possible through this helper.

The installed Prisma 7.9.0 exited zero and applied only pending Commerce. The nine historical rows and legacy counts were unchanged, with RLS/policies/grants intact. No modified-migration warning appeared in either the exact Production-like control or the resolved-baseline control from R2G.1. Changing the six noninitial baseline applied-step counts from zero to one did not change the observed warning. `migrate status` returned one for pending migrations and did not identify these checksum mismatches.

The [Prisma v7 documented workflow](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production) describes modified-migration warnings. Classification: `OBSERVED_BEHAVIOR_DIFFERS_FROM_DOCUMENTED_WORKFLOW`; no upstream-confirmed bug is claimed. Ofertano does not depend on those warnings. The R2G/R2G.1 blocker was a requirement to observe that output; R2G.2 explicitly replaces that requirement with independent ledger verification. Original evidence remains historical evidence, not the current readiness decision.

The independent verifier now also checks immutable forensic pins, pinned baseline DDL/schema hashes, and exact applied-step metadata. `forensic-pins.json` is trusted code-reviewed policy; an observed snapshot cannot redefine it. A coordinated rewrite of compatibility values and snapshot checksums is rejected. Fresh bootstrap retains its separate seven-resolved-row contract; it is not a Production ledger snapshot. After Commerce, the Production gate requires their exact checksums and one applied step each.

The rehearsal execution verifier checks exit zero, exactly the two Commerce applications in order, and the positive success message. Its warning boolean is telemetry only. Silence, unexpected/historical/repeated applications, nonzero exit, or missing success cannot pass. `checksumSafetyAuthority` is `INDEPENDENT_LEDGER_VERIFIER`.

## Five independent responsibilities

1. Repository integrity: verify manifest, exact eleven migration file hashes, immutable forensic pins, baseline DDL, and current schema hash.
2. Production ledger integrity: the future separately authorized runner reads `_prisma_migrations` read-only and passes the JSON snapshot to `verify-ledger-compatibility.mjs`. Exactly the two pinned exceptions, exact RLS and step metadata, no unknown/duplicate/unfinished/rolled-back rows, and explicit pending are required.
3. Database state safety: observed flags must explicitly be boolean false for all eleven required flags, token-presence false, all ten Commerce tables absent, no blockers, valid counts for all eighteen legacy application tables, and exact nineteen-table RLS/ten-policy/effective-grant/default-privilege state. Policy qualifiers and owner checks are compared, not just policy names.
4. Prisma execution: only after gates 1–3 pass, run one controlled `migrate deploy`. Prisma executes pending SQL; its output is not checksum verification.
5. Post-migration proof: re-read ledger, preserve all nine historical rows, require exact Commerce checksums/steps, ten tables, legacy count delta zero, intact security state, and the separately authorized future smoke checks.

## Pure predeploy authorization and snapshot limits

`authorize-commerce-migrate-deploy.mjs` performs one pure decision across ledger, allowed pending, trusted repository contract, observed flag snapshot and schema-state snapshot. It never connects, deploys, resolves, or mutates. Missing, malformed, ambiguous, or unsafe fields produce `DENIED`. Only the exact Foundation + Control Plane pending set can produce `AUTHORIZED`.

Expected Production identity is an explicit **trusted release input**, supplied by the audited future runner: environment and target environment production, forensic project id `prj_KcIMFLniTVvZGIGh1OCIkSE8SsND`, and the forty-character audited delivery SHA. Never derive the expected SHA from the observed identity or allow observations to supply their own expectation. The observed target must match that entire input exactly. In local tests these identity/flag fields are clearly synthetic; actual SQL still uses the local-only connection guard. This pure result does not authorize Production work in this mission.

The schema snapshot contains `rls`, canonical `policies` (including qualifiers and roles), effective `grants` including grant options and MAINTAIN, `columnPrivilegeExceptions` for effective access beyond table grants, relevant `defaultPrivileges`, the ten-table presence map, unfinished/rolled-back counts, blockers, and eighteen legacy counts. `expected-security-state.json` records the canonical R2F metadata for the nineteen managed tables. Pre-existing unrelated Supabase objects are outside this managed-table contract; a future runner must bind all observations to its verified target and perform its separate broader state checks. Snapshot builders must collect actual metadata and explicitly normalize flags, never replace missing observations with false or zero.

A read-only snapshot and a pure authorization decision do not make deploy mathematically atomic relative to all writers. The future runner must collect a consistent read-only preflight immediately before execution, use one controlled instance with no minutes-long delay, keep Prisma advisory locking enabled, and verify the ledger/security/counts again afterward. This module does not itself create a DB lock or an end-to-end transaction.

Versioned current evidence: `docs/evidence/50ag4b-r2g2/summary.json` and `local-validation.json`. R2G.1 evidence preserves both silent controls; its behavior observations remain valid.
No Production migration, environment change, code deployment, staged deployment, alias operation, merge to main, or R2H/R3 execution is authorized by these local proofs.
