# Catalog Ingestion Foundation — 2026-09-12

## 1. Objective

This mission creates a safe, background-only ingestion foundation that can expand catalog coverage without changing the public search response or enabling Local-First behavior.

Scope remains read-only for public search. The ingestion layer is explicit background work for seeds such as recent missed queries and single-marketplace products.

## 2. Architecture

The implemented foundation follows the existing discovery and persistence stack already present in the project:

- discovery adapters remain the source of marketplace candidates
- identity validation remains the gate for acceptable candidate matches
- dry-run mode allows validation without writes
- batch execution is bounded and does not depend on the public search critical path

The new code lives under:

- src/services/catalog-ingestion/index.ts
- src/services/catalog-ingestion/index.test.ts

This module intentionally avoids creating a second parallel system. It reuses the project’s discovery-oriented design patterns and keeps the work isolated from public search.

## 3. Seed Sources

The seed plan is intentionally conservative and prioritizes the highest-value sources:

1. searchRequest
2. singleMarketplace
3. recentQuery
4. opportunity
5. favorito
6. popularCategory

This allows the background layer to prioritize:

- missed queries that failed locally
- single-marketplace products that can be upgraded to comparable coverage
- later high-value categories, but only under a bounded budget

## 4. Marketplace Support

The foundation is designed around the existing marketplace adapters already present in the repo:

1. Mercado Livre
2. Amazon
3. Shopee
4. Magazine Luiza
5. AliExpress

The module is adapter-based and keeps explicit per-marketplace limits and error handling instead of a single unbounded fan-out.

## 5. Safety Invariants

The implementation keeps the existing guardrails in place:

- cross-brand conflicts are rejected
- model mismatch and brand confusion are filtered
- accessory-heavy matches are not promoted as primary results
- no fake marketplace or fake offer is created in the dry-run path
- idempotence is designed around bounded processing and per-seed evaluation

The current Prisma schema constraint remains untouched:

- MarketplaceOffer has a unique constraint on [productId, marketplace]
- This limits one offer per marketplace per product and is documented here as a known future limitation for deeper ingestion expansion.

## 6. Dry-Run and Batch Budget

The module exposes a non-persistent dry-run mode and a capped batch budget:

- dryRun=true
- batchLimit configurable
- seeds processed in priority order
- adapter failures are captured without aborting the overall batch

This provides a safe path to validate orchestration without writing to the database or enabling Local-First.

## 7. Observability

The module records:

- seeds processed
- candidates found
- candidates rejected
- marketplace errors
- elapsed time
- dry-run state

No secrets, tokens, or credentials are logged.

## 8. What Did Not Change

The following remain unchanged:

- public search response path
- Local-First activation
- schema and migration state
- database writes during the validation path
- UI, admin layout, SEO, or deployment behavior

## 9. Known Limitations

1. The current product-to-marketplace uniqueness constraint still restricts how many offers can be attached to one product in a marketplace.
2. The module is a foundation for background ingestion, not a full live-search replacement.
3. This does not solve the separate issue of local search latency; that should be addressed in a later performance-specific mission.

## 10. Recommended Next Mission

A follow-up mission should focus on:

- expanding ingestion quality for missing product families
- improving metadata normalization and identity coverage
- evaluating targeted product enrichment with dry-run first
- separately addressing local-search latency after catalog coverage is materially improved
