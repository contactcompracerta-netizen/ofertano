/**
 * CATALOG_ARCHITECTURE_V1 — TESTES DE PUBLICATION DO WRITER PUBLICO (FASE 9.17).
 *
 * A Shopee virar PUBLIC so pode ser seguro se a contagem de marketplace
 * publico continuar sendo a regra central, com PESO. Este arquivo prova as
 * situacoes que a missao exige:
 *
 *   1. ML publico + Shopee SHADOW          => 1 marketplace publico
 *   2. ML publico + Shopee PUBLIC          => 2 marketplaces publicos
 *   3. Duas ofertas Shopee no MESMO Product => conta 1 marketplace Shopee
 *   4. Shopee sozinha nao cria Product      => o writer e attach-only
 *   5. Oferta nao-EXACT / inativa / sem preco nao conta
 *
 * FIDELIDADE: `countPublicMarketplaces` e `hasPublicMultiStore` nao aceitam
 * flags — elas leem do ambiente, exatamente como a pagina publica faz. Por
 * isso este teste alterna `ARCHITECTURE_V1_SHADOW_*` no `process.env` em vez
 * de injetar um objeto: assim ele exercita o mesmo caminho de producao, e nao
 * um atalho de teste. O nucleo nao e alterado.
 */

import assert from "node:assert/strict";

import {
  publicationWeightFor,
  countPublicMarketplacesWithWeight,
} from "../publication/shadowWeight";
import type { ShadowFlags } from "../shadow/flags";
import {
  countPublicMarketplaces,
  hasPublicMultiStore,
  type PublicOfferLike,
} from "../../../publicVisibility/multiStoreVisibility";
import { selectWinningOffer } from "./offerWriter";
import type { PublicOfferDraftV1 } from "./types";

/** Shadow ativa SOMENTE para a Shopee — o estado certificado de producao. */
const SHOPEE_SHADOW: ShadowFlags = {
  enabled: true,
  marketplaceIds: ["shopee"],
  maxWrites: 0,
  persistRaw: false,
  persistHashes: false,
  dryRun: true,
};

/** Shopee promovida: fora da shadow. */
const NO_SHADOW: ShadowFlags = {
  ...SHOPEE_SHADOW,
  enabled: false,
  marketplaceIds: [],
};

/** Alterna a shadow por ambiente, como producao faz. */
function withShadow(on: boolean): () => void {
  const before = process.env.ARCHITECTURE_V1_SHADOW_ENABLED;
  const beforeIds = process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS;
  if (on) {
    process.env.ARCHITECTURE_V1_SHADOW_ENABLED = "true";
    process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS = "shopee";
  } else {
    process.env.ARCHITECTURE_V1_SHADOW_ENABLED = "false";
    process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS = "";
  }
  return () => {
    if (before === undefined) delete process.env.ARCHITECTURE_V1_SHADOW_ENABLED;
    else process.env.ARCHITECTURE_V1_SHADOW_ENABLED = before;
    if (beforeIds === undefined) delete process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS;
    else process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS = beforeIds;
  };
}

function offer(over: Partial<PublicOfferLike>): PublicOfferLike {
  return {
    marketplace: "MERCADO_LIVRE",
    active: true,
    available: true,
    status: "ACTIVE",
    matchStatus: "EXACT",
    price: 100,
    ...over,
  };
}

/*
 * LISTING-FIRST: a oferta ML deste arquivo é uma oferta de ANÚNCIO, então precisa
 * de um ITEM_ID real (`^MLB\d{8,}$`) comprovado pela `sourceUrl`. Sem os dois,
 * `isPublicavelOfertaMercadoLivre` falha fechado e a contagem de marketplaces
 * públicos mediria "oferta ML inexistente" em vez do peso de publicação.
 */
const ml = () =>
  offer({
    marketplace: "MERCADO_LIVRE",
    price: 100,
    externalId: "MLB8765432610",
    sourceUrl:
      "https://produto.mercadolivre.com.br/MLB-8765432610-smartphone-x",
  });
const shopee = (price = 80) => offer({ marketplace: "SHOPEE", price });

function main() {
  /* ---------------------------------------------------------------- */
  /* 1. SHOPEE SHADOW: 1 MARKETPLACE PUBLICO                           */
  /* ---------------------------------------------------------------- */

  const restoreShadow = withShadow(true);
  try {
    assert.equal(publicationWeightFor("shopee", SHOPEE_SHADOW), 0);
    assert.equal(
      countPublicMarketplacesWithWeight([ml(), shopee()], SHOPEE_SHADOW),
      1,
      "ML + Shopee shadow tem de contar 1 marketplace publico",
    );
    // Caminho real da pagina publica (le do ambiente):
    assert.equal(
      countPublicMarketplaces([ml(), shopee()]),
      1,
      "a regra central, lida do ambiente, tem de ver 1",
    );
    assert.equal(
      hasPublicMultiStore([ml(), shopee()]),
      false,
      "ML + Shopee shadow NAO satisfaz multi-loja publica",
    );
  } finally {
    restoreShadow();
  }

  /* ---------------------------------------------------------------- */
  /* 2. SHOPEE PUBLIC: 2 MARKETPLACES PUBLICOS                          */
  /* ---------------------------------------------------------------- */

  const restorePublic = withShadow(false);
  try {
    assert.equal(publicationWeightFor("shopee", NO_SHADOW), 1);
    assert.equal(
      countPublicMarketplacesWithWeight([ml(), shopee()], NO_SHADOW),
      2,
      "ML + Shopee publico tem de contar 2 marketplaces publicos",
    );
    assert.equal(
      countPublicMarketplaces([ml(), shopee()]),
      2,
      "a regra central, apos a promocao, tem de ver 2",
    );
    assert.equal(
      hasPublicMultiStore([ml(), shopee()]),
      true,
      "ML + Shopee publico satisfaz multi-loja publica",
    );

    /* -------------------------------------------------------------- */
    /* 3. DUAS OFERTAS SHOPEE NO MESMO PRODUCT                          */
    /* -------------------------------------------------------------- */

    assert.equal(
      countPublicMarketplacesWithWeight([ml(), shopee(90), shopee(70)], NO_SHADOW),
      2,
      "ML + 2 ofertas Shopee = 2 marketplaces (ML e Shopee), nunca 3",
    );
    assert.equal(
      countPublicMarketplacesWithWeight([shopee(90), shopee(70)], NO_SHADOW),
      1,
      "duas ofertas Shopee sem ML = 1 marketplace so",
    );

    const drafts: PublicOfferDraftV1[] = [
      {
        marketplaceId: "shopee", productId: "P1", externalId: "1", title: "t", seller: "s",
        image: null, price: 90, sourceUrl: null, affiliateLink: "https://a/1",
        available: true, matchStatus: "EXACT", discoverySource: "API",
      },
      {
        marketplaceId: "shopee", productId: "P1", externalId: "2", title: "t", seller: "s",
        image: null, price: 70, sourceUrl: null, affiliateLink: "https://a/2",
        available: true, matchStatus: "EXACT", discoverySource: "API",
      },
    ];
    const winner = selectWinningOffer(drafts);
    assert.equal(winner?.externalId, "2", "a oferta mais barata e a vencedora");
    assert.equal(winner?.price, 70);
    assert.equal(drafts.length, 2, "as duas listings continuam na fonte");

    /* -------------------------------------------------------------- */
    /* 4. SHOPEE SOZINHA NAO FORMA PRODUTO                             */
    /* -------------------------------------------------------------- */

    assert.equal(
      hasPublicMultiStore([shopee()]),
      false,
      "uma oferta Shopee isolada nao satisfaz multi-loja publica",
    );
    assert.equal(countPublicMarketplacesWithWeight([shopee()], NO_SHADOW), 1);

    /* -------------------------------------------------------------- */
    /* 5. OFERTA QUE NAO E EXACT / INATIVA / SEM PRECO NAO CONTA       */
    /*                                                              */
    /* Usa `countPublicMarketplaces`/`hasPublicMultiStore`, e nao o     */
    /* `countPublicMarketplacesWithWeight`: o ponderado e DE PROPOSITO  */
    /* livre de validade de oferta (e o gate de DISCOVERY, cujo tipo de */
    /* entrada nao expressa disponibilidade). O gate real de ativacao   */
    /* e `hasPublicMultiStore`, que e o que `sincronizarMelhorOferta- */
    /* DoProduto` chama. E o que estao sendo testados aqui.            */
    /* -------------------------------------------------------------- */

    const notUsable: Array<[string, Partial<PublicOfferLike>]> = [
      ["REVIEW", { matchStatus: "REVIEW" }],
      ["REJECTED", { matchStatus: "REJECTED" }],
      ["inativa", { active: false }],
      ["indisponivel", { available: false }],
      ["sem preco valido", { price: 0 }],
      ["UNAVAILABLE", { status: "UNAVAILABLE" }],
      ["ERROR", { status: "ERROR" }],
    ];
    for (const [label, patch] of notUsable) {
      assert.equal(
        countPublicMarketplaces([ml(), offer({ marketplace: "SHOPEE", ...patch })]),
        1,
        `oferta Shopee ${label} nao pode virar o segundo marketplace`,
      );
      assert.equal(
        hasPublicMultiStore([ml(), offer({ marketplace: "SHOPEE", ...patch })]),
        false,
        `oferta Shopee ${label} nao pode ativar um produto auto-criado`,
      );
    }

    /* -------------------------------------------------------------- */
    /* 6. MERCADO LIVRE NUNCA PERDE PESO                               */
    /* -------------------------------------------------------------- */

    assert.equal(publicationWeightFor("mercado_livre", SHOPEE_SHADOW), 1);
    assert.equal(publicationWeightFor("mercado_livre", NO_SHADOW), 1);
    assert.equal(
      countPublicMarketplacesWithWeight([ml()], NO_SHADOW),
      1,
      "Mercado Livre sozinho e publico",
    );
  } finally {
    restorePublic();
  }

  console.log(
    "publicSyncPublication.test.ts PASS " +
      "(shadow=1, public=2, duasOfertas=1marketplace, shopeeSozinha=single-store, naoExact=0)",
  );
}

main();
