# Raw Listing Shadow Readiness

## Scope

This document captures the current state of the raw listing shadow path for the Ofertano catalog-first architecture. The objective is to prepare the project for a future, controlled activation of raw listing persistence without changing public search behavior, discovery ranking, or the legacy marketplace offer flow.

## Current architecture

The legacy canonical model remains the source of truth for public catalog behavior:

- `Product` continues to represent the canonical product identity
- `MarketplaceOffer` continues to be the active offer layer for the public experience
- `RawMarketplaceListing` is additive and isolated as a shadow data source only
- The raw listing path is intentionally behind a fail-closed feature flag

## Feature flag default

The central switch remains:

- `RAW_LISTING_DUAL_WRITE_ENABLED=false` by default

Accepted truthy values: `true`, `1`, `yes`
Accepted falsey values: missing, empty, `false`, `0`, `no`, or any other unexpected value

This flag is fail-closed: no implicit enablement is allowed.

## Guard behavior

The raw write path is gated by the following rules:

1. If the flag is disabled, the raw listing write path returns `DISABLED` immediately.
2. If `dryRun=true`, it returns `DISABLED` immediately even when the flag is enabled.
3. If the listing is missing a marketplace or externalId, it is rejected.
4. If the repository is missing, the write fails as isolated `ERROR` instead of crashing the legacy flow.
5. If the repository throws, the error is captured and returned as a non-fatal result.

The public and legacy flows are expected to continue normally when the raw listing path is skipped or fails.

## Idempotence and identity

The raw listing identity is defined by:

- marketplace
- externalId

This pair is the collision key for duplicate prevention. The repository contract exposes `findListingByMarketplaceExternalId` and `upsertRawMarketplaceListing` so the same listing is updated rather than duplicated.

## Dry run precedence

The dry-run path is always authoritative:

- `dryRun=true` blocks writes even when `RAW_LISTING_DUAL_WRITE_ENABLED=true`
- test-level or controlled environment flags still do not bypass the dry-run gate

## Failure isolation

A raw listing failure must never break:

- ingestion
- public search
- marketplace discovery
- ranking
- Multi Loja
- legacy product/offer persistence

The current implementation isolates raw listing failures by returning `ERROR` or `DISABLED` instead of throwing into the call chain.

## Sanitization

The payload sanitizer strips sensitive URL query parameters from:

- `sourceUrl`
- `affiliateLink`

It does not persist tokens, secrets, credentials, or session identifiers.

## Observability

The ingestion batch result exposes counters for raw listing writes and skips:

- `rawListingCreated`
- `rawListingUpdated`
- `rawListingRejected`
- `rawListingErrors`
- `rawListingDisabled`

These metrics make it possible to distinguish between enabled/disabled and failed writes without introducing a heavy new logging layer.

## Safe future enablement

A future activation can only be considered after the following conditions are met:

- flag default remains OFF
- dry-run blocks writes
- repository idempotence is validated
- duplicate externalId collisions are prevented
- legacy flow remains unaffected by raw listing errors
- no residual data is left behind from tests or synthetic records
- targeted tests and build validations remain green

## Known risks

- Raw listing persistence is still intentionally shadow-only and not part of the main public path.
- A repository failure is absorbed and logged as an isolated error, not as a critical system error.
- The feature remains off by default and should not be turned on without explicit human review.

## Explicit constraint

This mission does not authorize activation of `RAW_LISTING_DUAL_WRITE_ENABLED` in production. The default remains OFF and must stay OFF until a future, separate, authorized enablement plan is approved.
