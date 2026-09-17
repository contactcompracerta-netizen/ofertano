# Commerce Intelligence Foundation — 50AG.1

Base: `388223c2cdac670148eaf3a5bd5edd06c04dfbcf`.

Raw Commerce → Identity Graph → Canonical Product / Variants → Offer Observation Ledger → Price Truth → Trust Signals → future history, forecast, recommendation and lifecycle layers.

This mission adds structure only. No imports from legacy flows, routes, UI changes, automatic Products, Raw activation, dual write, backfill, production migration or production deployment. Legacy Product semantics and all existing writers remain intact.

## Models

| Model | Purpose |
| --- | --- |
| ProductIdentifier | Observed raw value, normalized lookup value, type, marketplace and brand scope, source and confidence. Shared identifiers are allowed so conflicts remain expressible. |
| ProductVariant | One commercial variant per `(productId, variantKey)` with normalized attributes. |
| IdentityEvidence | Append-oriented explanation of matches and rejected associations, including raw JSON. |
| IdentityConflict | Open conflict referencing products, identifier and evidence; never automatically resolved. |
| OfferObservation | Immutable observed offer state, source and attribution, seller, exact decimal prices, nullable availability, capture time and provenance. |
| OfferPriceComponent | Distinct observed sale/list/shipping/coupon/PIX/membership/installment/final amounts with truth state and eligibility conditions. |
| TrustSignal | Extensible signal type string, explicit state, JSON value and evidence, typed scope plus optional foreign key. No aggregate score. |
| ProductRelation | Directed typed relationship with confidence and evidence; no population job. |

`ProductPassport` is a TypeScript read contract covering canonical identity, identifiers, variants, evidence/conflicts, observation/components/price truth, signals, relations and provenance. No table or public endpoint.

## Flags and repositories

`COMMERCE_IDENTITY_GRAPH_ENABLED`, `COMMERCE_VARIANTS_ENABLED`, `OFFER_LEDGER_ENABLED`, `PRICE_TRUTH_ENABLED`, `TRUST_SIGNALS_ENABLED` default OFF. Only trimmed, case-insensitive exact `true` enables a flag. Missing, empty, garbage, `1` and `yes` stay OFF.

Repositories obtain their injected Prisma client only after their own flag gate. No DB reads or writes when OFF. Graph gates identifiers, evidence, conflicts and relations; variants gates variant upsert; ledger gates observation append; price truth additionally gates atomic nested component creation; signals gates signal append. Cross-model writes verify additional flags. No observer/evidence/signal update/delete API is exposed.

Observations create components atomically. The unique `(marketplace, externalId, fingerprint)` enforces concurrent dedupe; an identical capture returns the existing row. This is state-level compression: returning to a previously captured identical state does not create a heartbeat or new recurrence entry. Future history work must explicitly revise that policy if it needs every state transition timestamp. Identity attachment and capture timestamps do not define a new commercial state.

## Pure functions

- `extractIdentifiers`: only observed values; preserves raw value and validation status; standard GTIN/EAN/UPC length and check-digit validation and ISBN-10/13 validation. Invalid identifiers remain evidence, never accepted by the repository. MPN/model/SKU matching requires brand; marketplace IDs require marketplace.
- `normalizeAttributes`: deterministic aliases, Unicode/whitespace/case normalization and common unit spacing. Conflicting values are preserved in sorted form rather than selected by arrival order. No AI, DB, environment or network.
- `buildVariantKey`: versioned SHA-256 over normalized sorted attributes. Unknown attributes are excluded from v1; expanding identity dimensions requires a future key version.
- `buildObservationFingerprint`: versioned SHA-256 of seller, commercial text/links, prices/currency, stock, availability and sorted components with sorted condition keys. Excludes capture times, provenance and internal identity references. Component amounts use canonical six-decimal representation.
- `computeEffectivePrice`: sale price plus known shipping minus explicitly eligible coupon/PIX discounts, or an observed eligible final effective price. Decimal arithmetic uses integer millionths. List, membership and installment values are never silently substituted for sale price. Missing shipping yields PARTIAL; absent base yields UNKNOWN; estimated components yield ESTIMATED; complete eligible observed inputs yield EXACT. Mixed currencies, duplicate component types, malformed or negative effective values yield UNKNOWN. Conditional benefits remain structured explanation and do not silently reduce price.

## Every FK decision

All new FKs use `ON UPDATE CASCADE` to preserve attachment after an explicit ID correction. No new `ON DELETE CASCADE` exists.

| Owner → target | ON DELETE | Reason |
| --- | --- | --- |
| ProductIdentifier → Product | RESTRICT | Identifier ownership cannot silently disappear; explicit archive/review first. |
| ProductIdentifier → ProductVariant | SET NULL | Preserve identifier evidence after variant removal. |
| ProductVariant → Product | RESTRICT | Prevent accidental loss of commercial variant ownership. |
| IdentityEvidence → Product / ProductVariant / RawMarketplaceListing | SET NULL | Historical evidence survives every target deletion. |
| IdentityConflict → Product A / Product B / ProductIdentifier / IdentityEvidence | SET NULL | Preserve recorded conflict even if an attachment disappears. |
| OfferObservation → Product / ProductVariant / RawMarketplaceListing / MarketplaceOffer | SET NULL | Ledger survives legacy offer cascades and identity deletions. |
| OfferPriceComponent → OfferObservation | RESTRICT | Observed price decomposition cannot be erased through parent deletion. |
| TrustSignal → Product / RawMarketplaceListing / OfferObservation / MarketplaceOffer | SET NULL | Evidence survives; `scopeType/scopeId` remains original attribution. |
| ProductRelation → from Product / to Product | RESTRICT | Directed graph relationship requires explicit lifecycle handling. |

Append-only is the internal writer contract, not an SQL permissions/trigger guarantee. FK SET NULL can change references while commercial state/provenance is preserved. Direct privileged SQL can still mutate these tables; future activation must define database roles, auditing and retention.

## Bootstrap v2

`initial-schema.sql` and all seven historical migrations remain byte-for-byte unchanged. Manifest v2 distinguishes immutable `baselineMigrations`, `baselineDDLHash`, `baselineSchemaSHA256`, `baselineSourceSHA` from `forwardMigrations` and `currentSchemaSHA256`.

Fresh flow: verified legacy DDL → `migrate resolve --applied` ONLY for baseline → `migrate deploy` for every forward migration → migration status → schema diff. Forward migration checksums are pinned but never manually marked applied. Complete migrated classification compares the entire repository inventory, not a permanent count of seven. Partial/incomplete/unrecognized ledgers refuse bootstrap. A baseline-only existing DB uses `prisma migrate deploy` directly; the bootstrap deliberately does not treat pending migrations as already canonical.

Every DDL target must be `127.0.0.1:55433` and a named disposable DB. Port 55432 is refused before connection. Socket address and port are verified. An advisory lock serializes bootstrap. Manifest inventory, schema/DDL/checksums and migration ordering are fail-closed. Unexpected errors produce a nonzero exit status.

The real PostgreSQL integration script `scripts/bootstrap/commerce-foundation.integration.mjs` requires mission-owned empty forward/partial/unknown fixtures, asserts seven baseline resolved ledger rows (`applied_steps_count=0`) plus one forward executed row (`applied_steps_count=1` and finished timestamp), preserves baseline ledger timestamps, checks A/B/C/D classifications, tripwire and exact fresh/forward metadata equality: tables, columns, enums, defaults, nullability, indexes, constraints and FK update/delete actions.

Build and postinstall only generate Prisma Client; they never migrate or bootstrap. Preview uses flags OFF and no DDL.

## Scale review

Designed for 1M Products, 10M listings/offers and 100M observations. Identifier lookup indexes use type/value/brand and marketplace/value; no global GTIN unique that would hide conflicts. Variant unique index covers product-prefix access. Observation timeline indexes use identity/offer/listing plus capture time; marketplace/external ID plus capture time supports merchant chronology. Unique fingerprint index enforces dedupe, but is not a time index. No redundant standalone product index on observations. Nullable FK indexes avoid delete scans. Signal scope/type/time index supports individual signal history, with separate FK indexes for deletion handling. JSON stores evidence, never primary identity lookup.

No partitioning yet. At 100M rows, ledger retention, BRIN/partition evaluation, index size, write amplification and production EXPLAIN/ANALYZE require measured workload review before activation. No performance benchmark is claimed.

## Future activation

50AG.2 may design a bounded shadow identity / ledger canary with explicit source allowlists, write budgets, eligibility policy, evidence review and rollback. That mission is not executed here. Flags, Raw, auto catalog, Production schema/code/environment and main remain unchanged.
