/**
 * CATALOG_ARCHITECTURE_V1 — ALIEXPRESS CONNECTOR: CONTRACT TEST (FASE 12).
 *
 * O conector AliExpress passa pelo MESMO contrato dos FakeConnectors, Shopee e
 * Amazon, sem nenhuma alteração especial no core:
 *   collect -> normalize -> validate -> raw -> hash -> replay -> idempotência
 *   -> identidade -> matching cross-market
 *
 * NENHUM teste aqui toca a rede: o discovery e o `buscarProdutoApi` legados são
 * substituídos por injeção. A prova de que a fonte é real é o probe separado
 * (forensics), não este arquivo.
 *
 * O foco deste arquivo é o que é PERIGOSO no AliExpress specifically:
 *   - identidade `product_id` (família) vs `sku_id` (variante);
 *   - o gate de variante (128GB vs 256GB, 110V vs 220V, Pro vs Pro Max);
 *   - fail-closed de link: sem `promotion_link` não publica oferta nova;
 *   - fonte morta tem que FALAR, não parecer "zero anúncios".
 */
import assert from "node:assert/strict";

import {
  AliExpressMarketplaceConnector,
  ALIEXPRESS_MARKETPLACE_ID,
  ALIEXPRESS_CONNECTOR_ID,
  ALIEXPRESS_CAPABILITIES,
  clearAliExpressRawPayloadCache,
  createAliExpressConnector,
  productIdValido,
} from "./aliexpressConnector";
import { ALIEXPRESS_PURCHASE_LINKS } from "../publicSync/connectors/aliexpressPurchaseLinks";
import { resolvePurchaseLinks, noPurchaseLinks } from "../publicSync/purchaseLinks";
import { requireCapability, UnsupportedCapabilityError } from "../types/connector";
import { processNormalizedListing, validateNormalizedListing } from "../ingestion/pipeline";
import { reprocessRawListing } from "../ingestion/reprocess";
import { InMemoryRawListingRepository } from "../fake/inMemoryRepositories";
import { CatalogMetrics } from "../observability/metrics";
import { computeHashPair, classifyHashChange } from "../hashing";
import { listingKeyToString } from "../ingestion/rawRepository";
import { evaluateIdentityConfidence } from "../identity/identityConfidence";
import { buildFakeListing } from "../fake/fakeConnectors";
import { UNKNOWN } from "../types/normalizedListingV1";

const PRODUCT_ID = "1005006789";

/* ------------------------------------------------------------------ */
/* Stub do payload real da Affiliate API (fields medidas em api.ts)    */
/* ------------------------------------------------------------------ */

function produto(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    product_id: PRODUCT_ID,
    product_title: "Fone de Ouvido Bluetooth TWS 5.3 com Estojo 128GB",
    product_main_image_url: "https://ae01.alicdn.com/kfs/example-main.jpg",
    product_small_image_urls: {
      string: [
        "https://ae01.alicdn.com/kfs/example-1.jpg",
        "https://ae01.alicdn.com/kfs/example-2.jpg",
      ],
    },
    product_detail_url: "https://www.aliexpress.com/item/1005006789.html",
    promotion_link: "https://s.click.aliexpress.com/e/click?trace=abc&productId=1005006789",
    target_sale_price: "129.90",
    target_sale_price_currency: "BRL",
    target_original_price: "249.90",
    target_original_price_currency: "BRL",
    second_level_category_name: "Fones de Ouvido",
    first_level_category_name: "Eletrônicos",
    shop_id: "8891234",
    shop_name: "Loja Oficial Exemplo",
    sku_id: "500123456789",
    lastest_volume: "9000",
    ...over,
  };
}

function makeConnector() {
  clearAliExpressRawPayloadCache();
  const connector = new AliExpressMarketplaceConnector({
    keywords: ["fone de ouvido bluetooth"],
    limit: 10,
  });
  return connector;
}

async function main() {
  /* --- 1. CAPACIDADES REAIS (FASE E) ---------------------------------- */
  {
    const connector = makeConnector();
    assert.equal(connector.marketplaceId, ALIEXPRESS_MARKETPLACE_ID);
    assert.equal(connector.id, ALIEXPRESS_CONNECTOR_ID);
    assert.equal(ALIEXPRESS_CAPABILITIES.catalog, true);
    assert.equal(ALIEXPRESS_CAPABILITIES.inventory, true);
    assert.equal(ALIEXPRESS_CAPABILITIES.seller, true);

    /*
     * As afirmações mais importantes: a API NÃO expõe estoque, frete, GTIN,
     * eixos estruturados de variante, delta, snapshot nem webhook. Declarar
     * qualquer uma dessas como `true` seria afirmar uma capacidade que a
     * fonte não entrega.
     */
    assert.equal(ALIEXPRESS_CAPABILITIES.stock, false);
    assert.equal(ALIEXPRESS_CAPABILITIES.shipping, false);
    assert.equal(ALIEXPRESS_CAPABILITIES.variants, false);
    assert.equal(ALIEXPRESS_CAPABILITIES.gtin, false);
    assert.equal(ALIEXPRESS_CAPABILITIES.incrementalUpdates, false);
    assert.equal(ALIEXPRESS_CAPABILITIES.fullSnapshot, false);
    assert.equal(ALIEXPRESS_CAPABILITIES.webhook, false);
    assert.equal(ALIEXPRESS_CAPABILITIES.pixPrice, false);

    assert.throws(
      () => requireCapability(connector, "gtin"),
      UnsupportedCapabilityError,
      "capacidade não declarada é fail-closed",
    );
    assert.throws(
      () => requireCapability(connector, "variants"),
      UnsupportedCapabilityError,
      "variante estruturada não existe nesta fonte",
    );
  }

  /* --- 2. IDENTIDADE: product_id é FAMÍLIA, sku_id NÃO é identidade ---- */
  {
    assert.equal(productIdValido("1005006789"), "1005006789");
    assert.equal(productIdValido(1005006789), "1005006789");
    assert.equal(productIdValido("123"), null, "id curto não é product_id");
    assert.equal(productIdValido("abc-123"), null);
    assert.equal(productIdValido(null), null);
    assert.equal(productIdValido(undefined), null);

    const listing = makeConnector().normalize(produto());
    assert.equal(
      listing.externalListingId,
      PRODUCT_ID,
      "identidade física é o product_id, nunca o sku_id nem a URL",
    );
    assert.notEqual(listing.externalListingId, "500123456789");
    /*
     * O sku_id é preservado como ATRIBUTO DE VARIANTE (evidência de que a
     * anúncio tem variantes), nunca como chave.
     */
    assert.equal(listing.variant.otherAttributes.sku_id, "500123456789");
  }

  /* --- 3. NORMALIZAÇÃO + AUSÊNCIA HONESTA ---------------------------- */
  {
    const listing = makeConnector().normalize(produto());
    assert.equal(listing.contractVersion, "normalized-listing/v1");
    assert.equal(listing.marketplaceId, ALIEXPRESS_MARKETPLACE_ID);
    assert.equal(listing.source, ALIEXPRESS_CONNECTOR_ID);
    assert.equal(listing.metadata.payloadVersion, "aliexpress-affiliate/v1");

    assert.equal(listing.seller.externalSellerId, "8891234");
    assert.equal(listing.seller.name, "Loja Oficial Exemplo");
    assert.equal(listing.commerce.price, 129.9);
    assert.equal(listing.commerce.oldPrice, 249.9);
    assert.equal(listing.catalog.category, "Fones de Ouvido");
    assert.equal(listing.catalog.primaryImageUrl, "https://ae01.alicdn.com/kfs/example-main.jpg");
    assert.equal(listing.catalog.images.length, 3);

    /* Tudo que a API NÃO devolve vira ausência explícita, nunca valor inventado. */
    assert.equal(listing.identity.gtin.length, 0, "API não expõe GTIN");
    assert.equal(listing.identity.brand, null, "marca não é afirmada sem campo");
    assert.equal(listing.identity.mpn, null);
    assert.equal(listing.commerce.stock, UNKNOWN, "API não expõe estoque");
    assert.equal(listing.commerce.pixPrice, UNKNOWN);
    assert.equal(listing.commerce.shippingHint, UNKNOWN);
    assert.equal(listing.commerce.installments, UNKNOWN);
    assert.equal(listing.commerce.availability, "IN_STOCK");
    assert.equal(
      listing.variant.storage,
      UNKNOWN,
      "sku_id é opaco: não inventa eixo de variante",
    );
    assert.equal(listing.variant.color, UNKNOWN);
    assert.equal(listing.variant.voltage, UNKNOWN);
  }

  /* --- 4. VALIDATE ---------------------------------------------------- */
  {
    const connector = makeConnector();
    const listing = connector.normalize(produto());
    assert.deepEqual(connector.validate(listing), []);
    assert.deepEqual(validateNormalizedListing(listing).reasonCodes, []);

    {
      const bad = structuredClone(listing);
      bad.commerce.price = 0;
      assert.ok(connector.validate(bad).includes("INVALID_PRICE"));
    }
    {
      const bad = structuredClone(listing);
      bad.externalListingId = "123";
      assert.ok(connector.validate(bad).includes("INVALID_PRODUCT_ID"));
    }
    {
      const bad = structuredClone(listing);
      bad.catalog.title = "";
      bad.catalog.category = null;
      assert.ok(connector.validate(bad).includes("MISSING_CATALOG_SIGNAL"));
    }
  }

  /* --- 5. payload INVÁLIDO: sem product_id / preço / título ------------ */
  {
    const connector = makeConnector();
    assert.throws(
      () => connector.normalize(produto({ product_id: undefined })),
      /ALIEXPRESS_PAYLOAD_INVALID/,
      "product_id ausente não vira listing",
    );
    assert.throws(
      () => connector.normalize(produto({ target_sale_price: "0" })),
      /ALIEXPRESS_PAYLOAD_INVALID/,
      "preço zero não publica",
    );
    assert.throws(
      () => connector.normalize(produto({ product_title: "   " })),
      /ALIEXPRESS_PAYLOAD_INVALID/,
      "título vazio não publica",
    );
  }

  /* --- 6. LINK FAIL-CLOSED (requisito 14) ----------------------------- */
  {
    const connector = makeConnector();

    /* promotion_link ausente => MISSING, e a oferta nova não é publicável. */
    const semLink = connector.normalize(produto({ promotion_link: undefined }));
    const raw = connector.rawPayloadFor(semLink.externalListingId);
    assert.ok(raw, "payload bruto preservado mesmo sem link");
    const resolvido = resolvePurchaseLinks(
      ALIEXPRESS_PURCHASE_LINKS.extract(raw),
    );
    assert.equal(resolvido.affiliateState, "MISSING");
    assert.equal(resolvido.hasAffiliateLink, false);
    assert.equal(resolvido.affiliateLink, null);

    /*
     * promotion_link inseguro é REJEITADO PELO CONECTOR, antes do core.
     * `normalizarAffiliateLink` exige http(s) + host `*.aliexpress.com`; o que
     * não passa vira `null` no payload bruto, então nunca chega a ser
     * persistido. É fail-closed mais cedo que o core.
     */
    for (const inseguro of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "https://evil.example.com/steal?productId=1005006789",
      "not-a-url",
    ]) {
      const listing = connector.normalize(produto({ promotion_link: inseguro }));
      const raw = connector.rawPayloadFor(listing.externalListingId);
      const resolvido = resolvePurchaseLinks(ALIEXPRESS_PURCHASE_LINKS.extract(raw));
      assert.equal(
        resolvido.hasAffiliateLink,
        false,
        `link inseguro nunca publica: ${inseguro}`,
      );
      assert.equal(resolvido.affiliateLink, null);
      assert.equal(
        resolvido.affiliateState,
        "MISSING",
        `link inseguro é descartado antes do core: ${inseguro}`,
      );
    }

    /* Defence in depth: o CORE também rejeita esquema fora de http(s). */
    const resolvidoInvalido = resolvePurchaseLinks(
      ALIEXPRESS_PURCHASE_LINKS.extract({
        promotionLink: "javascript:alert(1)",
        productDetailUrl: "https://www.aliexpress.com/item/1005006789.html",
      }),
    );
    assert.equal(resolvidoInvalido.affiliateState, "INVALID");
    assert.equal(resolvidoInvalido.affiliateLink, null);
    assert.equal(
      resolvidoInvalido.sourceUrl,
      "https://www.aliexpress.com/item/1005006789.html",
      "sourceUrl válida sobrevive ao affiliate inválido",
    );

    /* Link válido é preservado exatamente como a API devolveu. */
    const comLink = connector.normalize(produto());
    const rawComLink = connector.rawPayloadFor(comLink.externalListingId);
    const resolvidoComLink = resolvePurchaseLinks(
      ALIEXPRESS_PURCHASE_LINKS.extract(rawComLink),
    );
    assert.equal(resolvidoComLink.affiliateState, "SAFE");
    assert.match(String(resolvidoComLink.affiliateLink), /s\.click\.aliexpress\.com/);
    assert.equal(
      resolvidoComLink.sourceUrl,
      "https://www.aliexpress.com/item/1005006789.html",
    );

    /* Sem payload bruto, não há link: nunca se inventa. */
    const semBruto = noPurchaseLinks();
    assert.equal(semBruto.hasAffiliateLink, false);
    assert.equal(semBruto.affiliateReason, "RAW_PAYLOAD_UNAVAILABLE");
  }

  /* --- 7. IMAGE HOST ALLOWLIST (fonte externa não escolhe host) ------- */
  {
    const connector = makeConnector();
    const listing = connector.normalize(
      produto({
        product_main_image_url: "https://evil.example.com/track.jpg",
        product_small_image_urls: {
          string: ["https://ae01.alicdn.com/kfs/ok.jpg"],
        },
      }),
    );
    assert.equal(
      listing.catalog.primaryImageUrl,
      "https://ae01.alicdn.com/kfs/ok.jpg",
      "host fora do AliExpress é descartado, não persistido",
    );
    assert.equal(listing.catalog.images.length, 1);
  }

  /* --- 8. GATE DE VARIANTE: testado NO CORE, nao em helper local ----- */
  /*
   * Estes casos nao exercitam um regex do conector - eles exercitam o
   * `evaluateIdentityConfidence` de verdade, que e o unico caminho por onde
   * uma listagem AliExpress poderia virar oferta publica. Um teste de helper
   * local provaria que o helper funciona, nao que o gate segura.
   */
  {
    const cenario = (
      listingTitle: string,
      productTitle: string,
      motivo: string,
    ) => {
      const connector = makeConnector();
      const anuncio = connector.normalize(
        produto({ product_id: "1005009999", product_title: listingTitle }),
      );
      // Produto do catalogo com identidade FORTE, para isolar o gate de
      // variante. Se ainda assim nao publica, nunca foi por "parece igual".
      const catalogo = buildFakeListing({
        marketplaceId: "shopee",
        externalListingId: "s-1",
        identity: {
          gtin: ["7891234567890"],
          brand: "Generico",
          model: "MODELO-1",
          manufacturerModel: "MODELO-1",
        },
        catalog: { title: productTitle },
      });
      const decision = evaluateIdentityConfidence(anuncio, catalogo);
      assert.notEqual(
        decision.confidence,
        "EXACT",
        `NUNCA publica por titulo parecido: ${motivo}`,
      );
      return decision;
    };

    /* 128GB vs 256GB */
    const gb = cenario(
      "Fone Bluetooth TWS 128GB",
      "Fone Bluetooth TWS 256GB",
      "128GB vs 256GB",
    );
    assert.ok(
      gb.hardConflicts.length > 0,
      "128GB vs 256GB precisa ser HARD CONFLICT, nao um MATCH silencioso",
    );

    /* 110V vs 220V */
    const volt = cenario(
      "Carregador USB-C 110V",
      "Carregador USB-C 220V",
      "110V vs 220V",
    );
    assert.ok(
      volt.hardConflicts.length > 0,
      "110V vs 220V precisa ser HARD CONFLICT",
    );

    /* Pro vs Pro Max */
    cenario("iPhone 15 Pro Max 256GB", "iPhone 15 Pro 256GB", "Pro Max vs Pro");

    /* kit 2unidades vs unidade avulsa */
    cenario(
      "Fone Bluetooth Kit 2 Unidades",
      "Fone Bluetooth Unidade Avulsa",
      "kit vs unidade",
    );

    /* bundle vs produto simples */
    cenario(
      "Carregador Kit Completo 3 Pecas",
      "Carregador Unidade Simples",
      "bundle vs unidade",
    );

    /* RAM 8GB vs 16GB */
    const ram = cenario(
      "Notebook 8GB RAM SSD 256GB",
      "Notebook 16GB RAM SSD 256GB",
      "8GB vs 16GB RAM",
    );
    assert.ok(
      ram.hardConflicts.length > 0,
      "8GB vs 16GB RAM precisa ser HARD CONFLICT",
    );

    /* Mesma variante tambem nao publica: nao ha evidencia estruturada
     * possivel nesta fonte. E o ponto que garante que "parecido" nunca vira
     * "identico". */
    const igual = cenario(
      "Fone Bluetooth TWS 128GB",
      "Fone Bluetooth TWS 128GB",
      "mesma variante",
    );
    assert.equal(
      igual.confidence,
      "REJECT",
      "mesmo titulo sem evidencia estruturada NAO vira EXACT",
    );
  }

  /* --- 9. ELEGIBILIDADE ESTRUTURAL: AliExpress nunca atinge EXACT ------ */
  {
    /*
     * `collectStrongEvidence` so aceita GTIN, MPN, manufacturerModel e
     * brand+model. A API nao devolve NENHUM dos quatro. Portanto o caminho
     * EXACT e inalcancavel para esta fonte - nao por azar, mas por
     * construcao. E o que garante REJECT/HARD_CONFLICT sem depender de
     * nenhuma heuristica de titulo.
     */
    const conector = makeConnector();
    const anuncio = conector.normalize(produto());

    for (const productTitle of [
      "Fone Bluetooth TWS 128GB",
      "Fone de Ouvido Bluetooth",
      "Bluetooth TWS 5.3 Estojo",
    ]) {
      const catalogo = buildFakeListing({
        marketplaceId: "mercado_livre",
        externalListingId: "ml-1",
        identity: { gtin: ["7891234567890"], brand: "Generico", model: "MODELO-1" },
        catalog: { title: productTitle },
      });
      const decisao = evaluateIdentityConfidence(anuncio, catalogo);
      assert.equal(
        decisao.confidence,
        "REJECT",
        `sem GTIN/MPN/marca a listagem nunca e EXACT (${productTitle})`,
      );
    }

    /* A propria listagem AliExpress nao carrega evidencia forte. */
    assert.deepEqual(anuncio.identity.gtin, []);
    assert.equal(anuncio.identity.brand, null);
    assert.equal(anuncio.identity.mpn, null);
    assert.equal(anuncio.identity.manufacturerModel, null);
    assert.equal(anuncio.identity.model, null);
  }

  /* --- 10. HASHING: preço-only / estrutural / idempotência ------------ */
  {
    const connector = makeConnector();
    const repository = new InMemoryRawListingRepository();
    const metrics = new CatalogMetrics();
    const ctx = { repository, metrics };

    const listing = connector.normalize(produto());

    const first = await processNormalizedListing(ctx, {
      listing,
      rawPayload: produto(),
    });
    assert.equal(first.created, true);
    assert.equal(first.path, "STRUCTURAL", "primeira vez é estrutural");
    assert.equal(repository.allRecords().length, 1);

    const second = await processNormalizedListing(ctx, {
      listing,
      rawPayload: produto(),
    });
    assert.equal(second.path, "NOOP", "payload idêntico é NOOP");
    assert.equal(second.created, false);
    assert.equal(repository.allRecords().length, 1, "zero duplicata");
    assert.ok(metrics.total("duplicate_prevented_total") >= 1);

    /* Só o preço muda => OFFER_ONLY, catalogHash estável */
    const precoMudado = structuredClone(listing);
    precoMudado.commerce.price = 99.9;
    const third = await processNormalizedListing(ctx, {
      listing: precoMudado,
      rawPayload: produto({ target_sale_price: "99.90" }),
    });
    assert.equal(third.path, "OFFER_ONLY", "só preço mudou => OFFER_ONLY");
    assert.equal(
      third.hashes.catalogHash,
      first.hashes.catalogHash,
      "catalogHash não muda quando só o preço muda",
    );
    assert.notEqual(third.hashes.offerHash, first.hashes.offerHash);

    /* Mudança estrutural (título) => catalogHash muda */
    const tituloMudado = structuredClone(precoMudado);
    const NOVO_TITULO = "Fone Bluetooth TWS Pro Max 512GB";
    tituloMudado.catalog.title = NOVO_TITULO;
    tituloMudado.variant.otherAttributes = { sku_id: "500999" };
    const fourth = await processNormalizedListing(ctx, {
      listing: tituloMudado,
      rawPayload: produto({
        target_sale_price: "99.90",
        product_title: NOVO_TITULO,
        sku_id: "500999",
      }),
    });
    assert.equal(fourth.path, "STRUCTURAL", "mudança estrutural => STRUCTURAL");
    assert.notEqual(fourth.hashes.catalogHash, third.hashes.catalogHash);
  }

  /* --- 11. DETERMINISMO DE HASH -------------------------------------- */
  {
    const listing = makeConnector().normalize(produto());
    const a = computeHashPair(listing, produto());
    const b = computeHashPair(listing, produto());
    assert.deepEqual(a, b, "hashes são determinísticos");
    assert.equal(
      classifyHashChange({ catalogHash: a.catalogHash, offerHash: a.offerHash }, a),
      "NOOP",
    );
  }

  /* --- 12. REPLAY: idempotente, e muda oferta quando o preço muda ----- */
  {
    const connector = makeConnector();
    const repository = new InMemoryRawListingRepository();
    const ctx = { repository, metrics: new CatalogMetrics() };

    const listing = connector.normalize(produto());
    await processNormalizedListing(ctx, { listing, rawPayload: produto() });
    const record = await repository.findListing({
      marketplaceId: ALIEXPRESS_MARKETPLACE_ID,
      externalListingId: PRODUCT_ID,
    });
    assert.ok(record, "record existe antes do replay");
    assert.equal(
      listingKeyToString(record.key),
      `${ALIEXPRESS_MARKETPLACE_ID}:${PRODUCT_ID}`,
    );

    const before = repository.allRecords().length;
    const replay1 = await reprocessRawListing({ ...ctx, connector }, record, produto());
    assert.equal(replay1.path, "NOOP", "replay do mesmo payload é NOOP");
    const replay2 = await reprocessRawListing({ ...ctx, connector }, record, produto());
    assert.equal(replay2.path, "NOOP", "replay é idempotente");
    assert.equal(repository.allRecords().length, before, "replay não duplica");

    const replayAlterado = await reprocessRawListing(
      { ...ctx, connector },
      record,
      produto({ target_sale_price: "59.90" }),
    );
    assert.equal(replayAlterado.path, "OFFER_ONLY", "payload alterado muda só oferta");
  }

  /* --- 13. IDEMPOTÊNCIA DE COLETA: mesmo product_id não duplica ------- */
  {
    const connector = makeConnector();
    // collect() toca a rede via buscarAliExpress; aqui testamos a chave, que
    // é a invariante real: dois payloads do MESMO product_id são a mesma
    // listing, e processar os dois não cria duas linhas.
    const repository = new InMemoryRawListingRepository();
    const ctx = { repository, metrics: new CatalogMetrics() };
    const a = connector.normalize(produto());
    const b = connector.normalize(produto({ promotion_link: "https://s.click.aliexpress.com/e/click?trace=zzz&productId=1005006789" }));
    assert.equal(a.externalListingId, b.externalListingId);
    await processNormalizedListing(ctx, { listing: a, rawPayload: produto() });
    const second = await processNormalizedListing(ctx, { listing: b, rawPayload: produto({ promotion_link: "https://s.click.aliexpress.com/e/click?trace=zzz&productId=1005006789" }) });
    /*
     * O link de afiliado NÃO participa do catalogHash nem do offerHash: ele é
     * lido do payload bruto no momento da escrita, pelo purchase-link adapter.
     * Logo, um link novo do mesmo product_id é NOOP estrutural — e o que
     * importa é que não crie uma segunda oferta para o mesmo anúncio.
     */
    assert.equal(second.path, "NOOP", "só o link mudou: nada estrutural muda");
    assert.equal(
      second.hashes.catalogHash,
      (await repository.findListing({
        marketplaceId: ALIEXPRESS_MARKETPLACE_ID,
        externalListingId: PRODUCT_ID,
      }))?.catalogHash,
      "link não altera o catálogo",
    );
    assert.equal(repository.allRecords().length, 1, "zero duplicata física");

    /* E o link novo é o que o adapter vai ler. */
    const raw = connector.rawPayloadFor(PRODUCT_ID);
    assert.equal(
      resolvePurchaseLinks(ALIEXPRESS_PURCHASE_LINKS.extract(raw)).affiliateLink,
      "https://s.click.aliexpress.com/e/click?trace=zzz&productId=1005006789",
      "o payload bruto preserva o link mais recente da fonte",
    );
  }

  /* --- 14. HEALTH CHECK: credencial ausente é explícito, sem vazar ---- */
  {
    const connector = makeConnector();
    const savedKey = process.env.ALIEXPRESS_APP_KEY;
    const savedSecret = process.env.ALIEXPRESS_APP_SECRET;
    delete process.env.ALIEXPRESS_APP_KEY;
    delete process.env.ALIEXPRESS_APP_SECRET;
    try {
      const health = await connector.healthCheck();
      assert.equal(health.ok, false);
      assert.equal(health.detail, "CREDENTIALS_MISSING");
      const detail = String(health.detail ?? "");
      assert.ok(!detail.includes(savedKey ?? "§"));
      assert.ok(!detail.includes(savedSecret ?? "§"));
    } finally {
      if (savedKey !== undefined) process.env.ALIEXPRESS_APP_KEY = savedKey;
      if (savedSecret !== undefined) process.env.ALIEXPRESS_APP_SECRET = savedSecret;
    }
  }

  /* --- 15. fetchByExternalId: id inválido devolve null (NOT_SEEN) ----- */
  {
    const connector = makeConnector();
    assert.equal(await connector.fetchByExternalId("123"), null);
    assert.equal(await connector.fetchByExternalId(""), null);
  }

  /* --- 16. FONTE MORTA FALA (a armadilha do canário silencioso) --------- */
  /*
   * `buscarAliExpress` NÃO LANÇA: credencial revogada, API fora do ar ou
   * permissão perdida voltam como `searchOutcome: BLOCKED | UNUSABLE | ERROR`
   * com `candidates: []`.
   *
   * Se o conector engolisse isso, um canário reportaria
   * `LISTINGS_COLLECTED=0, ERROR=null` — o MESMO número de uma busca que
   * rodou bem e não achou nada. O verde seria indistinguível de uma coleta
   * morta, que é exatamente a falha que o canário existe para pegar.
   *
   * Aqui a rede é desligada de propósito (sem credencial => a API não
   * autoriza), então o caso real de "fonte morta" é reproduzido.
   */
  {
    const savedKey = process.env.ALIEXPRESS_APP_KEY;
    const savedSecret = process.env.ALIEXPRESS_APP_SECRET;
    delete process.env.ALIEXPRESS_APP_KEY;
    delete process.env.ALIEXPRESS_APP_SECRET;
    try {
      const connector = makeConnector();
      let erro: unknown = null;
      try {
        await connector.collect();
      } catch (e) {
        erro = e;
      }
      assert.ok(
        erro instanceof Error,
        "fonte bloqueada tem que lançar, não devolver batch vazia",
      );
      assert.match(
        erro.message,
        /ALIEXPRESS_SOURCE_(BLOCKED|UNUSABLE|ERROR)/,
        `a mensagem tem que dizer que a FONTE falhou (veio: ${erro.message})`,
      );
      /*
       * O runner reporta `ERROR: COLLECT_FAILED: <erro.name>`. Um `name` com
       * "ErrorError" ou com a mensagem inteira dentro tornaria o alerta do
       * cron ilegível — que é justamente quando ele precisa ser legível.
       */
      assert.equal(erro.name, "AliExpressSourceError");
    } finally {
      if (savedKey !== undefined) process.env.ALIEXPRESS_APP_KEY = savedKey;
      if (savedSecret !== undefined) process.env.ALIEXPRESS_APP_SECRET = savedSecret;
    }
  }

  console.log("aliexpressConnector.contract.test.ts PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
