# 50AG.3 — Control Plane Runbook

Companion to `docs/commerce-distributed-canary-control-plane.md`. All operations are **local only** (`127.0.0.1:55433`) and fail closed. Production is never contacted.

## 0. Safety registration

Register the read-only guard against accidental Production access in every shell that runs this runbook:

```bash
export PRODUCTION_DB_READONLY=UNAVAILABLE_SAFE
```

The main-repo worktree `.env` holds Supabase production-like credentials — never use them. This worktree's `.env` carries only the local 50AG.3 URL.

## 1. Local databases (PostgreSQL 127.0.0.1:55433)

- `ofertano_50ag3_control_plane` — control plane (grants + append-only audit) and, for this mission's integration proof, the shadow write target.
- `ofertano_50ag3_forward` — forward-path migration check.
- `ofertano_50ag2_shadow` — pristine 50AG.2 fixture for `test:commerce:shadow:local` (truncate `"Product" CASCADE` before any run).

Run everything with the explicit local URL:

```bash
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55433/ofertano_50ag3_control_plane"
export DIRECT_URL="$DATABASE_URL"   # fresh-bootstrap.mjs reads DIRECT_URL || DATABASE_URL
```

## 2. Schema bootstrap and forward path

Create the database and apply the additive migration `20260918100000_commerce_canary_control_plane` in a clean DB (with `DATABASE_URL`/`DIRECT_URL` from §1; `fresh-bootstrap.mjs` reads `DIRECT_URL || DATABASE_URL` and enforces `127.0.0.1:55433` + allowlisted DB names):

```bash
npm run db:bootstrap:fresh            # fresh DB + forward migrations
npm run db:bootstrap:fresh:check      # classify-only (no mutation)
```

A bootstrap of `ofertano_50ag3_forward` exercises the same forward path. Exact schema/metadata equivalence and manifest hashes are rechecked by `fresh-bootstrap.mjs` (`scripts/bootstrap/manifest.json` pins the migration hashes; `scripts/bootstrap/fresh-bootstrap.mjs` allowlists `/^ofertano_50ag3_(control_plane|forward)$/`).

## 3. Control-plane test matrix

All with the explicit `DATABASE_URL` above (the tests' tripwires require exactly `127.0.0.1:55433/ofertano_50ag3_control_plane`):

```bash
# Unit (config, token, state, fail-closed parsing, redaction)
npx tsx src/services/commerce-intelligence/control-plane/control-plane.unit.test.ts

# Integration (hermetic state machine: claim/crash/finalize/dedupe/config/legacy delta 0)
npx tsx src/services/commerce-intelligence/control-plane/control-plane.integration.test.ts

# Multiprocess (3× 50-way claim race 1 winner / 49 blocked; crash stays CLAIMED;
# 6-process full flow = 1 authorized write; AT-MOST-ONE across processes)
npx tsx src/services/commerce-intelligence/control-plane/control-plane.multiprocess.test.ts

# Final audit: 10×50 independent rounds (real OS processes), writes
# docs/evidence/50ag3/control-plane-multiprocess-10-rounds.json
npx tsx src/services/commerce-intelligence/control-plane/multiprocess-audit-10-rounds.ts

# Full control-plane suite
npm run test:commerce:control-plane
```

Evidence JSONs regenerate into `docs/evidence/50ag3/`:
- In-process: claim/blocked/finalize p50/p95 (40 samples), legacy delta 0.
- Multiprocess: 150 claim samples with cross-process p50/p95, crash status, flow created/blocked counts.

## 4. Regression suite

```bash
# Shadow unit + local (re-pristine ofertano_50ag2_shadow first:
#   psql "postgres://postgres:postgres@127.0.0.1:55433/ofertano_50ag2_shadow" -c 'TRUNCATE "Product" CASCADE;')
npm run test:commerce:shadow
npm run test:commerce:shadow:local

# Offline ML/Magalu cluster ×5 and full suite ×3 (34/34 each) — run sequentially, without
# concurrent worker-heavy processes (a noisy neighbor on the box can trip the timing windows).
for i in 1 2 3 4 5; do npx tsx src/services/multistore-v2/offlineMlMagaluCluster.test.ts; done
for i in 1 2 3; do npm test; done

# Toolchain
npm run check:encoding
npx prisma validate
npx prisma generate
git diff --check
```

Hermetic local build (no Production secrets/services; synthetic public vars only):

```bash
mkdir -p "$HOME/.cache/ofertano-audit/50ag3a-build" && chmod 700 "$HOME/.cache/ofertano-audit/50ag3a-build"
cat > "$HOME/.cache/ofertano-audit/50ag3a-build/env" <<'EOF'
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55433/ofertano_50ag3_control_plane"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:55433/ofertano_50ag3_control_plane"
PRODUCTION_DB_READONLY="UNAVAILABLE_SAFE"
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:55434"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="TEST_ONLY_publishable_key_50ag3a_audit"
NEXT_PUBLIC_SITE_URL="http://127.0.0.1:55434"
EOF
chmod 600 "$HOME/.cache/ofertano-audit/50ag3a-build/env"
set -a; . "$HOME/.cache/ofertano-audit/50ag3a-build/env"; set +a
npm run build        # must finish 22/22 static pages with exit code 0
```

The two `NEXT_PUBLIC_SUPABASE_*` values satisfy `src/lib/supabaseClient.ts` module-load validation; prerender performs no network I/O against them. A local stub (`supabase-stub.cjs`, mission-owned port 55434, request logging) exists in the audit cache for the case where a future page fetches at build time; it must never point anywhere real.

Expected gates: every 50-process race has exactly 1 `CLAIMED` winner and 49 blocked, a different winner each round, and always 0 shadow writes by losers; crash leaves `CLAIMED` (no rearm); full flow ends `CONSUMED` with exactly 1 CREATE; legacy commerce counts remain delta 0.

## 5. Vercel Preview smoke — ALL flags OFF (no commit required; verify before merge)

Create a Preview deployment from `feature/commerce-canary-control-plane-20260918` with **every** control-plane and shadow flag OFF (defaults are OFF — do not set any of them):

- `COMMERCE_DISTRIBUTED_CANARY_ENABLED` — OFF (unset)
- `COMMERCE_SHADOW_CANARY_TOKEN` — unset
- `COMMERCE_SHADOW_ENABLED` — OFF (unset)
- `COMMERCE_SHADOW_MARKETPLACE` / `COMMERCE_SHADOW_EXTERNAL_ID` / `COMMERCE_SHADOW_MAX_WRITES` / `COMMERCE_SHADOW_DRY_RUN` — unset (or explicit OFF values)
- `DATABASE_URL` — the normal Preview database (shared remote DB is fine: the distributed path fails closed at `LOCAL_TARGET_REQUIRED`/`PRODUCTION_FORBIDDEN` before any DB access when enabled; with the flag OFF it returns `LOCAL_PROCESS_BUDGET` with zero grant access)

Smoke checks:
1. Run a real search; assert identical results/status to baseline (no ranking/price/SEO/count change).
2. Assert **zero** `COMMERCE_CANARY_*` / `COMMERCE_SHADOW_*` events and zero writes to any commerce table.
3. Assert no migration is applied to the shared Preview DB (this migration is local-only).
4. Confirm `PRODUCTION_DB_READONLY=UNAVAILABLE_SAFE` is registered in the Preview environment so no production-like write path can be touched.

Never set the distributed flag to ON in Preview or Production. The `productionControlModeRequirement` gate means a non-local deployment with the flag ON refuses to run unless shadow gate + token are present — and Production activation is explicitly out of scope for 50AG.3.

## 6. Commit / push (feature only)

```bash
git add docs/ src/services/commerce-intelligence/control-plane/ \
        src/services/commerce-intelligence/shadow/config.ts \
        src/services/commerce-intelligence/shadow/contracts.ts \
        src/services/commerce-intelligence/shadow/service.ts \
        src/services/multistore-v2/search.ts prisma/ scripts/bootstrap/ package.json
git commit -m "feat(commerce): add distributed-safe canary control plane (one-shot grant)"
git push -u origin feature/commerce-canary-control-plane-20260918    # no force
```

Then STOP. 50AG.4 is a separate mission and must not start from this one.

## 7. Backout (if anything looks wrong)

- Revert the feature branch (`git revert` / reset on the feature branch only; never touch `main`).
- The additive migration poses no backout risk locally; do not deploy or alter any shared DB.
- Verify `COMMERCE_DISTRIBUTED_CANARY_ENABLED` remains OFF in every environment; OFF requires no code path beyond the legacy 50AG.2 shadow integration.