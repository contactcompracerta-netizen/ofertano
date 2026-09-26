/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW PUBLICATION WEIGHT TEST (FASE 8 / FASE J).
 *
 * REGRA CRITICA (resultado exigido: SHADOW_SOURCE_PUBLICATION_WEIGHT=0):
 *   Mercado Livre publico + segundo marketplace SHADOW  =>  1 marketplace
 *   publico. A shadow NUNCA transforma 1 em 2, logo nunca publica sozinha.
 *
 * Este teste e a prova dessa regra. Nele NAO se altera o nucleo: a shadow e
 * apenas configurada, como em producao.
 */
import assert from "node:assert/strict";

import {
  SHADOW_PUBLICATION_WEIGHT,
  contributesToPublicMarketplaceCount,
  countPublicMarketplacesWithWeight,
  filterPublicOffers,
  isShadowMarketplace,
  publicationWeightFor,
  assertSecondMarketplaceIsShadow,
} from "./shadowWeight";
import type { ShadowFlags } from "../shadow/flags";
import { evaluatePublicationEligibility } from "./publicationEligibility";
import {
  countPublicMarketplaces,
  hasPublicMultiStore,
  type PublicOfferLike,
} from "../../../publicVisibility/multiStoreVisibility";

/** Shadow ativa SOMENTE para o segundo marketplace. */
const SHADOW_SECOND: ShadowFlags = {
  enabled: true,
  marketplaceIds: ["shopee"],
  maxWrites: 0,
  persistRaw: false,
  persistHashes: false,
  dryRun: true,
};

/** Shadow desligada: comportamento legado. */
const SHADOW_OFF: ShadowFlags = {
  ...SHADOW_SECOND,
  enabled: false,
};

function offer(marketplace: string): PublicOfferLike {
  return {
    marketplace,
    active: true,
    available: true,
    status: "ACTIVE",
    matchStatus: "EXACT",
    price: 1999.9,
  };
}

function main() {
  /* --- Peso base: shadow = 0 ------------------------------------------- */
  assert.equal(SHADOW_PUBLICATION_WEIGHT, 0);
  assert.equal(publicationWeightFor("shopee", SHADOW_SECOND), 0);
  assert.equal(publicationWeightFor("mercado_livre", SHADOW_SECOND), 1);
  assert.equal(isShadowMarketplace("shopee", SHADOW_SECOND), true);
  assert.equal(isShadowMarketplace("mercado_livre", SHADOW_SECOND), false);
  assert.equal(
    contributesToPublicMarketplaceCount("shopee", SHADOW_SECOND),
    false,
  );

  /* Shadow desligada => o marketplace sai da shadow (comportamento legado). */
  assert.equal(publicationWeightFor("shopee", SHADOW_OFF), 1);
  assert.equal(isShadowMarketplace("shopee", SHADOW_OFF), false);

  /*
   * Marketplace NAO registrado mantem o peso legado (1). A extensibilidade da
   * Architecture V1 exige que um marketplaceId dinamico, fora do registry,
   * flua pelo pipeline sem alteracao no core. Shadow e decisao EXPLICITA
   * (allowlist), nunca inferida de "desconhecido".
   */
  assert.equal(publicationWeightFor("marketplace_inexistente", SHADOW_OFF), 1);
  assert.equal(
    publicationWeightFor("marketplace_inexistente", SHADOW_SECOND),
    1,
    "nao esta na allowlist da shadow => peso legado",
  );
  assert.equal(
    publicationWeightFor("MARKET_A", SHADOW_SECOND),
    1,
    "marketplace ficticio dos FakeConnectors nao e rebaixado",
  );
  assert.equal(
    publicationWeightFor("MARKET_A", {
      ...SHADOW_SECOND,
      marketplaceIds: ["MARKET_A"],
    }),
    0,
    "se explicitamente colocado na shadow, o peso e 0",
  );

  /* --- REGRA CRITICA: ML publico + shadow = 1 marketplace publico -------- */
  {
    const offers = [offer("mercado_livre"), offer("shopee")];
    assert.equal(
      countPublicMarketplacesWithWeight(offers, SHADOW_SECOND),
      1,
      "shadow nao conta para publicMarketplaceCount",
    );
    // Sem a shadow, os dois marketplaces contariam.
    assert.equal(countPublicMarketplacesWithWeight(offers, SHADOW_OFF), 2);
  }

  /*
   * --- O funil publico (hasPublicMultiStore) tambem respeita a shadow ------
   *
   * hasPublicMultiStore e usado em pagina/rota e NAO recebe flags: ele le do
   * ambiente, que e exatamente o caminho de producao. Por isso o teste
   * manipula as env vars reais em vez de injecar objeto.
   */
  {
    const offers = [offer("mercado_livre"), offer("shopee")];
    const saved = {
      enabled: process.env.ARCHITECTURE_V1_SHADOW_ENABLED,
      ids: process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS,
    };
    try {
      // Producao: shadow ativa apenas para shopee.
      process.env.ARCHITECTURE_V1_SHADOW_ENABLED = "true";
      process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS = "shopee";

      assert.equal(
        hasPublicMultiStore(offers),
        false,
        "ML + shopee SHADOW nao pode ativar produto auto-criado",
      );
      assert.equal(
        hasPublicMultiStore({ offers }),
        false,
        "variante com objeto Product tambem respeita a sombra",
      );
      assert.equal(countPublicMarketplaces(offers), 1);
      assert.equal(countPublicMarketplacesWithWeight(offers), 1);

      // Shadow desligada: os dois marketplaces contam (comportamento legado).
      process.env.ARCHITECTURE_V1_SHADOW_ENABLED = "false";
      assert.equal(hasPublicMultiStore(offers), true);
      assert.equal(countPublicMarketplaces(offers), 2);

      // Shadow ativa para um marketplace que nao esta nas ofertas: irrelevante.
      process.env.ARCHITECTURE_V1_SHADOW_ENABLED = "true";
      process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS = "amazon";
      assert.equal(
        hasPublicMultiStore(offers),
        true,
        "shadow de outra fonte nao afeta estes marketplaces",
      );
    } finally {
      if (saved.enabled === undefined) {
        delete process.env.ARCHITECTURE_V1_SHADOW_ENABLED;
      } else {
        process.env.ARCHITECTURE_V1_SHADOW_ENABLED = saved.enabled;
      }
      if (saved.ids === undefined) {
        delete process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS;
      } else {
        process.env.ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS = saved.ids;
      }
    }
  }

  /* --- O gate central de publicacao bloqueia ---------------------------- */
  {
    const offers = [offer("mercado_livre"), offer("shopee")];
    const verdict = evaluatePublicationEligibility({
      autoCreated: true,
      offers,
      shadowFlags: SHADOW_SECOND,
    });
    assert.equal(verdict.eligible, false, "shadow nao pode publicar sozinha");
    assert.equal(
      verdict.evidence.publicMarketplaceCount,
      1,
      "publicMarketplaceCount ignora a fonte shadow",
    );
    assert.ok(
      verdict.reasonCodes.includes("INSUFFICIENT_PUBLIC_MULTISTORE"),
      "motivo: multiloja publica insuficiente",
    );

    /* Com shadow desligada, o mesmo par publica: a regra nao e um veto fixo. */
    const verdictOff = evaluatePublicationEligibility({
      autoCreated: true,
      offers,
      shadowFlags: SHADOW_OFF,
    });
    assert.equal(verdictOff.eligible, true);
    assert.equal(verdictOff.evidence.publicMarketplaceCount, 2);
  }

  /* --- Filtro preserva as ofertas publicas e remove as shadow ------------ */
  {
    const offers = [offer("mercado_livre"), offer("shopee")];
    const filtered = filterPublicOffers(offers, SHADOW_SECOND);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].marketplace, "mercado_livre");
  }

  /* --- Shadow sozinha nao publica NADA ----------------------------------- */
  {
    const offers = [offer("shopee"), offer("shopee")];
    const verdict = evaluatePublicationEligibility({
      autoCreated: true,
      offers,
      shadowFlags: SHADOW_SECOND,
    });
    assert.equal(verdict.eligible, false);
    assert.equal(verdict.evidence.publicMarketplaceCount, 0);
    assert.equal(hasPublicMultiStore(offers), false);
  }

  /* --- Readiness exige shadow EXPLICITO (FASE Z) ---------------------- */
  assert.doesNotThrow(() =>
    assertSecondMarketplaceIsShadow("shopee", SHADOW_SECOND),
  );
  assert.throws(
    () => assertSecondMarketplaceIsShadow("shopee", SHADOW_OFF),
    /nao esta na allowlist da shadow/,
    "fonte fora da shadow e um erro de readiness, nao um detalhe",
  );
  assert.throws(
    () => assertSecondMarketplaceIsShadow("mercado_livre", SHADOW_SECOND),
    /nao esta na allowlist da shadow/,
  );

  console.log("shadowWeight.test.ts PASS");
}

main();
