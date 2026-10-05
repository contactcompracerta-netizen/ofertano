# Affiliate Provider Layer

## Existing link paths

`MarketplaceOffer.sourceUrl` stores the source/product URL and
`MarketplaceOffer.affiliateLink` stores a separate affiliate URL. The legacy
`Product` model has only `affiliateLink`; it has no independent original URL.
No schema migration is included here.

Public purchase selection currently lives in
`src/lib/affiliates/publicPurchase.ts`, is consumed by the client-side product
purchase component, and intentionally has stricter Mercado Livre rules. The
`/o/:codigo` route resolves to the public Product page; it is not an affiliate
redirect. `MarketplaceClickAnchor` tracks marketplace clicks separately.
These paths are unchanged by this mission.

The Mercado Livre affiliate worker is a local Chrome/CDP workflow. It validates
the listing identity and only applies confirmed links. Shopee, Amazon, and
AliExpress also have existing discovery/public-sync connector paths. The
Architecture V1 `purchaseLinks` helper validates separate source and affiliate
URLs but does not select or invoke an affiliate provider. No Awin provider was
found.

## Engine contract

`AffiliateProvider` identifies supported structured marketplace/network
context, reports whether it is configured, and asynchronously builds a URL
from `originalUrl`. The engine validates the original and returned URL with the
existing `toSafeExternalUrl` utility. It never writes Products or Offers.

`resolveAffiliateLink` selects the first matching provider only when its flag
is explicitly `true` and the provider reports configured. Missing, disabled,
unconfigured, throwing, non-monetized, or invalid providers return the safe
original URL through `PASSTHROUGH_PROVIDER`. Invalid original URLs return
`url: null`; unsafe destinations are never opened or emitted. Provider errors
are reduced to stable reason codes and are not copied into the result.

The result carries `provider`, `monetized`, `fallbackUsed`, and an optional
curated `reason`. The passthrough result is non-monetized and marks fallback.
The engine is pure with respect to catalog data; callers supply the original
URL explicitly, and the source URL is never overwritten.

## Registry and flags

The central registry contains structural stubs for Awin, Shopee, Amazon, and
AliExpress. Each reports `isConfigured() === false` and performs no external
call. Feature flags are:

- `AFFILIATE_AWIN_ENABLED`
- `AFFILIATE_SHOPEE_ENABLED`
- `AFFILIATE_AMAZON_ENABLED`
- `AFFILIATE_ALIEXPRESS_ENABLED`

Each flag is OFF unless its value is exactly `true` (case-insensitive after
trimming). These are separate from `PUBLIC_SYNC_MODE_*`, which controls
catalog-writing workflows. No new flags were added to deployment environment
files, and no existing connector or public purchase resolver was changed.

The existing Shopee public-sync mode and existing credentials are outside this
registry and remain unchanged. This registry has zero configured and zero
enabled providers by default. Mercado Livre remains on its existing validated
worker path; it is not routed through the future-provider stubs.

## Adding a provider

1. Implement one server-side adapter using the typed provider contract.
2. Match using structured marketplace/network context, not URL substring
   guesses.
3. Keep `isConfigured()` fail-closed and keep all signing/secrets server-side.
4. Register the adapter and add a new explicit `AFFILIATE_*_ENABLED` flag,
   defaulting to OFF.
5. Test disabled, missing configuration, exceptions, invalid URLs, fallback,
   idempotency, secret redaction, and preservation of the original URL.
6. Review the public purchase boundary and Mercado Livre listing identity in a
   separate integration change before enabling the provider.

Do not wrap an existing affiliate URL as a new original URL. Always pass the
persisted original `sourceUrl` to the engine; persist neither transformed URLs
nor click events as part of this layer. Provider implementations must be
idempotent for the same original URL and must not expose API keys, tokens, or
secrets in URLs or errors.

## Public activation status

This engine is infrastructure only and is not called by public routes or
Client Components. No public UI, catalog data, offers, marketplace state,
Price Monitor behavior, or database schema changes are made. No external
provider APIs are called.