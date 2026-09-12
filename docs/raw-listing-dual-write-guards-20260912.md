# Raw Listing Dual-Write Guards

## Summary

This mission prepares the ingestion pipeline for a future raw listing persistence path without enabling it by default. The legacy MarketplaceOffer/Product flow remains the only active persistence path.

## Feature flag

The central switch is:

- `RAW_LISTING_DUAL_WRITE_ENABLED`

Behavior:

- Missing, empty, `false`, `0`, or `no` => disabled
- `true`, `1`, or `yes` => enabled
- All other values => disabled

This is fail-closed. The system must never infer dual-write as enabled from environment, stage, or runtime assumptions.

## Dry run precedence

`dryRun=true` always wins. When dry-run is active, the raw listing write path must not create, update, or touch database rows even if the feature flag is enabled.

## Idempotent repository contract

The repository contract is limited to:

- `findListingByMarketplaceExternalId`
- `upsertRawMarketplaceListing`
- `linkListingToProduct`
- `markListingStale`

Identity is the pair `(marketplace, externalId)`. The write path must be idempotent and avoid duplicates.

## Failure isolation

Raw listing persistence is intentionally a shadow path. If the raw listing write fails, the legacy persistence flow must continue without interruption. This mission does not permit a raw listing failure to break public search or the normal product/offer flow.

## Canonical linking

A listing may carry a canonical product link when there is a trusted match. Otherwise, `canonicalProductId` stays null. The logic must never create a new Product solely to satisfy the raw listing relationship.

## Sanitization

The raw payload path strips sensitive query parameters from `sourceUrl` and `affiliateLink` before persistence. It never writes tokens, secrets, or authorization headers.

## Observability

The ingestion batch result exposes counters such as:

- `rawListingCreated`
- `rawListingUpdated`
- `rawListingRejected`
- `rawListingErrors`
- `rawListingDisabled`

This keeps the behavior transparent without creating a new analytics table.

## How to enable later

Set the environment variable in a deployment environment to `true`, confirm the dry-run override is still respected, and keep the same fail-closed default. No change to `.env` or Vercel configuration is required in this mission.

## How to disable immediately

Remove the value or set it to any value outside the accepted truthy list such as `false` or `0`.

## Next mission recommendation

The next step is a focused shadow-readiness mission that validates raw listing capture behind the ingestion foundation without enabling the dual-write path in production.
