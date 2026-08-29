import assert from "node:assert/strict";

import {
  applyConfirmedAffiliateLinkToOwnedOffer,
  offerPertenceAOportunidade,
  type ApplyAffiliateLinkStore,
} from "./applyAffiliateLink";
import {
  decidirOportunidadeAfiliadoMenorPreco,
  ensureMercadoLivreLowestPriceAffiliateOpportunity,
  opportunityAlteraOutroProduct,
  type AffiliateOpportunityStore,
  type ExactOfferSnapshot,
  type OpportunitySnapshot,
} from "./lowestPriceAffiliateOpportunity";
import {
  sanitizarOfertaCompraPublica,
} from "@/lib/affiliates/liveOffers";
import { resolverHrefProprioOfertaPublica } from "@/lib/affiliates/publicPurchase";

const AFFILIATE_ML = "https://meli.la/2qvdFzv";
const SOURCE_ML =
  "https://produto.mercadolivre.com.br/MLB-1234567890-smartphone-_JM";
const AFFILIATE_AMAZON =
  "https://www.amazon.com.br/dp/B00TEST123?tag=ofertano-20";

function offer(
  input: Partial<ExactOfferSnapshot> &
    Pick<ExactOfferSnapshot, "id" | "marketplace">,
): ExactOfferSnapshot {
  return {
    productId: input.productId ?? "prod-1",
    externalId: input.externalId ?? input.id,
    sourceUrl: input.sourceUrl ?? SOURCE_ML,
    affiliateLink: input.affiliateLink ?? null,
    title: input.title ?? "Smartphone X",
    image: input.image ?? "https://img.example/x.jpg",
    price: input.price ?? 1000,
    oldPrice: input.oldPrice ?? null,
    matchStatus: input.matchStatus ?? "EXACT",
    status: input.status ?? "PENDING_AFFILIATE",
    available: input.available ?? true,
    active: input.active ?? true,
    ...input,
  };
}

function opportunity(
  input: Partial<OpportunitySnapshot> & Pick<OpportunitySnapshot, "id">,
): OpportunitySnapshot {
  return {
    productId: input.productId ?? "prod-1",
    marketplace: input.marketplace ?? "MERCADO_LIVRE",
    externalId: input.externalId ?? "MLB-1",
    sourceUrl: input.sourceUrl ?? SOURCE_ML,
    status: input.status ?? "WAITING_AFFILIATE",
    affiliateLink: input.affiliateLink ?? null,
    matchStatus: input.matchStatus ?? "EXACT",
    ...input,
  };
}

function createMemoryOpportunityStore(seed: {
  offers?: ExactOfferSnapshot[];
  opportunities?: OpportunitySnapshot[];
}): AffiliateOpportunityStore & {
  offers: ExactOfferSnapshot[];
  opportunities: OpportunitySnapshot[];
} {
  const offers = [...(seed.offers ?? [])];
  const opportunities = [...(seed.opportunities ?? [])];
  let seq = 1;

  return {
    offers,
    opportunities,
    async listExactOffers(productId) {
      return offers.filter(
        (item) => item.productId === productId && item.matchStatus === "EXACT",
      );
    },
    async listOpportunitiesForOffers(productId, currentOffers) {
      const externalIds = new Set(
        currentOffers
          .map((item) => item.externalId?.trim() || "")
          .filter(Boolean),
      );
      return opportunities.filter(
        (item) =>
          item.productId === productId ||
          externalIds.has(item.externalId),
      );
    },
    async createPendingOpportunity(current) {
      const created = opportunity({
        id: `opp-${seq++}`,
        productId: current.productId,
        externalId: current.externalId ?? current.id,
        sourceUrl: current.sourceUrl ?? "",
        status: "WAITING_AFFILIATE",
        affiliateLink: null,
        matchStatus: "EXACT",
      });
      opportunities.push(created);
      return created;
    },
    async reusePendingOpportunity(existing, current) {
      existing.productId = current.productId;
      existing.externalId = current.externalId ?? existing.externalId;
      existing.sourceUrl = current.sourceUrl ?? existing.sourceUrl;
      existing.status = "WAITING_AFFILIATE";
      existing.affiliateLink = null;
      existing.matchStatus = "EXACT";
      return existing;
    },
    async markOfferAwaitingAffiliate(current) {
      const target = offers.find((item) => item.id === current.id);
      if (!target || target.productId !== current.productId) {
        return;
      }
      target.status = "PENDING_AFFILIATE";
      if (
        target.affiliateLink &&
        target.sourceUrl &&
        target.affiliateLink === target.sourceUrl
      ) {
        target.affiliateLink = null;
      }
    },
  };
}

function createMemoryApplyStore(seed: {
  offers?: ExactOfferSnapshot[];
  opportunities?: OpportunitySnapshot[];
}): ApplyAffiliateLinkStore & {
  offers: ExactOfferSnapshot[];
  opportunities: OpportunitySnapshot[];
} {
  const offers = [...(seed.offers ?? [])];
  const opportunities = [...(seed.opportunities ?? [])];

  return {
    offers,
    opportunities,
    async findOpportunityById(id) {
      return opportunities.find((item) => item.id === id) ?? null;
    },
    async findOfferById(id) {
      return offers.find((item) => item.id === id) ?? null;
    },
    async findMercadoLivreOfferForProduct(productId) {
      return (
        offers.find(
          (item) =>
            item.productId === productId &&
            item.marketplace === "MERCADO_LIVRE",
        ) ?? null
      );
    },
    async listOfferIdsForProduct(productId) {
      return offers
        .filter((item) => item.productId === productId)
        .map((item) => item.id);
    },
    async activateOfferAffiliate(current, affiliateLink) {
      const target = offers.find((item) => item.id === current.id);
      if (!target || target.productId !== current.productId) {
        throw new Error("Oferta de outro Product.");
      }
      target.affiliateLink = affiliateLink;
      target.status = "ACTIVE";
    },
    async resolveOpportunitiesForOffer(current, affiliateLink, preferredId) {
      let resolvedId: string | null = null;
      for (const item of opportunities) {
        if (item.productId !== current.productId) {
          continue;
        }
        if (item.marketplace !== "MERCADO_LIVRE") {
          continue;
        }
        if (
          current.externalId &&
          item.externalId &&
          item.externalId !== current.externalId &&
          item.id !== preferredId
        ) {
          continue;
        }
        item.affiliateLink = affiliateLink;
        item.status = "PUBLISHED";
        resolvedId = item.id;
      }
      return preferredId ?? resolvedId;
    },
  };
}

const mlBarato = offer({
  id: "ml-1",
  marketplace: "MERCADO_LIVRE",
  externalId: "MLB-1",
  price: 899,
  affiliateLink: null,
  status: "PENDING_AFFILIATE",
});

const amazonCara = offer({
  id: "amz-1",
  marketplace: "AMAZON",
  externalId: "B00AMZ",
  price: 1099,
  affiliateLink: AFFILIATE_AMAZON,
  status: "ACTIVE",
  sourceUrl: "https://www.amazon.com.br/dp/B00AMZ",
});

const mlCaro = offer({
  id: "ml-caro",
  marketplace: "MERCADO_LIVRE",
  externalId: "MLB-2",
  price: 1400,
  affiliateLink: null,
});

const mlNaoExact = offer({
  id: "ml-high",
  marketplace: "MERCADO_LIVRE",
  externalId: "MLB-3",
  price: 500,
  matchStatus: "HIGH",
  affiliateLink: null,
});

const mlComAfiliado = offer({
  id: "ml-aff",
  marketplace: "MERCADO_LIVRE",
  externalId: "MLB-4",
  price: 799,
  affiliateLink: AFFILIATE_ML,
  status: "ACTIVE",
});

async function run() {
{
  const decision = decidirOportunidadeAfiliadoMenorPreco([
    mlBarato,
    amazonCara,
  ]);
  assert.equal(decision.action, "CREATE_PENDING");
  assert.equal(decision.reason, "ML_LOWEST_WITHOUT_AFFILIATE");
  if (decision.action === "CREATE_PENDING") {
    assert.equal(decision.offer.id, "ml-1");
  }
}

{
  const store = createMemoryOpportunityStore({
    offers: [mlBarato, amazonCara],
  });
  const first = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
    "prod-1",
    store,
  );
  assert.equal(first.decision.action, "CREATE_PENDING");
  assert.equal(store.opportunities.length, 1);
  assert.equal(store.opportunities[0]?.status, "WAITING_AFFILIATE");
  assert.equal(store.opportunities[0]?.productId, "prod-1");
  assert.equal(store.offers.find((item) => item.id === "ml-1")?.status, "PENDING_AFFILIATE");
}

{
  const decision = decidirOportunidadeAfiliadoMenorPreco([
    mlCaro,
    amazonCara,
  ]);
  assert.equal(decision.action, "SKIP");
  assert.equal(decision.reason, "ML_NOT_LOWEST");

  const store = createMemoryOpportunityStore({
    offers: [mlCaro, amazonCara],
  });
  const result = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
    "prod-1",
    store,
  );
  assert.equal(result.opportunityId, null);
  assert.equal(store.opportunities.length, 0);
}

{
  const decision = decidirOportunidadeAfiliadoMenorPreco([
    mlNaoExact,
    amazonCara,
  ]);
  assert.equal(decision.action, "SKIP");
  assert.equal(decision.reason, "ML_NOT_EXACT");

  const store = createMemoryOpportunityStore({
    offers: [mlNaoExact, amazonCara],
  });
  const result = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
    "prod-1",
    store,
  );
  assert.equal(result.opportunityId, null);
  assert.equal(store.opportunities.length, 0);
}

{
  const decision = decidirOportunidadeAfiliadoMenorPreco([
    mlComAfiliado,
    amazonCara,
  ]);
  assert.equal(decision.action, "SKIP");
  assert.equal(decision.reason, "ML_HAS_AFFILIATE");

  const store = createMemoryOpportunityStore({
    offers: [mlComAfiliado, amazonCara],
  });
  const result = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
    "prod-1",
    store,
  );
  assert.equal(result.opportunityId, null);
  assert.equal(store.opportunities.length, 0);
}

{
  const sourceAsAffiliate = offer({
    id: "ml-copy",
    marketplace: "MERCADO_LIVRE",
    externalId: "MLB-COPY",
    price: 700,
    affiliateLink: SOURCE_ML,
    sourceUrl: SOURCE_ML,
    status: "ACTIVE",
  });
  const decision = decidirOportunidadeAfiliadoMenorPreco([
    sourceAsAffiliate,
    amazonCara,
  ]);
  assert.equal(decision.action, "CREATE_PENDING");
  assert.equal(
    resolverHrefProprioOfertaPublica(sourceAsAffiliate),
    null,
    "sourceUrl copiado para affiliateLink nao libera compra.",
  );
}

{
  const store = createMemoryOpportunityStore({
    offers: [mlBarato, amazonCara],
  });
  const first = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
    "prod-1",
    store,
  );
  const second = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
    "prod-1",
    store,
  );
  assert.equal(store.opportunities.length, 1, "duas pesquisas nao duplicam");
  assert.equal(first.opportunityId, second.opportunityId);
  assert.equal(second.decision.action, "REUSE_PENDING");
  assert.equal(store.opportunities[0]?.status, "WAITING_AFFILIATE");
}

{
  const ml = offer({
    id: "ml-apply",
    marketplace: "MERCADO_LIVRE",
    externalId: "MLB-APPLY",
    price: 810,
    affiliateLink: null,
  });
  const amazon = offer({
    id: "amz-apply",
    marketplace: "AMAZON",
    externalId: "B00APPLY",
    price: 990,
    affiliateLink: AFFILIATE_AMAZON,
    status: "ACTIVE",
    sourceUrl: "https://www.amazon.com.br/dp/B00APPLY",
  });
  const otherProductMl = offer({
    id: "ml-other",
    productId: "prod-2",
    marketplace: "MERCADO_LIVRE",
    externalId: "MLB-OTHER",
    price: 100,
    affiliateLink: null,
  });
  const pending = opportunity({
    id: "opp-apply",
    externalId: "MLB-APPLY",
    status: "WAITING_AFFILIATE",
  });
  const otherOpportunity = opportunity({
    id: "opp-other",
    productId: "prod-2",
    externalId: "MLB-OTHER",
    status: "WAITING_AFFILIATE",
  });
  const store = createMemoryApplyStore({
    offers: [ml, amazon, otherProductMl],
    opportunities: [pending, otherOpportunity],
  });

  const applied = await applyConfirmedAffiliateLinkToOwnedOffer(
    {
      opportunityId: "opp-apply",
      affiliateLink: AFFILIATE_ML,
    },
    store,
  );

  assert.equal(applied.ok, true);
  if (applied.ok) {
    assert.equal(applied.offerId, "ml-apply");
    assert.equal(applied.opportunityId, "opp-apply");
    assert.deepEqual(applied.otherOfferIdsUnchanged, ["amz-apply"]);
  }

  assert.equal(store.offers.find((item) => item.id === "ml-apply")?.affiliateLink, AFFILIATE_ML);
  assert.equal(store.offers.find((item) => item.id === "ml-apply")?.status, "ACTIVE");
  assert.equal(store.opportunities.find((item) => item.id === "opp-apply")?.status, "PUBLISHED");
  assert.equal(
    store.offers.find((item) => item.id === "amz-apply")?.affiliateLink,
    AFFILIATE_AMAZON,
    "outra MarketplaceOffer do mesmo Product nao e afetada",
  );
  assert.equal(
    store.offers.find((item) => item.id === "ml-other")?.affiliateLink,
    null,
    "MarketplaceOffer de outro Product nao e afetada",
  );
  assert.equal(
    store.opportunities.find((item) => item.id === "opp-other")?.status,
    "WAITING_AFFILIATE",
  );
}

{
  const ml = offer({
    id: "ml-mismatch",
    productId: "prod-1",
    marketplace: "MERCADO_LIVRE",
    externalId: "MLB-1",
  });
  const foreign = opportunity({
    id: "opp-foreign",
    productId: "prod-2",
    externalId: "MLB-1",
  });
  assert.equal(opportunityAlteraOutroProduct(foreign, ml), true);
  assert.equal(
    offerPertenceAOportunidade(foreign, ml).ok,
    false,
  );

  const store = createMemoryApplyStore({
    offers: [ml],
    opportunities: [foreign],
  });
  const applied = await applyConfirmedAffiliateLinkToOwnedOffer(
    {
      opportunityId: "opp-foreign",
      offerId: "ml-mismatch",
      affiliateLink: AFFILIATE_ML,
    },
    store,
  );
  assert.equal(applied.ok, false);
  if (!applied.ok) {
    assert.equal(applied.code, "PRODUCT_MISMATCH");
  }
  assert.equal(store.offers[0]?.affiliateLink, null);
}

{
  const awaiting = offer({
    id: "ml-wait",
    marketplace: "MERCADO_LIVRE",
    affiliateLink: null,
    sourceUrl: SOURCE_ML,
    status: "PENDING_AFFILIATE",
  });
  const sanitized = sanitizarOfertaCompraPublica(awaiting);
  assert.equal(sanitized.sourceUrl, null);
  assert.equal(sanitized.affiliateLink, null);
  assert.equal(
    resolverHrefProprioOfertaPublica({
      ...awaiting,
      status: "PENDING_AFFILIATE",
    }),
    null,
    "cliente nunca recebe sourceUrl como href enquanto aguarda afiliado",
  );
}

console.log("lowestPriceAffiliateOpportunity.test.ts ok");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
