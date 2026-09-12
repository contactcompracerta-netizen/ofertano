# Massive Catalog Architecture

## 1 Executive Summary

The Ofertano catalog is already strong in identity and canonicalization primitives, but it is still not structured as a scale-ready catalog architecture. The current model mixes several roles in the same `Product` and `MarketplaceOffer` layer: canonical product, raw marketplace listing, offer identity, price event, and search document. This is workable in the current catalog size, but it will break down once the system reaches 100M+ listings unless the architecture splits responsibilities cleanly.

The key principle is this: a marketplace listing is not the same as a canonical product. A product can have many sellers, many listings, many prices, and many URLs. Search should not operate directly on raw marketplace data. Instead, the future architecture should flow from raw listing -> normalization -> identity/matching -> canonical product -> active offers -> search document.

The current Prisma model should be treated as a proven local baseline, not the final large-scale target. It can support a catalog-first path for a medium-sized corpus, but it is not designed for multi-seller, multi-listing, high-volume concurrency, and search-index scale without a new split between raw listings and canonical products.

## 2 Current Architecture

The current project already includes the important building blocks for a catalog-first future:

- `Product` has canonical identity fields such as `canonicalName`, `canonicalKey`, `brand`, `modelNumber`, `gtin`, `ean`, `mpn`, and variants like `voltage` / `color` / `size`.
- `MarketplaceOffer` stores storefront-specific offer state such as external ID, price, stock, URL, affiliate link, and status.
- `saveProduct()` applies identity guardrails and rejects unsafe matches.
- `searchCatalogLocal()` proves that a read-only local catalog can exist without touching discovery/public search.
- `searchCatalogOrDiscover.ts` already splits between local catalog and live discovery, which means the public route is compatible with a future split architecture.

The current architecture still has a critical problem: the live public path does not treat raw marketplace listings as first-class data. Instead, the system is optimized around a hybrid behavior where discovery and persistence happen close to the user request path.

At 100M+ scale, this is the wrong tradeoff. The public search should eventually sit on top of a search document layer and a canonical catalog, while acquisition and marketplace ingestion become background flows.

## 3 Current Scaling Limits

The most important limits of the current approach are:

1. `Product` presently acts as both canonical product and live marketplace offer container.
2. `MarketplaceOffer` is constrained to a single offer per marketplace per product: `@@unique([productId, marketplace])`.
3. The schema does not separate raw listing identity from canonical product identity.
4. Search currently depends on a mix of Prisma reads, runtime clustering, and in-memory relevance scoring.
5. `PriceHistory` is tightly coupled to the offer lifecycle and can become structurally expensive at large scale.
6. `SearchRequest` is useful for diagnostic traffic, but it is not a strong search index.
7. `ImportQueue` and `ProductOpportunity` are operational tools, not a scalable ingestion backbone for 100M listings.

These constraints are acceptable for a smaller catalog but become limiting as raw listing volume and seller diversity grow.

## 4 Target Model

The scale target is not 100M canonical products. The target is 100M+ raw marketplace listings and a smaller number of canonical products.

Expected cardinality at scale:

- Raw marketplace listing: 100M+
- Canonical product: much smaller, likely low tens of millions or less depending on category breadth
- Active offers: comprised of current actionable listing states across canonical products
- Search documents: a derived projection, not a direct mirror of raw listings
- Price history events: potentially extremely large if stored at a fine-grained level; should be aggregated or tiered

The logical separation should be:

- A. Canonical Product: one real product identity
- B. Marketplace Listing: one seller/listing record from a storefront
- C. Seller Offer: one version of a listing with price, stock, status, and affiliate metadata
- D. Search Document: a derived, queryable representation for search
- E. Historical Price Event: a time series record, not a core query table

## 5 Raw Marketplace Listing

A future raw listing entity should be treated as an ingestion-first structure. It should capture the marketplace truth, not the canonical product truth.

A minimal raw listing model should include only justified fields:

- `id`
- `marketplace`
- `externalId`
- `sellerId`
- `sourceUrl`
- `affiliateLink`
- `title`
- `normalizedTitle`
- `brand`
- `model`
- `gtin`
- `ean`
- `mpn`
- `category`
- `attributes`
- `image`
- `price`
- `oldPrice`
- `stock`
- `availability`
- `seller`
- `rawPayload`
- `firstSeenAt`
- `lastSeenAt`
- `lastCheckedAt`
- `status`
- `fingerprint`
- `canonicalProductId`

The purpose is not to copy the current `MarketplaceOffer` exactly; it is to preserve the raw originating fact and keep a durable source-of-truth record separate from the product matching layer.

A raw listing is not a search result. It is an input to normalization and identity.

## 6 Canonical Product

The future `Product` should represent the real product identity, not the individual storefront listing.

Example: "Samsung Galaxy S26 256GB Preto" is a canonical product. The following are not the same canonical object:

- Mercado Livre seller A listing
- Mercado Livre seller B listing
- Amazon listing
- Shopee listing
- Magazine Luiza listing

Instead, all of those should link to the same canonical product if identity rules confirm they are the same real item.

This is the correct role for the current `Product` model in a scaled architecture: a canonical identity bucket plus metadata, not a one-to-one reflection of each storefront listing.

## 7 Offers and Sellers

The current schema is too compact for multi-seller reality. A product can have:

- multiple sellers in the same marketplace,
- multiple listings from the same seller,
- multiple variants of the same product,
- different stock and price states across listings.

The current constraint:

- `@@unique([productId, marketplace])`

works for a single best offer per marketplace, but it fails for multi-seller listings. It hides the real market shape and prevents a scaled offer graph.

A future data model needs a relation that allows:

- one canonical product,
- many sellers,
- many marketplace listings,
- many offer states,
- one current active offer per seller/listing branch.

The future constraint should be closer to:

- `(marketplace, externalId)` for duplicate control at the raw listing level,
- `(canonicalProductId, marketplace, sellerId, listingKey)` for a normalized offer identity, not a single `[productId, marketplace]` row.

## 8 Identity and Variants

The current identity pipeline is already strong in concept. It incorporates brand, model number, product class, quantity, capacity, size, voltage, and conflict guards. This is the correct basis for future scale.

The key is to keep identity logic separate from ingestion storage.

The future lifecycle should be:

- raw listing captured
- normalized title and attributes extracted
- identity facts derived
- candidate product match performed
- canonical product is linked
- active offer state is attached
- search document is refreshed

Important variant rules should remain:

- same product if same model + same capacity + same family + compatible attributes
- different product if brand differs in a strong conflict
- different product if accessory/part role is detected
- different product if replacement part is not the main product
- unknown if evidence is partial and not enough to merge

The current matcher already embodies that principle, and it should remain the contractual guardrail for future scale.

## 9 Ingestion Pipeline

The architecture should be structured as a pipeline, not a monolith.

Recommended pipeline:

Marketplace
  -> Fetcher
  -> Raw listing
  -> Normalization
  -> Identity extraction
  -> Canonical matcher
  -> Product linking
  -> Offer/index publication

The pipeline must separate:

- acquisition
- normalization
- matching
- persistence
- search indexing

This separation matters because 100M raw listings cannot be processed as one giant batch or as one monolithic function with all concerns collapsed into one DB transaction.

## 10 Queue Architecture

A single cron or single sequential queue is not enough for 100M listings. The future queue must be designed around independent marketplace budgets and worker partitions.

Recommended system model:

- small scale: Postgres job table + app worker
- medium scale: queue with bounded workers + rate limit budgets
- large scale: dedicated queue service or broker with retry / priority / dead-letter support

The important design fact is that the queue should prioritize:

- query demand
- single-to-multi coverage gaps
- product popularity
- freshness tier
- inventory backlog

It should not be a simple cron that reprocesses everything.

## 11 Rate Limiting

Every marketplace must have independent rate limits. A failure in one marketplace cannot block the rest of the catalog pipeline.

The scheduler should include:

- per-marketplace concurrency cap
- per-marketplace cooldown
- per-marketplace retry budget
- 403 / 429 / timeout classification
- backoff schedule
- auth failure isolation
- partial-batch continuation

This is the same principle already present in the search path: failures must be compartmentalized so one broken source does not poison the rest.

## 12 Incremental Updates

At scale, the system should not re-ingest everything in a blind full refresh cycle. The architecture should support incremental updates.

Whenever a listing is seen again:

- compare its current price, stock, availability, and seller metadata
- update current state if changed
- write price history only when necessary
- mark stale listings for refresh if inactive
- archive listings that disappear across a long retention window

This reduces write amplification and allows the database to evolve without constant full reprocessing.

## 13 Search Architecture

The current search still depends on Prisma reads and runtime matching in a way that will not scale to 100M listings. The architecture should separate the search path into two layers:

- a full-scale ingestion + identity layer
- a dedicated search document layer

At the current scale, the best path is a phased search architecture:

### FASE A

- PostgreSQL `GIN` / `GIN` on normalized title and attributes
- `pg_trgm` for typo tolerance
- `tsvector` / `tsquery` for full-text search
- coarse filtering on category + brand + marketplace + active state

### FASE B

- dedicated search product such as Typesense, Meilisearch, OpenSearch, Elasticsearch, or Algolia
- chosen only when demand, data volume, and latency justify it

The choice should be driven by:

- total listing volume,
- Portuguese query quality,
- update frequency,
- need for faceting,
- operational simplicity,
- latency requirement.

A large catalog should not rely on `contains` and full-table runtime re-ranking as the main strategy.

## 14 Search Document

The search document should be a derived structure, not a direct mirror of raw listings.

A future search document can include:

- `productId`
- `canonicalTitle`
- `normalizedTitle`
- `brand`
- `model`
- `gtin`
- `ean`
- `mpn`
- `category`
- `aliases`
- `attributes`
- `lowestPrice`
- `highestPrice`
- `offerCount`
- `marketplaceCount`
- `popularity`
- `rating`
- `updatedAt`

The document should index only what is needed for search and ranking. It should not include raw payloads or every historical variant of the same listing.

## 15 PostgreSQL Strategy

PostgreSQL can remain the system of record for a long time, but it should be used carefully.

At 1M listings, PostgreSQL is still manageable with good indexing and careful query design.

At 10M listings, performance remains feasible but only if there is discipline around partitioning, index coverage, and hot data separation.

At 100M listings, PostgreSQL remains viable as a core data store for canonical products and primary business state, but it becomes much harder to use as the only layer for all raw listing ingestion, historical events, and full-text search without partitioning and a separate search index.

The real risk is not raw storage alone; it is the combination of:

- large write amplification,
- large index maintenance,
- query latency under mixed OLTP + analytics workloads,
- frequent refreshes and historical price events.

## 16 Partitioning

Partitioning should be considered later, not immediately. It is likely necessary for the largest tables, especially:

- `MarketplaceListing`
- `PriceHistory`
- `AnalyticsEvent`

Potential partition keys:

- `marketplace`
- `createdAt`
- `recordedAt`

Partitioning helps with retention, bulk purge, and query pruning. It is not a substitute for good identity and queue design, but it becomes much more relevant as data volume rises.

## 17 Price History

At 100M listings, price history can explode if every listing update writes a full event record. This is a big architectural issue.

A future strategy should consider:

- only recording changes when the price differs materially,
- storing a daily aggregate when full granularity is not required,
- segregating cold historical data from hot active data,
- partitioning old records by time,
- dropping or summarizing stale history after a retention window.

The current `PriceHistory` relationship is useful, but it is not a complete answer for a very large catalog.

## 18 Hot/Warm/Cold

A 100M+ listing system should separate data by access pattern.

- HOT: active listings, popular products, frequently queried products, recent offers
- WARM: older but relevant listings and products with moderate demand
- COLD: archived, stale, historical, or rarely accessed raw data

This is not about using expensive infrastructure unnecessarily; it is about forcing the system to avoid treating all data as equally hot.

## 19 Storage Estimates

These are rough engineering estimates, not exact subscription quotes.

Assume a relatively lean normalized row with useful fields and moderate index overhead.

- 1M listings: roughly low tens of GB depending on raw payload and indexes
- 10M listings: roughly low hundreds of GB depending on indexing and history retention
- 100M listings: multiple TB once raw payload, indexes, image metadata, and price history are included at normal retention

The real cost driver is not only the listing row itself, but also:

- index size
- raw payload storage
- historical price data
- duplicate and stale rows
- search document duplication

## 20 Throughput Estimates

For 100M listings, the refresh schedule matters more than the raw row count.

Conceptual throughput requirements:

- 100M refresh in 24h: around 1,200 listings/sec average
- 100M refresh in 7 days: around 170 listings/sec average
- 100M refresh in 30 days: around 40 listings/sec average

These are rough estimates. They illustrate that the queue and worker model must be designed with a realistic throughput budget and not with ad hoc cron jobs that scale poorly.

## 21 Freshness Strategy

Freshness should not be global and equal for all rows. A massive catalog requires tiered freshness.

Recommended tiers:

- HOT: query-heavy products and popular categories refreshed very frequently
- WARM: regular catalog and category refresh on a moderate cadence
- COLD: long-tail or historical listings refreshed rarely or only on demand

This reduces wasted traffic and keeps the system stable while preserving service quality where it matters.

## 22 Failure Recovery

A large ingestion system must survive partial failures and restarts. The architecture should include:

- per-batch checkpoints
- dead-letter handling
- retry with backoff
- resume support
- partitioned worker ownership
- idempotency by marketplace + external ID
- partial success reporting

If a worker crashes, the system should recover without requiring a full re-import of everything.

## 23 Zero-Downtime Migration

The future migration should not break the current search behavior. A staged model is safer:

1. Add raw listing tables or equivalent storage
2. Dual-write from the current pipeline
3. Backfill canonical product and listing references
4. Run shadow reads against the new structures
5. Build a dedicated search document
6. Cut over public search to the new document layer
7. Remove or archive legacy paths after validation

This ensures the public site keeps functioning while the new architecture is rolled in.

## 24 Rollback

Every phase should have rollback criteria. The public site should remain the fallback until the new architecture has stabilised. This is critical because the search experience affects user trust and conversion.

Rollback should include:

- turning off the new search document layer,
- restoring the previous live search path,
- preserving raw listing data without activating it,
- leaving the canonical product layer as an independent but inactive option until validated.

## 25 Phase 10K

Phase 10K is a small healthy baseline:

- PostgreSQL remains the primary data store
- raw listing data is small and operationally manageable
- index maintenance is simple
- search remains close to the current model
- queue remains light and easy to reason about
- identity and matcher remain strong

Exit criteria: stable ingestion, search still fast, no large duplicate spikes, and no search degradation.

## 26 Phase 100K

Phase 100K adds complexity but remains manageable:

- more queries and more listings
- more marketplace variability
- need for bounded workers and better dedupe
- caution with raw payload size and price history volume
- more attention to search document freshness

Exit criteria: throughput is stable, query latency remains acceptable, and duplicate rates stay controlled.

## 27 Phase 1M

At 1M records, the system should start moving toward explicit tiering and capacity planning:

- tighter dedupe and matching guardrails
- more segmentation around hot/warm/cold data
- search document index becomes meaningful
- queue and worker design matters more than local scripts

Exit criteria: refresh workloads are predictable and the canonical catalog remains healthy.

## 28 Phase 10M

At 10M, the architecture should already be split into:

- raw listing storage
- canonical product layer
- search document index
- queue and worker infrastructure
- explicit freshness strategy

This is the phase where separate search infrastructure becomes highly likely if the product is still growing.

## 29 Phase 100M+

At 100M+, the system must be treated as a distributed catalog pipeline, not a simple app database. This phase requires:

- dedicated ingestion workers
- explicit queue + scheduler design
- search document service or indexer
- raw listing tables with retention and partition logic
- canonical product identity layer with strong dedupe controls
- warm/cold split for price and listing history
- operational metrics for freshness, rate limits, and stale inventory

## 30 Cost Controls

To avoid runaway cost, the architecture should impose a few hard disciplines:

- delta updates rather than full refreshes
- dedupe before write
- only keep necessary raw payload data
- keep price history for hot products and aggregate the rest
- limit search-document duplication to necessary fields
- separate hot/warm/cold storage and refresh policies
- keep rate limits per marketplace and per tenant

This is how the system avoids a cost explosion while still bringing in more catalog breadth.

## 31 Metrics

The future scale architecture needs an operational set of metrics, including:

- listings total
- active listings
- canonical products
- marketplace coverage
- single-to-multi upgrades
- duplicate rate
- matcher rejection rate
- ingestion throughput
- ingestion error rate
- index lag
- catalog hit rate
- search P50 / P95 / P99
- freshness by tier
- storage growth

Without these metrics, the ingestion pipeline will be hard to reason about and hard to tune.

## 32 Risks

The biggest risks are:

1. treating raw listings as canonical products
2. allowing duplicate listings to pollute the identity graph
3. storing too much raw payload and history in hot paths
4. tying the public search too closely to live acquisition and runtime matching
5. overloading Postgres with search, analytics, and ingestion on the same tables
6. underestimating the importance of a search document layer
7. failing to keep per-marketplace failure isolated

## 33 Recommendation

The correct recommendation for the current project is: do not treat the current schema as the final 100M-scale design. Instead, treat it as a well-structured medium-scale baseline with strong identity logic and a valid local catalog foundation.

The right near-term direction is:

- preserve `Product` as the canonical identity abstraction,
- add raw listing separation as a future first-class table,
- keep marketplace offers separate from canonical product records,
- add a search-document projection before public search becomes a full local catalog system,
- keep ingestion background-only and queue-driven,
- do not try to force all marketplace complexity into `Product` and `MarketplaceOffer`.

In practical terms, the architecture should evolve toward a split of core concerns before the system reaches true 100M-scale volume.

## 34 Next Mission

The next mission should focus on introducing a raw listing and product-linking design in a non-breaking way, with a shadow-read or side-by-side validation while the exact schema changes are evaluated. The mission should also validate the minimum required queue, search document, and refresh policies before any production rollout is attempted.
