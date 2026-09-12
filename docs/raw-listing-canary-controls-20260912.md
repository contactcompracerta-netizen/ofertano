# Raw Listing Canary Controls

## Objective

This mission adds a small canary layer around the raw listing shadow write path so a future activation can be scoped, measurable, and reversible without changing the public product search flow or the legacy marketplace offer path.

## Kill switch

The root switch remains:

- `RAW_LISTING_DUAL_WRITE_ENABLED=false` by default

If the global flag is not `true`, the raw listing path exits immediately with a skip result and does not create or update records.

## Canary shape

The canary layer is intentionally minimal and fail-closed:

- `RAW_LISTING_CANARY_MARKETPLACES`
- `RAW_LISTING_CANARY_EXTERNAL_IDS`
- `RAW_LISTING_CANARY_MAX_WRITES`

These are optional and safe-by-default. If the canary config is malformed or empty, the shadow write path must skip instead of writing.

## Marketplace allowlist

A marketplace allowlist can restrict writes to specific marketplaces only.

Example:

- `RAW_LISTING_CANARY_MARKETPLACES=mercadolivre,amazon`

The comparison is normalized and case-insensitive. If the allowlist is configured and the listing marketplace is absent from it, the write is rejected as a canary skip.

## External ID allowlist

The external ID allowlist is optional and exact-match based after normalization. It prevents accidental writes for unrelated external listings.

Example:

- `RAW_LISTING_CANARY_EXTERNAL_IDS=MLB123,MLB456`

If the allowlist exists and the listing external id is not included, the raw listing write is skipped.

## Max writes per process

The canary supports a strict process-level cap:

- `RAW_LISTING_CANARY_MAX_WRITES=1`

The counter is in-memory and process-scoped, which is sufficient for this mission and should be treated as a temporary guard only. Once the cap is reached, all subsequent writes are skipped until the process restarts.

## Dry run precedence

`dryRun=true` always wins. Even if the global flag is enabled and the listing meets the canary checks, dry-run prevents any write from being attempted.

## Fail closed versus fail open

- Invalid or incomplete canary config => raw listing path skips
- Legacy pathway => continues normally
- Repository failure => captured as `ERROR`; no public crash

The raw listing path is intentionally fail-closed and the legacy flow is fail-open.

## Observability

The raw listing path should distinguish between:

- `RAW_LISTING_CANARY_SKIPPED_DISABLED`
- `RAW_LISTING_CANARY_SKIPPED_DRY_RUN`
- `RAW_LISTING_CANARY_SKIPPED_MARKETPLACE`
- `RAW_LISTING_CANARY_SKIPPED_EXTERNAL_ID`
- `RAW_LISTING_CANARY_SKIPPED_LIMIT`
- `RAW_LISTING_CANARY_WRITE_SUCCESS`
- `RAW_LISTING_CANARY_WRITE_FAILED`

No secrets or credentials are written in logs. Only minimal metadata should be emitted.

## Test approach

The canary validation is intentionally implemented as unit-level tests with the repository mocked. This avoids any real database mutation and keeps the table count at zero.

## Safety rules

- `RAW_LISTING_DUAL_WRITE_ENABLED` must remain `false` by default
- no permanent activation is allowed in this mission
- no Vercel or `.env` changes are required to verify the canary logic
- no public search, ranking, Multi Loja, or legacy data flow changes are permitted

## Immediate disable path

To disable the canary immediately, remove or invalidate the flag and canary values. The default safe state is: all shadow writes skipped.

## Constraints

This mission does not authorize activation in production. It only prepares the raw listing path for a future, minimal, reversible canary rollout.
