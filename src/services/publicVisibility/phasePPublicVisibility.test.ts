/**
 * FASE P (FASE P) — REGRESSÃO DE VISIBILIDADE PÚBLICA PONDERADA.
 *
 * ============================================================================
 * O QUE ESTES TESTES EXISTEM PARA IMPEDIR
 * ============================================================================
 * Em 2026-09-27 a Fase P descobriu que a shadow estava documentada como ativa
 * em produção e mesmo assim ERA INOPERANTE no funil público.
 *
 * Causa: a allowlist da shadow é configuração e contém marketplaceId CANÔNICO
 * ("shopee"). O schema persiste `MarketplaceOffer.marketplace` como enum
 * Prisma, e o Prisma devolve a CHAVE do enum em MAIÚSCULAS ("SHOPEE"). O
 * filtro de shadow comparava as duas grafias diretamente, então nunca casava,
 * `publicationWeightFor` devolvia 1 para uma fonte em SHADOW, e um produto
 * auto-criado MERCADO_LIVRE + SHOPEE (peso real = 1) era servido em:
 *
 *   Home · /ofertas · busca · /favoritos · /produto/[id] · /sitemap.xml
 *   /o/[codigo] · /api/products/[id]/live-offers
 *
 * MEDIDO em produção ANTES do fix: /produto/0add0a7e... respondia 200, o
 * produto aparecia na Home, em /ofertas, na busca e no /api/favorites/products,
 * e estava indexável no /sitemap.xml.
 *
 * Estes testes existem para que a divergência NÃO VOLTE. A propriedade que eles
 * protegem é uma só, e é a do contrato de produção:
 *
 *   weightedPublicMarketplaceCount >= PUBLIC_MULTISTORE_MIN_MARKETPLACES
 *
 * Nada aqui toca banco, rede ou credencial. Nenhum teste desliga a shadow para
 * "conseguir verde": todos usam a allowlist real (shopee).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SHADOW_FLAGS,
  type ShadowFlags,
} from "@/services/architecture/v1/shadow/flags";
import {
  isShadowMarketplace,
  publicationWeightFor,
  toCanonicalMarketplaceId,
  toPublicOfferMarketplaceIds,
} from "@/services/architecture/v1/publication/shadowWeight";
import {
  PUBLIC_MULTISTORE_MIN_MARKETPLACES,
  hasPublicMultiStore,
  meetsPublicMultiStoreMarketplaceCount,
  isUsablePublicOffer,
  permitirAtivacaoProdutoAutoCriado,
  type PublicOfferLike,
} from "./multiStoreVisibility";
import { evaluatePublicationEligibility } from "@/services/architecture/v1/publication/publicationEligibility";

/* A allowlist operacional real da Fase 8.2, e a única que estes testes usam. */
const SHADOW_REAL: ShadowFlags = {
  ...DEFAULT_SHADOW_FLAGS,
  enabled: true,
  marketplaceIds: ["shopee"],
};

const SHADOW_OFF: ShadowFlags = { ...DEFAULT_SHADOW_FLAGS, enabled: false };

/**
 * `hasPublicMultiStore` e `meetsPublicMultiStoreMarketplaceCount` leem as
 * flags do AMBIENTE, exatamente como em produção — elas são a política viva,
 * não uma função pura com parâmetro. Os testes então configuram o ambiente,
 * que é o mesmo caminho que a aplicação percorre. Isso é mais fiel do que
 * injetar flags: um teste que passasse flags diretamente não provaria que o
 * funil público real lê a configuração.
 */
function setShadowEnv(flags: ShadowFlags): void {
  process.env.ARCHITECTURE_V1_SHADOW_ENABLED = String(flags.enabled);
  process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS =
    flags.marketplaceIds.join(",");
}

/** Restaura o ambiente ao final, para o teste não vazar estado para outro. */
async function withShadowEnv<T>(
  flags: ShadowFlags,
  run: () => T | Promise<T>,
): Promise<T> {
  const antes = {
    enabled: process.env.ARCHITECTURE_V1_SHADOW_ENABLED,
    ids: process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS,
  };

  setShadowEnv(flags);

  try {
    return await run();
  } finally {
    if (antes.enabled === undefined) {
      delete process.env.ARCHITECTURE_V1_SHADOW_ENABLED;
    } else {
      process.env.ARCHITECTURE_V1_SHADOW_ENABLED = antes.enabled;
    }

    if (antes.ids === undefined) {
      delete process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS;
    } else {
      process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS = antes.ids;
    }
  }
}

// Estado de producao: shadow ATIVA para shopee.
setShadowEnv(SHADOW_REAL);

/**
 * Ofertas como o Prisma AS ENTREGA: `marketplace` é a CHAVE do enum, em
 * maiúsculas. Reproduzir essa forma é o ponto inteiro da regressão — um
 * fixture em minúsculas passaria e não provaria nada.
 *
 * LISTING-FIRST (atualização do fixture): a política pública exige que uma
 * oferta MERCADO_LIVRE seja um ANÚNCIO provado — ITEM_ID (`MLB` + dígitos)
 * E `sourceUrl` de anúncio (`produto.mercadolivre.com.br/MLB-...`). O
 * fixture antigo criava ML sem identidade, então TODO caso que usava ML
 * caía como "não publicável" depois do endurecimento e a suíte ficava
 * vermelha por FIXTURE desatualizado, não por regressão de código. Agora
 * o default representa a oferta ML REAL e publicável do banco; quem
 * precisa de uma ML inválida passa `externalId`/`sourceUrl` no override.
 */
const IDENTIDADE_ML = {
  externalId: "MLB1234567890",
  sourceUrl: "https://produto.mercadolivre.com.br/MLB-1234567890-anuncio",
} as const;

const oferta = (
  marketplace: string,
  overrides: Partial<PublicOfferLike> = {},
): PublicOfferLike => ({
  marketplace,
  ...(marketplace === "MERCADO_LIVRE" ? IDENTIDADE_ML : {}),
  active: true,
  matchStatus: "EXACT",
  available: true,
  status: "ACTIVE",
  price: 100,
  ...overrides,
});

const produto = (offers: PublicOfferLike[], autoCreated = true) => ({
  id: "prod-0add0a7e",
  autoCreated,
  active: true,
  publicationStatus: "LIVE_PARTIAL" as const,
  offers,
});

/* ============================ P1 ============================ */
test("P1: autoCreated + ML publico + Shopee SHADOW => NAO PUBLICO", () => {
  const p = produto([
    oferta("MERCADO_LIVRE"),
    oferta("SHOPEE"),
  ]);

  assert.equal(
    hasPublicMultiStore(p),
    false,
    "a oferta SHOPEE nao pode transformar 1 marketplace publico em 2",
  );
  assert.equal(
    evaluatePublicationEligibility({ autoCreated: true, offers: p.offers, shadowFlags: SHADOW_REAL })
      .eligible,
    false,
  );
});

/* ============================ P2 ============================ */
test("P2: autoCreated + ML publico + Shopee PUBLICA => PUBLICO", async () => {
  const p = produto([oferta("MERCADO_LIVRE"), oferta("SHOPEE")]);

  // Mesma fixture de P1, sombra DESLIGADA. O resultado tem de inverter: a
  // regra é a CONFIGURACAO, nao o nome do marketplace.
  await withShadowEnv(SHADOW_OFF, () => {
    assert.equal(publicationWeightFor("SHOPEE"), 1);
    assert.equal(hasPublicMultiStore(p), true);
  });
});

/* ============================ P3 ============================ */
test("P3: autoCreated + ML publico + Magalu PUBLICA => PUBLICO", () => {
  const p = produto([oferta("MERCADO_LIVRE"), oferta("MAGAZINE_LUIZA")]);

  assert.equal(
    hasPublicMultiStore(p),
    true,
    "Magalu nao esta na allowlist => peso legado 1 => 2 marketplaces publicos",
  );
  assert.equal(
    evaluatePublicationEligibility({ autoCreated: true, offers: p.offers, shadowFlags: SHADOW_REAL })
      .eligible,
    true,
  );
});

/* ============================ P4 ============================ */
test("P4: autoCreated + 2 ofertas da MESMA loja => NAO PUBLICO", () => {
  const p = produto([
    oferta("MERCADO_LIVRE", { price: 10 }),
    oferta("MERCADO_LIVRE", { price: 20 }),
  ]);

  assert.equal(hasPublicMultiStore(p), false);
  assert.equal(meetsPublicMultiStoreMarketplaceCount(p.offers), false);
});

/* ============================ P5 ============================ */
test("P5: autoCreated + ML + Magalu INVALIDA => NAO PUBLICO", () => {
  for (const invalida of [
    { available: false },
    { status: "UNAVAILABLE" },
    { status: "ERROR" },
    { matchStatus: "REVIEW" },
    { active: false },
    { price: 0 },
    { price: null },
  ] satisfies Partial<PublicOfferLike>[]) {
    const p = produto([oferta("MERCADO_LIVRE"), oferta("MAGAZINE_LUIZA", invalida)]);

    assert.equal(
      hasPublicMultiStore(p),
      false,
      `segunda loja invalida (${JSON.stringify(invalida)}) nao pode qualificar`,
    );
  }
});

/* ============================ P6 ============================ */
test("P6: produto MANUAL + 1 marketplace => comportamento legado", () => {
  const p = produto([oferta("MERCADO_LIVRE")], false);

  // Legado: manual nao e barrado na ATIVACAO (permitirAtivacao... = true)...
  assert.equal(permitirAtivacaoProdutoAutoCriado(false, p.offers), true);
  assert.equal(
    evaluatePublicationEligibility({ autoCreated: false, offers: p.offers, shadowFlags: SHADOW_REAL })
      .eligible,
    true,
    "politica central libera manual (comportamento legado, nao alterado)",
  );

  // ...mas a LEITURA publica ja exigia multi-loja antes desta missao e continua
  // exigindo. Este nao e um efeito colateral do fix: e o gate preexistente.
  assert.equal(hasPublicMultiStore(p), false);
});

/* ============================ P7 ============================ */
test("P7: o enum SHOPEE canonicaliza para shopee e recebe peso 0", () => {
  assert.equal(toCanonicalMarketplaceId("SHOPEE"), "shopee");
  assert.equal(toCanonicalMarketplaceId("MERCADO_LIVRE"), "mercado_livre");
  assert.equal(toCanonicalMarketplaceId("MAGAZINE_LUIZA"), "magazine_luiza");

  // Enum fora do registry nao some: mantem o peso legado, por contrato.
  assert.equal(toCanonicalMarketplaceId("LOJA_DO_FUTURO"), "loja_do_futuro");
  assert.equal(publicationWeightFor("LOJA_DO_FUTURO", SHADOW_REAL), 1);

  // A forma que efetivamente vazava: enum do banco contra allowlist canonica.
  assert.equal(isShadowMarketplace("SHOPEE", SHADOW_REAL), true);
  assert.equal(publicationWeightFor("SHOPEE", SHADOW_REAL), 0);
  assert.deepEqual(
    toPublicOfferMarketplaceIds(
      [oferta("MERCADO_LIVRE"), oferta("SHOPEE")],
      SHADOW_REAL,
    ),
    ["mercado_livre"],
    "o filtro canonico expõe SÓ a loja pública",
  );
});

/* ============================ P8 ============================ */
test("P8: a rota direta de produto respeita o gate PONDERADO", () => {
  // Reproduz a decisão de src/app/produto/[id]/page.tsx: a página e o
  // generateMetadata chamam hasPublicMultiStore sobre as ofertas cruas do
  // Prisma e chamam notFound() quando ela e falsa.
  const offersDaPagina = [oferta("MERCADO_LIVRE"), oferta("SHOPEE")];
  const renderiza = hasPublicMultiStore({ offers: offersDaPagina });

  assert.equal(renderiza, false, "notFound(): rota direta nao renderiza single-store");

  const offersDoMetadata = [oferta("MERCADO_LIVRE"), oferta("MAGAZINE_LUIZA")];
  assert.equal(
    hasPublicMultiStore({ offers: offersDoMetadata }),
    true,
    "com 2 lojas publicas a rota direta renderiza",
  );
});

/* ============================ P9 ============================ */
test("P9: o sitemap respeita o gate (UI oculta => sitemap nao indexa)", () => {
  // src/app/sitemap.ts aplica hasPublicMultiStore DEPOIS do
  // multiStorePublicWhere; o filtro em memoria e o que garante o contrato.
  const indexavel = (offers: PublicOfferLike[]) =>
    hasPublicMultiStore({ offers });

  assert.equal(indexavel([oferta("MERCADO_LIVRE"), oferta("SHOPEE")]), false);
  assert.equal(indexavel([oferta("MERCADO_LIVRE"), oferta("MAGAZINE_LUIZA")]), true);
});

/* ============================ P10 ============================ */
test("P10: favoritos respeitam o gate sem apagar o registro do usuario", () => {
  // services/favorites/products.ts filtra por hasPublicMultiStore. O
  // registro Favorite NAO e apagado: a funcao so decide o que RETORNAR.
  const podeExibir = (offers: PublicOfferLike[]) => hasPublicMultiStore({ offers });

  assert.equal(podeExibir([oferta("MERCADO_LIVRE"), oferta("SHOPEE")]), false);
  assert.equal(podeExibir([oferta("MERCADO_LIVRE"), oferta("MAGAZINE_LUIZA")]), true);
});

/* ============================ P11 ============================ */
test("P11: busca e categorias respeitam o gate", () => {
  // Busca: o cluster de discovery nao tem available/status, entao usa o gate
  // PONDERADO. A forma errada (contagem nua de marketplaces distintos) e o
  // que a Fase P mediu como vazamento.
  const nua = (offers: Array<{ marketplace: string }>) =>
    new Set(offers.map((o) => o.marketplace)).size >= 2;
  const gate = (offers: Array<{ marketplace: string }>) =>
    meetsPublicMultiStoreMarketplaceCount(offers);

  const mlMaisShopee = [{ marketplace: "SHOPEE" }, { marketplace: "MERCADO_LIVRE" }];

  assert.equal(nua(mlMaisShopee), true, "a contagem nua e a que vazava");
  assert.equal(
    gate(mlMaisShopee),
    false,
    "o gate ponderado fecha o mesmo caso",
  );
  assert.equal(
    gate([{ marketplace: "MERCADO_LIVRE" }, { marketplace: "MAGAZINE_LUIZA" }]),
    true,
  );

  // Categorias/ Home usam o gate completo de produto persistido.
  assert.equal(
    hasPublicMultiStore({ offers: [oferta("MERCADO_LIVRE"), oferta("SHOPEE")] }),
    false,
  );
});

/* ============================ P12 ============================ */
test("P12: a transicao public->shadow torna o produto inelegivel SEM mutar o banco", async () => {
  const offers = [oferta("MERCADO_LIVRE"), oferta("SHOPEE")];
  const produtoPersistente = { ...produto(offers), active: true };

  const antes = await withShadowEnv(SHADOW_OFF, () =>
    evaluatePublicationEligibility({ autoCreated: true, offers }),
  );
  const depois = await withShadowEnv(SHADOW_REAL, () =>
    evaluatePublicationEligibility({ autoCreated: true, offers }),
  );

  assert.equal(antes.eligible, true, "antes da shadow: elegivel");
  assert.equal(depois.eligible, false, "depois: inelegivel");
  assert.deepEqual(depois.reasonCodes, ["INSUFFICIENT_PUBLIC_MULTISTORE"]);

  // O dado persistido NAO mudou entre as duas avaliacoes — e ainda assim a
  // leitura publica inverteu. E exatamente isto que a missao exige: a leitura
  // nao pode depender de uma reconciliacao futura para ser segura.
  assert.equal(produtoPersistente.active, true, "active segue true no estado persistido");
  assert.equal(
    await withShadowEnv(SHADOW_REAL, () => hasPublicMultiStore(produtoPersistente)),
    false,
    "mas a leitura e fail-closed",
  );
  assert.equal(
    await withShadowEnv(SHADOW_OFF, () => hasPublicMultiStore(produtoPersistente)),
    true,
    "e a inversao vem da flag, nao de codigo de superficie",
  );
});

/* ============ TRANSICAO DE FLAG APLICADA AO FILTRO CANONICO ============ */
test("o filtro canonico reage a mudanca de flag sem tocar em codigo de superficie", () => {
  const offers = [oferta("MERCADO_LIVRE"), oferta("SHOPEE")];

  assert.deepEqual(
    toPublicOfferMarketplaceIds(offers, SHADOW_OFF),
    ["mercado_livre", "shopee"],
  );
  assert.deepEqual(
    toPublicOfferMarketplaceIds(offers, SHADOW_REAL),
    ["mercado_livre"],
    "a allowlist e a unica fonte de verdade; nenhuma superficie decide sozinha",
  );
});

test("isUsablePublicOffer continua independente do peso de shadow", () => {
  // Uma oferta SHADOW e uma oferta VALIDA. Validade e peso sao eixos
  // distintos: a oferta e valida, mas nao conta para marketplaces publicos.
  assert.equal(isUsablePublicOffer(oferta("SHOPEE")), true);
  assert.equal(publicationWeightFor("SHOPEE", SHADOW_REAL), 0);
});
