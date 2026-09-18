# 50AG.3 — Distributed-Safe Canary Control Plane (One-Shot Grant)

Stacked base: `c3e401c7fdefd4f9e434ef25b2bab24c4c2a7e1d`. One additive migration (`20260918100000_commerce_canary_control_plane`). Production remains on the previously deployed state and is never contacted or configured by this work — the control plane exists only in the local PostgreSQL at `127.0.0.1:55433`. The runbook in `docs/commerce-distributed-canary-runbook.md` registers `PRODUCTION_DB_READONLY=UNAVAILABLE_SAFE` and the Vercel Preview smoke procedure with **ALL flags OFF**.

This mission replaces the process-local `COMMERCE_SHADOW_MAX_WRITES` budget as the canary authority. In distributed mode, authorization is a **DB-backed one-shot grant**: at most one authorized canary attempt can ever execute across any number of processes. It is fail-closed, proven only locally, and never activated in Production.

The 50AG.2 document ("Future distributed-safe Production design — NOT implemented or activated") described this design as future work; it is implemented here as a local, disabled-by-default capability.

## Gates

| Setting | Default / contract |
| --- | --- |
| COMMERCE_DISTRIBUTED_CANARY_ENABLED | OFF; trimmed case-insensitive exact `true` only (`'true '`/`'True'` accepted; `'yes'`/`'1'` rejected). |
| COMMERCE_SHADOW_CANARY_TOKEN | Valid only when it satisfies `/^\S{8,512}$/u`. Stored exclusively as its SHA-256 hex digest in a UNIQUE `tokenHash` column; the plaintext token is never persisted, logged or emitted. No token-level timing comparison exists because lookup is exact-hash. |
| COMMERCE_SHADOW_ENABLED | Required ON: the distributed gate cannot bypass the shadow gate. |
| COMMERCE_SHADOW_MARKETPLACE | Missing/invalid blocks; exactly one Prisma marketplace enum value, no lists. |
| COMMERCE_SHADOW_EXTERNAL_ID | Missing/invalid blocks; one exact opaque ID (`/^[A-Za-z0-9_-]{1,128}$/`), no wildcard/prefix/list. |
| COMMERCE_SHADOW_DRY_RUN | `true`; only explicit `false` permits claims and writes. Garbage remains true. |
| VERCEL_ENV / deploymentEnv | `production` is always forbidden by the hard local tripwire. Production additionally requires `productionControlModeRequirement`: distributed flag ON, shadow gate ON and a valid token, or the whole path blocks with `PRODUCTION_REQUIRES_DISTRIBUTED_GRANT` / `PRODUCTION_SHADOW_GATE_OFF` / `PRODUCTION_TOKEN_INVALID`. |

Every execution refuses any target except `postgres[ql]://127.0.0.1:55433/{ofertano_50ag2_shadow,ofertano_50ag3_control_plane}` plus explicit `localDbNames` opt-ins. Port 55432 is never contacted. Connection URL query parameters/fragments are rejected. When `COMMERCE_DISTRIBUTED_CANARY_ENABLED` is OFF the orchestrator returns `LOCAL_PROCESS_BUDGET` mode **without touching the grant table at all** — legacy behavior remains byte-identical. No runtime flag bypasses the local policy.

Block reasons: `SHADOW_DISABLED`, `DISTRIBUTED_DISABLED`, `PRODUCTION_FORBIDDEN`, `LOCAL_TARGET_REQUIRED`, `TOKEN_MISSING`, `TOKEN_INVALID`, `MARKETPLACE_MISSING`, `EXTERNAL_ID_MISSING`, `MARKETPLACE_MISMATCH`, `EXTERNAL_ID_MISMATCH`, `IDENTITY_NOT_EXACT`, `DRY_RUN`, `GRANT_NOT_FOUND`, `ALREADY_CLAIMED`, `EXPIRED`, `DISABLED`, `CONSUMED`, `FAILED`, `ATTEMPTS_EXHAUSTED`, `DRY_RUN_ONLY`, `SHADOW_PREFLIGHT_FAILED`, `CLAIM_UNEXPECTED`, `FINALIZE_UNEXPECTED`, `PREFLIGHT_*`.

## Schema (additive, fail-closed by construction)

New enums `CommerceCanaryGrantStatus` (`ARMED`, `CLAIMED`, `CONSUMED`, `FAILED`, `EXPIRED`, `DISABLED`) and `CommerceCanaryAttemptKind` (`CLAIM`, `BLOCKED`, `CONSUMED`, `FAILED`, `EXPIRE`, `DISABLE`).

`CommerceCanaryGrant` carries `tokenHash` (UNIQUE, SHA-256 only), exact `marketplace`/`externalId`, `maxAttempts`, `attemptsClaimed`, `dryRunOnly`, `requireExactIdentity`, non-null `expiresAt` (TTL required), `claimedAt`/`claimedBy`/`consumedAt`/`failedAt`/`failureCode`/`resultObservationId`/`resultStatus`. `CommerceCanaryAttempt` is append-only audit (FK to Grant, ON DELETE CASCADE). There is deliberately **no FK to Product / OfferObservation / RawMarketplaceListing / MarketplaceOffer**: control plane and commerce ledger are decoupled (Part O).

CHECK constraints are enforced by the database, not only JS: `maxAttempts >= 1`, `attemptsClaimed >= 0`, `attemptsClaimed <= maxAttempts`, `tokenHash` length ≥ 32, `externalId` non-empty. Migration contains no DROP/RENAME/backfill and mutates no commerce data.

## State machine

```
 ARMED → CLAIMED → CONSUMED / FAILED
 ARMED → DISABLED / EXPIRED   (operator / controlled expiry)
```

No automatic path returns to ARMED. `FAILED`, `CONSUMED`, `DISABLED`, `EXPIRED` are terminal. A failed canary requires a **new explicit grant/token** — no auto-rearm, no retry. A crash after claim leaves the grant `CLAIMED` forever (no lease reaper, no auto-recovery): AT-MOST-ONE is prioritized over availability (Part I).

## Atomic claim

One row-level `UPDATE ... WHERE ... RETURNING` performs every check in a single statement: `tokenHash` exact match, status `ARMED`, exact marketplace, exact externalId, `expiresAt > NOW()`, `attemptsClaimed < maxAttempts`, `dryRunOnly = false`. PostgreSQL row locking serializes contenders: exactly one `UPDATE` matches the pre-claim state; every other contender sees zero rows and is classified by a follow-up `SELECT`. A subsequent claim attempt on a `CLAIMED` grant is blocked (`ALREADY_CLAIMED`); on a finalized grant, blocked by its terminal status. There is no SELECT-then-UPDATE race window.

## Fail-closed orchestration

`runCommerceDistributedCanary` executes in strict order:

1. Distributed flag OFF → `LOCAL_PROCESS_BUDGET` result with **zero grant access** (no table read/write).
2. Shadow gate, token state, exact marketplace, exact externalId, local-only target and production-control-mode gates — each divergence returns `BLOCKED` before any grant access.
3. Dry-run preflight through the real shadow write path (0 writes, 0 claims) validates input and requires identity `EXACT`.
4. Config dry-run → `DRY_RUN`, still no claim (Part M separation).
5. Atomic global claim (`claimCanaryGrant`).
6. Claim failed → zero shadow writes; `BLOCKED` audit row recorded.
7. Claim won → the single authorized shadow canary runs through `runCommerceShadowCanary` (unchanged write path, `localDbNames` opt-in).
8. `CREATED` / `DEDUPED` → finalize `CONSUMED` with `resultObservationId`.
9. Anything else, or any post-claim exception → finalize `FAILED` with a bounded `failureCode` (Prisma trigger violations surface as `P2039`). **Never auto-retry.**

Crash semantics: if the process dies between claim and finalize, the grant stays `CLAIMED` and no other process can ever attempt it — by design.

## Finalization

Only the claimant (`claimedBy == executionId`) can move `CLAIMED` to a final state. Idempotent: repeated finalize on an already-final grant never reopens or mutates it (`ALREADY_FINALIZED`), and a non-claimant attempting it gets `NOT_CLAIMANT`.

## Logging and audit

Structured events only: `COMMERCE_CANARY_GRANT_BLOCKED`, `COMMERCE_CANARY_GRANT_CLAIMED`, `COMMERCE_CANARY_CONSUMED`, `COMMERCE_CANARY_FAILED`. Fields are marketplace, `externalIdSafe` (SHA-256 prefix 12), reason, grant id, execution id and duration. Tokens and hashes never appear. Logging failures degrade to a sanitized failure record and can never throw into the caller.

Append-only `CommerceCanaryAttempt` rows record `CLAIM`, `BLOCKED`, `CONSUMED`, `FAILED` with reason, execution id and claim latency. Audit assertions include the blocked rows from retries.

## Integration and isolation

`scheduleCommerceDistributedCanaryAfterBarrier` is called in `searchMultistoreV2` after the RESPONSE barrier on the same unchanged result object. OFF → byte-identical delegation to the existing 50AG.2 `scheduleCommerceShadowAfterBarrier`; the local behavior and tests are unchanged. ON → fail-closed distributed orchestration registered via Next `after()` (Vercel requires after-context, else throws `AFTER_CONTEXT_REQUIRED`; local CLI falls back to a zero-delay timer). Schedule/worker errors emit `COMMERCE_CANARY_FAILED` and never throw into the caller or change its response. Background execution is not a durable queue.

Timing bounds (500ms statement timeout, 500ms pool wait, 1500ms transaction / 500ms lock timeout, 500ms wait, 2000ms write transaction) are laboratory containment, not a Production SLA.

## Local proof

Evidence in `docs/evidence/50ag3/`:

- **In-process** (`control-plane-inprocess.json`, 40 samples): claim p50 ≈ 3.9ms / p95 ≈ 8.0ms; blocked p50 ≈ 4.9ms / p95 ≈ 10.3ms; finalize p50 ≈ 4.1ms / p95 ≈ 9.8ms. Legacy delta 0.
- **Multiprocess** (`control-plane-multiprocess.json`, 150 claim samples): 3× 50-way claim races, each with exactly 1 winner and 49 blocked (`ALREADY_CLAIMED`/`CONSUMED`), a different winner each round; crash leaves the grant `CLAIMED` (no rearm); 6-process full-flow race = 1 `CREATED` + 5 blocked (zero shadow writes outside the winner); cross-process claim p50 ≈ 652ms / p95 ≈ 1007ms including worker cold boot. These are observed local measurements, no global or Production latency claim.
- **Final audit — 10×50** (`control-plane-multiprocess-10-rounds.json`): 10 independent rounds × 50 concurrent OS processes against fresh grants (marketplace AMAZON, externalId SHADOW-ASIN1, new synthetic token per round, ARMED, maxAttempts=1). Every round: exactly 1 winner and 49 `ALREADY_CLAIMED`, grant row `CLAIMED` with `attemptsClaimed=1` and `claimedBy=winner`, zero commerce deltas (Product/MarketplaceOffer/PriceHistory/RawMarketplaceListing/OfferObservation). Summary 10/10 success, 500 processes, 10 claims, 490 blocked; claim latency min 31ms / p50 497ms / p95 1218ms / max 4304ms across 500 samples (includes tsx worker cold boot). Regenerate with `npm run test:commerce:control-plane:audit:10-rounds`. Local-only observations, never a Production SLA.

Test files scrub the dedicated `ofertano_50ag3_control_plane` database at start (TRUNCATE grants/attempts; delete shadow-created commerce rows; keep fixture products/EAN), so reruns are deterministic. Workers import the real production functions (`claimCanaryGrant`, `runCommerceDistributedCanary`) — no duplicated SQL. The failflow uses a distinct external id (`SHADOW-ASIN2`) and asserts `failureCode = 'P2039'`.

## Explicitly NOT done

- No Production activation, token or grant.
- No auto-retry, no auto-rearm, no lease expiry mid-write, no recovery of `CLAIMED` grants.
- No change to the legacy search response, ranking, prices, SEO, counts or affiliate links.
- No wildcard matching, no process-local budget authority in distributed mode.