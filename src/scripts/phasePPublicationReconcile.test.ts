/**
 * FASE P (FASE Q/S/T) — TESTES DO RECONCILIADOR DE PUBLICAÇÃO.
 *
 * Três propriedades, nesta ordem de importance:
 *
 * 1. O DEFAULT É DRY-RUN. Sem `--apply`, nada é escrito. Isto é uma
 *    propriedade de segurança: um `--apply` implícito reverteria a ordem da
 *    missão inteira (reconciliar o estado persistido antes de a leitura pública
 *    estar segura). O teste falha se alguém inverter o default.
 *
 * 2. A DETECÇÃO DELEGA À POLÍTICA CENTRAL. O reconciliador não tem regra
 *    própria: se `evaluatePublicationEligibility` mudar, o relatório muda junto.
 *
 * 3. A AÇÃO PROPOSTA É A CANÔNICA DO CÓDIGO EXISTENTE
 *    (`DRAFT` + `active=false`), e não uma escolha deste script.
 *
 * Nenhum teste aqui toca banco, rede ou credencial.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseReconcileArgs,
  evaluateProductViolation,
  type ReconcilableProduct,
} from "./phase-p-publication-reconcile";
import { DEFAULT_SHADOW_FLAGS, type ShadowFlags } from "@/services/architecture/v1/shadow/flags";
import { evaluatePublicationEligibility } from "@/services/architecture/v1/publication/publicationEligibility";

const SHADOW_REAL: ShadowFlags = {
  ...DEFAULT_SHADOW_FLAGS,
  enabled: true,
  marketplaceIds: ["shopee"],
};

/*
 * LISTING-FIRST: oferta MERCADO_LIVRE só é pública com identidade de
 * ANÚNCIO provada (ITEM_ID + URL de anúncio). O fixture representa a
 * oferta ML real do banco; sem identidade o teste ficava vermelho por
 * fixture desatualizado, não por violação da reconcilição.
 */
const oferta = (marketplace: string) => ({
  marketplace,
  ...(marketplace === "MERCADO_LIVRE"
    ? {
        externalId: "MLB1234567890",
        sourceUrl:
          "https://produto.mercadolivre.com.br/MLB-1234567890-anuncio",
      }
    : {}),
  active: true,
  matchStatus: "EXACT",
  available: true,
  status: "ACTIVE",
  price: 100,
});

/* O produto violador real da Fase P, com a forma que o Prisma devolve. */
const VIOLADOR: ReconcilableProduct = {
  id: "0add0a7e-72d3-470d-b470-6b1f7c5ad576",
  name: "Carregador iPhone 20W Fonte Turbo Tipo C Para Aparelhos Apple",
  autoCreated: true,
  active: true,
  publicationStatus: "LIVE_PARTIAL",
  offers: [oferta("MERCADO_LIVRE"), oferta("SHOPEE")],
};

/* ================= 1. DEFAULT DRY-RUN ================= */

test("sem --apply o reconciliador e DRY-RUN (nenhuma escrita)", () => {
  const args = parseReconcileArgs([]);

  assert.equal(args.aplicar, false, "o default tem de ser dry-run");
  assert.equal(args.limite, 1, "e o limite default e conservador");
  assert.equal(args.productId, undefined);
  assert.equal(args.expectActive, undefined);
  assert.equal(args.expectStatus, undefined);
});

test("--apply e explicito e nunca vem por acidente de outra flag", () => {
  assert.equal(parseReconcileArgs(["--apply"]).aplicar, true);
  assert.equal(parseReconcileArgs(["--limit=5"]).aplicar, false);
  assert.equal(parseReconcileArgs(["--product-id=abc"]).aplicar, false);
  assert.equal(
    parseReconcileArgs(["--expect-active=true"]).aplicar,
    false,
    "informar o estado esperado nao habilita escrita",
  );
});

test("--limit negativo ou nao-inteiro e rejeitado em vez de virar default", () => {
  assert.throws(() => parseReconcileArgs(["--limit=-1"]));
  assert.throws(() => parseReconcileArgs(["--limit=abc"]));
  assert.equal(parseReconcileArgs(["--limit=0"]).limite, 0);
  assert.equal(parseReconcileArgs(["--limit=7"]).limite, 7);
});

test("as flags de CAS sao lidas e propagate", () => {
  const args = parseReconcileArgs([
    "--apply",
    "--limit=1",
    "--product-id=0add0a7e-72d3-470d-b470-6b1f7c5ad576",
    "--expect-active=true",
    "--expect-publication-status=LIVE_PARTIAL",
  ]);

  assert.deepEqual(args, {
    aplicar: true,
    limite: 1,
    productId: "0add0a7e-72d3-470d-b470-6b1f7c5ad576",
    expectActive: "true",
    expectStatus: "LIVE_PARTIAL",
  });
});

/* ================= 2. DELEGAÇÃO À POLÍTICA CENTRAL ================= */

test("o produto real da Fase P e violacao com a shadow ativa", () => {
  const v = evaluateProductViolation(VIOLADOR, SHADOW_REAL);

  assert.ok(v, "ML + Shopee shadow => violacao");
  assert.equal(v!.productId, "0add0a7e-72d3-470d-b470-6b1f7c5ad576");
  assert.equal(v!.weightedMarketplaceCount, 1);
  assert.equal(v!.minRequired, 2);
  assert.deepEqual(v!.reasonCodes, ["INSUFFICIENT_PUBLIC_MULTISTORE"]);
  assert.deepEqual(v!.weightedMarketplaces, ["mercado_livre"]);
  assert.deepEqual(v!.shadowMarketplacesExcluded, ["shopee"]);
});

test("o MESMO produto nao e violacao com a shadow desligada (a regra e a config)", () => {
  const v = evaluateProductViolation(VIOLADOR, DEFAULT_SHADOW_FLAGS);
  assert.equal(v, null, "sem shadow, ML+Shopee sao 2 marketplaces publicos");
});

test("a metrica historica (sem peso) fica preservada no relatorio", () => {
  const v = evaluateProductViolation(VIOLADOR, SHADOW_REAL);

  // Foi exatamente a confusão entre 2 (sem peso) e 1 (com peso) que fez o
  // harness da Fase P reportar 0 violações. As duas números ficam visíveis.
  assert.equal(v!.unweightedMarketplaceCount, 2);
  assert.equal(v!.weightedMarketplaceCount, 1);
});

/* ================= 3. AÇÃO CANÔNICA ================= */

test("a acao proposta e DRAFT + active=false (contrato do writer existente)", () => {
  const v = evaluateProductViolation(VIOLADOR, SHADOW_REAL);

  assert.deepEqual(v!.proposed, { publicationStatus: "DRAFT", active: false });
});

test("o estado atual reportado e o estado persistido, nao um estado desejado", () => {
  const v = evaluateProductViolation(VIOLADOR, SHADOW_REAL);

  assert.deepEqual(v!.currentState, {
    autoCreated: true,
    active: true,
    publicationStatus: "LIVE_PARTIAL",
  });
  assert.equal(v!.eligible, false);
});

/* ================= CAS: nao-violacoes ================= */

test("produto ja elegivel nao entra no relatorio", () => {
  const ok: ReconcilableProduct = {
    ...VIOLADOR,
    offers: [oferta("MERCADO_LIVRE"), oferta("MAGAZINE_LUIZA")],
  };

  assert.equal(evaluateProductViolation(ok, SHADOW_REAL), null);
});

test("produto manual single-store NAO e violacao (comportamento legado)", () => {
  /*
   * O recorte da missão é `autoCreated=true`, e a política central libera
   * produtos manuais. Um produto manual single-store pode estar ativo por
   * decisão legada; incluí-lo aqui faria o reconciliador despublicar catálogo
   * que ninguém pediu para despublicar.
   */
  const manual: ReconcilableProduct = {
    ...VIOLADOR,
    autoCreated: false,
    offers: [oferta("MERCADO_LIVRE")],
  };

  assert.equal(
    evaluatePublicationEligibility({
      autoCreated: manual.autoCreated,
      offers: manual.offers,
      shadowFlags: SHADOW_REAL,
    }).eligible,
    true,
    "a política central libera manual",
  );
});
