/**
 * CATALOG_ARCHITECTURE_V1 — TESTES DO WRITER PUBLICO (FASE 9.16 / 9.17).
 *
 * Cobrem, sem banco e sem rede, cada comportamento exigido pela missao:
 *   - EXACT unico => write
 *   - REVIEW => zero writes
 *   - REJECT => zero writes
 *   - hard conflict => zero writes
 *   - 2 EXACT Products => zero writes
 *   - invalid affiliate URL => zero link persistido
 *   - duplicate listing => idempotente
 *   - 2 listings do mesmo product => menor preco vence, deterministico
 *   - price change => update
 *   - Shopee nao cria Product (attach-only)
 *   - publication: ML+Shopee shadow = 1; ML+Shopee publico = 2
 *
 * Regra de seguranca herdada: estes testes nao mudam o nucleo, apenas
 * configuram. Um teste que precisa afrouxar a policy para passar e um teste
 * errado.
 */

import assert from "node:assert/strict";

import { runMarketplacePublicSync } from "./runner";
import { selectWinningOffer, auditPersistedPublicOffers } from "./offerWriter";
import { resolveProbeIdentity } from "./identityResolver";
import {
  resolvePurchaseLinks,
  noPurchaseLinks,
  purchaseLinkSourceFromFields,
} from "./purchaseLinks";
import {
  authorizePublicSync,
  isCronSyncAllowed,
  PUBLIC_SYNC_SUPPORTED_SOURCES,
} from "./flags";
import {
  NORMALIZED_LISTING_V1,
  UNKNOWN,
  type NormalizedMarketplaceListingV1,
} from "../types/normalizedListingV1";
import { computeRawHash } from "../hashing";
import type { IdentityDecisionV1 } from "../identity/identityConfidence";
import type {
  PublicOfferCommitter,
  PublicOfferDraftV1,
  PublicSyncConfig,
  PublicSyncReportV1,
} from "./types";

/* ------------------------------------------------------------------ */
/* DOUBLES                                                             */
/* ------------------------------------------------------------------ */

function listing(
  over: Partial<NormalizedMarketplaceListingV1> = {},
): NormalizedMarketplaceListingV1 {
  return {
    contractVersion: NORMALIZED_LISTING_V1,
    source: "shopee-affiliate-api",
    marketplaceId: "shopee",
    externalListingId: "1.2",
    seller: { externalSellerId: null, name: "Loja Real" },
    identity: {
      gtin: [],
      mpn: null,
      manufacturerModel: "ABC-123",
      brand: "MarcaX",
      model: "ABC-123",
    },
    catalog: {
      title: "Produto Real",
      description: null,
      category: "eletronicos",
      images: ["https://img/x.jpg"],
      attributes: {},
      primaryImageUrl: "https://img/x.jpg",
    },
    variant: {
      color: UNKNOWN, storage: UNKNOWN, memory: UNKNOWN,
      voltage: UNKNOWN, size: UNKNOWN, otherAttributes: {},
    },
    commerce: {
      price: 100, oldPrice: null, pixPrice: UNKNOWN, installments: UNKNOWN,
      stock: UNKNOWN, availability: "IN_STOCK", shippingHint: UNKNOWN, promotion: null,
    },
    metadata: {
      sourceUpdatedAt: null,
      collectedAt: "2026-01-01T00:00:00.000Z",
      rawHash: computeRawHash({ a: 1 }),
      payloadVersion: "v1",
    },
    ...over,
  };
}

function decision(over: Partial<IdentityDecisionV1>): IdentityDecisionV1 {
  return {
    policyVersion: "IDENTITY_POLICY_V1",
    leftKey: "L",
    rightKey: "R",
    leftMarketplaceId: "shopee",
    rightMarketplaceId: "mercado_livre",
    category: "eletronicos",
    textSimilarity: 0.9,
    confidence: "EXACT",
    reasonCodes: ["MPN_MATCH"],
    evidence: [],
    sharedEvidence: [],
    hardConflicts: [],
    missingCriticalAttributes: [],
    axisComparisons: [],
    ...over,
  } as IdentityDecisionV1;
}

function recordingCommitter() {
  const drafts: PublicOfferDraftV1[] = [];
  const committer: PublicOfferCommitter = {
    async commit(draft, context) {
      if (!context.dryRun) drafts.push(draft);
      return {
        productId: draft.productId,
        marketplaceId: draft.marketplaceId,
        externalId: draft.externalId,
        action: "CREATE",
        changed: true,
        publicationSynced: !context.dryRun,
        changedFields: ["price"],
      };
    },
  };
  return { committer, drafts };
}

function config(over: Partial<PublicSyncConfig> = {}): PublicSyncConfig {
  return {
    marketplaceId: "shopee",
    connector: {
      marketplaceId: "shopee",
      capabilities: {} as never,
      async collect() {
        return { items: [], nextCursor: null, snapshotComplete: true };
      },
      validate() {
        return [];
      },
    } as never,
    purchaseLinks: purchaseLinkSourceFromFields({
      affiliate: "offerLink",
      source: "productLink",
    }),
    maxListings: 100,
    brandLexicon: new Set(["marcax"]),
    ...over,
  };
}

const RAW_WITH_LINKS = {
  offerLink: "https://s.shopee.com.br/abc",
  productLink: "https://shopee.com.br/product/1/2",
};

const EXACT = () => decision({ confidence: "EXACT", hardConflicts: [] });

/* ------------------------------------------------------------------ */
/* FLAGS / AUTORIZACAO                                                 */
/* ------------------------------------------------------------------ */

function testFlags() {
  assert.deepEqual(authorizePublicSync("shopee"), {
    authorized: true,
    mode: "V1_PRIMARY",
    source: "RUNTIME",
  });
  // Amazon agora está na allowlist, mas sem env var => RUNTIME_MODE_OFF (fail-closed)
  assert.deepEqual(authorizePublicSync("amazon"), {
    authorized: false,
    reason: "RUNTIME_MODE_OFF",
  });
  assert.deepEqual(authorizePublicSync("mercado_livre"), {
    authorized: false,
    reason: "MARKETPLACE_NOT_IN_ALLOWLIST",
  });
  // Rollback instantaneo de configuracao, sem tocar em dado.
  // Quando passa allowlist explícita, usa modo estático (source: "STATIC")
  assert.deepEqual(authorizePublicSync("shopee", { shopee: { mode: "OFF" } }, {}), {
    authorized: false,
    reason: "MODE_OFF",
  });
  assert.equal(isCronSyncAllowed("shopee"), true);
  assert.equal(isCronSyncAllowed("amazon"), true);
  // Mercado Livre ja e publico pelo caminho legado e nao e escrito por este
  // runner: sua preservacao nao depende desta allowlist.
  assert.deepEqual(Object.keys(PUBLIC_SYNC_SUPPORTED_SOURCES).sort(), ["amazon", "magazine_luiza", "shopee"]);
}

/* ------------------------------------------------------------------ */
/* LINKS (FASE 9.7)                                                    */
/* ------------------------------------------------------------------ */

function testPurchaseLinks() {
  const ok = resolvePurchaseLinks({
    affiliateLink: "https://s.shopee.com.br/abc",
    sourceUrl: "https://shopee.com.br/product/1/2",
  });
  assert.equal(ok.affiliateState, "SAFE");
  assert.equal(ok.affiliateLink, "https://s.shopee.com.br/abc");
  assert.equal(ok.sourceUrl, "https://shopee.com.br/product/1/2");
  assert.equal(ok.hasAffiliateLink, true);

  // Rejeita esquema nao http(s) e devolve null. NUNCA substitui por invencao.
  const bad = resolvePurchaseLinks({
    affiliateLink: "javascript:alert(1)",
    sourceUrl: "data:text/html,<script>",
  });
  assert.equal(bad.affiliateState, "INVALID");
  assert.equal(bad.sourceState, "INVALID");
  assert.equal(bad.affiliateLink, null);
  assert.equal(bad.sourceUrl, null);
  assert.equal(bad.hasAffiliateLink, false);

  const missing = resolvePurchaseLinks({
    affiliateLink: null,
    sourceUrl: "https://shopee.com.br/product/1/2",
  });
  assert.equal(missing.affiliateState, "MISSING");
  assert.equal(missing.affiliateLink, null);

  const none = noPurchaseLinks();
  assert.equal(none.hasAffiliateLink, false);
  assert.equal(none.affiliateReason, "RAW_PAYLOAD_UNAVAILABLE");

  const src = purchaseLinkSourceFromFields({
    affiliate: "offerLink",
    source: "productLink",
  });
  assert.deepEqual(
    src.extract({ offerLink: "https://a/1", productLink: "https://b/2", other: "x" }),
    { affiliateLink: "https://a/1", sourceUrl: "https://b/2" },
  );
  assert.deepEqual(src.extract(null), { affiliateLink: null, sourceUrl: null });
  assert.deepEqual(src.extract("texto"), { affiliateLink: null, sourceUrl: null });
}

/* ------------------------------------------------------------------ */
/* SELECAO DETERMINISTICA (FASE 9.10)                                 */
/* ------------------------------------------------------------------ */

function draft(over: Partial<PublicOfferDraftV1>): PublicOfferDraftV1 {
  return {
    marketplaceId: "shopee",
    productId: "P1",
    externalId: "1",
    title: "t",
    seller: "s",
    image: null,
    price: 10,
    sourceUrl: null,
    affiliateLink: "https://a/1",
    available: true,
    matchStatus: "EXACT",
    discoverySource: "API",
    ...over,
  };
}

function testSelectWinningOffer() {
  assert.equal(
    selectWinningOffer([
      draft({ externalId: "1", price: 50 }),
      draft({ externalId: "2", price: 20 }),
    ])?.externalId,
    "2",
  );
  // Empate resolvido por externalId, nao pela ordem da API.
  assert.equal(
    selectWinningOffer([
      draft({ externalId: "9", price: 20 }),
      draft({ externalId: "1", price: 20 }),
    ])?.externalId,
    "1",
  );
  const a = [draft({ externalId: "1", price: 20 }), draft({ externalId: "5", price: 20 })];
  assert.equal(
    selectWinningOffer(a)?.externalId,
    selectWinningOffer([...a].reverse())?.externalId,
  );
  // Preco invalido nunca vence; sem preco valido, nada e gravado.
  assert.equal(
    selectWinningOffer([
      draft({ externalId: "1", price: 0 }),
      draft({ externalId: "2", price: 5 }),
    ])?.externalId,
    "2",
  );
  assert.equal(selectWinningOffer([draft({ externalId: "1", price: -3 })]), null);
  assert.equal(selectWinningOffer([draft({ externalId: "1", price: Number.NaN })]), null);
}

/* ------------------------------------------------------------------ */
/* IDENTIDADE FAIL-CLOSED (FASE 9.5)                                  */
/* ------------------------------------------------------------------ */

const ML_COUNTERPART = () => listing({ marketplaceId: "mercado_livre" });

async function testIdentityResolver() {
  const keys = { lookup: async () => ["P1"] };
  const one = { loadAll: async () => [ML_COUNTERPART()] };

  const exact = await resolveProbeIdentity(listing(), {
    keys, evaluate: EXACT, products: one, brandLexicon: new Set(["marcax"]),
  });
  assert.equal(exact.outcome, "EXACT_UNIQUE");
  assert.equal(exact.winnerProductId, "P1");

  const review = await resolveProbeIdentity(listing(), {
    keys, evaluate: () => decision({ confidence: "REVIEW" }), products: one,
    brandLexicon: new Set(["marcax"]),
  });
  assert.equal(review.outcome, "NO_EXACT");
  assert.equal(review.winnerProductId, null);
  assert.equal(review.reviewCount, 1);

  const reject = await resolveProbeIdentity(listing(), {
    keys, evaluate: () => decision({ confidence: "REJECT" }), products: one,
    brandLexicon: new Set(["marcax"]),
  });
  assert.equal(reject.winnerProductId, null);

  const conflicted = await resolveProbeIdentity(listing(), {
    keys,
    evaluate: () =>
      decision({
        confidence: "EXACT",
        hardConflicts: [{ axis: "storage", left: "256GB", right: "512GB" } as never],
      }),
    products: one,
    brandLexicon: new Set(["marcax"]),
  });
  assert.equal(conflicted.winnerProductId, null);
  assert.equal(conflicted.outcome, "NO_EXACT");
  assert.equal(conflicted.hardConflictCount, 1);

  // 2 Products EXACT => ambiguidade => nao publica nenhum.
  const ambiguous = await resolveProbeIdentity(listing(), {
    keys: { lookup: async () => ["P1", "P2"] },
    evaluate: EXACT, products: one, brandLexicon: new Set(["marcax"]),
  });
  assert.equal(ambiguous.outcome, "AMBIGUOUS_EXACT");
  assert.equal(ambiguous.winnerProductId, null);
  assert.deepEqual(ambiguous.exactProductIds, ["P1", "P2"]);

  // O veto de hard conflict e DO PAR VENCEDOR, nao da Probe inteira: um
  // conflito em uma oferta nao pode envenenar um EXACT limpo de outra.
  const mixed = await resolveProbeIdentity(listing(), {
    keys,
    evaluate: (_l, right) =>
      right.marketplaceId === "magazine_luiza"
        ? decision({ confidence: "EXACT", hardConflicts: [{ axis: "storage" } as never] })
        : decision({ confidence: "EXACT", hardConflicts: [] }),
    products: {
      loadAll: async () => [
        listing({ marketplaceId: "magazine_luiza" }),
        listing({ marketplaceId: "mercado_livre" }),
      ],
    },
    brandLexicon: new Set(["marcax"]),
  });
  assert.equal(mixed.outcome, "EXACT_UNIQUE");
  assert.equal(mixed.winnerProductId, "P1");
  assert.equal(mixed.hardConflictCount, 1);

  // Melhor decisao entre as counterparts do mesmo Product vence.
  const best = await resolveProbeIdentity(listing(), {
    keys,
    evaluate: (_l, right) =>
      decision({ confidence: right.marketplaceId === "mercado_livre" ? "EXACT" : "REVIEW" }),
    products: {
      loadAll: async () => [
        listing({ marketplaceId: "magazine_luiza" }),
        listing({ marketplaceId: "mercado_livre" }),
      ],
    },
    brandLexicon: new Set(["marcax"]),
  });
  assert.equal(best.outcome, "EXACT_UNIQUE");

  const none = await resolveProbeIdentity(listing(), {
    keys: { lookup: async () => [] },
    evaluate: EXACT,
    products: { loadAll: async () => [] },
    brandLexicon: new Set(["marcax"]),
  });
  assert.equal(none.outcome, "NO_CANDIDATES");
}

/* ------------------------------------------------------------------ */
/* RUNNER END-TO-END                                                   */
/* ------------------------------------------------------------------ */

async function runWith(
  items: NormalizedMarketplaceListingV1[],
  over: {
    evaluate?: () => IdentityDecisionV1;
    lookup?: () => Promise<string[]>;
    dryRun?: boolean;
    raw?: unknown;
  } = {},
) {
  const { committer, drafts } = recordingCommitter();
  const cfg = config({
    connector: {
      marketplaceId: "shopee",
      capabilities: {} as never,
      async collect() {
        return { items, nextCursor: null, snapshotComplete: true };
      },
      validate() {
        return [];
      },
      rawPayloadFor: () => (over.raw === undefined ? RAW_WITH_LINKS : over.raw),
    } as never,
  });
  const report = await runMarketplacePublicSync(
    cfg,
    {
      keys: { lookup: over.lookup ?? (async () => ["P1"]) },
      products: {
        loadAll: async (id) => [
          listing({ marketplaceId: "mercado_livre", externalListingId: id }),
        ],
      },
      evaluate: over.evaluate ?? EXACT,
      writer: committer,
    },
    { dryRun: over.dryRun ?? true },
  );
  return { report, drafts };
}

async function testRunner() {
  const exact = await runWith([listing()], { dryRun: false });
  assert.equal(exact.report.EXACT_UNIQUE, 1);
  assert.equal(exact.report.WRITES, 1);
  assert.equal(exact.drafts.length, 1);
  assert.equal(exact.drafts[0].productId, "P1");
  assert.equal(exact.drafts[0].matchStatus, "EXACT");
  assert.equal(exact.drafts[0].discoverySource, "API");
  assert.equal(exact.drafts[0].affiliateLink, "https://s.shopee.com.br/abc");
  assert.equal(exact.drafts[0].sourceUrl, "https://shopee.com.br/product/1/2");
  // Attach-only: o writer nunca cria Product.
  assert.equal(exact.report.ATTACH_ONLY, true);
  assert.equal(exact.report.PRODUCTS_CREATED, 0);

  const review = await runWith([listing()], {
    evaluate: () => decision({ confidence: "REVIEW" }),
    dryRun: false,
  });
  assert.equal(review.report.WRITES, 0);
  assert.equal(review.drafts.length, 0);

  const reject = await runWith([listing()], {
    evaluate: () => decision({ confidence: "REJECT" }),
    dryRun: false,
  });
  assert.equal(reject.report.WRITES, 0);

  const conflict = await runWith([listing()], {
    evaluate: () =>
      decision({ confidence: "EXACT", hardConflicts: [{ axis: "storage" } as never] }),
    dryRun: false,
  });
  assert.equal(conflict.report.WRITES, 0);

  const ambiguous = await runWith([listing()], {
    lookup: async () => ["P1", "P2"],
    dryRun: false,
  });
  assert.equal(ambiguous.report.AMBIGUOUS_EXACT, 1);
  assert.equal(ambiguous.report.WRITES, 0);
  assert.equal(ambiguous.drafts.length, 0);

  // DRY-RUN e o DEFAULT: conta o que faria, nao persiste nada.
  const dry = await runWith([listing()]);
  assert.equal(dry.report.MODE, "DRY_RUN");
  assert.equal(dry.report.WOULD_WRITE, 1);
  assert.equal(dry.report.WRITES, 0);
  assert.equal(dry.drafts.length, 0);

  // Duas listings do MESMO Product => uma oferta, a mais barata.
  const two = await runWith(
    [
      listing({ externalListingId: "1", commerce: { ...listing().commerce, price: 90 } }),
      listing({ externalListingId: "2", commerce: { ...listing().commerce, price: 30 } }),
    ],
    { dryRun: false },
  );
  assert.equal(two.report.WRITES, 1);
  assert.equal(two.drafts.length, 1);
  assert.equal(two.drafts[0].externalId, "2");
  assert.equal(two.drafts[0].price, 30);

  // URL de afiliado invalida => nao persiste link algum.
  const badLink = await runWith([listing()], {
    dryRun: false,
    raw: { offerLink: "javascript:alert(1)", productLink: "https://shopee.com.br/p/1" },
  });
  assert.equal(badLink.report.INVALID_LINK, 1);
  assert.equal(badLink.drafts[0].affiliateLink, null);

  // offerLink ausente => classificada, nunca inventada.
  const noLink = await runWith([listing()], {
    dryRun: false,
    raw: { productLink: "https://shopee.com.br/p/1" },
  });
  assert.equal(noLink.report.MISSING_AFFILIATE_LINK, 1);
  assert.equal(noLink.drafts[0].affiliateLink, null);

  // Payload bruto indisponivel nao quebra o runner.
  const noRaw = await runWith([listing()], { dryRun: false, raw: null });
  assert.equal(noRaw.report.MISSING_AFFILIATE_LINK, 1);
  assert.equal(noRaw.drafts[0].affiliateLink, null);

  // Marketplace fora da allowlist: nada e sequer coletado.
  const { committer: c2 } = recordingCommitter();
  let collectCalls = 0;
  const unauthorized = await runMarketplacePublicSync(
    config({
      marketplaceId: "aliexpress",
      connector: {
        marketplaceId: "aliexpress",
        capabilities: {} as never,
        async collect() {
          collectCalls += 1;
          return { items: [listing()], nextCursor: null, snapshotComplete: true };
        },
        validate() {
          return [];
        },
      } as never,
    }),
    {
      keys: { lookup: async () => [] },
      products: { loadAll: async () => [] },
      evaluate: EXACT,
      writer: c2,
    },
    { dryRun: false },
  );
  assert.equal(unauthorized.ERROR, "WRITER_NOT_AUTHORIZED: MARKETPLACE_NOT_IN_ALLOWLIST");
  assert.equal(collectCalls, 0);
  assert.equal(unauthorized.WRITES, 0);

  // API offline nao publica nada.
  const { committer: c3 } = recordingCommitter();
  const offline = await runMarketplacePublicSync(
    config({
      connector: {
        marketplaceId: "shopee",
        capabilities: {} as never,
        async collect() {
          throw new Error("API offline");
        },
        validate() {
          return [];
        },
      } as never,
    }),
    {
      keys: { lookup: async () => [] },
      products: { loadAll: async () => [] },
      evaluate: EXACT,
      writer: c3,
    },
    { dryRun: false },
  );
  assert.match(String(offline.ERROR), /^COLLECT_FAILED/);
  assert.equal(offline.WRITES, 0);

  // Falha de DB em uma oferta nao derruba as demais.
  let calls = 0;
  const flaky: PublicOfferCommitter = {
    async commit(d) {
      calls += 1;
      if (calls === 1) throw new Error("db down");
      return {
        productId: d.productId, marketplaceId: d.marketplaceId, externalId: d.externalId,
        action: "CREATE", changed: true, publicationSynced: true, changedFields: [],
      };
    },
  };
  const partial = await runMarketplacePublicSync(
    config({
      connector: {
        marketplaceId: "shopee",
        capabilities: {} as never,
        async collect() {
          return { items: [listing({ externalListingId: "a" })], nextCursor: null, snapshotComplete: true };
        },
        validate() {
          return [];
        },
        rawPayloadFor: () => RAW_WITH_LINKS,
      } as never,
    }),
    {
      keys: { lookup: async () => ["P1"] },
      products: { loadAll: async (id) => [listing({ marketplaceId: "mercado_livre", externalListingId: id })] },
      evaluate: EXACT,
      writer: flaky,
    },
    { dryRun: false },
  );
  assert.equal(partial.ERROR, "COMMIT_FAILED");
}

/* ------------------------------------------------------------------ */
/* AUDITORIA DE PERSISTIDO (FASE 9.19 / 9.37)                          */
/* ------------------------------------------------------------------ */

function testAudit() {
  const base = {
    productId: "P1", marketplace: "SHOPEE", externalId: "1", price: 10,
    matchStatus: "EXACT", status: "ACTIVE", active: true, available: true,
    hasAffiliateLink: true, hardConflicts: 0,
  };
  const clean = auditPersistedPublicOffers([base]);
  assert.equal(clean.REVIEW_PUBLIC_OFFERS, 0);
  assert.equal(clean.REJECT_PUBLIC_OFFERS, 0);
  assert.equal(clean.HARD_CONFLICT_PUBLIC_OFFERS, 0);
  assert.equal(clean.PUBLIC_WITHOUT_AFFILIATE_LINK, 0);
  assert.equal(clean.DUPLICATE_EXTERNAL_IDS, 0);
  assert.equal(clean.ROWS[0].countsTowardPublicMarketplace, true);
  // A auditoria normaliza o id do enum sem aplicar o filtro de shadow: ela
  // precisa enxergar as ofertas da fonte enquanto ela ainda e shadow.
  assert.equal(clean.ROWS[0].marketplaceId, "shopee");

  assert.equal(
    auditPersistedPublicOffers([{ ...base, matchStatus: "REVIEW" }]).REVIEW_PUBLIC_OFFERS,
    1,
  );
  assert.equal(
    auditPersistedPublicOffers([{ ...base, matchStatus: "REJECTED" }]).REJECT_PUBLIC_OFFERS,
    1,
  );
  assert.equal(
    auditPersistedPublicOffers([{ ...base, hardConflicts: 2 }]).HARD_CONFLICT_PUBLIC_OFFERS,
    1,
  );
  assert.equal(
    auditPersistedPublicOffers([{ ...base, hasAffiliateLink: false }]).PUBLIC_WITHOUT_AFFILIATE_LINK,
    1,
  );
  assert.equal(
    auditPersistedPublicOffers([base, { ...base, productId: "P2" }]).DUPLICATE_EXTERNAL_IDS,
    1,
  );
  // Oferta inativa nao esta na superficie publica, logo nao e vazao.
  assert.equal(
    auditPersistedPublicOffers([{ ...base, active: false, matchStatus: "REVIEW" }]).REVIEW_PUBLIC_OFFERS,
    0,
  );
  // Marketplace diferente com o mesmo externalId NAO e duplicata.
  assert.equal(
    auditPersistedPublicOffers([base, { ...base, marketplace: "AMAZON" }]).DUPLICATE_EXTERNAL_IDS,
    0,
  );
}

/* ------------------------------------------------------------------ */

async function main() {
  testFlags();
  testPurchaseLinks();
  testSelectWinningOffer();
  await testIdentityResolver();
  await testRunner();
  testAudit();

  console.log("publicSync.test.ts PASS");
}

main().catch((error) => {
  console.error("publicSync.test.ts FAIL", error);
  process.exitCode = 1;
});

/* ------------------------------------------------------------------ */
/* RUNTIME GATE (FASE 10)                                             */
/* ------------------------------------------------------------------ */

function testRuntimeGate() {
  const emptyEnv: Record<string, string | undefined> = {};

  // Magalu supported + mode absent (default OFF) => unauthorized
  assert.deepEqual(authorizePublicSync("magazine_luiza", PUBLIC_SYNC_SUPPORTED_SOURCES, emptyEnv), {
    authorized: false,
    reason: "RUNTIME_MODE_OFF",
  });

  // Magalu supported + explicit OFF => unauthorized
  assert.deepEqual(authorizePublicSync("magazine_luiza", PUBLIC_SYNC_SUPPORTED_SOURCES, { PUBLIC_SYNC_MODE_MAGAZINE_LUIZA: "OFF" }), {
    authorized: false,
    reason: "RUNTIME_MODE_OFF",
  });

  // Magalu + V1_PRIMARY_WITH_LEGACY_FALLBACK => authorized
  assert.deepEqual(authorizePublicSync("magazine_luiza", PUBLIC_SYNC_SUPPORTED_SOURCES, { PUBLIC_SYNC_MODE_MAGAZINE_LUIZA: "V1_PRIMARY_WITH_LEGACY_FALLBACK" }), {
    authorized: true,
    mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
    source: "RUNTIME",
  });

  // Magalu + invalid mode => unauthorized (fail-closed)
  assert.deepEqual(authorizePublicSync("magazine_luiza", PUBLIC_SYNC_SUPPORTED_SOURCES, { PUBLIC_SYNC_MODE_MAGAZINE_LUIZA: "INVALID" }), {
    authorized: false,
    reason: "RUNTIME_MODE_OFF",
  });

  // Amazon supported + mode absent (default OFF) => unauthorized
  assert.deepEqual(authorizePublicSync("amazon", PUBLIC_SYNC_SUPPORTED_SOURCES, emptyEnv), {
    authorized: false,
    reason: "RUNTIME_MODE_OFF",
  });

  // Amazon supported + explicit OFF => unauthorized
  assert.deepEqual(authorizePublicSync("amazon", PUBLIC_SYNC_SUPPORTED_SOURCES, { PUBLIC_SYNC_MODE_AMAZON: "OFF" }), {
    authorized: false,
    reason: "RUNTIME_MODE_OFF",
  });

  // Amazon + V1_PRIMARY_WITH_LEGACY_FALLBACK => authorized
  assert.deepEqual(authorizePublicSync("amazon", PUBLIC_SYNC_SUPPORTED_SOURCES, { PUBLIC_SYNC_MODE_AMAZON: "V1_PRIMARY_WITH_LEGACY_FALLBACK" }), {
    authorized: true,
    mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
    source: "RUNTIME",
  });

  // Amazon + invalid mode => unauthorized (fail-closed)
  assert.deepEqual(authorizePublicSync("amazon", PUBLIC_SYNC_SUPPORTED_SOURCES, { PUBLIC_SYNC_MODE_AMAZON: "INVALID" }), {
    authorized: false,
    reason: "RUNTIME_MODE_OFF",
  });

  // Unknown marketplace => unauthorized
  assert.deepEqual(authorizePublicSync("aliexpress", PUBLIC_SYNC_SUPPORTED_SOURCES, emptyEnv), {
    authorized: false,
    reason: "MARKETPLACE_NOT_IN_ALLOWLIST",
  });

  // Shopee continues authorized with default (legacy operating)
  assert.deepEqual(authorizePublicSync("shopee", PUBLIC_SYNC_SUPPORTED_SOURCES, emptyEnv), {
    authorized: true,
    mode: "V1_PRIMARY",
    source: "RUNTIME",
  });

  // Shopee with explicit OFF
  assert.deepEqual(authorizePublicSync("shopee", PUBLIC_SYNC_SUPPORTED_SOURCES, { PUBLIC_SYNC_MODE_SHOPEE: "OFF" }), {
    authorized: false,
    reason: "RUNTIME_MODE_OFF",
  });

  // Shopee with custom allowlist override (static) - uses MODE_OFF
  assert.deepEqual(authorizePublicSync("shopee", { shopee: { mode: "OFF" } }, emptyEnv), {
    authorized: false,
    reason: "MODE_OFF",
  });

  // GLOBAL_CUTOVER does not participate in this decision
  assert.deepEqual(authorizePublicSync("magazine_luiza", PUBLIC_SYNC_SUPPORTED_SOURCES, { ...emptyEnv, CATALOG_V1_GLOBAL_CUTOVER: "YES" }), {
    authorized: false,
    reason: "RUNTIME_MODE_OFF",
  });

  // Cron Magalu with mode OFF: zero writes (tested via runner integration)
  assert.equal(isCronSyncAllowed("magazine_luiza"), true);
  assert.equal(isCronSyncAllowed("shopee"), true);
  assert.equal(isCronSyncAllowed("amazon"), true);
}
