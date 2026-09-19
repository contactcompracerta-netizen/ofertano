# Security gate scope reconciliation (50AG.4B-R3C)

This branch fixes the false `AUTHORIZE_DENIED` of the R3 security gate **without weakening
the real security**. It reconciles the **scope** of the gate, not the security contract.

## Problem (proven by R3B)

Production legitimately contains six additional policies on legacy/external lowercase
tables outside the 19 tables managed by Ofertano:

| Table | Policy |
| --- | --- |
| `public.notifications` | `notifications_select_own`, `notifications_update_own` |
| `public.price_alerts` | `price_alerts_delete_own`, `price_alerts_insert_own`, `price_alerts_select_own`, `price_alerts_update_own` |

The R3 gate compared **all** observed policies and **all** default privileges globally,
so these six external policies (and the platform-owned `supabase_admin` default ACL)
produced a false `POLICY_STATE_DIVERGED` / `DEFAULT_PRIVILEGES_DIVERGED`.

R3B additionally proved:

- the 10 canonical managed policies are exact;
- the 38 managed grants are exact;
- the migration role (`postgres`) default ACL in `public` grants **nothing** to
  `anon`/`authenticated` (only `postgres` and `service_role`);
- `public` schema: `anon`/`authenticated` have `USAGE`, but `CREATE=false`;
- new Commerce tables would inherit **no** dangerous privileges.

## MANAGED SECURITY SCOPE

The authoritative managed set is derived **only** from
`security.rls[].tableName` (19 tables, including `_prisma_migrations`). The gate fails
closed if that set is empty, has duplicates, or contains empty names.

- **RLS**: exact canonical state over the managed set.
- **Policies**: observed policies are split into `MANAGED_POLICIES`
  (`tablename ∈ managedTableSet`, compared EXACT on tablename/policyname/permissive/
  roles/cmd/qual/with_check) and `OUT_OF_SCOPE_POLICIES` (observed and returned as
  metadata — **never denied, never silently discarded**).
- **Grants**: managed tables / protected roles (`anon`, `authenticated`) are compared
  EXACT against the canonical 38 rows (privileges and grant options). Effective
  privileges come from `has_table_privilege`, so privileges received through `PUBLIC`
  surface in the managed grant state and are fail-closed. Grants on unmanaged tables
  are observed, not compared.
- **Column privilege exceptions**: must be empty (fail-closed).

## DEFAULT ACL (scoped contract)

Replaces the old global `defaultPrivileges === []` with `defaultPrivilegeSafety`:

```json
{
  "migrationRole": "postgres",
  "schema": "public",
  "protectedRoles": ["anon", "authenticated"],
  "forbiddenTablePrivileges": ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER","MAINTAIN"],
  "publicSchemaCreateForbidden": true
}
```

The snapshot carries expanded default-ACL rows `{owner, schema, objectType, grantee,
privilege, grantable}`. The gate evaluates **only** rows where

- `owner === migrationRole` (`postgres`),
- `schema === public`,
- `objectType === 'r'` (TABLES — the object class Commerce creates),

and denies if such a row grants any forbidden table privilege — directly or via
`PUBLIC` — to `anon`/`authenticated`, or carries a grant option for them.

Other owners (e.g. `supabase_admin`, storage/graphql platform roles) are
`OUT_OF_SCOPE_DEFAULT_ACL_OBSERVED` and do **not** deny merely by existing. R3B shows
these platform rows exist in Production and only affect objects created by
`supabase_admin`. `service_role` is a `PRIVILEGED_PLATFORM_ROLE_OBSERVED`, not a
public user.

## PUBLIC inheritance

The gate is not blind to `PUBLIC`: effective table privileges (`has_table_privilege`)
already include anything transmitted via `PUBLIC`, so a `PUBLIC`-hidden grant on a
managed table is seen as a real effective privilege and denied when non-canonical.
Default ACL rows with `grantee === 'PUBLIC'` from the migration role in `public` are
denied as well.

## PUBLIC schema safety

`schemaState.publicSchemaPrivileges` must declare `USAGE`/`CREATE` for `anon` and
`authenticated`:

- `USAGE=true` is accepted;
- `CREATE=true` for `anon` or `authenticated` is **DENIED** (`PUBLIC_SCHEMA_CREATE_UNSAFE`);
- a missing snapshot is **DENIED** (`PUBLIC_SCHEMA_PRIVILEGES_MISSING`).

## MIGRATION ROLE

`schemaState.migrationRole` is required and must equal the contract (`postgres`).
Missing or divergent role → `MIGRATION_ROLE_UNEXPECTED`. The caller cannot omit it.

## Commerce static object contract

The two pending migrations are audited (SQL comments stripped) and must create only:

- TABLES (10),
- ENUM TYPES (11),
- indexes / unique indexes,

and must not contain FUNCTION, TRIGGER, SEQUENCE, VIEW, MATERIALIZED VIEW, POLICY,
GRANT, REVOKE, `ALTER DEFAULT PRIVILEGES`, `OWNER TO`, or `ENABLE ROW LEVEL SECURITY`.
Migration SQL immutability is additionally enforced by the repository checksum gate
(`verifyLedgerCompatibility` pins).

Note (Part N): enum `TYPE USAGE` is not row access; the critical exposure gate is
**table privileges + schema CREATE**.

## UNMANAGED inventory

`notifications`/`price_alerts` remain classified `SUPABASE_PLATFORM_OR_EXTERNAL` and are
preserved as **observation** (fixture/evidence), not as an authorization pin. No pin in
this change can fail an authorize just because an external table changed.

## Fixture

`scripts/migration-history/production-security-r3b.fixture.json` is a **sanitized**
snapshot built from the real R3B audit log: 19 RLS rows, 10 managed policies, 6
unmanaged policies, 38 managed grants, 56 representative default-ACL rows (including
`supabase_admin` platform rows), `migrationRole=postgres`, and safe public-schema
state. No URLs, hostnames, project refs, passwords or tokens.

## Local rehearsal (Parts V/W)

`scripts/bootstrap/r3c-rehearsal.integration.mjs` uses a **new disposable database**
`ofertano_50ag4b_r3c_rehearsal` on `127.0.0.1:55433` (never 55432):

1. baseline + RLS applied; 9-row Production-like ledger fixture;
2. version-2 snapshot collected from the local DB, then the 6 R3B unmanaged policies
   and platform default-ACL rows are injected into the **snapshot only**;
3. the authorize gate returns `AUTHORIZED` with `outOfScopePolicyCount=6`,
   `managedPolicyCount=10`, `managedGrantCount=38`, `unsafeMigrationDefaultAclCount=0`;
4. local `migrate deploy` applies exactly Foundation + Control Plane;
5. post-migration: 10 Commerce tables present, 0 rows, **zero** effective
   `anon`/`authenticated` privileges on all of them (validating the default-ACL
   contract prediction empirically).

## Result observability

An `AUTHORIZED` result includes `securityScope: MANAGED_TABLES_ONLY`,
`managedTableCount`, `managedPolicyCount`, `outOfScopePolicyCount`,
`outOfScopePolicies` (tablename/policyname/cmd), `managedGrantCount`,
`unsafeMigrationDefaultAclCount`, and `publicSchemaCreateSafe`. These are
observational fields that do not weaken the verdict.