# Raw Marketplace Listing Migration Audit

## Summary

This migration is additive and creates the raw-listing foundation introduced in the Missão 47 work. It does not apply to the database in this task and does not enable any dual-write behavior. The purpose is to make the schema delta audit-ready and reviewable as a separate SQL migration artifact.

## What the migration creates

The migration creates a new table named `RawMarketplaceListing` and a new enum named `RawListingStatus`.

The table includes:

- `id`
- `marketplace`
- `externalId`
- `sellerId`
- `sellerName`
- `sourceUrl`
- `affiliateLink`
- `title`
- `normalizedTitle`
- `brand`
- `modelNumber`
- `ean`
- `gtin`
- `mpn`
- `category`
- `attributes`
- `rawPayload`
- `image`
- `price`
- `oldPrice`
- `stock`
- `available`
- `active`
- `status`
- `fingerprint`
- `canonicalProductId`
- first-seen/last-seen/last-checked timestamps
- `createdAt` and `updatedAt`

The `RawListingStatus` enum contains:

- `DISCOVERED`
- `NORMALIZED`
- `MATCHED`
- `UNMATCHED`
- `STALE`
- `ARCHIVED`
- `ERROR`

## Safety properties

This migration is additive by design.

Important guarantees:

- `marketplace + externalId` is unique
- `canonicalProductId` is nullable
- multiple raw listings from the same marketplace can still link to the same canonical `Product`
- the existing `MarketplaceOffer` table remains intact
- the existing unique constraint `@@unique([productId, marketplace])` remains in place
- no existing Product or MarketplaceOffer row is deleted, updated, or backfilled
- no migration is executed in this session

## Relation to Product

The relation is optional:

- `RawMarketplaceListing.canonicalProductId` -> `Product.id`
- `ON DELETE SET NULL`
- `ON UPDATE CASCADE`

This is intentionally safer than cascading deletes, because the raw listing layer is a discovery and ingestion source. If a canonical product disappears, the raw listing should not be destroyed automatically.

## Indexing note

The table includes these indexes:

- `RawMarketplaceListing_canonicalProductId_updatedAt_idx`
- `RawMarketplaceListing_marketplace_active_idx`
- `RawMarketplaceListing_lastCheckedAt_idx`
- `RawMarketplaceListing_brand_modelNumber_idx`
- `RawMarketplaceListing_fingerprint_idx`
- unique index on `(marketplace, externalId)`

These are minimal operational indexes for new raw listing ingestion and lookup. They are not excessive for the current stage, though the `fingerprint` index may later be revisited if the dataset becomes extremely large.

## Locking and operational risk

This migration creates a new table plus several indexes. The main lock risk is limited to:

1. creating the new table
2. creating the new enum type
3. creating index structures on the new table
4. creating the optional foreign key to `Product`

Because the table is new, there is no destructive lock on existing Product or MarketplaceOffer tables. The foreign key addition is not expected to block the existing workload materially because it is added against a new table with no existing data.

## No dual-write and no active runtime behavior

This migration does not enable the raw listing feature in runtime logic.

It intentionally leaves the system in a dormant state:

- no new write path is activated
- no dual-write or shadow write path is enabled
- no `RAW_LISTING_DUAL_WRITE_ENABLED` flag is introduced
- no production environment change occurs

## Future rollout sequence

When the migration is eventually applied in a controlled environment, the operational sequence should be:

1. preflight and backup/checkpoint
2. apply migration in a controlled environment
3. confirm empty table and index health
4. smoke test current app behavior
5. keep dual-write disabled
6. observe production for several cycles
7. only then prepare a shadow or dual-write activation

## Rollback strategy

A future rollback would be appropriate only if the table is unused and no consumer has started depending on it. In that case, a reverse migration would drop the foreign key, indexes, and the table itself. This is not executed in this mission.

## Verification status

The migration SQL was generated as read-only audit output using Prisma diff. It was then stored in the migration directory as an SQL file, but the migration was not executed against any database.
