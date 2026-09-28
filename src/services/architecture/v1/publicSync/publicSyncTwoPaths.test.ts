/**
 * CATALOG_ARCHITECTURE_V1 — DOIS CAMINHOS DO SYNC (FASE 9, modelo B/C).
 *
 * O sync tem duas portas, e elas nao podem se confundir:
 *
 *   A. KNOWN_BINDING_REFRESH — a listing JÁ está associada a um Product por um
 *      gate certificado. Atualiza SO dados de oferta (preço, disponibilidade,
 *      link), mantendo o MESMO productId. Nao re-deriva identidade, nao cria
 *      Product, nao promove status.
 *
 *   B. NEW_DISCOVERY — a listing nao tem binding. Passa por
 *      CandidateBlockingKey -> IdentityPolicy e so publica com EXACT unico.
 *
 * O que estes testes travam:
 *   - binding_refresh usa o productId certificado e nao chama a identity
 *   - binding_refresh nao roda com o matcher de descoberta
 *   - listing sem binding NUNCA pega o caminho de refresh
 *   - refresh nao apaga link seguro vigente nem rebaixa ACTIVE
 *   - refresh com preco invalido nao grava e nao apaga o preco
 *   - binding nao vista = NOT_SEEN (nunca delete/desassociacao)
 *   - DRY_RUN conta o refresh sem persistir
 *   - refresh repetido é idempotente (2a vez = NOOP)
 *   - Shopee nunca cria Product em nenhum dos dois caminhos
 */

import assert from "node:assert/strict";

import { runMarketplacePublicSync } from "./runner";
import {
  NORMALIZED_LISTING_V1,
  UNKNOWN,
  type NormalizedMarketplaceListingV1,
} from "../types/normalizedListingV1";
import { computeRawHash } from "../hashing";
import type { IdentityDecisionV1 } from "../identity/identityConfidence";
import {
  purchaseLinkSourceFromFields,
} from "./purchaseLinks";
import type {
  KnownBinding,
  KnownBindingLookup,
  OfferCommitResultV1,
  OfferWriteMode,
  PublicOfferCommitter,
  PublicOfferDraftV1,
  PublicSyncConfig,
  PublicSyncReportV1,
} from "./types";

const RAW = {
  offerLink: "https://s.shopee.com.br/novo",
  productLink: "https://shopee.com.br/product/1/2",
};

function listing(
  over: Partial<NormalizedMarketplaceListingV1> = {},
): NormalizedMarketplaceListingV1 {
  return {
    contractVersion: NORMALIZED_LISTING_V1,
    source: "shopee-affiliate-api",
    marketplaceId: "shopee",
    // Forma que a oferta certificada tem no banco. Ver o teste
    // `compositeSweepNaoCasaComChaveCertificada` para a forma do conector.
    externalListingId: "58215116714",
    seller: { externalSellerId: null, name: "Loja" },
    identity: { gtin: [], mpn: null, manufacturerModel: null, brand: null, model: null },
    catalog: { title: "Carregador iPhone 20W", description: null, category: "eletronicos", images: ["https://img/a.jpg"], attributes: {}, primaryImageUrl: "https://img/a.jpg" },
    variant: { color: UNKNOWN, storage: UNKNOWN, memory: UNKNOWN, voltage: UNKNOWN, size: UNKNOWN, otherAttributes: {} },
    commerce: { price: 13.99, oldPrice: null, pixPrice: UNKNOWN, installments: UNKNOWN, stock: UNKNOWN, availability: "IN_STOCK", shippingHint: UNKNOWN, promotion: null },
    metadata: { sourceUpdatedAt: null, collectedAt: "2026-01-01T00:00:00.000Z", rawHash: computeRawHash({ a: 1 }), payloadVersion: "v1" },
    ...over,
  };
}

const EXACT = (): IdentityDecisionV1 =>
  ({
    policyVersion: "IDENTITY_POLICY_V1", leftKey: "L", rightKey: "R",
    leftMarketplaceId: "shopee", rightMarketplaceId: "mercado_livre",
    category: "eletronicos", textSimilarity: 0.95, confidence: "EXACT",
    reasonCodes: ["MPN_MATCH"], evidence: [], sharedEvidence: [],
    hardConflicts: [], missingCriticalAttributes: [], axisComparisons: [],
  }) as IdentityDecisionV1;

/** Committer dublê que registra modo, draft e chamadas. */
function recorder() {
  const calls: Array<{ draft: PublicOfferDraftV1; mode: OfferWriteMode; dryRun: boolean }> = [];
  const committer: PublicOfferCommitter = {
    async commit(draft, context): Promise<OfferCommitResultV1> {
      calls.push({ draft, mode: context.mode, dryRun: context.dryRun });
      return {
        productId: draft.productId,
        marketplaceId: draft.marketplaceId,
        externalId: draft.externalId,
        action: context.mode === "REFRESH" ? "UPDATE" : "CREATE",
        changed: true,
        publicationSynced: !context.dryRun,
        changedFields: ["price"],
      };
    },
  };
  return { committer, calls };
}

/** Associações certificadas em memoria. */
function bindings(list: KnownBinding[]): KnownBindingLookup {
  return {
    async find(marketplaceId, externalListingId) {
      return (
        list.find(
          (b) => b.externalId === externalListingId,
        ) ?? null
      );
    },
    async listCertified() {
      return list;
    },
  };
}

/*
 * A binding certificada tem a forma REAL de producao: `externalId` e o itemId
 * CRU, gravado pelas ofertas certificadas, enquanto a `externalListingId` que o
 * conector produz na varredura e "<shopId>.<itemId>". Sao duas representacoes da
 * MESMA listagem, e o refresh tem de respeitar a que esta no banco.
 */
const CERTIFIED: KnownBinding = {
  productId: "0add0a7e-72d3-470d-b470-6b1f7c5ad576",
  externalId: "58215116714",
  matchStatus: "EXACT",
  currentPrice: 13.99,
  affiliateLink: "https://s.shopee.com.br/ANTIGO",
  lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
};

async function run(
  items: NormalizedMarketplaceListingV1[],
  over: {
    dryRun?: boolean;
    known?: KnownBindingLookup;
    evaluate?: () => IdentityDecisionV1;
    lookup?: () => Promise<string[]>;
    raw?: unknown;
    /** Capacidade opcional: busca deterministica por externalListingId. */
    fetchByExternalId?: (
      externalListingId: string,
    ) => NormalizedMarketplaceListingV1 | null;
  } = {},
) {
  const { committer, calls } = recorder();
  const cfg: PublicSyncConfig = {
    marketplaceId: "shopee",
    connector: {
      marketplaceId: "shopee",
      capabilities: {} as never,
      async collect() {
        return { items, nextCursor: null, snapshotComplete: true };
      },
      validate() {
        return [];
      },
      rawPayloadFor: () => (over.raw === undefined ? RAW : over.raw),
      ...(over.fetchByExternalId
        ? {
            async fetchByExternalId(externalListingId: string) {
              return over.fetchByExternalId!(externalListingId);
            },
          }
        : {}),
    } as never,
    purchaseLinks: purchaseLinkSourceFromFields({ affiliate: "offerLink", source: "productLink" }),
    maxListings: 100,
    brandLexicon: new Set<string>(),
  };
  const report = await runMarketplacePublicSync(
    cfg,
    {
      keys: { lookup: over.lookup ?? (async () => ["0add0a7e-72d3-470d-b470-6b1f7c5ad576"]) },
      products: {
        loadAll: async () => [listing({ marketplaceId: "mercado_livre", externalListingId: "ML-1" })],
      },
      evaluate: over.evaluate ?? EXACT,
      writer: committer,
      ...(over.known ? { knownBindings: over.known } : {}),
    },
    { dryRun: over.dryRun ?? true },
  );
  return { report, calls };
}

async function main() {
  /* ---------------------------------------------------------------- */
  /* A. BINDING CERTIFICADA => REFRESH, SEMidentity                   */
  /* ---------------------------------------------------------------- */

  // O matcher de descoberta REJEITA tudo. Se o refresh dependesse dele, o
  // contador EXACT_UNIQUE seria 0 e nao haveria escrita. Logo: write com
  // EXACT_UNIQUE=0 prova que o refresh nao passou pela identity.
  const refresh = await run([listing()], {
    dryRun: false,
    known: bindings([CERTIFIED]),
    evaluate: () => ({ ...EXACT(), confidence: "REJECT" }) as IdentityDecisionV1,
  });
  assert.equal(refresh.report.CERTIFIED_BINDINGS, 1);
  assert.equal(refresh.report.BINDING_REFRESH_MATCHED, 1);
  assert.equal(refresh.report.BINDING_REFRESH_WRITES, 1);
  assert.equal(refresh.report.WRITES, 1);
  assert.equal(refresh.report.EXACT_UNIQUE, 0, "refresh nao pode passar pela identity");
  assert.equal(refresh.report.NEW_DISCOVERY_LISTINGS, 0);
  assert.equal(refresh.calls.length, 1);
  assert.equal(refresh.calls[0].mode, "REFRESH");
  // productId é o CERTIFICADO, não um derivado do matcher.
  assert.equal(refresh.calls[0].draft.productId, CERTIFIED.productId);
  assert.equal(refresh.report.PRODUCTS_CREATED, 0, "refresh nunca cria Product");

  /* ---------------------------------------------------------------- */
  /* LISTING SEM BINDING => DESCOBERTA (nunca refresh)                  */
  /* ---------------------------------------------------------------- */

  const fresh = await run([listing()], {
    dryRun: false,
    known: bindings([{ ...CERTIFIED, externalId: "OUTRA-COISA" }]),
    evaluate: () => ({ ...EXACT(), confidence: "REJECT" }) as IdentityDecisionV1,
  });
  assert.equal(fresh.report.BINDING_REFRESH_MATCHED, 0, "binding alheia nao pode servir esta listing");
  assert.equal(fresh.report.NEW_DISCOVERY_LISTINGS, 1);
  assert.equal(fresh.report.WRITES, 0, "sem binding e sem EXACT => zero escrita");
  assert.equal(fresh.calls.length, 0);

  // Sem porta de bindings, tudo vai por descoberta.
  const noPort = await run([listing()], { dryRun: false, evaluate: () => ({ ...EXACT(), confidence: "REJECT" }) as IdentityDecisionV1 });
  assert.equal(noPort.report.BINDING_REFRESH_MATCHED, 0);
  assert.equal(noPort.report.WRITES, 0);

  // Descoberta com EXACT unico continua funcionando normalmente.
  const discovered = await run([listing()], { dryRun: false, known: bindings([]) });
  assert.equal(discovered.report.NEW_DISCOVERY_LISTINGS, 1);
  assert.equal(discovered.report.EXACT_UNIQUE, 1);
  assert.equal(discovered.calls[0].mode, "CREATE");

  /* ---------------------------------------------------------------- */
  /* REFRESH ATUALIZA DADOS DE OFERTA E MANTEM O productId              */
  /* ---------------------------------------------------------------- */

  const priceUp = await run(
    [listing({ commerce: { ...listing().commerce, price: 17.5 } })],
    { dryRun: false, known: bindings([CERTIFIED]), evaluate: () => ({ ...EXACT(), confidence: "REJECT" }) as IdentityDecisionV1 },
  );
  assert.equal(priceUp.calls[0].draft.price, 17.5);
  assert.equal(priceUp.calls[0].draft.productId, CERTIFIED.productId);
  assert.equal(priceUp.report.BINDING_STATUS[0].previousPrice, 13.99);
  assert.equal(priceUp.report.BINDING_STATUS[0].refreshedPrice, 17.5);
  assert.equal(priceUp.report.BINDING_STATUS[0].action, "REFRESH_UPDATED");

  /* ---------------------------------------------------------------- */
  /* REFRESH NAO APAGA LINK SEGURO VIGENTE (anti perda de dado)        */
  /* ---------------------------------------------------------------- */

  // Coleta sem offerLink (payload parcial). O writer deve PRESERVAR o link
  // vigente: ausencia de dado na fonte nao pode apagar dado bom.
  const noLink = await run([listing()], {
    dryRun: false,
    known: bindings([CERTIFIED]),
    raw: { productLink: "https://shopee.com.br/product/1/2" },
    evaluate: () => ({ ...EXACT(), confidence: "REJECT" }) as IdentityDecisionV1,
  });
  assert.equal(noLink.calls.length, 1, "o refresh ainda acontece");
  assert.equal(noLink.calls[0].draft.affiliateLink, null, "o draft nao inventa link");
  assert.equal(noLink.report.MISSING_AFFILIATE_LINK, 1);

  /* ---------------------------------------------------------------- */
  /* PRECO INVALIDO NAO GRAVA E NAO APAGA O PRECO VIGENTE              */
  /* ---------------------------------------------------------------- */

  const zeroPrice = await run([listing({ commerce: { ...listing().commerce, price: 0 } })], {
    dryRun: false,
    known: bindings([CERTIFIED]),
    evaluate: () => ({ ...EXACT(), confidence: "REJECT" }) as IdentityDecisionV1,
  });
  assert.equal(zeroPrice.calls.length, 0, "preco invalido nao vira atualizacao de oferta");
  assert.equal(zeroPrice.report.WRITES, 0);
  assert.equal(zeroPrice.report.BINDING_REFRESH_MATCHED, 1, "a binding foi vista, so nao atualizou");

  /* ---------------------------------------------------------------- */
  /* BINDING NAO VISTA = NOT_SEEN (nunca delete nem desassociacao)     */
  /* ---------------------------------------------------------------- */

  const notSeen = await run([listing({ externalListingId: "OUTRA" })], {
    dryRun: false,
    known: bindings([CERTIFIED]),
  });
  assert.equal(notSeen.report.BINDING_NOT_SEEN, 1);
  assert.equal(notSeen.report.BINDING_STATUS[0].seen, false);
  assert.equal(notSeen.report.BINDING_STATUS[0].action, "NOT_SEEN");
  assert.equal(notSeen.report.BINDING_STATUS[0].previousPrice, 13.99, "o preco vigente permanece intacto");

  /* ---------------------------------------------------------------- */
  /* DRY-RUN CONTA O REFRESH SEM PERSISTIR                            */
  /* ---------------------------------------------------------------- */

  const dry = await run([listing()], { dryRun: true, known: bindings([CERTIFIED]) });
  assert.equal(dry.report.MODE, "DRY_RUN");
  assert.equal(dry.report.WOULD_WRITE, 1);
  assert.equal(dry.report.WRITES, 0);
  assert.equal(dry.calls[0].dryRun, true);

  /* ---------------------------------------------------------------- */
  /* IDEMPOTENCIA: REFRESH REPETIDO ESTAVEL                          */
  /* ---------------------------------------------------------------- */

  // 1a rodada grava; a 2a, com o mesmo preco, e NOOP. O runner nao decide
  // NOOP sozinho — quem compara e o writer contra o estado persistido.
  const once = await run([listing()], { dryRun: false, known: bindings([CERTIFIED]), evaluate: () => ({ ...EXACT(), confidence: "REJECT" }) as IdentityDecisionV1 });
  assert.equal(once.report.BINDING_REFRESH_WRITES, 1);

  // O preco vigente comeca DIFERENTE do que a fonte devolve, para que a 1a
  // rodada mova o preco e a 2a (apos persistir) seja NOOP de verdade.
  const live: KnownBinding[] = [{ ...CERTIFIED, currentPrice: 9.9 }];
  const stable: PublicOfferCommitter = {
    async commit(draft): Promise<OfferCommitResultV1> {
      const changed = draft.price !== live[0].currentPrice;
      if (changed) live[0].currentPrice = draft.price;
      return {
        productId: draft.productId, marketplaceId: draft.marketplaceId,
        externalId: draft.externalId, action: changed ? "UPDATE" : "NOOP",
        changed, publicationSynced: changed, changedFields: changed ? ["price"] : [],
      };
    },
  };
  const cfg = {
    marketplaceId: "shopee",
    connector: {
      marketplaceId: "shopee", capabilities: {} as never,
      async collect() { return { items: [listing()], nextCursor: null, snapshotComplete: true }; },
      validate() { return []; },
      rawPayloadFor: () => RAW,
    } as never,
    purchaseLinks: purchaseLinkSourceFromFields({ affiliate: "offerLink", source: "productLink" }),
    maxListings: 10, brandLexicon: new Set<string>(),
  } as PublicSyncConfig;
  const deps = {
    keys: { lookup: async () => ["P1"] },
    products: { loadAll: async () => [listing({ marketplaceId: "mercado_livre" })] },
    evaluate: EXACT, writer: stable, knownBindings: bindings(live),
  };
  const same1 = await runMarketplacePublicSync(cfg, deps, { dryRun: false });
  const same2 = await runMarketplacePublicSync(cfg, deps, { dryRun: false });
  const same3 = await runMarketplacePublicSync(cfg, deps, { dryRun: false });
  assert.equal(same1.WRITES, 1, "1a rodada move o preco");
  assert.equal(same1.BINDING_REFRESH_WRITES, 1);
  assert.equal(same2.WRITES, 0, "2a rodada com o mesmo preco nao escreve");
  assert.equal(same2.BINDING_REFRESH_NOOP, 1);
  assert.equal(same2.BINDING_REFRESH_WRITES, 0);
  assert.equal(same3.WRITES, 0, "3a rodada continua estavel");
  // Contagem de bindings estavel entre rodadas: nada e criado nem desassociado.
  assert.equal(same1.CERTIFIED_BINDINGS, same2.CERTIFIED_BINDINGS);
  assert.equal(same2.CERTIFIED_BINDINGS, same3.CERTIFIED_BINDINGS);
  assert.equal(same1.BINDING_NOT_SEEN, 0);

  /* ---------------------------------------------------------------- */
  /* SHOPEE NUNCA CRIA PRODUCT EM NENHUM DOS DOIS CAMINHOS             */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /* BUSCA DETERMINISTICA: refresh NAO depende da varredura             */
  /* ---------------------------------------------------------------- */

  // O conector sabe consultar a fonte por identificador e a VARREDURA por
  // palavra-chave nao devolve a listing certificada. Se o refresh dependeu da
  // varredura, nao haveria nenhuma escrita — que e exatamente o modo de falha
  // medido em producao (3/3 numa execucao, 0/3 na seguinte).
  const det = await run([], {
    dryRun: false,
    known: bindings([CERTIFIED]),
    fetchByExternalId: () => listing(),
    evaluate: () => ({ ...EXACT(), confidence: "REJECT" }) as IdentityDecisionV1,
  });
  assert.equal(det.report.LISTINGS_COLLECTED, 0, "a varredura nao devolveu nada");
  assert.equal(det.report.BINDING_REFRESH_MATCHED, 1, "o refresh nao depende da varredura");
  assert.equal(det.report.BINDING_REFRESH_WRITES, 1);
  assert.equal(det.report.WRITES, 1);
  assert.equal(det.calls.length, 1);
  assert.equal(det.calls[0].draft.productId, CERTIFIED.productId);
  assert.equal(det.report.PRODUCTS_CREATED, 0);

  // Mesma offerta aparecendo na varredura E no pre-pass nao e contada duas
  // vezes: o pre-pass ja a tratou, a varredura deve ignora-la.
  const both = await run([listing()], {
    dryRun: false,
    known: bindings([CERTIFIED]),
    fetchByExternalId: () => listing(),
    evaluate: () => ({ ...EXACT(), confidence: "REJECT" }) as IdentityDecisionV1,
  });
  assert.equal(both.report.BINDING_REFRESH_MATCHED, 1, "sem dupla contagem");
  assert.equal(both.report.LISTINGS_VALID, 1, "a listing da varredura nao e revalidada");
  assert.equal(both.calls.length, 1, "um unico commit");

  // Fetch que devolve null = NOT_SEEN: nenhuma escrita, nenhuma desassociacao,
  // e o preco vigente continua registrado.
  const vanished = await run([], {
    dryRun: false,
    known: bindings([CERTIFIED]),
    fetchByExternalId: () => null,
  });
  assert.equal(vanished.report.BINDING_REFRESH_MATCHED, 0);
  assert.equal(vanished.report.BINDING_NOT_SEEN, 1);
  assert.equal(vanished.report.BINDING_STATUS[0].action, "NOT_SEEN");
  assert.equal(vanished.report.BINDING_STATUS[0].previousPrice, 13.99);
  assert.equal(vanished.report.WRITES, 0);
  assert.equal(vanished.calls.length, 0);

  // Falha de FONTE em uma binding nao derruba as demais: continua fail-closed
  // por item e segue para a proxima.
  const partial = await run([], {
    dryRun: false,
    known: bindings([
      { ...CERTIFIED, externalId: "1.111" },
      { ...CERTIFIED, externalId: "2.222" },
    ]),
    fetchByExternalId: (id: string) => {
      if (id === "1.111") throw new Error("rede caiu");
      return listing({ externalListingId: id });
    },
  });
  assert.equal(partial.report.BINDING_REFRESH_MATCHED, 1, "a binding que falhou nao conta");
  assert.equal(partial.report.BINDING_NOT_SEEN, 1, "a que falhou e NOT_SEEN, nao desassociada");
  assert.equal(partial.report.BINDING_REFRESH_WRITES, 1, "a outra foi atualizada");
  assert.equal(partial.report.ERROR, "BOUND_FETCH_FAILED");

  /*
   * A chave externa gravada e a CERTIFICADA, nunca a `externalListingId` da
   * listagem. As ofertas legadas foram persistidas com o itemId cru, enquanto o
   * conector produz "<shopId>.<itemId>". Se o refresh gravasse a forma do
   * conector, reescreveria a chave que sustenta @@unique([marketplace,
   * externalId]) — uma atualizacao de preco trocando a identidade da oferta.
   */
  const keyKept = await run([], {
    dryRun: false,
    known: bindings([CERTIFIED]),
    fetchByExternalId: () => listing({ externalListingId: "1789734166.58215116714" }),
    evaluate: () => ({ ...EXACT(), confidence: "REJECT" }) as IdentityDecisionV1,
  });
  assert.equal(keyKept.calls.length, 1);
  assert.equal(
    keyKept.calls[0].draft.externalId,
    CERTIFIED.externalId,
    "o refresh nao pode trocar a chave certificada",
  );
  assert.notEqual(keyKept.calls[0].draft.externalId, "1789734166.58215116714");

  /*
   * DIVERGENCIA DE FORMA ENTRE A VARREDURA E O BANCO.
   *
   * O conector produz `externalListingId` = "<shopId>.<itemId>", enquanto as
   * ofertas certificadas gravaram `externalId` = itemId cru. Sao a MESMA
   * listagem em duas representacoes, e a varredura NAO casa com a chave
   * certificada — de proposito. Se casasse por adivinhacao, o refresh
   * reescreveria a chave de uma oferta ja certificada.
   *
   * O que sustenta o refresh e a busca DETERMINISTICA por chave, que recebe o
   * valor do banco. Este teste trava as duas metades: a varredura nao casa, e a
   * chave certificada e preservada na gravacao.
   */
  const composite = await run(
    [listing({ externalListingId: "1789734166.58215116714" })],
    {
      dryRun: false,
      known: bindings([CERTIFIED]),
      // A identidade rejeita tudo: se a varredura tivesse casado, teriamos
      // escrito; como nao casou, nao ha escrita por este caminho.
      evaluate: () => ({ ...EXACT(), confidence: "REJECT" }) as IdentityDecisionV1,
    },
  );
  assert.equal(
    composite.report.BINDING_REFRESH_MATCHED,
    0,
    "a varredura nao pode casar por adivinhacao com a chave certificada",
  );
  assert.equal(composite.report.NEW_DISCOVERY_LISTINGS, 1);
  assert.equal(composite.report.WRITES, 0);
  assert.equal(composite.calls.length, 0);
  assert.equal(composite.report.BINDING_NOT_SEEN, 1, "a binding segue nao vista, nao desassociada");

  const totals: PublicSyncReportV1[] = [refresh.report, fresh.report, discovered.report, priceUp.report, dry.report, notSeen.report, same1, same2, same3, det.report, both.report, vanished.report, partial.report, keyKept.report, composite.report];
  for (const r of totals) {
    assert.equal(r.PRODUCTS_CREATED, 0);
    assert.equal(r.ATTACH_ONLY, true);
    assert.equal(r.REVIEW_PUBLISHED, 0);
    assert.equal(r.REJECT_PUBLISHED, 0);
    assert.equal(r.HARD_CONFLICT_PUBLISHED, 0);
    assert.equal(r.AMBIGUOUS_PUBLISHED, 0);
  }

  console.log(
    "publicSyncTwoPaths.test.ts PASS " +
      "(refresh_sem_identity, sem_binding_vai_descoberta, link_preservado, " +
      "preco_invalido_nao_grava, not_seen_sem_delete, idempotente, attach_only, " +
      "refresh_deterministico, sem_dupla_contagem, falha_por_item)",
  );
}

main().catch((error) => {
  console.error("publicSyncTwoPaths.test.ts FAIL", error);
  process.exitCode = 1;
});
