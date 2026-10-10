/**
 * CATALOG_WAVE 1 - FASE N/E: CatalogImporterV1.
 *
 * Cobertura: pipeline completo em DRY_RUN (zero escrita), guard de fonte
 * aprovada, decisões por identidade/validação, matching through importer,
 * plan engine, limites canary, idempotência, flags fail-closed, LIVE
 * bloqueado, rollback na aplicação.
 */
import type { RawAwinFeedItem } from "../feed/awinAdapter";
import { WAVE1_FIXTURES, fixtureSetFor } from "./fixtures";
import {
  CatalogImporterV1,
  CANARY_MAX_PER_ADVERTISER,
  CANARY_MAX_TOTAL,
} from "./importer";
import type { CatalogImportFlags } from "./featureFlags";
import {
  CatalogDisabledError,
  LiveModeBlockedError,
} from "./featureFlags";
import { InMemoryStagingStore } from "./staging";
import { InMemoryCatalogGateway } from "./transaction";
import type { CatalogImportPlanItem } from "./plan";
import type {
  ExistingOfferRef,
  ExistingProductRef,
} from "./types";

let passed = 0;
function ok(cond: boolean, label: string): void {
  if (!cond) {
    throw new Error(`FAIL: ${label}`);
  }
  passed += 1;
}

function flags(over: Partial<CatalogImportFlags> = {}): CatalogImportFlags {
  return {
    catalogImportEnabled: true,
    awinWave1Enabled: true,
    awinWave1StagingWriteEnabled: false,
    awinWave1WriteEnabled: false,
    awinWave1LiveEnabled: false,
    mode: "DRY_RUN",
    ...over,
  };
}

function harness(
  f: CatalogImportFlags,
  existingProducts: ExistingProductRef[] = [],
  existingOffers: ExistingOfferRef[] = [],
): {
  store: InMemoryStagingStore;
  gateway: InMemoryCatalogGateway;
  importer: CatalogImporterV1;
} {
  const store = new InMemoryStagingStore();
  const gateway = new InMemoryCatalogGateway();
  const importer = new CatalogImporterV1({
    flags: f,
    stagingStore: store,
    gateway,
    existingProducts,
    existingOffers,
  });
  return { store, gateway, importer };
}

function find(
  items: readonly CatalogImportPlanItem[],
  externalId: string,
): CatalogImportPlanItem {
  const item = items.find((i) => i.externalId === externalId);
  if (!item) throw new Error(`PLAN_ITEM_MISSING: ${externalId}`);
  return item;
}

function genRow(i: number): RawAwinFeedItem {
  return {
    productId: `GEN-${i}`,
    title: `Produto Gerado Numero ${i} Descricao Comprida Teste`,
    brand: `MarcaGen${i % 7}`,
    model: `MOD-${i}`,
    price: "99,90",
    currency: "BRL",
    productUrl: `https://www.example.com/p/${i}`,
    affiliateUrl: `https://example-awin.test/cread.php?awinmid=1&ued=${encodeURIComponent(`https://www.example.com/p/${i}`)}`,
    imageUrls: `https://cdn.example-img.test/gen/${i}.jpg`,
  };
}

async function expectRunError(
  p: Promise<unknown>,
  matches: (err: unknown) => boolean,
  label: string,
): Promise<void> {
  try {
    await p;
  } catch (err) {
    ok(matches(err), `${label} => erro esperado (${err instanceof Error ? err.name : String(err)})`);
    return;
  }
  throw new Error(`FAIL: ${label} deveria lançar`);
}

async function main(): Promise<void> {
  /* ===================================================================== */
  /* 1) FASE M: DRY RUN completo das fixtures (4 merchants) — zero escrita */
  /* ===================================================================== */
  const dry = harness(flags());
  const countersByMerchant: Record<string, Record<string, number>> = {};

  for (const fixture of WAVE1_FIXTURES) {
    const res = await dry.importer.run(fixture.rows, fixture.merchant);
    ok(res.mode === "DRY_RUN", `${fixture.merchant}: modo DRY_RUN`);
    ok(res.apply === null, `${fixture.merchant}: apply === null em DRY_RUN`);
    ok(res.advertiser !== null, `${fixture.merchant}: advertiser aprovado`);
    countersByMerchant[fixture.merchant] = { ...res.plan.counters };
  }

  const kb = countersByMerchant.kabum;
  ok(kb.wouldCreateProducts === 5, `kabum create=5 (got ${kb.wouldCreateProducts})`);
  ok(kb.wouldMatchProducts === 0, "kabum match=0");
  ok(kb.wouldCreateOffers === 5, "kabum offers=5");
  ok(kb.wouldReview === 0, "kabum review=0");
  ok(kb.wouldReject === 3, `kabum reject=3 (got ${kb.wouldReject})`);

  const ci = countersByMerchant["cama-in-box"];
  ok(ci.wouldCreateProducts === 2, `cama create=2 (got ${ci.wouldCreateProducts})`);
  ok(ci.wouldReview === 1, `cama review=1 (got ${ci.wouldReview})`);
  ok(ci.wouldReject === 0, "cama reject=0");

  const ol = countersByMerchant.olympikus;
  ok(ol.wouldCreateProducts === 3, "olympikus create=3");
  ok(ol.wouldCreateOffers === 3, "olympikus offers=3");

  const lv = countersByMerchant.leveros;
  ok(lv.wouldCreateProducts === 4, `leveros create=4 (got ${lv.wouldCreateProducts})`);
  ok(lv.wouldReject === 1, "leveros reject=1");

  ok(dry.gateway.writeAttempts === 0, "DATABASE_WRITES=0 no dry run");
  ok(dry.gateway.countProducts() === 0, "gateway sem products no dry run");
  ok(dry.gateway.countOffers() === 0, "gateway sem offers no dry run");
  ok((await dry.store.count()) === 18, "staging: 19 linhas - 1 duplicada = 18");

  /* Detalhes por item (kabum) ------------------------------------------- */
  const kbRun = await dry.importer.run(fixtureSetFor("kabum").rows, "kabum");
  // Dry run denovo não duplica staging (idempotência da store).
  ok((await dry.store.count()) === 18, "staging idempotente entre execuções");

  const k1 = find(kbRun.plan.items, "KBM-1001");
  ok(k1.decision === "CREATE_PRODUCT", "k1: CREATE_PRODUCT");
  ok(k1.identityLevel === "A", "k1: identidade A (GTIN válido)");
  ok(k1.validationStatus === "VALID", "k1: VALID");
  ok(k1.offerAction === "CREATE_OFFER", "k1: CREATE_OFFER");
  ok(k1.reasonCodes.includes("NEW_PRODUCT_CANDIDATE"), "k1: NEW_PRODUCT_CANDIDATE");
  ok(k1.staging.source === "AWIN" && k1.staging.affiliateNetwork === "AWIN", "k1: 3 camadas");

  const dup = kbRun.plan.items.filter(
    (i) => i.externalId === "KBM-1001" && i.reasonCodes.includes("DUPLICATE_EXTERNAL_ID"),
  );
  ok(dup.length === 1, "k4 duplicado: 1 item REJECT por DUPLICATE_EXTERNAL_ID");
  ok(kbRun.plan.duplicateExternalIds === 1, "duplicates=1");

  const k5 = kbRun.plan.items.find((i) =>
    i.reasonCodes.includes("INVALID_CURRENCY"),
  );
  ok(k5?.decision === "REJECT", "k5 USD => REJECT");
  ok(k5?.validationStatus === "INVALID", "k5 INVALID");

  const k6 = kbRun.plan.items.find((i) =>
    i.reasonCodes.includes("INVALID_DESTINATION_URL"),
  );
  ok(k6?.decision === "REJECT", "k6 URL javascript: => REJECT");

  /* cama-in-box: PARTIAL e identidade D ---------------------------------- */
  const ciRun = await dry.importer.run(fixtureSetFor("cama-in-box").rows, "cama-in-box");
  const c2 = find(ciRun.plan.items, "CIB-2002");
  ok(c2.decision === "REVIEW", "c2 sem imagem => REVIEW");
  ok(c2.validationStatus === "PARTIAL", "c2 PARTIAL");
  ok(c2.reasonCodes.includes("MISSING_IMAGE"), "c2 reason MISSING_IMAGE");
  ok(c2.offerAction === "NONE", "c2 não escreve oferta");

  const c3 = find(ciRun.plan.items, "CIB-2003");
  ok(c3.decision === "CREATE_PRODUCT", "c3 identidade fraca => seed DRAFT");
  ok(c3.identityLevel === "D", "c3 nível D");
  ok(c3.reasonCodes.includes("WEAK_IDENTITY"), "c3 reason WEAK_IDENTITY");
  ok(c3.offerAction === "CREATE_OFFER", "c3 cria oferta da fonte aprovada");

  /* leveros: preço inválido ---------------------------------------------- */
  const lvRun = await dry.importer.run(fixtureSetFor("leveros").rows, "leveros");
  const l4 = find(lvRun.plan.items, "LEV-4004");
  ok(l4.decision === "REJECT", "l4 preço 0 => REJECT");
  ok(l4.reasonCodes.includes("INVALID_PRICE"), "l4 reason INVALID_PRICE");

  /* ===================================================================== */
  /* 2) Matching through importer                                          */
  /* ===================================================================== */

  // (a) GTIN exato => AUTO_MATCH; e GTIN conflitante => REVIEW.
  const gtinExisting: ExistingProductRef[] = [
    { id: "real-1", name: "Mouse Logitech G305", brand: "Logitech", gtin: "4006381333931" },
  ];
  const m1 = harness(flags(), gtinExisting);
  const m1run = await m1.importer.run(fixtureSetFor("kabum").rows, "kabum");
  const mk1 = find(m1run.plan.items, "KBM-1001");
  ok(mk1.decision === "MATCH_PRODUCT", "k1 casa por GTIN => MATCH_PRODUCT");
  ok(mk1.matchCandidateProductId === "real-1", "k1 candidato real-1");
  ok((mk1.matchConfidence ?? 0) >= 0.95, "k1 confiança >= 0.95");
  ok(mk1.reasonCodes.includes("AUTO_MATCH"), "k1 reason AUTO_MATCH");
  ok(mk1.offerAction === "CREATE_OFFER", "k1 oferta nova no candidato");
  ok(m1run.plan.counters.wouldMatchProducts === 1, "kabum match=1");
  ok(m1run.plan.counters.wouldCreateProducts === 4, "kabum create=4 (resto)");

  const m2 = harness(flags(), gtinExisting);
  const m2run = await m2.importer.run(fixtureSetFor("leveros").rows, "leveros");
  const ml3 = find(m2run.plan.items, "LEV-4003");
  ok(ml3.decision === "REVIEW", "l3 GTIN conflitante => REVIEW (nunca auto)");
  ok(ml3.matchCandidateProductId === null, "l3 sem candidato automático");
  ok(ml3.reasonCodes.includes("GTIN_CONFLICT"), "l3 reason GTIN_CONFLICT");
  ok(ml3.offerAction === "NONE", "l3 não escreve");

  // (b) Produto igual em duas lojas => mesmo Product.
  const jblExisting: ExistingProductRef[] = [
    { id: "p-jbl", name: "Fone Bluetooth JBL Tune 520BT", brand: "JBL", gtin: "7899875432107" },
  ];
  const x1 = harness(flags(), jblExisting);
  const x1run = await x1.importer.run(fixtureSetFor("kabum").rows, "kabum");
  const x2 = harness(flags(), jblExisting);
  const x2run = await x2.importer.run(fixtureSetFor("leveros").rows, "leveros");
  ok(find(x1run.plan.items, "KBM-1007").matchCandidateProductId === "p-jbl", "k7 => p-jbl");
  ok(find(x2run.plan.items, "LEV-4001").matchCandidateProductId === "p-jbl", "l1 => p-jbl");
  ok(
    find(x1run.plan.items, "KBM-1007").decision === "MATCH_PRODUCT" &&
      find(x2run.plan.items, "LEV-4001").decision === "MATCH_PRODUCT",
    "produto igual em duas lojas: ambos MATCH no mesmo Product",
  );

  // (c) Faixa REVIEW (0.85-0.949) via atributos estruturados.
  const attrExisting: ExistingProductRef[] = [
    {
      id: "p-k552",
      name: "Teclado Mecanico Redragon Kumara RGB ABNT2",
      brand: "Redragon",
      category: "Perifericos",
    },
  ];
  const m3 = harness(flags(), attrExisting);
  const m3run = await m3.importer.run(fixtureSetFor("kabum").rows, "kabum");
  const mk2 = find(m3run.plan.items, "KBM-1002");
  ok(mk2.decision === "REVIEW", "k2 confiança 0.90 => REVIEW");
  ok(mk2.reasonCodes.includes("REVIEW_THRESHOLD"), "k2 reason REVIEW_THRESHOLD");
  ok(mk2.matchCandidateProductId === "p-k552", "k2 candidato p-k552");
  ok(mk2.matchConfidence === 0.9, `k2 confiança 0.9 (got ${mk2.matchConfidence})`);
  ok(m3run.plan.counters.wouldCreateProducts === 4, "resto segue CREATE");

  // (d) Identidade C => pode semear Product DRAFT, mas não auto-merge.
  const m4 = harness(flags());
  const m4run = await m4.importer.run(
    [
      {
        productId: "C-1",
        title: "Fone Bluetooth JBL Tune 520BT",
        brand: "JBL",
        price: "249,90",
        currency: "BRL",
        productUrl: "https://www.example.com/go/1",
        affiliateUrl: "https://example-awin.test/cread.php?awinmid=1&ued=https%3A%2F%2Fwww.example.com%2Fgo%2F1",
        imageUrls: "https://cdn.example-img.test/c1.jpg",
      },
    ],
    "kabum",
  );
  const cItem = find(m4run.plan.items, "C-1");
  ok(cItem.decision === "CREATE_PRODUCT", "identidade C => seed DRAFT");
  ok(cItem.identityLevel === "C", "nível C");
  ok(cItem.reasonCodes.includes("PARTIAL_IDENTITY"), "reason PARTIAL_IDENTITY");
  ok(cItem.offerAction === "CREATE_OFFER", "identidade C => oferta da fonte aprovada");

  // (e) Imagem inválida => PARTIAL => REVIEW.
  const m5 = harness(flags());
  const m5run = await m5.importer.run(
    [
      {
        productId: "IMG-1",
        title: "Produto Com Imagem Invalida Descricao",
        brand: "MarcaX",
        model: "MX-1",
        price: "99,90",
        currency: "BRL",
        productUrl: "https://www.example.com/p/img",
        imageUrls: "ftp://bad.example/image.png",
      },
    ],
    "kabum",
  );
  const imgItem = find(m5run.plan.items, "IMG-1");
  ok(imgItem.decision === "REVIEW", "imagem inválida => REVIEW");
  ok(imgItem.validationStatus === "PARTIAL", "status PARTIAL");
  ok(imgItem.reasonCodes.includes("MISSING_IMAGE"), "reason MISSING_IMAGE");

  // (f) UPDATE_OFFER / UNCHANGED via oferta existente.
  const offerExisting: ExistingProductRef[] = [
    { id: "p1", name: "Mouse Logitech G305", brand: "Logitech", gtin: "4006381333931" },
  ];
  const offersAt199: ExistingOfferRef[] = [
    { id: "off-x", productId: "p1", merchant: "kabum", externalId: "KBM-1001", price: 199.9, active: true },
  ];
  const m6 = harness(flags(), offerExisting, offersAt199);
  const m6run = await m6.importer.run(fixtureSetFor("kabum").rows, "kabum");
  const u1 = find(m6run.plan.items, "KBM-1001");
  ok(u1.offerAction === "UPDATE_OFFER", "preço mudou => UPDATE_OFFER");
  ok(u1.reasonCodes.includes("OFFER_PRICE_CHANGED"), "reason OFFER_PRICE_CHANGED");
  ok(m6run.plan.counters.wouldUpdateOffers === 1, "wouldUpdateOffers=1");

  const offersAt249: ExistingOfferRef[] = [
    { id: "off-y", productId: "p1", merchant: "kabum", externalId: "KBM-1001", price: 249.9, active: true },
  ];
  const m7 = harness(flags(), offerExisting, offersAt249);
  const m7run = await m7.importer.run(fixtureSetFor("kabum").rows, "kabum");
  const n1 = find(m7run.plan.items, "KBM-1001");
  ok(n1.offerAction === "UNCHANGED", "preço igual => UNCHANGED");
  ok(n1.reasonCodes.includes("OFFER_UNCHANGED"), "reason OFFER_UNCHANGED");
  ok(m7run.plan.counters.wouldRemainUnchanged === 1, "wouldRemainUnchanged=1");

  /* ===================================================================== */
  /* 3) FASE F: fontes não aprovadas => REJECT total, sem escrita          */
  /* ===================================================================== */
  const unapprovedList = [
    "temu",
    "nike",
    "dafiti",
    "adidas",
    "polishop",
    "vx-case",
    "shopee",
    "amazon",
    "mercado-livre",
    "aliexpress",
    "decor-colors",
    "granado",
    "phebo",
    "fut-fanatics",
    "eotica",
    "riachuelo",
    "decathlon",
    "ml",
  ];
  for (const merchant of unapprovedList) {
    const h = harness(flags({ mode: "CANARY", awinWave1WriteEnabled: true }));
    const res = await h.importer.run(fixtureSetFor("kabum").rows, merchant);
    ok(res.advertiser === null, `${merchant}: sem advertiser`);
    ok(res.apply === null, `${merchant}: nenhuma aplicação`);
    ok(
      res.plan.items.every((i) => i.decision === "REJECT"),
      `${merchant}: todos REJECT`,
    );
    ok(
      res.plan.items.every((i) =>
        i.reasonCodes.includes("REJECT_UNAPPROVED_SOURCE"),
      ),
      `${merchant}: reason REJECT_UNAPPROVED_SOURCE`,
    );
    ok(h.gateway.writeAttempts === 0, `${merchant}: escrita=0`);
  }

  /* ===================================================================== */
  /* 4) Flags fail-closed                                                   */
  /* ===================================================================== */
  const offHarness = harness(
    flags({
      catalogImportEnabled: false,
      awinWave1Enabled: false,
      awinWave1WriteEnabled: true,
      mode: "CANARY",
    }),
  );
  await expectRunError(
    offHarness.importer.run(fixtureSetFor("kabum").rows, "kabum"),
    (e) => e instanceof CatalogDisabledError,
    "flags base OFF",
  );

  const disabledHarness = harness(flags({ mode: "DISABLED" }));
  await expectRunError(
    disabledHarness.importer.run(fixtureSetFor("kabum").rows, "kabum"),
    (e) => e instanceof CatalogDisabledError,
    "mode DISABLED",
  );

  const liveHarness = harness(
    flags({ mode: "LIVE", awinWave1WriteEnabled: true }),
  );
  await expectRunError(
    liveHarness.importer.run(fixtureSetFor("kabum").rows, "kabum"),
    (e) => e instanceof LiveModeBlockedError,
    "LIVE sem flag extra",
  );
  ok(
    (await liveHarness.store.count()) === 0,
    "LIVE bloqueado antes de qualquer processamento",
  );
  ok(liveHarness.gateway.writeAttempts === 0, "LIVE bloqueado: escrita=0");

  // LIVE completo (flag extra ON) funciona e aplica.
  const liveFull = harness(
    flags({
      mode: "LIVE",
      awinWave1WriteEnabled: true,
      awinWave1LiveEnabled: true,
    }),
  );
  const liveRes = await liveFull.importer.run([genRow(9001)], "kabum");
  ok(liveRes.apply !== null, "LIVE completo aplica");
  ok(liveRes.apply?.productsCreated === 1, "LIVE: 1 product criado");
  ok(liveFull.gateway.countProducts() === 1, "LIVE: gateway reflete o product");

  /* ===================================================================== */
  /* 5) Limites canary (25/anunciante, 100 total)                           */
  /* ===================================================================== */
  ok(CANARY_MAX_PER_ADVERTISER === 25, "limite por anunciante = 25");
  ok(CANARY_MAX_TOTAL === 100, "limite total = 100");

  const canary = harness(flags({ mode: "CANARY", awinWave1WriteEnabled: true }));
  const kbRows = Array.from({ length: 30 }, (_, i) => genRow(i + 1));
  const kbCanary = await canary.importer.run(kbRows, "kabum");
  ok(kbCanary.apply !== null, "CANARY aplica");
  ok(kbCanary.apply?.applied === 25, `kabum: 25 aplicados (got ${kbCanary.apply?.applied})`);
  ok(kbCanary.apply?.skippedCanaryLimit === 5, `kabum: 5 pulados (got ${kbCanary.apply?.skippedCanaryLimit})`);
  ok(canary.gateway.countProducts() === 25, "kabum: 25 products reais");
  ok(canary.gateway.countOffers() === 25, "kabum: 25 offers reais");

  const olRows = Array.from({ length: 80 }, (_, i) => genRow(i + 101));
  const olCanary = await canary.importer.run(olRows, "olympikus");
  ok(olCanary.apply?.applied === 25, "olympikus: 25 aplicados (limite do anunciante)");
  ok(olCanary.apply?.skippedCanaryLimit === 55, "olympikus: 55 pulados");
  ok(canary.gateway.countProducts() === 50, "total: 50 products (acumulado)");

  // Preenche até o teto total (100) com os 4 merchants.
  const fill = harness(flags({ mode: "CANARY", awinWave1WriteEnabled: true }));
  const fillMerchants: Array<["kabum" | "cama-in-box" | "olympikus" | "leveros", number]> = [
    ["kabum", 0],
    ["cama-in-box", 300],
    ["olympikus", 600],
    ["leveros", 900],
  ];
  let totalApplied = 0;
  for (const [merchant, offset] of fillMerchants) {
    const rows = Array.from({ length: 25 }, (_, i) => genRow(offset + i + 1));
    const res = await fill.importer.run(rows, merchant);
    totalApplied += res.apply?.applied ?? 0;
  }
  ok(totalApplied === 100, `4 merchants x 25 = 100 aplicados (got ${totalApplied})`);
  ok(fill.gateway.countProducts() === 100, "teto total: 100 products");
  const overflow = await fill.importer.run([genRow(1234)], "kabum");
  ok(overflow.apply?.applied === 0, "teto total atingido: nada mais aplica");
  ok(overflow.apply?.skippedCanaryLimit === 1, "overflow contabilizado");

  /* ===================================================================== */
  /* 6) FASE J: idempotência (2ª execução = sem duplicatas)                 */
  /* ===================================================================== */
  const idem = harness(flags({ mode: "CANARY", awinWave1WriteEnabled: true }));
  const run1 = await idem.importer.run(fixtureSetFor("kabum").rows, "kabum");
  ok(run1.apply?.productsCreated === 5, "run1: 5 products");
  ok(run1.apply?.offersCreated === 5, "run1: 5 offers");
  ok(idem.gateway.countProducts() === 5, "run1 gateway: 5 products");
  ok((await idem.store.count()) === 7, "run1 staging: 8 linhas - 1 duplicada = 7");

  const snapshotProducts: ExistingProductRef[] = idem.gateway.snapshotProducts();
  const snapshotOffers: ExistingOfferRef[] = idem.gateway.snapshotOffers();
  const importer2 = new CatalogImporterV1({
    flags: flags({ mode: "CANARY", awinWave1WriteEnabled: true }),
    stagingStore: idem.store,
    gateway: idem.gateway,
    existingProducts: snapshotProducts,
    existingOffers: snapshotOffers,
  });
  const writesBefore = idem.gateway.writeAttempts;
  const run2 = await importer2.run(fixtureSetFor("kabum").rows, "kabum");

  ok(run2.plan.counters.wouldCreateProducts === 0, "run2: 0 products novos");
  ok(run2.plan.counters.wouldCreateOffers === 0, "run2: 0 offers novas");
  ok(run2.plan.counters.wouldMatchProducts === 3, `run2: 3 matches (got ${run2.plan.counters.wouldMatchProducts})`);
  ok(run2.plan.counters.wouldRemainUnchanged === 3, `run2: 3 unchanged (got ${run2.plan.counters.wouldRemainUnchanged})`);
  ok(run2.plan.counters.wouldReject === 3, "run2: 3 rejeitados (dup+USD+URL)");
  ok(run2.plan.counters.wouldReview === 2, `run2: 2 review (brand+model 0.93) (got ${run2.plan.counters.wouldReview})`);
  ok(idem.gateway.countProducts() === 5, "DUPLICATE_PRODUCTS=0");
  ok(idem.gateway.countOffers() === 5, "DUPLICATE_OFFERS=0");
  ok(idem.gateway.writeAttempts === writesBefore, "run2: nenhuma escrita nova");
  ok((await idem.store.count()) === 7, "staging segue 7 linhas (idempotente)");

  /* ===================================================================== */
  /* 7) Rollback na aplicação (FASE K via importer)                         */
  /* ===================================================================== */
  const rb = harness(flags({ mode: "CANARY", awinWave1WriteEnabled: true }));
  rb.gateway.failNextOfferCreation = true;
  const rbRes = await rb.importer.run([genRow(501)], "kabum");
  ok(rbRes.apply?.failed === 1, "aplicação: 1 falha");
  ok(rbRes.apply?.applied === 0, "aplicação: 0 aplicadas");
  ok(rbRes.apply?.productsCreated === 0, "métrica não conta product revertido");
  ok(rb.gateway.countProducts() === 0, "ROLLBACK: sem product órfão");
  ok(rb.gateway.countOffers() === 0, "ROLLBACK: sem offer órfã");

  /* ===================================================================== */
  /* 8) CANARY com só REVIEW/REJECT => nenhuma escrita                      */
  /* ===================================================================== */
  const noWrites = harness(flags({ mode: "CANARY", awinWave1WriteEnabled: true }));
  const partialRow: RawAwinFeedItem = {
    productId: "RW-1",
    title: "Produto Somente Revisao Caso",
    brand: "MarcaRW",
    model: "RW-1",
    price: "10,00",
    currency: "BRL",
    productUrl: "https://www.example.com/rw/1",
    imageUrls: "",
  };
  const rwRes = await noWrites.importer.run([partialRow], "kabum");
  ok(rwRes.plan.counters.wouldReview === 1, "item PARTIAL => REVIEW");
  ok(rwRes.apply?.applied === 0, "REVIEW não aplica");
  ok(noWrites.gateway.writeAttempts === 0, "REVIEW: escrita=0");

  /* ===================================================================== */
  /* 9) Affiliate ausente e indisponibilidade são fail-closed              */
  /* ===================================================================== */
  const affiliateGuard = harness(flags());
  const noAffiliate = await affiliateGuard.importer.run(
    [
      {
        productId: "AFF-1",
        title: "Produto com identidade forte sem afiliado",
        brand: "Marca",
        model: "M-1",
        price: "99,90",
        currency: "BRL",
        productUrl: "https://www.example.com/aff/1",
        imageUrls: "https://cdn.example-img.test/aff/1.jpg",
      },
    ],
    "kabum",
  );
  const noAffiliateItem = find(noAffiliate.plan.items, "AFF-1");
  ok(noAffiliateItem.decision === "REVIEW", "affiliate ausente => REVIEW");
  ok(
    noAffiliateItem.reasonCodes.includes("MISSING_AFFILIATE_URL"),
    "affiliate ausente => reason explícito",
  );
  ok(noAffiliateItem.offerAction === "NONE", "affiliate ausente => sem offer write");

  const unavailableGuard = harness(flags());
  const unavailable = await unavailableGuard.importer.run(
    [
      {
        productId: "STOCK-0",
        title: "Produto indisponível com identidade forte",
        brand: "Marca",
        model: "S-0",
        price: "149,90",
        currency: "BRL",
        productUrl: "https://www.example.com/stock/0",
        affiliateUrl:
          "https://example-awin.test/cread.php?awinmid=1&ued=https%3A%2F%2Fwww.example.com%2Fstock%2F0",
        imageUrls: "https://cdn.example-img.test/stock/0.jpg",
        availability: "out of stock",
      },
    ],
    "kabum",
  );
  const unavailableItem = find(unavailable.plan.items, "STOCK-0");
  ok(unavailableItem.decision === "REJECT", "indisponível => REJECT");
  ok(
    unavailableItem.reasonCodes.includes("UNAVAILABLE_ITEM"),
    "indisponível => reason explícito",
  );
  ok(unavailableItem.offerAction === "NONE", "indisponível => sem offer write");

  console.log(`importer.test.ts PASS (${passed} asserções)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
