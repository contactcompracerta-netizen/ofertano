# Feed Ingestion Engine V1 — Shadow (Dry-Run) Ingestion

Status: **pre-release checkpoint** — dry-run only, catalog frozen.

## Purpose

The Feed Ingestion Engine parses marketplace affiliate feeds (AWIN first), normalizes
and validates every row, deduplicates by identity, and produces a **deterministic
report** — without ever writing to the database.

It exists to answer: *"what would happen if we ingested this feed?"* — before any
live ingestion is ever enabled.

## Hard guarantees

| Guarantee | How it is enforced |
|---|---|
| No database writes | `src/lib/feed/**` never imports Prisma and never touches `Product` / `MarketplaceOffer`. `DATABASE_WRITE_CAPABILITY=ABSENT`. `runFixture()` always returns `databaseWrites: 0`. |
| No live execution | Execution modes are fail-closed: only `DISABLED` and `DRY_RUN` are usable. `setMode("LIVE")` downgrades to `DISABLED`. There is no code path that performs writes regardless of mode. |
| No network / no DNS | URL validation (`urlSafety.ts`) is pure — no `fetch`, no DNS resolution, only scheme/host inspection. |
| Deterministic reports | No `Math.random()`, no `Date.now()`, no UUIDs in report content. Same input ⇒ byte-identical report; repeated runs are idempotent. |
| Fail-closed validation | Invalid data is reported, never silently hidden. `ABSENT`, `VALID` and `INVALID` are kept as distinct states. |

## Architecture

```
src/lib/feed/
├── urlSafety.ts           # toSafeExternalUrl(): pure http/https + credential check
├── normalization/
│   ├── index.ts           # price, currency, string, GTIN, attributes, URL dedup
│   └── index.test.ts
├── dryRunEngine.ts        # DryRunEngine, ExecutionMode, FeedDryRunReport
├── awinAdapter.ts         # AWIN CSV adapter + feedAdapterRegistry
├── kabumFixture.ts        # sanitized 12-row KaBuM fixture (AWIN shape)
└── *.test.ts
```

- **`feedAdapterRegistry`** is separate from the affiliate provider registry.
  Only the `awin` adapter is registered. KaBuM is an *advertiser/merchant inside
  AWIN*, not a `FeedSource` — the adapter source is `awin` with `advertiserId` /
  `advertiserName` metadata.
- Shopee is **not** registered (contract not clear enough) — fail-closed with
  `NOT_IMPLEMENTED_WITH_REASON`. No fake adapters are registered.

## Deduplication

- Key: `source + externalId`.
- Policy: `FIRST_OCCURRENCE_WINS`. The duplicate row is discarded, but still
  counted in `totalRows` and `duplicateExternalIds`.
- Missing `externalId` ⇒ row classified as `MISSING_EXTERNAL_ID` (`partialRows`).

## GTIN

GTIN is accepted **only when explicitly present** in the feed row. It is never
extracted from title, description, SKU, model or URL.

## Report (`FeedDryRunReport`)

Aggregate, deterministic fields only: `totalRows`, `parsedRows`, `validRows`,
`partialRows`, `invalidRows`, `duplicateExternalIds`, per-signal counters
(`rowsWithGtin`, `rowsWithBrand`, `rowsWithModel`, `rowsWithMpn`,
`rowsWithValidUrl`, `rowsWithPrice`), plus `failureReasons`,
`identitySignalStats`, `currencyStats` and `advertiserStats`.

## Fixture

`kabumFixture.ts` holds a **sanitized** 12-row AWIN-shaped CSV for KaBuM:

- 9 valid rows, 3 intentional invalid rows (invalid price, invalid URL,
  duplicate `externalId`).
- No secrets, no tokens, no credentialed URLs.

## Running the checks

```bash
npx tsc --noEmit                 # typecheck
npx tsx src/lib/feed/urlSafety.test.ts
npx tsx src/lib/feed/normalization/index.test.ts
npx tsx src/lib/feed/dryRunEngine.test.ts
npx tsx src/lib/feed/awinAdapter.test.ts   # prints DRY_RUN_AWIN_* metrics
```

Expected feed test totals: URL Safety **22**, Normalization **47**,
Dry Run Engine **31**, AWIN Adapter **73** (173 total).

## What is explicitly out of scope (V1)

- LIVE ingestion
- Catalog writes (Product / Offer creation or updates)
- Provider activation
- Price Monitor integration
- Mercado Livre flow changes
- External HTTP calls during ingestion
