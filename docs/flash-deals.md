# Ofertas Relâmpago

The Home slot sits between Hero and Ofertas recentes, only on the unfiltered
Home. Empty data renders no section and consumes no space. Up to six compact
cards form a horizontal, keyboard-focusable swipe rail with fixed image sizes.
The emerald/white styling belongs to Ofertano; Mercado Livre is a small label.
Each card opens its own confirmed affiliate link. No generic affiliate fallback
or sibling listing is used. There is no “Ver todas” link until a real filtered
flash-deals destination exists.

## Read-only source contract

`getHomeFlashDeals` receives the already indexed products/offers read by Home;
it does not query a marketplace, write data, or add a database round trip.
The adapter reuses MarketplaceOffer fields, public multi-store eligibility,
ML listing identity validation and the existing public purchase policy.
The offer price and oldPrice belong to that listing, never to Product's best
price across stores. Percentage is derived only from a valid listing oldPrice.

There is currently no dedicated flash-promotion ingestion. Normal discounted
offers stay out of this module. A future ingestion adapter can retain verified
listing-level evidence in the existing MarketplaceOffer.rawPayload alongside
its current data, without schema changes:

```ts
flashDeal: {
  kind: "FLASH_DEAL",
  listingId: string, // must equal MarketplaceOffer.externalId
  verifiedAt: string, // actual verification timestamp, ISO with timezone
  validUntil: string, // actual freshness deadline from ingestion policy
  endsAt?: string, // actual promotion end only; never synthesize this
}
```

This is an internal contract, not an assertion that Mercado Livre currently
returns these fields. Only ingestion that has verified a real flash promotion
may produce it. This change does not add or modify any ingestion writer.
The section activates on the next Home request once eligible evidence exists.
No payloads were populated by this task.

Missing, stale, future-dated, malformed or mismatched evidence fails closed.
`validUntil` controls freshness and is never displayed as urgency. Countdown
appears only for `endsAt`; a single browser clock removes expired/stale cards
and hides the whole section once none remain. No timer is created without
a real end time. Client data contains only normalized cards, not raw payloads.

`FlashDealsProvider` and the generic card accept future marketplace adapters;
each adapter must enforce that marketplace's publication and purchase rules.
ML_LISTING_FIRST, ML_CATALOG_AS_OFFER=0 and Price Monitor REFRESH_ONLY remain
untouched. No Product, price monitor, matching, schema or catalog writes.

## Verification

`npx tsx src/services/flashDeals/flashDeals.test.tsx` covers offline eligibility,
catalog rejection, listing URL mismatch, affiliates, freshness/end dates,
deduplication, offer-specific prices, hidden empty state and absent timer.
Fixtures are only in test code, never a fallback for production.

`npx tsx scripts/verify-flash-deals.tsx [http://localhost:3100]` uses the built
CSS and local Chromium in an isolated document. It checks 360, 375, 390, 412,
430, 768 and 1440px, large prices, long titles, image geometry, keyboard scroll,
empty rendering and optional real-timestamp presentation. Screenshots/results
are saved in the OS temporary directory `ofertano-flash-deals`. The optional
URL also checks the compiled Home with existing indexed data.

Validated: 225px section height on mobile, 250px on tablet/desktop, no document
horizontal overflow, 72x72px images and no runtime page errors. The integrated
Home returned HTTP 200 at 390/1440px and correctly hid the section because no
verified flash promotion was available. Full lint passed with 103 existing
warnings; changed files lint passed cleanly. Typecheck, production build and
related listing-first, refresh-only, public-purchase and visibility tests passed.
The Home's database projection now also reads offer-level `rawPayload`, title,
image and oldPrice. Raw payload stays server-side. No additional query or
marketplace call was added; large-catalog payload/LCP load benchmarking was not
performed in this task.
