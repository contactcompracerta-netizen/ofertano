# Raw Marketplace Listing Foundation

## 1. Objective

This mission introduces a non-destructive raw listing layer to prepare the catalog for 100M+ listing scale without altering public behavior. The key design choice is that raw marketplace listings are not canonical products; they are the source-of-truth ingestion layer used before normalization, matching, and canonical linking.

The current public search path remains unchanged. The new layer is a foundation for future mass ingestion and product linking, not an activation of Local-First or a new public search behavior.

## 2. Model Added

A new Prisma model is added as a safe foundation:

- `RawMarketplaceListing`

It stores one marketplace listing at one marketplace identity level. This allows the project to ingest raw marketplace facts before they are resolved to a canonical product.

Fields included are intentionally minimal and aligned with the actual project model:

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
- timestamps for creation, last-seen, and last-check

This is intentionally a foundation, not a full 100M-scale data model. It is the “raw layer” that can later evolve into a richer multi-seller, multi-offer system.

## 3. Identity and Uniqueness

The identity rule is built around:

- marketplace + externalId

This matches the required ingestion identity and prevents duplicate listing rows from the same storefront source. The model includes:

- `@@unique([marketplace, externalId])`

This is the correct raw-listing key to prevent repeated ingestion writes of the same listing.

The model also keeps `sellerId` optional. This allows multiple sellers in the same marketplace to coexist when their listing IDs differ, which is essential for multi-seller readiness.

## 4. Existing Schema Compatibility

The current `MarketplaceOffer` model remains fully intact. This mission does not delete or replace it.

This is a deliberate compatibility choice:

- `MarketplaceOffer` continues to serve the existing public/legacy flow
- `RawMarketplaceListing` provides the new mass-scale ingestion layer
- the old `@@unique([productId, marketplace])` remains in place for now

This gives time for a future cutover to a multi-seller representation without breaking the current architecture.

## 5. Relation to Product

`RawMarketplaceListing` includes an optional `canonicalProductId` relation to `Product`.

This allows a raw listing to exist in three states:

1. not matched yet
2. matched to a canonical product
3. rejected by identity rules

This is important because the raw layer should be able to store millions of discovered listings even before a product exists or before a canonical match is validated.

This is the foundation for future product linking without forcing a product to exist immediately for every listing.

## 6. Multi-Seller Readiness

The new model is compatible with the multi-seller future.

A product may eventually have:

- multiple Mercado Livre seller records
- multiple Amazon sellers
- multiple listings from the same marketplace
- multiple variants in the same family

The raw-listing layer supports this because it does not force the constraint `Product + Marketplace` to be unique at the raw listing level.

## 7. Indexing Strategy

The raw listing model includes a small, targeted set of indexes:

- `[marketplace, externalId]` unique guard
- `[canonicalProductId, updatedAt]`
- `[marketplace, active]`
- `[lastCheckedAt]`
- `[brand, modelNumber]`
- `[fingerprint]`

This keeps the core early-scale model effective without creating an excessive index set that would hurt write amplification at 100M rows.

## 8. Normalization Foundation

A new service module is added at:

- `src/services/catalog-listings/index.ts`

It exposes a normalized contract for raw listing input and future product search document projection.

The module includes:

- `normalizeMarketplaceListing()`
- `listingFingerprint()`
- `buildListingIdentity()`
- `buildProductSearchDocument()`
- `linkListingToCanonicalProduct()`

These functions are pure and do not hit the network or the database. They create a future contract for:

- listing normalization
- identity-based matching
- canonical linking decisions
- search-document projection

## 9. Canonical Linking Rule

The linking function preserves the existing identity invariants already used elsewhere in the project:

- reject cross-brand merges
- reject model conflicts
- reject accessory roles and replacement parts as main products
- keep unmatched listings separate from canonical products

This ensures that the new raw listing layer is compatible with the existing identity semantics and does not weaken the safety model.

## 10. Search Document Projection

The `buildProductSearchDocument()` helper creates a future search-document projection without executing any database or network access.

It includes fields such as:

- `productId`
- `title`
- `normalizedTitle`
- `brand`
- `model`
- `gtin`
- `ean`
- `mpn`
- `category`
- `aliases`
- `lowestPrice`
- `offerCount`
- `marketplaceCount`
- `updatedAt`

This is a pure projection that can later feed a search index without rewriting the public search path.

## 11. Dual Write and Future Rollout Plan

This mission does not enable dual-write or any new runtime behavior. The raw listing layer remains inactive in the public pipeline.

The intended future rollout is:

1. add raw listing table
2. keep `MarketplaceOffer` and `Product` untouched
3. validate raw listing ingestion in shadow mode
4. build a canonical linkage service
5. add search document projection
6. enable dual-write behind a feature flag only after validation

The suggested future feature flag is:

- `RAW_LISTING_DUAL_WRITE_ENABLED`

It remains future work and is intentionally not activated here.

## 12. Limitations

This foundation is intentionally narrow and non-destructive:

1. It does not replace the current `MarketplaceOffer` layer.
2. It does not enable any new public search or local-first route.
3. It does not alter the current product-marketplace unique constraint.
4. It does not create migration execution or database writes in runtime validation.

## 13. Recommended Next Mission

The next mission should focus on a staged rollout plan for the raw listing model:

- enable shadow ingestion of raw listing rows
- validate canonical matching in a read-only mode
- build a non-breaking product-linking pipeline
- then decide whether search-document indexing or a dedicated search layer is necessary for the next scale threshold
