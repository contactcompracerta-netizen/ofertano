# Admin Operations Dashboard

`/admin/operacoes` is a server-rendered, read-only operational snapshot. It is
inside the existing `/admin/:path*` proxy matcher and uses the existing HTTP
Basic Auth credentials (`ADMIN_USER` and `ADMIN_PASSWORD`). Unauthenticated
requests receive `401`, `WWW-Authenticate`, and `Cache-Control: no-store`.
There is no separate role/session system for this route.

## Data and definitions

- Product totals, active state, and publication status come from Prisma
  `groupBy` queries.
- Offer distribution is grouped by `productId`; source rows are grouped by
  marketplace, active state, and product. The UI lists only marketplaces that
  currently have offers. `ACTIVE` means at least one active offer exists; it
  does not claim that an integration credential or feed is enabled.
- Publicly navigable Products use the same active, publication, valid-offer,
  and distinct-marketplace rules as the sitemap and public catalog. Products
  and buyable Offers remain separate concepts.
- Offers without source URLs and potentially incomplete offers are database
  counts only. The dashboard does not request external URLs.
- Price Monitor is reported as `REFRESH_ONLY`, with Product creation `0`.
  Active offers with `nextCheckAt` at or before snapshot time are shown as
  checks due, not as persisted jobs. Last check and price timestamps come from
  `MarketplaceOffer` and `PriceHistory`; the schema has no dedicated monitor
  execution ledger.
- Recent synchronization/job rows use the last eight `ImportRun` records.
  Only source labels, mode, status, timestamps, duration, and failed-item count
  are selected. Metadata, cursors, payloads, and error text are not returned.
  When that ledger cannot be read, the UI says job data is unavailable.
- Recent errors are limited to failed/partial ImportRuns or runs with failed
  item counts. There is no Vercel runtime-log integration.

## Freshness and cache

The page opts out of static and long-lived caching and reads a snapshot once
per navigation. The browser makes one `GET /api/health` request on mount with
`cache: no-store`; there is no polling. The health endpoint is liveness-only,
while the separate database status reflects whether dashboard queries
succeeded.

Offer-check freshness is `RECENT` through 24 hours, `STALE` after 24 hours, and
`UNKNOWN` when no timestamp exists. These labels describe observed timestamps,
not a guarantee that a scheduled job is late.

## Read-only boundary

The operations query module uses only `count`, `groupBy`, `aggregate`, and
selected `findMany` calls. A static test rejects Prisma mutation calls in that
module, and a proxy test verifies the unauthenticated route challenge. No
operation, server action, API mutation endpoint, feed URL, secret, or raw
ImportRun metadata is exposed by the dashboard.