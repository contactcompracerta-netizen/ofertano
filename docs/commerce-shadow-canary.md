# 50AG.2 — Bounded Shadow Identity and Offer Ledger

Stacked base: `2cce80cfadcf14fc71884134b701a4d73595b5e2`. No new schema migration. Production remains on `388223c2cdac670148eaf3a5bd5edd06c04dfbcf`, with no 50AG tables.

Shadow observes the already acquired legacy snapshot. It never creates or updates Product, MarketplaceOffer, PriceHistory or RawMarketplaceListing. It never calls marketplace APIs, changes the legacy response, ranking, displayed price, best offer, count, SEO, URL or public affiliate link. Synthetic Products are created only by the disposable local fixture setup, outside the pipeline.

## Gates

| Setting | Default / contract |
| --- | --- |
| COMMERCE_SHADOW_ENABLED | OFF; trimmed case-insensitive exact true only. |
| COMMERCE_SHADOW_MARKETPLACE | Missing/invalid blocks; exactly one Prisma marketplace enum value, no lists. |
| COMMERCE_SHADOW_EXTERNAL_ID | Missing/invalid blocks; one exact opaque ID, no wildcard/prefix/list. |
| COMMERCE_SHADOW_MAX_WRITES | 0; canonical safe integer >=0. Invalid/negative/fraction/scientific notation blocks. |
| COMMERCE_SHADOW_DRY_RUN | true; only explicit false permits writes. Garbage remains true. |
| COMMERCE_SHADOW_REQUIRE_EXACT_IDENTITY | true; explicit false is parsed, but v1 observation writes remain EXACT-only. Nonexact diagnostics require dry-run. |
| COMMERCE_SHADOW_RECORD_CONFLICTS_ENABLED | OFF; explicit true separately authorizes conflict-only diagnostic transactions. |

Every execution additionally refuses `VERCEL_ENV=production` and any target except `postgres[ql]://127.0.0.1:55433/ofertano_50ag2_shadow`. Port 55432 is never contacted. An enabled Preview with the shared remote DB is also blocked. Connection URL query parameters/fragments are rejected. The default client is dedicated to the validated local URL and never reuses the legacy Prisma singleton. No runtime flag bypasses this hard local policy. OFF, marketplace/ID mismatch and maxWrites=0 return before DB client access. Dry-run resolves identity through bounded reads in the local fixture and produces the complete plan with zero persisted rows.

Writes require all four foundation gates: identity graph, offer ledger, price truth and trust signals. Variant creation separately requires the variants gate, EXACT identity, at least one semantic variant dimension beyond model number and no conflicting normalized attribute values. Empty/arbitrary JSON alone never creates a variant.

Eligibility reasons include SHADOW_DISABLED, MARKETPLACE_NOT_ALLOWED, EXTERNAL_ID_NOT_ALLOWED, WRITE_BUDGET_ZERO, DRY_RUN, IDENTITY_NOT_EXACT, MISSING_EXTERNAL_ID, INVALID_INPUT, RAW_NOT_REQUIRED, READY, LOCAL_TARGET_REQUIRED, PRODUCTION_FORBIDDEN, FOUNDATION_FLAG_OFF, BUDGET_EXHAUSTED and CONFLICT_RECORDING_DISABLED. RAW_NOT_REQUIRED is an informational eligible outcome, not an activation gate. Missing Raw reference stays null; no Raw writer is called.

## Identity policy v1

EXACT requires a single consistent existing Product supported by a validated GTIN/EAN/UPC graph match, an unambiguous marketplace/external ID graph or existing legacy offer link, or exact brand-scoped MPN. GTIN representations compare their standard zero-padded equivalence; only genuinely observed identifiers are persisted. Stored identifier raw values are independently validated. Multiple strong candidates, truncation at the bounded candidate limit, missing candidate or observed brand contradiction are conflicts. No candidate is arbitrarily selected.

Brand/model graph evidence alone is HIGH diagnostic confidence with no Product attachment. Title similarity never becomes EXACT. Missing links are UNRESOLVED with null Product. No inferred/manual assertion is automatically generated. Identity is checked again inside the write transaction; changed evidence fails observably and rolls back.

The v1 write policy blocks HIGH/unresolved observation writes even if require-exact is explicitly false; the flag cannot bypass this mission’s conservative policy. A conflict can produce only a conflict plan by default. Recording it requires the extra conflict flag, all regular allowlists/local/foundation gates, non-dry execution and a reserved budget unit. It records OPEN IdentityConflict, consumes one diagnostic transaction and returns BLOCKED/IDENTITY_NOT_EXACT; observation count stays unchanged. No automatic resolution occurs.

## Transaction and dedupe

One write budget unit means one committed canary transaction containing the parallel foundation rows, not one SQL row. The budget is **PROCESS_LOCAL_ONLY**. Reservations are synchronous before the first mutation and count in-flight work. Successful creation consumes one; failed/rolled-back work releases its reservation. Configuration changes do not replenish the default process budget. Tests use explicit fresh budget instances for controlled meaningful changes.

A spent budget may still perform bounded reads and return DEDUPED for the identical existing state, with no mutations or new evidence/signals. New states require remaining budget. A transaction advisory lock per marketplace/external ID serializes cooperating local shadow writers. The unique ledger key remains the final duplicate guard. Two independent processes can still spend separate budgets for different states: this is not a Production global quota.

All identifiers (only absent valid observations), optional variant, observation + nested components, evidence and objective signals are in one interactive transaction. Every mutation uses the foundation repositories. Repository append preserves atomic nested component creation, returns an existing state without mutation and uses the persisted-state fingerprint. The entire transaction rolls back on component/evidence/signal failure. No direct scattered INSERTs exist in the pipeline.

Fingerprint v1 is preserved for existing inputs without attributes. Shadow uses v2 to include normalized observed attributes as commercial state and exclude component source provenance from state identity. Order of attribute/provenance keys, capture time, internal identity IDs and provenance do not create a new state. Price/stock/availability/seller/components or semantic attributes do. This preserves the 50AG.1 state-compression policy: repeated visits to an already recorded state reuse that row, without heartbeat/recurrence timestamps.

## Price truth and signals

Observed sale price becomes SALE_PRICE. Old price becomes LIST_PRICE only with an explicit compatible list-price assertion. Shipping is added only when known, including genuinely observed zero. Coupons, PIX and membership benefits must be observed; unknown eligibility is retained as unknown and never reduces the total. Installment total requires a complete positive-count observation. No missing amount is replaced with zero.

Effective-price arithmetic uses the foundation integer-millionth implementation. FINAL_EFFECTIVE_PRICE is explicitly **derived**, carries the computed truth state and structured missing/conditional explanation, and has null amount when UNKNOWN. A partial known subtotal stays PARTIAL and cannot be presented as a complete payable total. The pipeline does not feed public displayed prices.

Objective signals only: IDENTITY_EXACT, IDENTIFIER_VALID, SELLER_PRESENT, PRICE_OBSERVED, AVAILABILITY_OBSERVED, SOURCE_URL_PRESENT, AFFILIATE_LINK_PRESENT and PRICE_COMPONENT_COMPLETE. Absence/uncertainty is UNKNOWN. No seller quality, buying safety, aggregate trust score or best-offer assertion is invented.

Observation provenance is whitelisted: source flow, shadow version, capture timestamp, marketplace, external ID, identity method and fingerprint/version. Caller-supplied extra provenance is ignored. Shadow URL copies remove userinfo, fragments and credential-like query keys; this does not modify the legacy/public URL or affiliate link. Logs never contain those URLs or raw payload/identifier values, affiliate tracking tokens, arbitrary exception messages or stack traces.

## Integration, isolation and time budget

A single dedicated integration function is called in `searchMultistoreV2` after the RESPONSE barrier and before returning the same original result object. It selects only the one explicitly allowed acquired raw candidate and snapshots known legacy fields; it does not traverse/refetch opaque raw payloads or invent shipping/stock/availability. The Brazilian legacy price contract supplies BRL currency. Other fields remain absent when the acquisition contract does not provide them.

With the gate OFF, no snapshot, timer, worker or DB access occurs; the Next after runtime and worker module are loaded only after the enabled local gates. after is registered synchronously; the worker import executes inside the post-response callback. With a valid local gate, Next.js `after()` registers work post-response. Local CLI, which has no request context, uses a zero-delay timer fallback; Vercel never uses that fallback. Schedule/worker errors emit COMMERCE_SHADOW_FAILED and cannot throw into the caller or change its response. Background execution is not a durable queue or delivery guarantee.

Identity reads have a 500ms statement timeout, 500ms max pool wait and 1500ms transaction timeout. Writes additionally have a 500ms lock timeout, 500ms max wait and 2000ms transaction timeout. Writes are awaited only in local direct test calls, never by the search response. These bounds are laboratory containment, not a Production SLA. Future activation requires durable post-response execution and measured latency/cold-start review.

Structured events: COMMERCE_SHADOW_ATTEMPT/BLOCKED/DRY_RUN/CREATED/DEDUPED/FAILED/CONFLICT. Fields are marketplace, external ID hash prefix, controlled reason, confidence, fingerprint prefix, duration and transaction write count. Logging failures fall back to a sanitized failure record. No Analytics or public telemetry system is modified.

## Local proof

Use only 127.0.0.1:55433 with `ofertano_50ag2_shadow` and the separate forward-bootstrap fixture. Fresh bootstrap resolves only the seven legacy baseline migrations; the existing 50AG.1 migration remains a real forward deploy with applied_steps_count=1. No 50AG.2 migration exists. Exact metadata/schema equivalence is rechecked.

Two synthetic Products are seeded before measuring the canary deltas, one primary and one reserved for the conflict test; no Production data is copied. The conflict identifier is attached by fixture setup only. Tests cover all gates, OFF zero reads, dry-run zero mutations, identity EXACT/HIGH/unresolved/conflicts, one-budget transaction, repeated/irrelevant dedupe, meaningful price change, concurrency, component-trigger-induced rollback, trust/provenance sanitation, legacy adapter acquisition response equality and unchanged legacy counts. A local temporary failure trigger/function is removed before final schema comparison.

Measurements in `docs/evidence/50ag2/local-canary.json` are observed local pure-plan p50/p95 (200 samples), interactive write transaction duration and dedupe transaction duration. Identity DB lookup is separately timed and excluded from the pure-plan benchmark. No global throughput or Production latency is claimed. Legacy equality ignores only acquisition elapsedMs telemetry.

## Future distributed-safe Production design — NOT implemented or activated

Choose a DB-backed one-shot canary authorization row, keyed by a unique random canary token hash. Freeze marketplace, exact external ID, permitted identity, code/schema version, expiration, maximum=1, status (DISABLED/ARMED/CONSUMED/REVOKED) and consumed observation ID. A future COMMERCE_SHADOW_CANARY_TOKEN carries the corresponding authorization; never log/persist the plaintext token in evidence, URLs or client state. The current implementation has no Production token activation path.

Inside one transaction, lock the authorization row with SELECT FOR UPDATE; verify ARMED/not expired/bindings/remaining budget and current exact identity; atomically consume the remaining unit together with observation/components/evidence/signals; store the created ID and COMMIT. A unique token/authorization binding prevents independent workers minting parallel budgets. Retries read the consumed observation and return DEDUPED without spending again. Failure rolls back both budget consumption and ledger writes. A per-token advisory transaction lock may supplement row locking but cannot replace a persisted authorization/tombstone. No automatic lease expiry or process restart replenishes a consumed one-shot token.

A short transaction row lock is simpler than an external lease: no lease can expire mid-write and permit a second worker. If long-running workflows later need leases, require fencing/version checks and finalize the claim in the same authoritative transaction. Redis counters detached from the SQL commit would require compensation and cannot alone prove exactly one committed canary.

This design needs additional schema/infra in a separate reviewed mission. It is deliberately not deployed here. The current local hard tripwire must also be explicitly revised in that future mission; flags alone cannot authorize Production.

## Mandatory future activation sequence

1. Reviewed 50AG.1/50AG.2 code integrated in main through a separate authorization; no merge here.
2. Apply additive 50AG schema and later distributed control-plane migration to Production in a separate mission; no migration here.
3. Keep every graph/ledger/truth/signal/shadow/Raw/auto catalog flag OFF after migration.
4. Verify a distributed-safe atomic one-shot write budget and authorization row; process memory is insufficient on Vercel.
5. Bind one explicit external ID, no wildcard/list.
6. Bind one explicit marketplace.
7. Perform an authorized read-only dry-run first and review its sanitized plan.
8. Require an already existing legitimate Product and unambiguous exact identity. Current Production has Product=0: future identity prerequisites require separate explicit authorization, never automatic Product creation by shadow.
9. Prove zero public response/ranking/price/link/SEO and legacy side effects.
10. Read after write and prove one observation, coherent components/evidence/signals, consumed authorization and unchanged legacy counts.
11. Disable one-shot authorization persistently and switch master/foundation gates OFF; retain the consumed tombstone.
12. Review containment/rollback before any activation: revoke remaining authorization, stop scheduling, cancel/rollback faulty in-flight work if independently authorized, retain immutable audit rows, and avoid deleting/rewriting legacy data or dropping tables as rollback. Runtime flag changes cannot reliably cancel an already started transaction; the atomic global quota provides the bound.

No Production canary, merge, Production migration/deploy, Raw or auto catalog activation is executed. Next safe mission is 50AG.3 — distributed-safe Production canary control plane; it is not started automatically.

## 50AG.2 measured laboratory result

The full offline matrix passed, including the real acquisition boundary: legacy responses were deep-equal across OFF, dry-run and local write, excluding only acquisition elapsedMs telemetry. First authorized transaction: 1 observation, 6 components, 1 variant, 1 new identifier, 1 evidence and 8 signals. Identical input and reordered attribute/provenance keys returned DEDUPED; price change returned CREATED after an explicitly reset local budget. Concurrent identical attempts returned CREATED/DEDUPED with one observation. Component failure rolled back the entire transaction and released the budget. Conflict writes were blocked by default; explicit diagnostic authorization created only one OPEN conflict.

Across the complete matrix: synthetic Product count stayed 2, and legacy offer/history/Raw deltas stayed 0. Four observations total reflect separately controlled fixture scenarios, not a shared one-shot budget. No Raw row was created.

Observed local timings, 200 pure-plan samples: p50 1.012ms, p95 1.877ms; first write transaction 255.553ms; dedupe transaction 26.635ms. These measurements are fixture-specific and establish no Production SLA. Fresh/forward metadata equivalence passed again after removal of the local failure trigger.

## Official validation hold — classification H

The unchanged official npm test failed at the global persist.test watchdog (20000ms). The same test failed in a separate isolated run on immutable 50AG.1 base 2cce80cf, and restricting only the test process CPU affinity did not resolve it. Earlier full attempts encountered strict wall-clock assertions in abort/ML fast-path/hydration; the final full run passed those and reached persist. No assertion, clock, watchdog, official npm script or public search algorithm was changed.

The 21 preceding official scripts passed in that full run. The 12 scripts after persist were subsequently run separately and passed; this does not constitute an official 34/34 pass. Shadow pure/SQL matrix, foundation, bootstrap/schema, default local client and real local background fallback passed. The implementation remains reviewable on a feature Preview with every gate OFF. READY_FOR_50AG3=NO until an unchanged official 34/34 run passes. Production activation remains prohibited.
