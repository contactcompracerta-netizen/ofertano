/**
 * CATALOG_ARCHITECTURE_V1 — SEGUNDO MARKETPLACE REAL: CONTRACT TEST (FASE 8 / W).
 *
 * O conector Shopee passa pelo MESMO contrato dos FakeConnectors, sem nenhuma
 * alteracao especial no core:
 *   collect -> normalize -> validate -> raw -> hash -> replay -> idempotencia
 *   -> identidade -> matching cross-market -> exclusao de publicacao na shadow.
 *
 * O transporte HTTP e INJETADO (fetch stub): o teste nao toca a rede e nao
 * depende de credencial. A prova de que a fonte e real e o canario separado.
 */
import assert from "node:assert/strict";

import {
  ShopeeMarketplaceConnector,
  SHOPEE_MARKETPLACE_ID,
  ShopeeConnectorError,
  type ShopeeOfferNodeV1,
} from "./shopeeConnector";
import { requireCapability, UnsupportedCapabilityError } from "../../types/connector";
import { processNormalizedListing, validateNormalizedListing } from "../../ingestion/pipeline";
import { reprocessRawListing } from "../../ingestion/reprocess";
import { InMemoryRawListingRepository } from "../../fake/inMemoryRepositories";
import { CatalogMetrics } from "../../observability/metrics";
import { computeHashPair, classifyHashChange } from "../../hashing";
import { listingKeyToString } from "../../ingestion/rawRepository";
import { classifyCrossMarketPair, matchCrossMarket } from "../../matching/crossMarketMatching";
import { evaluatePublicationEligibility } from "../../publication/publicationEligibility";
import { buildFakeListing } from "../../fake/fakeConnectors";
import { UNKNOWN } from "../../types/normalizedListingV1";
import type { ShadowFlags } from "../../shadow/flags";

/* ------------------------------------------------------------------ */
/* Stub de transporte: payload REAL da Shopee (formato productOfferV2)  */
/* ------------------------------------------------------------------ */

function node(over: Partial<ShopeeOfferNodeV1> = {}): ShopeeOfferNodeV1 {
  return {
    itemId: 1001,
    shopId: 77,
    productName: "Smartwatch Samsung Galaxy Watch 4 44mm Bluetooth",
    shopName: "Loja Oficial",
    price: "1299.90",
    priceMin: "1299.90",
    priceMax: "1499.90",
    imageUrl: "https://down-vi.img.susercontent.com/file/example.jpg",
    productLink: "https://shopee.com.br/product/1001",
    offerLink: "https://shopee.com.br/offer/1001",
    ratingStar: "4.8",
    sales: 120,
    priceDiscountRate: "0.12",
    productCatIds: [65536],
    ...over,
  };
}

function graphqlResponse(nodes: ShopeeOfferNodeV1[], hasNextPage = false) {
  /*
   * Stub fiel ao contrato: o conector chama response.text() e faz
   * response.ok. Um stub que so devolvesse .json() nao representaria a
   * fonte e mascararia falha real de parsing.
   */
  const body = JSON.stringify({
    data: {
      productOfferV2: {
        nodes,
        pageInfo: { page: 1, limit: nodes.length, hasNextPage, scrollId: null },
      },
    },
  });
  return {
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

function makeConnector(
  responses: ShopeeOfferNodeV1[][],
  now = "2026-09-26T12:00:00.000Z",
) {
  let call = 0;
  const seenAuth: string[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    seenAuth.push(String((init?.headers as Record<string, string>)?.Authorization ?? ""));
    const batch = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return graphqlResponse(batch);
  }) as unknown as typeof fetch;
  const connector = new ShopeeMarketplaceConnector({
    keywords: ["smartwatch"],
    pageSize: 10,
    now: () => now,
    fetchImpl,
  });
  return { connector, seenAuth };
}

const SHADOW_ONLY_SHOPEE: ShadowFlags = {
  enabled: true,
  marketplaceIds: [SHOPEE_MARKETPLACE_ID],
  maxWrites: 0,
  persistRaw: false,
  persistHashes: false,
  dryRun: true,
};

async function main() {
  /* --- 1. CAPACIDADES REAIS (FASE E) ---------------------------------- */
  const { connector, seenAuth } = makeConnector([[node()]]);
  assert.equal(connector.marketplaceId, SHOPEE_MARKETPLACE_ID);
  assert.equal(connector.id, "shopee-affiliate");
  assert.equal(connector.capabilities.catalog, true);
  assert.equal(connector.capabilities.inventory, true);
  assert.equal(connector.capabilities.seller, true);
  assert.equal(connector.capabilities.fullSnapshot, true);
  /* Capacidades que a API de afiliados NAO expoe — marcar seria mentira. */
  assert.equal(connector.capabilities.stock, false);
  assert.equal(connector.capabilities.gtin, false);
  assert.equal(connector.capabilities.variants, false);
  assert.equal(connector.capabilities.pixPrice, false);
  assert.equal(connector.capabilities.webhook, false);
  assert.equal(connector.capabilities.incrementalUpdates, false);
  assert.throws(
    () => requireCapability(connector, "gtin"),
    UnsupportedCapabilityError,
    "capacidade nao declarada e fail-closed",
  );

  /* --- 2. COLETA (FASE H) --------------------------------------------- */
  process.env.SHOPEE_AFFILIATE_APP_ID = "12345678901";
  process.env.SHOPEE_AFFILIATE_SECRET = "f".repeat(32);
  const batch = await connector.collect(null);
  assert.equal(batch.items.length, 1);
  assert.equal(batch.snapshotComplete, true);
  assert.equal(batch.nextCursor, null);
  assert.ok(
    seenAuth[0].startsWith("SHA256 Credential="),
    "usa autorizacao oficial por assinatura",
  );

  const listing = batch.items[0];

  /* --- 3. NORMALIZACAO + IDENTIDADE (FASE F / G) ----------------------- */
  assert.equal(listing.contractVersion, "normalized-listing/v1");
  assert.equal(listing.marketplaceId, SHOPEE_MARKETPLACE_ID);
  assert.equal(listing.externalListingId, "1001");
  assert.equal(listing.source, "shopee-affiliate");
  assert.equal(listing.seller.externalSellerId, "77");
  assert.equal(listing.seller.name, "Loja Oficial");
  assert.equal(listing.commerce.price, 1299.9);
  assert.equal(listing.catalog.title?.includes("Galaxy Watch"), true);
  assert.equal(listing.metadata.collectedAt, "2026-09-26T12:00:00.000Z");
  assert.equal(listing.metadata.payloadVersion, "shopee-affiliate/v1");

  /* Ausencia real vira UNKNOWN, nunca valor inventado. */
  assert.equal(listing.identity.gtin.length, 0, "fonte nao expoe GTIN");
  assert.equal(listing.commerce.stock, UNKNOWN, "fonte nao expoe estoque");
  assert.equal(listing.commerce.pixPrice, UNKNOWN);
  assert.equal(listing.variant.color, UNKNOWN, "fonte nao expoe variante");
  assert.equal(listing.identity.brand, null, "marca nao e afirmada sem evidencia");

  /* --- 4. VALIDATE ----------------------------------------------------- */
  assert.deepEqual(connector.validate(listing), []);
  assert.deepEqual(validateNormalizedListing(listing).reasonCodes, []);
  {
    const bad = structuredClone(listing);
    bad.commerce.price = 0;
    assert.ok(connector.validate(bad).includes("INVALID_PRICE"));
  }

  /* --- 5. RAW + HASHES (FASE H / O) ----------------------------------- */
  const repository = new InMemoryRawListingRepository();
  const metrics = new CatalogMetrics();
  const ctx = { repository, metrics };

  const first = await processNormalizedListing(ctx, {
    listing,
    rawPayload: node(),
  });
  assert.equal(first.created, true);
  assert.equal(first.path, "STRUCTURAL", "primeira vez e estrutural");
  assert.equal(repository.allRecords().length, 1);

  /* --- 6. IDEMPOTENCIA: NOOP (FASE H) --------------------------------- */
  const second = await processNormalizedListing(ctx, {
    listing,
    rawPayload: node(),
  });
  assert.equal(second.path, "NOOP", "payload identico e NOOP");
  assert.equal(second.created, false);
  assert.equal(repository.allRecords().length, 1, "zero duplicata");
  assert.equal(metrics.total("duplicate_prevented_total") >= 1, true);

  /* --- 7. OFFER_ONLY: muda preco, mesmo catalogo (FASE O) -------------- */
  const priceChanged = structuredClone(listing);
  priceChanged.commerce.price = 1199.9;
  const third = await processNormalizedListing(ctx, {
    listing: priceChanged,
    rawPayload: node({ price: "1199.90" }),
  });
  assert.equal(third.path, "OFFER_ONLY", "so preco mudou => OFFER_ONLY");
  assert.equal(
    third.hashes.catalogHash,
    first.hashes.catalogHash,
    "catalogHash nao muda quando so o preco muda",
  );
  assert.notEqual(third.hashes.offerHash, first.hashes.offerHash);

  /* --- 8. STRUCTURAL: muda titulo (FASE O) ---------------------------- */
  const titleChanged = structuredClone(priceChanged);
  titleChanged.catalog.title = "Smartwatch Samsung Galaxy Watch 4 44mm PLUS";
  const fourth = await processNormalizedListing(ctx, {
    listing: titleChanged,
    rawPayload: node({ price: "1199.90", productName: titleChanged.catalog.title }),
  });
  assert.equal(fourth.path, "STRUCTURAL", "mudanca estrutural => STRUCTURAL");

  /*
   * A partir daqui o estado persistido e o do payload `titleChanged`. O replay
   * usa ESSE payload como "identico": reexecutar o payload antigo aqui seria
   * legitimamente STRUCTURAL (o titulo regrediu), nao um bug de idempotencia.
   * O payload precisa ser um no Shopee COMPLETO, porque replay re-normaliza
   * pelo conector e um no sem itemId seria corretamente REJECTED.
   */
  const buildReplayPayload = (price: string) =>
    node({ price, productName: titleChanged.catalog.title });

  /* --- 9. DETERMINISMO DE HASH ---------------------------------------- */
  {
    const a = computeHashPair(listing, node());
    const b = computeHashPair(listing, node());
    assert.deepEqual(a, b, "hashes sao deterministicos");
    const reordered = computeHashPair(listing, {
      shopName: "Loja Oficial",
      productName: "Smartwatch Samsung Galaxy Watch 4 44mm Bluetooth",
      price: "1299.90",
      itemId: 1001,
      shopId: 77,
    });
    assert.equal(a.catalogHash, reordered.catalogHash, "ordem de chaves nao muda o hash");
    assert.equal(
      classifyHashChange({ catalogHash: a.catalogHash, offerHash: a.offerHash }, a),
      "NOOP",
    );
  }

  /* --- 10. REPLAY (FASE P) -------------------------------------------- */
  {
    const record = await repository.findListing({
      marketplaceId: SHOPEE_MARKETPLACE_ID,
      externalListingId: "1001",
    });
    assert.ok(record, "record existe antes do replay");
    const before = repository.allRecords().length;

    const replay1 = await reprocessRawListing(
      { ...ctx, connector },
      record,
      buildReplayPayload("1199.90"),
    );
    assert.equal(replay1.path, "NOOP", "replay do mesmo payload e NOOP");
    const replay2 = await reprocessRawListing(
      { ...ctx, connector },
      record,
      buildReplayPayload("1199.90"),
    );
    assert.equal(replay2.path, "NOOP", "replay e idempotente");
    assert.equal(
      repository.allRecords().length,
      before,
      "replay nao duplica RawMarketplaceListing",
    );
    assert.equal(
      listingKeyToString(record.key),
      `${SHOPEE_MARKETPLACE_ID}:1001`,
    );
  }

  /* --- 11. REPLAY DE PAYLOAD ALTERADO => OFFER_ONLY ------------------- */
  {
    const record = await repository.findListing({
      marketplaceId: SHOPEE_MARKETPLACE_ID,
      externalListingId: "1001",
    });
    assert.ok(record);
    const replay = await reprocessRawListing(
      { ...ctx, connector },
      record,
      buildReplayPayload("999.00"),
    );
    assert.equal(replay.path, "OFFER_ONLY", "payload alterado muda so a oferta");
  }

  /* --- 12. IDENTIDADE GLOBAL: mesmo externalId em 2 marketplaces ------ */
  {
    const repository2 = new InMemoryRawListingRepository();
    const ml = buildFakeListing({
      marketplaceId: "mercado_livre",
      externalListingId: "1001",
      identity: { gtin: ["7891234567890"], brand: "Samsung", model: "Galaxy Watch 4" },
      catalog: { title: "Smartwatch Samsung Galaxy Watch 4 44mm" },
      commerce: { price: 1349 },
    });
    const sp = structuredClone(listing);
    sp.identity.gtin = ["7891234567890"];
    sp.identity.brand = "Samsung";
    sp.identity.model = "Galaxy Watch 4";

    await processNormalizedListing({ repository: repository2, metrics: new CatalogMetrics() }, { listing: ml, rawPayload: { id: 1 } });
    await processNormalizedListing({ repository: repository2, metrics: new CatalogMetrics() }, { listing: sp, rawPayload: { id: 2 } });

    assert.equal(
      repository2.allRecords().length,
      2,
      "mesmo externalListingId em marketplaces diferentes sao 2 listings",
    );
  }

  /* --- 13. MATCHING CROSS-MARKET (FASE K/L/M) ------------------------- */
  {
    const ml = buildFakeListing({
      marketplaceId: "mercado_livre",
      externalListingId: "ml-1",
      identity: { gtin: ["7891234567890"], brand: "Samsung", model: "Galaxy Watch 4" },
      catalog: { title: "Smartwatch Samsung Galaxy Watch 4 44mm Bluetooth" },
      commerce: { price: 1349 },
    });
    const sp = structuredClone(listing);
    sp.identity.gtin = ["7891234567890"];
    sp.identity.brand = "Samsung";
    sp.identity.model = "Galaxy Watch 4";

    const exact = classifyCrossMarketPair(ml, sp);
    assert.equal(exact.decision, "EXACT", "mesmo GTIN e mesma variante => EXACT");

    /* Hard conflict: outro GTIN => REJECT mesmo com texto identico. */
    const other = structuredClone(sp);
    other.identity.gtin = ["1111111111111"];
    const reject = classifyCrossMarketPair(ml, other);
    assert.equal(reject.decision, "REJECT");
    assert.ok(reject.hardConflicts.some((c) => c.kind === "GTIN_MISMATCH"));

    const results = matchCrossMarket([ml, sp]);
    assert.equal(results.length, 1, "candidate generation por evidencia");
  }

  /* --- 14. SHADOW NAO CONTA COMO MULTILOJA (FASE J) ------------------- */
  {
    const offers = [
      {
        marketplace: "mercado_livre",
        active: true,
        available: true,
        status: "ACTIVE",
        matchStatus: "EXACT" as const,
        price: 1349,
      },
      {
        marketplace: SHOPEE_MARKETPLACE_ID,
        active: true,
        available: true,
        status: "ACTIVE",
        matchStatus: "EXACT" as const,
        price: listing.commerce.price,
      },
    ];
    const verdict = evaluatePublicationEligibility({
      autoCreated: true,
      offers,
      shadowFlags: SHADOW_ONLY_SHOPEE,
    });
    assert.equal(verdict.eligible, false, "shadow nao publica como multiloja");
    assert.equal(verdict.evidence.publicMarketplaceCount, 1);
  }

  /* --- 15. HEALTH CHECK nao vaza segredo ------------------------------ */
  {
    const health = await connector.healthCheck();
    assert.equal(health.ok, true);
    const detail = String(health.detail ?? "");
    assert.ok(!detail.includes(process.env.SHOPEE_AFFILIATE_APP_ID ?? "§"));
    assert.ok(!detail.includes(process.env.SHOPEE_AFFILIATE_SECRET ?? "§"));
  }

  /* --- 16. Credencial ausente => erro explicito, nao stacktrace cru ----- */
  {
    const savedId = process.env.SHOPEE_AFFILIATE_APP_ID;
    delete process.env.SHOPEE_AFFILIATE_APP_ID;
    try {
      const { connector: c2 } = makeConnector([[node()]]);
      await assert.rejects(() => c2.collect(null), (error: unknown) => {
        assert.ok(error instanceof ShopeeConnectorError);
        assert.equal(error.code, "CREDENTIALS_MISSING");
        assert.ok(!error.message.includes(savedId ?? "§"));
        return true;
      });
    } finally {
      if (savedId !== undefined) process.env.SHOPEE_AFFILIATE_APP_ID = savedId;
    }
  }

  console.log("shopeeConnector.contract.test.ts PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
