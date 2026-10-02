# V11 Read-Only TLS Probe — Operational README

## Overview

V11 is a locally-executed read-only TLS probe that proves:

1. **DIRECT_URL** is available in the environment
2. **Normalization** (V10 contract) sets `sslmode=require` in memory only
3. **pg.Client** connects with TLS confirmed
4. **PrismaClient** connects with TLS confirmed
5. **Same normalized URL** is used by both probes (verified via SHA-256 fingerprint)

## What V11 Does NOT Do

- Does NOT execute `prisma migrate deploy`
- Does NOT execute any migration command
- Does NOT perform DDL or DML operations
- Does NOT access Production
- Does NOT call Vercel
- Does NOT write to `.env` files
- Does NOT modify DIRECT_URL
- Does NOT use `child_process`
- Does NOT expose secrets in reports

## Architecture

```
V11 Probe
│
├── Environment Validation
│   └── Verifies unambiguous environment signals
│
├── DIRECT_URL Presence Validation
│   └── Checks env var exists before proceeding
│
├── URL Normalization (V10 contract)
│   └── forceSslRequire() sets sslmode=require in memory only
│
├── Safe URL Fingerprint
│   └── SHA-256(normalized URL) — never reveals secrets
│
├── pg Read-Only Probe
│   ├── Create pg.Client with normalized URL
│   ├── Connect
│   ├── SET default_transaction_read_only = on
│   ├── SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()
│   └── Disconnect in finally
│
└── PrismaClient Read-Only Probe
    ├── Create PrismaPg adapter with normalized URL
    ├── Create PrismaClient with adapter
    ├── Connect
    ├── SET default_transaction_read_only = on
    ├── $queryRaw SELECT ssl FROM pg_stat_ssl...
    └── $disconnect in finally
```

## Safety Guarantees

### Query Allowlist
Only pre-approved SQL queries can be executed:
- `SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();`
- `SELECT current_setting('transaction_read_only') AS tr;`
- `SELECT 1 AS v11_probe_alive;`

Any query NOT in the allowlist → **FAIL_CLOSED**.

### Write Guard
SQL write patterns are structurally rejected:
- INSERT, UPDATE, DELETE, UPSERT
- CREATE TABLE, ALTER TABLE, DROP TABLE, TRUNCATE
- COPY FROM, MERGE, GRANT, REVOKE
- migrate deploy, db push, prisma seed

### No Subprocess
`child_process`, `exec`, `execSync`, `spawn`, `spawnSync` are structurally forbidden.

### Dry-Run Mode
Run with `--dry-run` or `V11_DRY_RUN=1`:
- No socket connections
- No DNS lookups
- No database connections
- No HTTP calls
- Instant completion

## Usage

```bash
# Install dependencies
cd v11-read-only-tls-probe && npm install

# Run dry-run mode (no network, no database)
npm run dry-run

# Run full probe (requires DIRECT_URL in env)
npm run probe

# Run tests
npm test

# Static safety scan
npm run static-scan

# Package
npm run package
```

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `DIRECT_URL` | PostgreSQL connection URL | For real probe |
| `VERCEL_ENV` | Environment detection | For production mode |
| `V11_DRY_RUN` | Enable dry-run mode | Optional |
| `V11_REQUIRE_PRODUCTION` | Fail if not production | Optional |
| `R3_LOCAL_REHEARSAL` | Local rehearsal mode | Optional |

## V10 Contract Compliance

The `forceSslRequire()` function exactly replicates the V10 contract:
1. Input must be non-empty string
2. Protocol must be postgres: or postgresql:
3. Must have hostname
4. Must NOT have hash fragment
5. sslmode=require is set via URLSearchParams.set
6. Other query parameters are preserved
7. Original URL string is never modified

## Audit Trail

All source files have SHA-256 hashes recorded in `SHA256SUMS`.
The package includes a `manifest.json` and `audit-report.md`.
