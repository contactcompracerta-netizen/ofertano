# Automatic Catalog Persistence

These controls are fail-closed. A path runs only when its value is exactly `true` (case-insensitive, surrounding whitespace ignored).

| Variable | Default | Scope |
| --- | --- | --- |
| `CATALOG_POPULATE_ENABLED` | `false` | Scheduled catalog opportunity and queue creation |
| `IMPORT_QUEUE_PROCESS_ENABLED` | `false` | Scheduled queue consumption and automatic publication |
| `PUBLIC_SEARCH_PERSISTENCE_ENABLED` | `false` | Public-search persistence only; result discovery remains enabled |

The price-monitor path is intentionally not covered by these flags. It operates on existing offers and may write price history, but it does not create a new Product from an empty catalog.

Explicit manual import paths remain separate from these automatic flags.

When an automatic cron path is disabled, it emits a sanitized skip event and performs no acquisition or database write.

## Verification

- `src/lib/featureFlags.ts` (helper) + `src/lib/featureFlags.test.ts` — fail-closed parsing.
- `src/app/api/cron/autoCatalogGuards.test.ts` — cron routes skip before any write.
- `src/app/api/cron/catalogAutoPersistence.integration.test.ts` — real zero-write proofs against the local canary database (route invocation, public search with offline adapters, manual import still creates products, price monitor never creates a Product). These tests refuse to run outside the local canary connection string.
