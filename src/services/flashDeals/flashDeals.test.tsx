import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import FlashDealsSection from "@/components/flashDeals/FlashDealsSection";
import { getHomeFlashDeals, type FlashDealOffer, type FlashDealProduct } from "./flashDeals";
import { formatRemainingTime } from "./countdown";

// Offline fixtures only. No database writes or marketplace requests.
const now = Date.parse("2026-10-05T12:00:00Z");
const evidence = {
  kind: "FLASH_DEAL", listingId: "MLB1234567890",
  verifiedAt: "2026-10-05T11:00:00Z", validUntil: "2026-10-05T13:00:00Z",
};
const offer: FlashDealOffer = {
  id: "test-offer", marketplace: "MERCADO_LIVRE", price: 149, oldPrice: 249,
  title: "Oferta de teste offline", image: "/icon.svg",
  externalId: "MLB1234567890",
  sourceUrl: "https://produto.mercadolivre.com.br/MLB-1234567890-anuncio",
  affiliateLink: "https://meli.la/test-fixture", status: "ACTIVE", available: true,
  rawPayload: { flashDeal: evidence },
};
const product: FlashDealProduct = {
  id: "test-product", name: "Produto offline", image: "/icon.svg",
  offers: [offer, { ...offer, id: "amazon-test", marketplace: "AMAZON", rawPayload: null }],
};
function select(overrides: Partial<FlashDealOffer> = {}) {
  return getHomeFlashDeals([{ ...product, offers: [{ ...offer, ...overrides }, product.offers[1]] }], undefined, now);
}
assert.equal(select().length, 1);
assert.equal(select()[0].currentPrice, 149);
assert.equal(select()[0].discountPercent, 40);
assert.equal(select()[0].expiresAt, null);
for (const invalid of [
  { rawPayload: null }, { available: false }, { price: NaN }, { price: 0 },
  { status: "UNAVAILABLE" }, { affiliateLink: null },
  { affiliateLink: "https://meli.la/1i7Te2C" },
  { sourceUrl: "https://www.mercadolivre.com.br/p/MLB1234567890" },
  { sourceUrl: "https://produto.mercadolivre.com.br/MLB-9999999999-anuncio" },
  { rawPayload: { flashDeal: { ...evidence, listingId: "MLB9999999999" } } },
  { rawPayload: { flashDeal: { ...evidence, kind: "DISCOUNT" } } },
  { rawPayload: { flashDeal: { ...evidence, validUntil: "2026-10-05T11:59:59Z" } } },
  { rawPayload: { flashDeal: { ...evidence, verifiedAt: "2026-10-06T11:00:00Z" } } },
  { rawPayload: { flashDeal: { ...evidence, endsAt: "invalid" } } },
  { rawPayload: { flashDeal: { ...evidence, endsAt: "2026-10-05T12:00:00Z" } } },
] satisfies Partial<FlashDealOffer>[]) assert.equal(select(invalid).length, 0, JSON.stringify(invalid));
assert.equal(getHomeFlashDeals([{ ...product, offers: [offer] }], undefined, now).length, 0);
assert.equal(getHomeFlashDeals([product, product], undefined, now).length, 1);
assert.equal(select({ oldPrice: 100 })[0].originalPrice, null);
assert.equal(select({ oldPrice: null })[0].discountPercent, null);
const timed = select({ rawPayload: { flashDeal: { ...evidence, endsAt: "2026-10-05T12:30:00Z" } } });
assert.equal(timed[0].expiresAt, "2026-10-05T12:30:00.000Z");
assert.equal(formatRemainingTime(3661000), "01 : 01 : 01");
assert.equal(formatRemainingTime(-1000), "00 : 00 : 00");
assert.equal(renderToStaticMarkup(<FlashDealsSection deals={[]} />), "");
const untimedMarkup = renderToStaticMarkup(<FlashDealsSection deals={select()} />);
assert.ok(!untimedMarkup.includes("Tempo restante"));
assert.ok(untimedMarkup.includes("Ofertas Relâmpago"));
assert.ok(untimedMarkup.includes('href="https://meli.la/test-fixture"'));
assert.ok(renderToStaticMarkup(<FlashDealsSection deals={timed} />).includes("Tempo restante"));
console.log("PASS: flash deals eligibility, listing-only, affiliate policy, expiry, deduplication and empty/timer rendering");
