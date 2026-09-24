/**
 * CATALOG_ARCHITECTURE_V1 — PUBLICATION GATE TESTS (FASE O, puro-lógica).
 *
 * PUBLICATION_GATE_CENTRAL / PUBLIC_MULTISTORE_INVARIANT:
 *  - fluxo MANUAL liberado (comportamento legado);
 *  - auto-criado exige ofertas válidas em >= 2 marketplaces DISTINTOS;
 *  - 1 marketplace (mesmo com 2 ofertas) => INSUFFICIENT_PUBLIC_MULTISTORE;
 *  - oferta inválida => NO_VALID_OFFERS;
 *  - identidade NON_EXACT => IDENTITY_NOT_EXACT;
 *  - frescor STALE/EXPIRED => bloqueado (OFFER_FRESHNESS_STALE/EXPIRED).
 */
import assert from "node:assert/strict";
import {
  evaluatePublicationEligibility,
  publicationEligibleToActivate,
  PUBLICATION_REASON_CODES,
} from "./publicationEligibility";
import type { PublicOfferLike } from "../../../publicVisibility/multiStoreVisibility";

const validOffer = (marketplace: string, matchStatus = "EXACT"): PublicOfferLike => ({
  marketplace,
  active: true,
  available: true,
  status: "ACTIVE",
  matchStatus,
  price: 1999.9,
});

async function main() {
  // MANUAL: liberado sempre.
  {
    const verdict = evaluatePublicationEligibility({
      autoCreated: false,
      offers: [validOffer("MARKET_A")],
    });
    assert.equal(verdict.eligible, true);
    assert.deepEqual(verdict.reasonCodes, [PUBLICATION_REASON_CODES.MANUAL_PRODUCT]);
  }

  // AUTO: 2 marketplaces distintos => elegível.
  {
    const verdict = evaluatePublicationEligibility({
      autoCreated: true,
      offers: [validOffer("MARKET_A"), validOffer("MARKET_B")],
    });
    assert.equal(verdict.eligible, true, "2 marketplaces distintos => publishable");
    assert.equal(verdict.evidence.publicMarketplaceCount, 2);
    assert.equal(verdict.evidence.validOfferCount, 2);
  }

  // AUTO: 1 marketplace (2 ofertas do mesmo) => bloqueado.
  {
    const verdict = evaluatePublicationEligibility({
      autoCreated: true,
      offers: [validOffer("MARKET_A"), validOffer("MARKET_A")],
    });
    assert.equal(verdict.eligible, false, "2 ofertas do MESMO marketplace NÃO constituem multiloja");
    assert.ok(verdict.reasonCodes.includes(PUBLICATION_REASON_CODES.INSUFFICIENT_PUBLIC_MULTISTORE));
    assert.equal(verdict.evidence.publicMarketplaceCount, 1);
  }

  // AUTO: 1 marketplace com 1 oferta => bloqueado.
  {
    const verdict = evaluatePublicationEligibility({
      autoCreated: true,
      offers: [validOffer("MARKET_A")],
    });
    assert.equal(verdict.eligible, false);
    assert.ok(verdict.reasonCodes.includes(PUBLICATION_REASON_CODES.INSUFFICIENT_PUBLIC_MULTISTORE));
  }

  // AUTO: ofertas inválidas (preço 0 / UNAVAILABLE) => NO_VALID_OFFERS.
  {
    const verdict = evaluatePublicationEligibility({
      autoCreated: true,
      offers: [
        { ...validOffer("MARKET_A"), price: 0 },
        { ...validOffer("MARKET_B"), status: "UNAVAILABLE" },
      ],
    });
    assert.equal(verdict.eligible, false);
    assert.ok(verdict.reasonCodes.includes(PUBLICATION_REASON_CODES.NO_VALID_OFFERS));
    assert.equal(verdict.evidence.validOfferCount, 0);
  }

  // AUTO: identidade NON_EXACT (override de evidência) => bloqueado, mesmo com multiloja.
  {
    const verdict = evaluatePublicationEligibility({
      autoCreated: true,
      offers: [validOffer("MARKET_A"), validOffer("MARKET_B")],
      identityStatusOverride: "NON_EXACT",
    });
    assert.equal(verdict.eligible, false);
    assert.equal(verdict.evidence.identityStatus, "NON_EXACT");
    assert.ok(verdict.reasonCodes.includes(PUBLICATION_REASON_CODES.IDENTITY_NOT_EXACT));
  }

  // AUTO: freshness STALE => bloqueado (FASE L).
  {
    const verdict = evaluatePublicationEligibility({
      autoCreated: true,
      offers: [validOffer("MARKET_A"), validOffer("MARKET_B")],
      freshnessTimestamps: {
        lastSeenAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    assert.equal(verdict.evidence.freshnessContractApplied, true);
    assert.equal(verdict.eligible, false, "dado STALE nunca é publicado como melhor oferta");
    assert.ok(verdict.reasonCodes.includes(PUBLICATION_REASON_CODES.OFFER_FRESHNESS_STALE));
  }

  // AUTO: freshness EXPIRED => bloqueado.
  {
    const verdict = evaluatePublicationEligibility({
      autoCreated: true,
      offers: [validOffer("MARKET_A"), validOffer("MARKET_B")],
      freshnessTimestamps: {
        processedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    assert.equal(verdict.eligible, false);
    assert.ok(verdict.reasonCodes.includes(PUBLICATION_REASON_CODES.OFFER_FRESHNESS_EXPIRED));
  }

  // AUTO: freshness FRESH + multiloja => elegível.
  {
    const verdict = evaluatePublicationEligibility({
      autoCreated: true,
      offers: [validOffer("MARKET_A"), validOffer("MARKET_B")],
      freshnessTimestamps: { lastSeenAt: new Date().toISOString() },
    });
    assert.equal(verdict.eligible, true, "dado FRESH com multiloja => publishable");
    assert.equal(verdict.evidence.freshness, "FRESH" as never);
  }

  // publicationEligibleToActivate delega para a mesma política.
  {
    assert.equal(publicationEligibleToActivate(true, [validOffer("MARKET_A"), validOffer("MARKET_B")]), true);
    assert.equal(publicationEligibleToActivate(true, [validOffer("MARKET_A")]), false);
    assert.equal(publicationEligibleToActivate(false, [validOffer("MARKET_A")]), true, "manual liberado");
  }

  console.log("publicationEligibility.test.ts PASS");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});