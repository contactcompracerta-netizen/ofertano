import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  sanitizarOfertaCompraPublica,
} from "@/lib/affiliates/liveOffers";
import { resolverHrefProprioOfertaPublica } from "@/lib/affiliates/publicPurchase";
import { validateOfficialMercadoLivreAffiliateLink } from "@/lib/affiliates/validateAdminAffiliateLink";
import {
  canDispatchPendingAffiliateOpportunity,
  opportunityDispatchKey,
  shouldMarkDispatchDelivered,
} from "@/services/admin-push/eligibility";
import { buildAdminPushPayload } from "@/services/admin-push/payload";
import { buildPublicSearchHandoffUrl } from "@/services/imageSearch";
import {
  applyConfirmedAffiliateLinkToOwnedOffer,
  type ApplyAffiliateLinkStore,
} from "@/services/opportunities/applyAffiliateLink";
import {
  ensureMercadoLivreLowestPriceAffiliateOpportunity,
  type AffiliateOpportunityStore,
  type ExactOfferSnapshot,
  type OpportunitySnapshot,
} from "@/services/opportunities/lowestPriceAffiliateOpportunity";

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
          item.productId === productId || externalIds.has(item.externalId),
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
      if (target) {
        target.status = "PENDING_AFFILIATE";
      }
    },
  };
}

function createMemoryApplyStore(seed: {
  offers: ExactOfferSnapshot[];
  opportunities: OpportunitySnapshot[];
}): ApplyAffiliateLinkStore & {
  offers: ExactOfferSnapshot[];
  opportunities: OpportunitySnapshot[];
} {
  const offers = [...seed.offers];
  const opportunities = [...seed.opportunities];

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
            item.productId === productId && item.marketplace === "MERCADO_LIVRE",
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
      if (!target) {
        return;
      }
      target.affiliateLink = affiliateLink;
      target.status = "ACTIVE";
      target.active = true;
      target.available = true;
    },
    async resolveOpportunitiesForOffer(current, affiliateLink, preferredId) {
      for (const item of opportunities) {
        if (
          item.marketplace === "MERCADO_LIVRE" &&
          item.productId === current.productId &&
          (!current.externalId || item.externalId === current.externalId)
        ) {
          item.affiliateLink = affiliateLink;
          item.status = "PUBLISHED";
        }
      }
      return preferredId ?? opportunities.find((item) => item.status === "PUBLISHED")?.id ?? null;
    },
  };
}

async function run() {
  const ml = offer({
    id: "ml-1",
    marketplace: "MERCADO_LIVRE",
    externalId: "MLB-1",
    price: 899,
    affiliateLink: null,
  });
  const amazon = offer({
    id: "amz-1",
    marketplace: "AMAZON",
    externalId: "B00TEST123",
    price: 1099,
    status: "ACTIVE",
    affiliateLink: AFFILIATE_AMAZON,
    sourceUrl: "https://www.amazon.com.br/dp/B00TEST123",
  });

  // CASO 1 — ML EXACT menor preço, sem affiliateLink
  const store1 = createMemoryOpportunityStore({ offers: [ml, amazon] });
  const first = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
    "prod-1",
    store1,
  );
  assert.equal(first.decision.action, "CREATE_PENDING");
  assert.equal(first.decision.reason, "ML_LOWEST_WITHOUT_AFFILIATE");
  assert.ok(first.opportunityId);
  assert.equal(store1.opportunities.length, 1);
  assert.equal(store1.opportunities[0]?.status, "WAITING_AFFILIATE");
  assert.equal(
    canDispatchPendingAffiliateOpportunity({
      marketplace: "MERCADO_LIVRE",
      status: store1.opportunities[0]!.status as string,
    }),
    true,
    "CASO 1: Push elegível a partir da ProductOpportunity WAITING_AFFILIATE.",
  );

  const delivered = new Set<string>();
  const dispatchKey = opportunityDispatchKey(first.opportunityId!);
  assert.equal(delivered.has(dispatchKey), false);
  delivered.add(dispatchKey);
  assert.equal(
    shouldMarkDispatchDelivered({ sent: 1, failed: 0 }),
    true,
  );

  // CASO 2 — mesma pesquisa novamente
  const second = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
    "prod-1",
    store1,
  );
  assert.equal(second.decision.action, "REUSE_PENDING");
  assert.equal(second.opportunityId, first.opportunityId);
  assert.equal(store1.opportunities.length, 1);
  assert.equal(
    delivered.has(opportunityDispatchKey(second.opportunityId!)),
    true,
    "CASO 2: dispatch já entregue não gera segunda notificação.",
  );

  // CASO 3 — ML não é menor
  const shopeeCheaper = offer({
    id: "shp-1",
    marketplace: "SHOPEE",
    price: 790,
    status: "ACTIVE",
    affiliateLink: "https://shopee.com.br/x",
  });
  const store3 = createMemoryOpportunityStore({
    offers: [{ ...ml, price: 899 }, shopeeCheaper],
  });
  const notLowest = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
    "prod-1",
    store3,
  );
  assert.equal(notLowest.decision.action, "SKIP");
  assert.equal(notLowest.decision.reason, "ML_NOT_LOWEST");
  assert.equal(notLowest.opportunityId, null);
  assert.equal(store3.opportunities.length, 0);
  assert.equal(
    canDispatchPendingAffiliateOpportunity({
      marketplace: "MERCADO_LIVRE",
      status: "PUBLISHED",
    }),
    false,
  );

  // CASO 4 — ML não é EXACT
  const store4 = createMemoryOpportunityStore({
    offers: [
      { ...ml, matchStatus: "HIGH" },
      amazon,
    ],
  });
  const notExact = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
    "prod-1",
    store4,
  );
  assert.equal(notExact.decision.action, "SKIP");
  assert.equal(notExact.decision.reason, "ML_NOT_EXACT");
  assert.equal(store4.opportunities.length, 0);

  // CASO 5 — ML já tem affiliateLink
  const store5 = createMemoryOpportunityStore({
    offers: [{ ...ml, affiliateLink: AFFILIATE_ML, status: "ACTIVE" }, amazon],
  });
  const hasAffiliate = await ensureMercadoLivreLowestPriceAffiliateOpportunity(
    "prod-1",
    store5,
  );
  assert.equal(hasAffiliate.decision.action, "SKIP");
  assert.equal(hasAffiliate.decision.reason, "ML_HAS_AFFILIATE");
  assert.equal(store5.opportunities.length, 0);

  // CASO 6 — Admin salva link
  const pending = opportunity({
    id: "opp-apply",
    productId: "prod-1",
    externalId: "MLB-1",
    status: "WAITING_AFFILIATE",
  });
  const otherProductMl = offer({
    id: "ml-other",
    productId: "prod-2",
    marketplace: "MERCADO_LIVRE",
    externalId: "MLB-OTHER",
    affiliateLink: null,
  });
  const applyStore = createMemoryApplyStore({
    offers: [
      { ...ml, id: "ml-apply", externalId: "MLB-1", affiliateLink: null },
      amazon,
      otherProductMl,
    ],
    opportunities: [pending],
  });
  const canonical = validateOfficialMercadoLivreAffiliateLink(AFFILIATE_ML);
  assert.ok(canonical, "CASO 6: URL afiliada validada pela regra canônica.");
  const applied = await applyConfirmedAffiliateLinkToOwnedOffer(
    {
      opportunityId: "opp-apply",
      affiliateLink: AFFILIATE_ML,
    },
    applyStore,
  );
  assert.equal(applied.ok, true);
  if (applied.ok) {
    assert.equal(applied.offerId, "ml-apply");
    assert.equal(applied.opportunityId, "opp-apply");
    assert.ok(applied.otherOfferIdsUnchanged.includes("amz-1"));
  }
  assert.equal(
    applyStore.offers.find((item) => item.id === "ml-apply")?.affiliateLink,
    AFFILIATE_ML,
  );
  assert.equal(
    applyStore.offers.find((item) => item.id === "ml-apply")?.status,
    "ACTIVE",
  );
  assert.equal(
    applyStore.opportunities.find((item) => item.id === "opp-apply")?.status,
    "PUBLISHED",
  );
  assert.equal(
    applyStore.offers.find((item) => item.id === "amz-1")?.affiliateLink,
    AFFILIATE_AMAZON,
    "outra oferta do mesmo Product não muda.",
  );
  assert.equal(
    applyStore.offers.find((item) => item.id === "ml-other")?.affiliateLink,
    null,
  );

  const invalid = await applyConfirmedAffiliateLinkToOwnedOffer(
    {
      opportunityId: "opp-apply",
      affiliateLink: SOURCE_ML,
    },
    applyStore,
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.code, "INVALID_AFFILIATE_LINK");
  }

  // CASO 7 — live-offers nunca usa sourceUrl como CTA
  const awaiting = offer({
    id: "ml-wait",
    marketplace: "MERCADO_LIVRE",
    affiliateLink: null,
    sourceUrl: SOURCE_ML,
    status: "PENDING_AFFILIATE",
  });
  const pendingPublic = sanitizarOfertaCompraPublica(awaiting);
  assert.equal(pendingPublic.sourceUrl, null);
  assert.equal(pendingPublic.affiliateLink, null);
  assert.equal(resolverHrefProprioOfertaPublica(awaiting), null);

  const releasedPublic = sanitizarOfertaCompraPublica({
    ...awaiting,
    affiliateLink: AFFILIATE_ML,
    status: "ACTIVE",
  });
  assert.equal(releasedPublic.sourceUrl, null);
  assert.equal(releasedPublic.affiliateLink, AFFILIATE_ML);
  assert.equal(
    resolverHrefProprioOfertaPublica({
      ...awaiting,
      affiliateLink: AFFILIATE_ML,
      status: "ACTIVE",
    }),
    AFFILIATE_ML,
  );

  // CASO 8 — Push anti-spam, 404/410 e focus
  const payload = buildAdminPushPayload({
    focusId: first.opportunityId!,
    opportunityKey: dispatchKey,
  });
  assert.equal(
    payload.data.url,
    `/admin/oportunidades?focus=${first.opportunityId}`,
  );
  assert.equal(payload.data.focusId, first.opportunityId);
  assert.equal(
    shouldMarkDispatchDelivered({ sent: 0, failed: 1 }),
    false,
    "404/410 sem entrega não marca dispatch.",
  );

  const subscribeSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/admin/push/subscribe/route.ts"),
    "utf8",
  );
  assert.match(subscribeSource, /upsert\(/);
  assert.match(subscribeSource, /duplicated: Boolean\(existing\)/);

  const sendSource = fs.readFileSync(
    path.join(process.cwd(), "src/services/admin-push/send.ts"),
    "utf8",
  );
  assert.match(sendSource, /isPermanentPushFailure/);
  assert.match(sendSource, /adminPushSubscription\.deleteMany/);

  const saveProductSource = fs.readFileSync(
    path.join(process.cwd(), "src/services/database/saveProduct.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    saveProductSource,
    /notifyPendingAffiliate|notifyMlPending|queueMicrotask/,
    "saveProduct não recalcula oportunidade nem dispara Push.",
  );

  const lowestSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/services/opportunities/lowestPriceAffiliateOpportunity.ts",
    ),
    "utf8",
  );
  assert.match(
    lowestSource,
    /notifyPendingAffiliateOpportunitySafe/,
    "Push nasce como consequência da ProductOpportunity válida.",
  );

  const releaseSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/opportunities/release/route.ts"),
    "utf8",
  );
  assert.match(releaseSource, /applyConfirmedAffiliateLinkWithProductSync/);
  assert.doesNotMatch(releaseSource, /marketplaceOffer\.updateMany/);

  // CASO 9 — pesquisa por imagem
  const handoff = buildPublicSearchHandoffUrl("jbl tune 520bt");
  assert.match(handoff, /^\/\?q=/);
  assert.match(handoff, /jbl/i);

  const imageButton = fs.readFileSync(
    path.join(process.cwd(), "src/components/ImageSearchButton.tsx"),
    "utf8",
  );
  assert.doesNotMatch(imageButton, /saveProduct/);
  assert.match(imageButton, /action="\/"/);
  assert.match(imageButton, /name=\{IMAGE_SEARCH_QUERY_PARAM\}/);

  const recognize = fs.readFileSync(
    path.join(process.cwd(), "src/lib/imageSearch/recognizeInBrowser.ts"),
    "utf8",
  );
  assert.match(recognize, /await import\("tesseract\.js"\)/);
  assert.doesNotMatch(recognize, /from ["']tesseract\.js["']/);

  const hero = fs.readFileSync(
    path.join(process.cwd(), "src/components/Hero.tsx"),
    "utf8",
  );
  assert.doesNotMatch(hero, /tesseract/);
  assert.match(hero, /ImageSearchButton/);

  const imageSearchIndex = fs.readFileSync(
    path.join(process.cwd(), "src/services/imageSearch/index.ts"),
    "utf8",
  );
  assert.doesNotMatch(imageSearchIndex, /saveProduct/);
  assert.doesNotMatch(imageSearchIndex, /EXACT/);

  // CASO 10 — regressão da página de produto
  const productPage = fs.readFileSync(
    path.join(process.cwd(), "src/app/produto/[id]/page.tsx"),
    "utf8",
  );
  for (const token of [
    "ProductGallery",
    "FavoriteButton",
    "PriceAlertButton",
    "ProductLivePurchase",
    "LiveComparatorOffers",
    "LivePrimaryBuyButton",
    "LiveMobileBuyBar",
    "Sobre o produto",
    "Ficha técnica",
    "generateMetadata",
    "Header",
    "Footer",
  ]) {
    assert.match(
      productPage,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `CASO 10: ${token} precisa permanecer na página de produto.`,
    );
  }

  const adminPage = fs.readFileSync(
    path.join(process.cwd(), "src/app/admin/oportunidades/page.tsx"),
    "utf8",
  );
  assert.doesNotMatch(adminPage, /<table[\s>]/);
  assert.match(adminPage, /Salvar e liberar oferta/);
  assert.match(adminPage, /get\("focus"\)/);
  assert.match(adminPage, /scroll-mt-24/);
  assert.match(adminPage, /min-h-12 w-full/);
  assert.match(adminPage, /grid-cols-2/);

  const adminPushButton = fs.readFileSync(
    path.join(process.cwd(), "src/app/admin/oportunidades/AdminPushButton.tsx"),
    "utf8",
  );
  assert.match(adminPushButton, /Ativar notificações/);

  const nextConfig = fs.readFileSync(
    path.join(process.cwd(), "next.config.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    nextConfig,
    /serverExternalPackages/,
    "Tesseract é client-side; não precisa de serverExternalPackages.",
  );

  const realtimeSql = fs.readFileSync(
    path.join(
      process.cwd(),
      "prisma/supabase-realtime-marketplace-offer.sql",
    ),
    "utf8",
  );
  assert.match(realtimeSql, /ADD TABLE "MarketplaceOffer"/);
  assert.doesNotMatch(
    realtimeSql,
    /ALTER TABLE[\s\S]*REPLICA IDENTITY/i,
    "Realtime não altera a identidade de réplica da tabela.",
  );

  const livePurchase = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/components/product/ProductLivePurchase.tsx",
    ),
    "utf8",
  );
  assert.doesNotMatch(livePurchase, /payload\.old/);
  assert.match(livePurchase, /removeChannel/);
  assert.match(livePurchase, /productId=eq\.\$\{productId\}/);
  assert.match(livePurchase, /aindaAguardaAfiliadoMercadoLivre/);
  assert.match(livePurchase, /clearInterval/);

  console.log("convergence.integration.test.ts ok");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
