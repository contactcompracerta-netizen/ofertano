/**
 * FASE P (FASE 9) — REGRESSÃO DO INVARIANTE DE PUBLICATION.
 *
 * O harness de Fase P media `COUNT(DISTINCT marketplace)` sem peso de shadow,
 * enquanto o gate de produção usa `countPublicMarketplacesWithWeight`. Estes
 * testes existem para que essa divergência NÃO VOLTE silenciosamente: se
 * alguém trocar o helper por um SQL cru de novo, ou se a allowlist da shadow
 * deixar de ser aplicada, o teste falha.
 *
 * Nenhum teste aqui toca em banco, rede ou credencial.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLIC_OFFER_PREDICATE_SQL,
  canonicalMarketplaceId,
  countAutoActiveBelowMin,
  unweightedPublicMarketplaceCount,
  weightedPublicMarketplaceCount,
  type PublicOfferDbRow,
} from "./phasePPublicationInvariants";
import { DEFAULT_SHADOW_FLAGS, readShadowFlags } from "../services/architecture/v1/shadow/flags";
import { PUBLIC_MULTISTORE_MIN_MARKETPLACES } from "../services/publicVisibility/multiStoreVisibility";

/* Shadow ATIVA apenas para shopee — o contrato documentado da FASE 8.2. */
const SHADOW_ON = { ...DEFAULT_SHADOW_FLAGS, enabled: true, marketplaceIds: ["shopee"] };
/* Shadow DESLIGADA — o que o .env.local local produz hoje. */
const SHADOW_OFF = DEFAULT_SHADOW_FLAGS;

function offer(
  productId: string,
  marketplace: string,
  overrides: Partial<PublicOfferDbRow> = {},
): PublicOfferDbRow {
  return {
    productId,
    marketplace,
    active: true,
    available: true,
    matchStatus: "EXACT",
    status: "ACTIVE",
    price: 100,
    ...overrides,
  };
}

test("P1: enum do banco vira o marketplaceId canonico da allowlist", () => {
  assert.equal(canonicalMarketplaceId("SHOPEE"), "shopee");
  assert.equal(canonicalMarketplaceId("MERCADO_LIVRE"), "mercado_livre");
  assert.equal(canonicalMarketplaceId("MAGAZINE_LUIZA"), "magazine_luiza");
  // Enum fora do registry NAO some: mantem o peso legado, por contrato.
  assert.equal(canonicalMarketplaceId("LOJA_DO_FUTURO"), "loja_do_futuro");
});

test("P2: com shadow ATIVA, shopee tem peso 0 e nao soma marketplace", () => {
  const offers = [
    { marketplace: "mercado_livre" },
    { marketplace: "shopee" },
  ];
  assert.equal(weightedPublicMarketplaceCount(offers, SHADOW_ON), 1);
  // O número SEM peso é 2 — é exatamente a divergência que corrigimos.
  assert.equal(unweightedPublicMarketplaceCount(offers), 2);
});

test("P3: com shadow DESLIGADA, shopee mantem o peso legado (1)", () => {
  const offers = [{ marketplace: "mercado_livre" }, { marketplace: "shopee" }];
  assert.equal(weightedPublicMarketplaceCount(offers, SHADOW_OFF), 2);
});

test("P4: ML + SHOPEE com shadow ATIVA fica ABAIXO do minimo (o bug do harness)", () => {
  const products = [
    {
      productId: "prod-carregador",
      offers: [
        offer("prod-carregador", "MERCADO_LIVRE"),
        offer("prod-carregador", "SHOPEE"),
      ],
    },
  ];
  const on = countAutoActiveBelowMin(products, SHADOW_ON);
  // O SQL cru dizia 0 violacoes. O gate de producao diz 1.
  assert.equal(on.belowUnweighted, 0, "metrica historica continua 0");
  assert.equal(on.belowWeighted, 1, "invariante de producao ve 1");
  assert.deepEqual(on.belowWeightedProductIds, ["prod-carregador"]);

  // Com a shadow desligada, o mesmo produto tem 2 marketplaces => 0 violacoes.
  const off = countAutoActiveBelowMin(products, SHADOW_OFF);
  assert.equal(off.belowWeighted, 0);
  assert.equal(off.belowUnweighted, 0);
});

test("P5: duas ofertas da MESMA marketplace contam como 1", () => {
  const products = [
    {
      productId: "p",
      offers: [
        offer("p", "MERCADO_LIVRE", { price: 10 }),
        offer("p", "MERCADO_LIVRE", { price: 20 }),
      ],
    },
  ];
  for (const flags of [SHADOW_ON, SHADOW_OFF]) {
    const r = countAutoActiveBelowMin(products, flags);
    assert.equal(r.belowUnweighted, 1);
    assert.equal(r.belowWeighted, 1);
  }
});

test("P6: oferta invalida nao conta nem no numero com peso", () => {
  const products = [
    {
      productId: "p",
      offers: [
        offer("p", "MERCADO_LIVRE"),
        offer("p", "MAGAZINE_LUIZA", { active: false }),
        offer("p", "AMAZON", { matchStatus: "REVIEW" }),
        offer("p", "SHOPEE", { available: false }),
      ],
    },
  ];
  // So MERCADO_LIVRE e utilizavel => 1 marketplace => abaixo do minimo.
  const r = countAutoActiveBelowMin(products, SHADOW_ON);
  assert.equal(r.belowUnweighted, 1);
  assert.equal(r.belowWeighted, 1);

  // Um segundo marketplace VALIDO faz o produto ser elegivel.
  const good = [
    {
      productId: "p",
      offers: [offer("p", "MERCADO_LIVRE"), offer("p", "MAGAZINE_LUIZA")],
    },
  ];
  const r2 = countAutoActiveBelowMin(good, SHADOW_ON);
  assert.equal(r2.belowUnweighted, 0);
  assert.equal(r2.belowWeighted, 0);
});

test("P7: produto sem nenhuma oferta publica e violacao nas DUAS contagens", () => {
  const products = [{ productId: "p", offers: [] }];
  const r = countAutoActiveBelowMin(products, SHADOW_ON);
  assert.equal(r.belowUnweighted, 1);
  assert.equal(r.belowWeighted, 1);
});

test("P8: o minimo vem da politica de producao, nao de um literal do script", () => {
  assert.equal(PUBLIC_MULTISTORE_MIN_MARKETPLACES, 2);
  const products = [
    {
      productId: "p",
      offers: [offer("p", "MERCADO_LIVRE"), offer("p", "MAGAZINE_LUIZA")],
    },
  ];
  // Forcar min=3 tem de reprovar o mesmo produto que min=2 aprova.
  assert.equal(countAutoActiveBelowMin(products, SHADOW_ON, 2).belowWeighted, 0);
  assert.equal(countAutoActiveBelowMin(products, SHADOW_ON, 3).belowWeighted, 1);
});

test("P9: o predicado SQL de oferta valida nao pode regredir", () => {
  for (const fragment of [
    "o.active = true",
    "\"matchStatus\" = 'EXACT'",
    "o.available = true",
    "NOT IN ('UNAVAILABLE','ERROR')",
    "o.price > 0",
  ]) {
    assert.ok(
      PUBLIC_OFFER_PREDICATE_SQL.includes(fragment),
      `predicado de oferta valida perdeu: ${fragment}`,
    );
  }
});

test("P10: default das flags segue fail-closed (shadow desligada)", () => {
  // Este e o estado que o .env.local local produz: shadow off => peso legado.
  // O teste existe para fixar o comportamento default e tornar o drift
  // local/producao VISIVEL em vez de presumido.
  const flags = readShadowFlags({});
  assert.equal(flags.enabled, false);
  assert.deepEqual(flags.marketplaceIds, []);
  assert.equal(flags.dryRun, true, "dryRun default true = fail-closed");
  assert.equal(flags.maxWrites, 0);
});
